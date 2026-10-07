import {
  changePasswordSchema,
  loginSchema,
  setupSchema,
  type AuthState,
} from '@taazastream/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ADMIN_COOKIE } from '../app';
import type { AppContext } from '../context';
import { verifyPassword } from '../core/auth';
import { isLoopback, isPrivateAddress } from '../core/system';
import { AppError, forbidden, ok, unauthorized } from '../http/errors';
import { parse } from '../http/validate';

const LOGIN_RATE = { max: 10, timeWindow: '15 minutes' };

function setSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
) {
  reply.setCookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    // `secure` whenever the request arrived over HTTPS (e.g. behind a TLS reverse proxy).
    // On plain-HTTP LANs a secure cookie would never be sent back, so it is conditional.
    secure: request.protocol === 'https',
    path: '/api',
    expires: expiresAt,
  });
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext) {
  const currentUser = async (request: FastifyRequest) =>
    ctx.auth.validateSession(request.cookies[ADMIN_COOKIE]);

  app.get('/api/auth/state', async (request) => {
    const user = await currentUser(request);
    const setupRequired = !(await ctx.auth.adminExists());
    const state: AuthState = {
      authenticated: !!user,
      user: user ? { id: user.id, username: user.username ?? '', role: user.role } : null,
      setupRequired,
      setupAllowedFromHere: setupRequired && isLoopback(request.ip),
    };
    return ok(state);
  });

  /**
   * First-run admin creation. Only allowed while no admin exists AND from the server PC itself
   * (loopback), so a guest on the Wi-Fi cannot claim the server.
   */
  app.post('/api/auth/setup', { config: { rateLimit: LOGIN_RATE } }, async (request, reply) => {
    if (await ctx.auth.adminExists())
      throw new AppError(409, 'CONFLICT', 'An admin account already exists');
    if (!isLoopback(request.ip)) {
      throw forbidden(
        'For security, create the admin account on the server PC itself: open http://localhost:' +
          ctx.config.port +
          '/admin there.',
      );
    }
    const body = parse(setupSchema, request.body);
    const user = await ctx.auth.createAdmin(body.username, body.password);
    const session = await ctx.auth.createSession(user.id, request.ip);
    setSessionCookie(request, reply, session.token, session.expiresAt);
    return ok({ username: user.username });
  });

  app.post('/api/auth/login', { config: { rateLimit: LOGIN_RATE } }, async (request, reply) => {
    if (!ctx.config.allowPublicAdmin && !isPrivateAddress(request.ip))
      throw forbidden('Admin is only available on the local network');
    const body = parse(loginSchema, request.body);
    const user = await ctx.auth.verifyCredentials(body.username, body.password);
    if (!user) {
      ctx.log.warn(
        { svc: 'auth', username: body.username.slice(0, 64), ip: request.ip },
        'admin login failed',
      );
      throw unauthorized('Incorrect username or password');
    }
    const session = await ctx.auth.createSession(user.id, request.ip);
    setSessionCookie(request, reply, session.token, session.expiresAt);
    ctx.log.info({ svc: 'auth', username: user.username, ip: request.ip }, 'admin logged in');
    return ok({ username: user.username });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    await ctx.auth.destroySession(request.cookies[ADMIN_COOKIE]);
    reply.clearCookie(ADMIN_COOKIE, { path: '/api' });
    return ok({ loggedOut: true });
  });

  app.post('/api/auth/password', { config: { rateLimit: LOGIN_RATE } }, async (request, reply) => {
    const user = await currentUser(request);
    if (!user?.passwordHash) throw unauthorized();
    const body = parse(changePasswordSchema, request.body);
    if (!(await verifyPassword(body.currentPassword, user.passwordHash)))
      throw unauthorized('Current password is incorrect');
    await ctx.auth.changePassword(user.id, body.newPassword);
    const session = await ctx.auth.createSession(user.id, request.ip);
    setSessionCookie(request, reply, session.token, session.expiresAt);
    ctx.log.info({ svc: 'auth', username: user.username }, 'admin password changed');
    return ok({ changed: true });
  });
}
