import {
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import type { User } from '@prisma/client';
import type { Logger } from 'pino';
import type { Db } from './database';

function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  opts: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** scrypt parameters: N=2^15, r=8, p=1 (~32 MiB, ~50-100 ms) — OWASP recommended minimums. */
const PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };
const MAXMEM = 128 * 1024 * 1024;

/** Format: scrypt$N$r$p$saltB64$hashB64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: MAXMEM,
  });
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64!, 'base64');
  try {
    const key = await scrypt(
      password.normalize('NFKC'),
      Buffer.from(saltB64!, 'base64'),
      expected.length,
      {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        maxmem: MAXMEM,
      },
    );
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Pre-computed dummy hash so unknown usernames take as long as wrong passwords.
let dummyHash: Promise<string> | null = null;

/**
 * LocalAuth — admin authentication without any cloud service.
 * Passwords: scrypt. Sessions: 256-bit random tokens; only their SHA-256 is stored.
 */
export class LocalAuth {
  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    private readonly ttlMs: number,
  ) {}

  async adminExists(): Promise<boolean> {
    return (
      (await this.db.user.count({ where: { role: 'ADMIN', passwordHash: { not: null } } })) > 0
    );
  }

  async createAdmin(username: string, password: string): Promise<User> {
    const passwordHash = await hashPassword(password);
    const user = await this.db.user.create({
      data: {
        username: username.toLowerCase(),
        passwordHash,
        role: 'ADMIN',
        displayName: username,
      },
    });
    this.log.info({ username: user.username }, 'admin account created');
    return user;
  }

  async verifyCredentials(username: string, password: string): Promise<User | null> {
    const user = await this.db.user.findUnique({ where: { username: username.toLowerCase() } });
    if (!user?.passwordHash || user.role !== 'ADMIN') {
      dummyHash ??= hashPassword('timing-equaliser');
      await verifyPassword(password, await dummyHash);
      return null;
    }
    return (await verifyPassword(password, user.passwordHash)) ? user : null;
  }

  async createSession(userId: string, ip: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs);
    await this.db.adminSession.create({
      data: { tokenHash: hashToken(token), userId, expiresAt, ip },
    });
    await this.db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    return { token, expiresAt };
  }

  async validateSession(token: string | undefined): Promise<User | null> {
    if (!token || token.length > 128) return null;
    const session = await this.db.adminSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session) return null;
    if (session.expiresAt.getTime() < Date.now() || session.user.role !== 'ADMIN') {
      await this.db.adminSession.delete({ where: { id: session.id } }).catch(() => undefined);
      return null;
    }
    // Touch at most once a minute to avoid write amplification.
    if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
      await this.db.adminSession
        .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }
    return session.user;
  }

  async destroySession(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.db.adminSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  }

  async changePassword(userId: string, newPassword: string): Promise<void> {
    await this.db.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    // Invalidate all other sessions.
    await this.db.adminSession.deleteMany({ where: { userId } });
  }

  async purgeExpired(): Promise<void> {
    await this.db.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}
