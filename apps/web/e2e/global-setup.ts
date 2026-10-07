import { spawn, spawnSync } from 'node:child_process';
import { openSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);

/**
 * Starts the production TaazaStream build for the E2E run and returns a teardown function.
 * (Playwright's built-in webServer cannot reliably stop Node child processes on Windows.)
 */
export default async function globalSetup() {
  const logFile = path.join(os.tmpdir(), 'taazastream-e2e-server.log');
  const out = openSync(logFile, 'w');
  const child = spawn(process.execPath, [path.join(here, 'start-server.mjs')], {
    env: { ...process.env, E2E_PORT: String(E2E_PORT) },
    stdio: ['ignore', out, out],
    windowsHide: true,
  });

  const url = `http://127.0.0.1:${E2E_PORT}/api/health`;
  const deadline = Date.now() + 180_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`E2E server exited early; see ${logFile}`);
    try {
      if ((await fetch(url)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) {
    child.kill();
    throw new Error(`E2E server did not start; see ${logFile}`);
  }

  return async () => {
    if (child.exitCode !== null || !child.pid) return;
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  };
}
