# TaazaStream — container image (optional; native Windows install is the primary deployment).
# Build:  docker build -f docker/Dockerfile -t taazastream .
# Media folders are mounted read-only; data/cache are volumes.

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm db:generate && pnpm build && pnpm prune --prod --config.ignore-scripts=true || true

FROM node:24-bookworm-slim AS runtime
# System FFmpeg (with VA-API support on Intel/AMD iGPUs when /dev/dri is passed through).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    CACHE_DIR=/cache \
    BACKUP_DIR=/data/backups \
    DATABASE_URL=file:/data/taazastream.db \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    MDNS_ENABLED=false
COPY --from=build /app /app
RUN mkdir -p /data /cache /media && chown -R node:node /data /cache /app
USER node
EXPOSE 3000
VOLUME ["/data", "/cache"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/server/dist/index.js"]
