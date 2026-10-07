/**
 * `pnpm --filter @taazastream/server reset-admin <username> <new-password>`
 * Recovery tool for a forgotten admin password. Must be run on the server PC.
 */
import { pino } from 'pino';
import { loadConfig } from '../config';
import { hashPassword } from '../core/auth';
import { LocalDatabase } from '../core/database';

const [username, password] = process.argv.slice(2);
if (!username || !password || password.length < 10) {
  process.stderr.write('Usage: reset-admin <username> <new-password (min 10 chars)>\n');
  process.exit(1);
}

const config = loadConfig();
const log = pino({ level: 'warn' });
const database = new LocalDatabase(config, log);
await database.init();
const db = database.client;
const name = username.toLowerCase();
const existing = await db.user.findUnique({ where: { username: name } });
const passwordHash = await hashPassword(password);
if (existing) {
  await db.user.update({ where: { id: existing.id }, data: { passwordHash, role: 'ADMIN' } });
  await db.adminSession.deleteMany({ where: { userId: existing.id } });
  process.stdout.write(`Password updated for admin "${name}". All sessions were signed out.\n`);
} else {
  await db.user.create({ data: { username: name, passwordHash, role: 'ADMIN', displayName: username } });
  process.stdout.write(`Admin "${name}" created.\n`);
}
await database.close();
