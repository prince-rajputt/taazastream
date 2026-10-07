import { isWatched, type WatchProgressInput } from '@taazastream/shared';
import type { Logger } from 'pino';
import type { Db } from '../core/database';
import { notFound } from '../http/errors';

interface Pending {
  userId: string;
  videoId: string;
  movieId: string | null;
  episodeId: string | null;
  seriesId: string | null;
  positionSec: number;
  durationSec: number;
  completed: boolean;
  sessionId: string | null;
  at: number;
}

/** Flush buffered progress at most this often. */
const FLUSH_INTERVAL_MS = 15_000;

/**
 * Watch progress with debounced writes.
 *
 * Players report every ~10 s; updates are coalesced in memory per (profile, video) and written
 * to SQLite in one transaction every 15 s, immediately on pause/stop/complete, and on shutdown.
 * A two-hour film therefore costs a few hundred small writes, not one per second.
 */
export class ProgressService {
  private pending = new Map<string, Pending>();
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private videoCache = new Map<string, { movieId: string | null; episodeId: string | null; seriesId: string | null; durationSec: number }>();
  writes = 0;

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  private async videoMeta(videoId: string) {
    const cached = this.videoCache.get(videoId);
    if (cached) return cached;
    const v = await this.db.videoFile.findUnique({
      where: { id: videoId },
      select: { movieId: true, episodeId: true, durationSec: true, episode: { select: { seriesId: true } } },
    });
    if (!v) throw notFound('Video');
    const meta = { movieId: v.movieId, episodeId: v.episodeId, seriesId: v.episode?.seriesId ?? null, durationSec: v.durationSec };
    if (this.videoCache.size > 2000) this.videoCache.clear();
    this.videoCache.set(videoId, meta);
    return meta;
  }

  /** Record a progress report. `immediate` forces a flush (pause, stop, page hide). */
  async record(userId: string, input: WatchProgressInput, immediate = false): Promise<{ completed: boolean }> {
    const meta = await this.videoMeta(input.videoId);
    const durationSec = input.durationSec > 0 ? input.durationSec : meta.durationSec;
    const positionSec = Math.min(input.positionSec, durationSec || input.positionSec);
    const completed = input.completed === true || isWatched(positionSec, durationSec);
    const key = `${userId}|${input.videoId}`;
    this.pending.set(key, {
      userId,
      videoId: input.videoId,
      movieId: meta.movieId,
      episodeId: meta.episodeId,
      seriesId: meta.seriesId,
      positionSec,
      durationSec,
      completed,
      sessionId: input.sessionId ?? null,
      at: Date.now(),
    });
    if (immediate || completed) await this.flush();
    return { completed };
  }

  /** Pending (not yet flushed) position for a profile and video, if any. */
  peek(userId: string, videoId: string): Pending | undefined {
    return this.pending.get(`${userId}|${videoId}`);
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.pending.size === 0) return;
    const batch = [...this.pending.values()];
    this.pending.clear();
    this.flushing = (async () => {
      try {
        await this.db.$transaction(async (tx) => {
          for (const p of batch) {
            await tx.continueWatching.upsert({
              where: { userId_videoFileId: { userId: p.userId, videoFileId: p.videoId } },
              create: {
                userId: p.userId,
                videoFileId: p.videoId,
                movieId: p.movieId,
                episodeId: p.episodeId,
                seriesId: p.seriesId,
                positionSec: p.positionSec,
                durationSec: p.durationSec,
                completed: p.completed,
              },
              update: { positionSec: p.positionSec, durationSec: p.durationSec, completed: p.completed, hidden: false },
            });
            if (p.sessionId) {
              const existing = await tx.watchHistory.findUnique({
                where: { userId_sessionId: { userId: p.userId, sessionId: p.sessionId } },
                select: { id: true },
              });
              if (existing) {
                await tx.watchHistory.update({
                  where: { id: existing.id },
                  data: { positionSec: p.positionSec, durationSec: p.durationSec, completed: p.completed, endedAt: new Date(p.at) },
                });
              } else {
                await tx.watchHistory.create({
                  data: {
                    userId: p.userId,
                    videoFileId: p.videoId,
                    sessionId: p.sessionId,
                    positionSec: p.positionSec,
                    durationSec: p.durationSec,
                    completed: p.completed,
                  },
                });
                // New viewing session → popularity counters.
                if (p.movieId) await tx.movie.update({ where: { id: p.movieId }, data: { playCount: { increment: 1 } } });
                if (p.seriesId) await tx.series.update({ where: { id: p.seriesId }, data: { playCount: { increment: 1 } } });
              }
            }
          }
        });
        this.writes += batch.length;
      } catch (err) {
        // Put the batch back (newer reports win) so a transient DB error loses nothing.
        for (const p of batch) {
          const key = `${p.userId}|${p.videoId}`;
          if (!this.pending.has(key)) this.pending.set(key, p);
        }
        this.log.error({ err: (err as Error).message }, 'failed to save watch progress');
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  async resumePosition(userId: string, videoId: string): Promise<number> {
    const pending = this.peek(userId, videoId);
    const row = pending ?? (await this.db.continueWatching.findUnique({ where: { userId_videoFileId: { userId, videoFileId: videoId } } }));
    if (!row || row.completed || row.positionSec < 15) return 0;
    return Math.max(0, row.positionSec - 3); // a little pre-roll for context
  }
}
