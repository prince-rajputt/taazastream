import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { APP_VERSION } from '../config';
import type { AppContext } from '../context';
import { ok } from '../http/errors';

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext) {
  /** Liveness/readiness. Works with the internet unplugged; cloud state is informational only. */
  app.get('/api/health', async (_req, reply) => {
    const dbOk = await ctx.database.ping();
    const cloud = ctx.cloud.status;
    reply.header('Cache-Control', 'no-store');
    return reply.code(dbOk ? 200 : 503).send(
      ok({
        status: dbOk ? 'ok' : 'degraded',
        version: APP_VERSION,
        uptimeSec: Math.round((Date.now() - ctx.startedAt) / 1000),
        database: dbOk ? 'ok' : 'unavailable',
        ffmpeg: ctx.ffmpeg.ffmpeg.available,
        ffprobe: ctx.ffmpeg.ffprobe.available,
        mode: cloud.mode,
        cloudReachable: cloud.reachable,
        time: new Date().toISOString(),
      }),
    );
  });

  /** Public "connect another device" info (LAN URLs + QR code). */
  app.get('/api/connect', async () => {
    const info = ctx.serverInfo();
    const qrSvg = await QRCode.toString(info.primaryUrl, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b0b10', light: '#ffffff' },
    });
    return ok({ name: info.name, primaryUrl: info.primaryUrl, urls: info.urls, mdnsHost: info.mdnsHost, qrSvg });
  });
}
