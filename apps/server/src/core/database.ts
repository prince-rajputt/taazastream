import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export type Db = PrismaClient;

/**
 * LocalDatabase — the primary, offline store (SQLite via Prisma).
 * Nothing here ever touches the network.
 */
export class LocalDatabase {
  readonly client: PrismaClient;
  private ftsAvailable = false;

  constructor(
    private readonly config: AppConfig,
    private readonly log: Logger,
  ) {
    this.client = new PrismaClient({
      datasourceUrl: config.databaseUrl,
      log: [{ level: 'error', emit: 'event' }],
    });
    this.client.$on('error' as never, (e: { message: string }) => {
      this.log.error({ err: e.message }, 'database error');
    });
  }

  get hasFullTextSearch(): boolean {
    return this.ftsAvailable;
  }

  /** Apply pending migrations using the bundled Prisma CLI (no network needed). */
  async migrate(): Promise<void> {
    const schema = path.join(this.config.repoRoot, 'prisma', 'schema.prisma');
    if (!existsSync(schema)) {
      this.log.warn({ schema }, 'prisma schema not found; skipping migrations');
      return;
    }
    let cli: string;
    try {
      cli = require.resolve('prisma/build/index.js');
    } catch {
      this.log.warn('prisma CLI not installed; skipping migrations');
      return;
    }
    const started = Date.now();
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [cli, 'migrate', 'deploy', '--schema', schema],
        {
          env: {
            ...process.env,
            DATABASE_URL: this.config.databaseUrl,
            PRISMA_HIDE_UPDATE_MESSAGE: '1',
            CHECKPOINT_DISABLE: '1',
          },
          windowsHide: true,
          timeout: 120_000,
        },
      );
      const applied = /(\d+) migrations? found/.exec(stdout)?.[1];
      this.log.info({ ms: Date.now() - started, migrations: applied }, 'database migrations applied');
    } catch (err) {
      const e = err as { stderr?: string; message: string };
      this.log.error({ err: e.stderr?.trim() || e.message }, 'database migration failed');
      throw new Error('Database migration failed. See log for details.');
    }
  }

  async init(): Promise<void> {
    if (this.config.autoMigrate) await this.migrate();
    await this.client.$connect();
    // WAL gives concurrent readers while the scanner writes; NORMAL sync is safe with WAL.
    await this.client.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await this.client.$executeRawUnsafe('PRAGMA synchronous = NORMAL');
    await this.client.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    await this.client.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
    await this.ensureSearchIndex();
  }

  /**
   * Full-text search index (SQLite FTS5). Kept outside Prisma migrations because Prisma
   * cannot model virtual tables; maintained by SearchService.
   */
  private async ensureSearchIndex(): Promise<void> {
    try {
      await this.client.$executeRawUnsafe(
        `CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
           kind UNINDEXED, ref_id UNINDEXED, title, genres, year, people, overview,
           tokenize = 'unicode61 remove_diacritics 2'
         )`,
      );
      this.ftsAvailable = true;
    } catch (err) {
      this.ftsAvailable = false;
      this.log.warn({ err: (err as Error).message }, 'FTS5 unavailable, search falls back to LIKE');
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.$queryRawUnsafe('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.$disconnect();
  }
}
