import { pino } from 'pino';
import { buildApp } from './app';
import { APP_VERSION, loadConfig } from './config';
import { createContext } from './context';
import { loggerOptions } from './logger';

async function main() {
  const config = loadConfig();
  const log = pino(loggerOptions(config));

  log.info({ version: APP_VERSION, node: process.version, env: config.env }, 'TaazaStream starting');

  let ctx;
  try {
    ctx = await createContext(config, log);
  } catch (err) {
    log.fatal({ err: (err as Error).message }, 'startup failed');
    process.exit(1);
  }

  const app = await buildApp(ctx);

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    log.fatal(
      { err: (err as Error).message },
      code === 'EADDRINUSE'
        ? `Port ${config.port} is already in use. Close the other program or set PORT in .env.`
        : 'could not start HTTP server',
    );
    await ctx.shutdown();
    process.exit(1);
  }

  ctx.restartDiscovery();
  const info = ctx.serverInfo();
  log.info({ host: config.host, port: config.port, urls: info.urls }, 'server started');

  // Friendly banner for people starting the server by double-clicking the launcher.
  if (!config.isTest) {
    const lines = [
      '',
      '  ┌──────────────────────────────────────────────────────────┐',
      `  │  TaazaStream ${APP_VERSION.padEnd(44)}│`,
      '  ├──────────────────────────────────────────────────────────┤',
      `  │  This PC:        ${`http://localhost:${config.port}`.padEnd(40)}│`,
      ...info.urls.slice(0, 3).map((u) => `  │  Phones / TVs:   ${u.padEnd(40)}│`),
      ...(info.mdnsHost ? [`  │  Or try:         ${info.mdnsHost.padEnd(40)}│`] : []),
      `  │  Admin:          ${`http://localhost:${config.port}/admin`.padEnd(40)}│`,
      '  └──────────────────────────────────────────────────────────┘',
      '',
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
  }

  // Housekeeping: auto-scan, expired sessions.
  let lastAutoScan = Date.now();
  const housekeeping = setInterval(() => {
    const minutes = ctx.settings.get().autoScanIntervalMinutes;
    if (minutes > 0 && Date.now() - lastAutoScan > minutes * 60_000 && !ctx.scanner.isRunning) {
      lastAutoScan = Date.now();
      void ctx.db.mediaFolder.count().then((n) => (n ? ctx.scanner.start({}) : null));
    }
    void ctx.auth.purgeExpired().catch(() => undefined);
  }, 60_000);
  housekeeping.unref();

  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'server stopping');
    clearInterval(housekeeping);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    try {
      await app.close();
      await ctx.shutdown();
      log.info('server stopped');
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGBREAK', () => void stop('SIGBREAK')); // Ctrl+Break / console close on Windows
  process.on('unhandledRejection', (reason) => {
    log.error({ err: reason instanceof Error ? reason.message : String(reason) }, 'unhandled promise rejection');
  });
}

void main();
