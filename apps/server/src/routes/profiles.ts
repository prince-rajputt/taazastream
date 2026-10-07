import { idParamsSchema, profileSchema, type Profile } from '@taazastream/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { AppError, notFound, ok } from '../http/errors';
import { parse } from '../http/validate';

const MAX_PROFILES = 8;

export function registerProfileRoutes(app: FastifyInstance, ctx: AppContext) {
  const toProfile = (u: {
    id: string;
    displayName: string;
    color: string;
    isKids: boolean;
  }): Profile => ({
    id: u.id,
    name: u.displayName,
    color: u.color,
    isKids: u.isKids,
  });

  app.get('/api/profiles', async () => {
    const users = await ctx.db.user.findMany({
      where: { role: 'VIEWER' },
      orderBy: { createdAt: 'asc' },
    });
    return ok(users.map(toProfile));
  });

  app.post('/api/profiles', async (request) => {
    const body = parse(profileSchema, request.body);
    if ((await ctx.db.user.count({ where: { role: 'VIEWER' } })) >= MAX_PROFILES) {
      throw new AppError(409, 'CONFLICT', `At most ${MAX_PROFILES} profiles are supported`);
    }
    const u = await ctx.db.user.create({
      data: { role: 'VIEWER', displayName: body.name, color: body.color, isKids: body.isKids },
    });
    return ok(toProfile(u));
  });

  app.patch('/api/profiles/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const body = parse(profileSchema.partial(), request.body);
    const existing = await ctx.db.user.findUnique({ where: { id } });
    if (!existing || existing.role !== 'VIEWER') throw notFound('Profile');
    const u = await ctx.db.user.update({
      where: { id },
      data: { displayName: body.name, color: body.color, isKids: body.isKids },
    });
    return ok(toProfile(u));
  });

  app.delete('/api/profiles/:id', async (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const existing = await ctx.db.user.findUnique({ where: { id } });
    if (!existing || existing.role !== 'VIEWER') throw notFound('Profile');
    if (id === ctx.defaultProfileId)
      throw new AppError(409, 'CONFLICT', 'The default profile cannot be deleted');
    await ctx.db.user.delete({ where: { id } });
    return ok({ deleted: true });
  });
}
