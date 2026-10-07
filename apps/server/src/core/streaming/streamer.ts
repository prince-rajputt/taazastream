import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import { AppError, fsError } from '../../http/errors';
import { isInsideAny } from '../paths';
import { parseRange, videoMimeType } from './range';
import { StreamTracker } from './tracker';

export interface StreamableVideo {
  id: string;
  path: string;
  fileName: string;
  title: string;
  folderPath: string;
}

/** 256 KiB reads: few syscalls, low memory, quick first byte. */
const READ_CHUNK = 256 * 1024;

/**
 * LocalVideoStreamer — direct HTTP Range streaming of the original file.
 *
 * The file is never loaded into memory: a bounded `fs.ReadStream` is piped to the socket
 * and Node's backpressure throttles disk reads to the client's network speed. Client
 * disconnects destroy the read stream immediately, releasing the file handle.
 */
export class LocalVideoStreamer {
  constructor(
    private readonly tracker: StreamTracker,
    private readonly log: Logger,
    private readonly limits: () => { maxStreams: number },
  ) {}

  async stream(
    request: FastifyRequest,
    reply: FastifyReply,
    video: StreamableVideo,
  ): Promise<FastifyReply> {
    // Defence in depth: the DB path must still be inside its registered media folder.
    if (!isInsideAny([video.folderPath], video.path)) {
      this.log.warn({ videoId: video.id }, 'refusing to stream file outside media folder');
      throw new AppError(403, 'FORBIDDEN', 'File is outside the media library');
    }

    let size: number;
    let mtime: Date;
    try {
      const st = await stat(video.path);
      if (!st.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
      size = st.size;
      mtime = st.mtime;
    } catch (err) {
      throw fsError(err, 'Video file');
    }

    const ip = request.ip;
    const ua = request.headers['user-agent'];
    const streamKey = StreamTracker.key(ip, ua, video.id);
    if (
      !this.tracker.isActive(streamKey) &&
      this.tracker.activeCount(streamKey) >= this.limits().maxStreams
    ) {
      throw new AppError(
        503,
        'STREAM_LIMIT',
        'The server is busy: maximum number of simultaneous streams reached',
      );
    }

    const etag = `"${size.toString(16)}-${Math.floor(mtime.getTime()).toString(16)}"`;
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', videoMimeType(video.fileName));
    reply.header('ETag', etag);
    reply.header('Last-Modified', mtime.toUTCString());
    // Private: the browser may cache ranges, shared proxies may not.
    reply.header('Cache-Control', 'private, max-age=3600');
    reply.header(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(path.basename(video.fileName))}`,
    );
    reply.header('X-Content-Type-Options', 'nosniff');

    // If-Range: only honour the Range when the validator still matches.
    const ifRange = request.headers['if-range'];
    const rangeHeader =
      ifRange && ifRange !== etag && ifRange !== mtime.toUTCString()
        ? undefined
        : request.headers.range;
    const parsed = parseRange(rangeHeader, size);

    if (parsed.type === 'unsatisfiable') {
      reply.header('Content-Range', `bytes */${size}`);
      throw new AppError(416, 'RANGE_NOT_SATISFIABLE', 'Requested range not satisfiable');
    }

    const start = parsed.type === 'partial' ? parsed.range.start : 0;
    const end = parsed.type === 'partial' ? parsed.range.end : size - 1;
    const length = end - start + 1;

    if (parsed.type === 'partial') {
      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${size}`);
    } else {
      reply.code(200);
    }
    reply.header('Content-Length', String(length));

    this.tracker.record({
      ip,
      ua,
      videoId: video.id,
      title: video.title,
      mode: 'direct',
      quality: 'original',
      bytes: 0,
    });

    if (request.method === 'HEAD') {
      // Answer HEAD directly so the real Content-Length is preserved (no body is sent).
      reply.hijack();
      reply.raw.writeHead(reply.statusCode, reply.getHeaders() as Record<string, string>);
      reply.raw.end();
      return reply;
    }

    const fileStream = createReadStream(video.path, { start, end, highWaterMark: READ_CHUNK });
    fileStream.on('data', (chunk) => this.tracker.addBytes(ip, ua, video.id, chunk.length));
    fileStream.on('error', (err) => {
      this.log.warn({ videoId: video.id, err: err.message }, 'stream read error');
    });
    // Release the file handle as soon as the client goes away (seek, tab closed, Wi-Fi drop).
    request.raw.once('close', () => {
      if (!fileStream.destroyed) fileStream.destroy();
    });
    return reply.send(fileStream);
  }
}
