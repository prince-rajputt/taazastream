import { existsSync } from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { Prisma, type User } from '@prisma/client';
import { idSchema } from '@taazastream/shared';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance, type FastifyRequest } from 'fastify';
import type { AppContext } from './context';
import { isPrivateAddress } from './core/system';
import { AppError, failure } from './http/errors';
import { registerAdminRoutes } from './routes/admin';
import { registerAuthRoutes } from './routes/auth';
import { registerCatalogRoutes } from './routes/catalog';
import { registerHealthRoutes } from './routes/health';
import { registerPlaybackRoutes } from './routes/playback';
import { registerProfileRoutes } from './routes/profiles';

declare module 'fastify' {
  interface FastifyRequest {
    profileId: string;
    adminUser: User | null;
  }
}

export const ADMIN_COOKIE = 'ts_admin';
export const CSRF_HEADER = 'x-taazastream';

/** Paths that legitimately generate many requests per second while playing. */
const MEDIA_PATH = /^\/api\/(stream|hls|images|subtitles)\//;

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: ctx.log as unknown as FastifyBaseLogger,
    trustProxy: ctx.config.trustProxy,
    // Per-request access logs are disabled: a playing video makes many range/segment requests.
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 1024 * 1024,
    // Long-lived keep-alive connections make seeking and HLS segment fetches faster on LAN.
    keepAliveTimeout: 65_000,
    connectionTimeout: 0,
    requestTimeout: 0,
    routerOptions: { ignoreTrailingSlash: true, maxParamLength: 200 },
  });

  app.decorateRequest('profileId', '');
  app.decorateRequest('adminUser', null);

  /* ------------------------------ Security ------------------------------ */
  await app.register(helmet, {
    // Plain HTTP on a private LAN is the norm: never upgrade or pin HTTPS.
    hsts: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    referrerPolicy: { policy: 'same-origin' },
  });

  await app.register(cors, {
    // Same-origin by default. Extra origins (e.g. the Vite dev server) are opt-in via CORS_ORIGINS.
    origin: ctx.config.corsOrigins.length ? ctx.config.corsOrigins : false,
    credentials: true,
  });

  await app.register(rateLimit, {
    global: true,
    max: 900,
    timeWindow: '1 minute',
    allowList: (req) => MEDIA_PATH.test(req.url) || !req.url.startsWith('/api/'),
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      ...failure('RATE_LIMITED', `Too many requests. Try again in ${Math.ceil(context.ttl / 1000)}s.`),
    }),
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 10 } });

  /* ------------------------------ Hooks ------------------------------ */
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;

    // Device registry for the admin dashboard (IP + coarse device class only).
    if (!MEDIA_PATH.test(request.url)) ctx.tracker.touchDevice(request.ip, request.headers['user-agent']);

    // CSRF: state-changing API calls must carry a custom header. Browsers cannot add it
    // cross-site without a CORS preflight, which we do not grant.
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (unsafe && request.headers[CSRF_HEADER] !== '1') {
      reply.code(403).send(failure('FORBIDDEN', 'Missing request header'));
      return reply;
    }

    // Viewer profile (no account needed). Unknown/invalid ids fall back to the default profile.
    const header = request.headers['x-profile-id'];
    const pid = typeof header === 'string' && idSchema.safeParse(header).success ? header : null;
    request.profileId = pid ?? ctx.defaultProfileId;

    if (request.url.startsWith('/api/admin')) {
      if (!ctx.config.allowPublicAdmin && !isPrivateAddress(request.ip)) {
        ctx.log.warn({ ip: request.ip }, 'admin API request from public address rejected');
        reply.code(403).send(failure('FORBIDDEN', 'Admin is only available on the local network'));
        return reply;
      }
      const user = await ctx.auth.validateSession(request.cookies[ADMIN_COOKIE]);
      if (!user) {
        reply.code(401).send(failure('UNAUTHORIZED', 'Admin login required'));
        return reply;
      }
      request.adminUser = user;
    }
  });

  // Make sure profile ids point at real viewer profiles.
  app.addHook('preHandler', async (request: FastifyRequest) => {
    if (!request.url.startsWith('/api/') || request.profileId === ctx.defaultProfileId || MEDIA_PATH.test(request.url)) return;
    const exists = await ctx.db.user.findUnique({ where: { id: request.profileId }, select: { role: true } });
    if (!exists || exists.role !== 'VIEWER') request.profileId = ctx.defaultProfileId;
  });

  /* ------------------------------ Errors ------------------------------ */
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error.message, code: error.code, url: request.url.split('?')[0] }, 'request failed');
      return reply.code(error.statusCode).send(failure(error.code, error.message, error.details));
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') return reply.code(404).send(failure('NOT_FOUND', 'Not found'));
      if (error.code === 'P2002') return reply.code(409).send(failure('CONFLICT', 'Already exists'));
      request.log.error({ err: error.message, code: error.code }, 'database error');
      return reply.code(500).send(failure('DATABASE_ERROR', 'Database error'));
    }
    if (error instanceof Prisma.PrismaClientInitializationError || error instanceof Prisma.PrismaClientRustPanicError) {
      request.log.error({ err: error.message }, 'database unavailable');
      return reply.code(503).send(failure('DATABASE_ERROR', 'Database unavailable'));
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status === 429) return reply.code(429).send(failure('RATE_LIMITED', 'Too many requests'));
    if (status === 413 || (error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send(failure('BAD_REQUEST', 'Upload too large'));
    }
    if (status >= 400 && status < 500) {
      return reply.code(status).send(failure('BAD_REQUEST', (error as Error).message || 'Bad request'));
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOSPC') return reply.code(507).send(failure('DISK_FULL', 'The server disk is full'));
    request.log.error({ err: (error as Error).message, stack: (error as Error).stack }, 'unhandled error');
    return reply.code(500).send(failure('INTERNAL_ERROR', 'Something went wrong on the server'));
  });

  /* ------------------------------ Routes ------------------------------ */
  await app.register(async (api) => {
    registerHealthRoutes(api, ctx);
    registerAuthRoutes(api, ctx);
    registerProfileRoutes(api, ctx);
    registerCatalogRoutes(api, ctx);
    registerPlaybackRoutes(api, ctx);
    registerAdminRoutes(api, ctx);
  });

  /* ------------------------------ Web app (PWA) ------------------------------ */
  const webDist = ctx.config.webDist;
  const hasWeb = existsSync(path.join(webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      // Serve files dynamically so a rebuilt web app works without restarting the server.
      wildcard: true,
      index: ['index.html'],
      etag: true,
      lastModified: true,
      setHeaders(res, filePath) {
        const name = path.basename(filePath);
        if (name === 'index.html' || name === 'sw.js' || name.startsWith('workbox-') || name === 'manifest.webmanifest' || name === 'registerSW.js') {
          res.header('Cache-Control', 'no-cache');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.header('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.header('Cache-Control', 'public, max-age=86400');
        }
      },
    });
  }

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send(failure('NOT_FOUND', 'Endpoint not found'));
    if (request.method !== 'GET' && request.method !== 'HEAD') return reply.code(404).send(failure('NOT_FOUND', 'Not found'));
    // Missing static files (e.g. an old hashed bundle) must 404, never fall back to HTML.
    if (/\.[a-z0-9]{1,8}$/i.test(request.url.split('?')[0]!)) return reply.code(404).type('text/plain').send('Not found');
    if (!hasWeb) {
      return reply
        .code(503)
        .type('text/html')
        .send('<h1>TaazaStream</h1><p>The web app has not been built yet. Run <code>pnpm build</code>.</p>');
    }
    // SPA fallback: client-side routes (/movie/123, /admin, ...) get index.html.
    reply.header('Cache-Control', 'no-cache');
    return reply.sendFile('index.html');
  });

  return app;
}
