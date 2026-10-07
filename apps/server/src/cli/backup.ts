/**
 * `pnpm backup` — create a database + metadata backup from the command line.
 * Safe to run while the server is running (uses SQLite VACUUM INTO).
 */
import { pino } from 'pino';
import { loadConfig } from '../config';
import { BackupService } from '../core/backup';
import { LocalDatabase } from '../core/database';

const config = loadConfig({ AUTO_MIGRATE: 'false' });
const log = pino({ level: 'info' });
const database = new LocalDatabase(config, log);
await database.init();
const files = await new BackupService(database.client, config.backupDir, log).create();
for (const f of files)
  process.stdout.write(
    `  ${config.backupDir}\\${f.fileName}  (${Math.round(f.sizeBytes / 1024)} KB)\n`,
  );
await database.close();
