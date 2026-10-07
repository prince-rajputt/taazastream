# Contributing to TaazaStream

Thanks for helping! TaazaStream is an offline-first LAN streaming server, so every change should
keep these priorities, in order: **offline LAN operation, streaming performance, reliability,
security, maintainability**.

## Setup

```bash
corepack enable
pnpm install
pnpm db:generate
node scripts/make-test-media.mjs      # optional sample library in ./test-media (git-ignored)
pnpm dev                              # server on :3000 (tsx watch) + Vite on :5173
```

During development open http://localhost:5173 (Vite proxies `/api` to the server). Set
`CORS_ORIGINS=http://localhost:5173` only if you call the API from another origin.

## Project layout

```
apps/server    Fastify API, scanner, streaming engine, HLS, auth (Node + Prisma/SQLite)
apps/web       React + Vite PWA (viewer UI, player, admin dashboard)
packages/shared  API types, Zod schemas, playback decision rules shared by both apps
packages/config  Shared TypeScript configuration
prisma         SQLite schema and migrations
supabase       Optional cloud schema (metadata sync/backup)
scripts        Fixtures, icons, perf test, Windows launcher/installer/firewall
docker         Container image
docs           Architecture, performance and offline test reports
```

## Checks (same as CI)

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test          # unit + API/streaming integration tests (needs FFmpeg; bundled one is used)
pnpm build
pnpm test:e2e      # Playwright, against the production build, with internet blocked
pnpm check:secrets
```

## Database changes

Edit `prisma/schema.prisma`, then create a migration:

```bash
pnpm db:migrate:dev --name describe_change
```

Migrations are applied automatically on server start (`AUTO_MIGRATE=true`).

## Rules of thumb

- Nothing in the core may require the internet: no CDNs, fonts, analytics or online metadata APIs.
- Never accept filesystem paths from the browser; look files up by ID and re-check `isInsideAny`.
- Validate every input with Zod (`packages/shared/src/schemas.ts`).
- Never commit `.env`, databases, media files or generated caches.
- Use Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
