import { createReadStream } from 'node:fs';
import type { SharedFile } from '@taazastream/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { SHARED_LIMITS, SharedFileError } from '../core/shared-files';
import { parseRange } from '../core/streaming/range';
import { AppError, badRequest, fsError, notFound, ok } from '../http/errors';
import { parse } from '../http/validate';

const kindParams = z.object({ kind: z.enum(['pdf', 'image']) });
const idParams = z.object({ id: z.string().max(32) });

/** `attachment`/`inline` header that keeps non-ASCII (e.g. Hindi) file names intact. */
function disposition(type: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Shared PDFs and gallery images. Every device on the LAN can list, view and download;
 * only the signed-in admin can upload or delete (enforced by the /api/admin hook).
 */
export function registerSharedRoutes(app: FastifyInstance, ctx: AppContext) {
  const store = ctx.sharedFiles;

  app.get('/api/shared/:kind', async (request) => {
    const { kind } = parse(kindParams, request.params);
    return ok(store.list(kind));
  });

  app.get('/api/shared-files/:id', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const { download } = parse(z.object({ download: z.string().optional() }), request.query);
    const found = store.resolve(id);
    if (!found) throw notFound('File');

    reply
      .header('Content-Type', found.type)
      .header('Content-Disposition', disposition(download ? 'attachment' : 'inline', found.name))
      .header('Accept-Ranges', 'bytes')
      .header('Cache-Control', 'private, max-age=86400');
    // The browser's built-in PDF viewer is blocked by the app's strict CSP (object-src 'none').
    if (found.type === 'application/pdf') reply.removeHeader('Content-Security-Policy');

    // Range support lets PDF viewers open large files page by page.
    const range = parseRange(request.headers.range, found.sizeBytes);
    if (range.type === 'unsatisfiable') {
      reply.header('Content-Range', `bytes */${found.sizeBytes}`);
      throw new AppError(416, 'RANGE_NOT_SATISFIABLE', 'Requested range not satisfiable');
    }
    try {
      if (range.type === 'partial') {
        const { start, end } = range.range;
        reply
          .code(206)
          .header('Content-Range', `bytes ${start}-${end}/${found.sizeBytes}`)
          .header('Content-Length', end - start + 1);
        return reply.send(createReadStream(found.file, { start, end }));
      }
      reply.header('Content-Length', found.sizeBytes);
      return reply.send(createReadStream(found.file));
    } catch (err) {
      throw fsError(err);
    }
  });

  app.get('/api/shared-files/:id/thumb', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const thumb = store.resolveThumb(id);
    if (!thumb) throw notFound('Thumbnail');
    reply
      .header('Content-Type', thumb.type)
      .header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.send(createReadStream(thumb.file));
  });

  /* ------------------------------ Admin ------------------------------ */
  app.post('/api/admin/shared/:kind', async (request) => {
    const { kind } = parse(kindParams, request.params);
    if (!request.isMultipart()) throw badRequest('Expected a multipart/form-data upload');
    const saved: SharedFile[] = [];
    try {
      const parts = request.files({
        limits: { files: 50, fileSize: SHARED_LIMITS[kind].maxBytes },
      });
      for await (const part of parts) saved.push(await store.save(kind, part.filename, part.file));
    } catch (err) {
      if (err instanceof SharedFileError) throw badRequest(err.message, { saved });
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE')
        throw badRequest(`File is larger than ${SHARED_LIMITS[kind].label}`, { saved });
      if ((err as { code?: string }).code === 'FST_FILES_LIMIT')
        throw badRequest('Upload at most 50 files at a time', { saved });
      if ((err as NodeJS.ErrnoException).code === 'ENOSPC') throw fsError(err);
      throw err;
    }
    if (!saved.length) throw badRequest('No file uploaded');
    ctx.log.info({ kind, count: saved.length }, 'shared files uploaded');
    return ok(saved);
  });

  app.delete('/api/admin/shared-files/:id', async (request) => {
    const { id } = parse(idParams, request.params);
    if (!(await store.remove(id))) throw notFound('File');
    return ok({ deleted: true });
  });
}
