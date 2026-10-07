// Boots the production build of TaazaStream for Playwright with a small generated library.
// Supabase points at an unroutable address to simulate "internet down".
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const serverDist = path.join(repo, 'apps', 'server', 'dist', 'index.js');
if (!existsSync(serverDist) || !existsSync(path.join(repo, 'apps', 'web', 'dist', 'index.html'))) {
  console.error('Build first: pnpm build');
  process.exit(1);
}

const root = path.join(os.tmpdir(), 'taazastream-e2e');
const media = path.join(root, 'media');
const data = path.join(root, 'run');
rmSync(data, { recursive: true, force: true });

function ffmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    return createRequire(path.join(repo, 'apps', 'server', 'package.json'))('ffmpeg-static');
  }
}

if (!existsSync(path.join(media, '.complete'))) {
  const ff = ffmpeg();
  const clip = (rel, { secs = 20, webm = false, hue = 0 } = {}) => {
    const out = path.join(media, rel);
    mkdirSync(path.dirname(out), { recursive: true });
    const codec = webm
      ? [
          '-c:v',
          'libvpx-vp9',
          '-deadline',
          'realtime',
          '-cpu-used',
          '8',
          '-b:v',
          '600k',
          '-c:a',
          'libopus',
          '-b:a',
          '64k',
        ]
      : [
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '96k',
        ];
    execFileSync(ff, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=640x360:rate=24:duration=${secs},hue=h=${hue}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:sample_rate=48000:duration=${secs}`,
      ...codec,
      '-shortest',
      out,
    ]);
  };
  clip('Movies/Lantern Coast (2022)/Lantern Coast (2022).webm', { secs: 40, webm: true });
  writeFileSync(
    path.join(media, 'Movies/Lantern Coast (2022)/Lantern Coast (2022).nfo'),
    '<movie><title>Lantern Coast</title><year>2022</year><plot>A lighthouse keeper decodes signals from passing ships.</plot><genre>Mystery</genre><genre>Drama</genre><rating>8.4</rating><actor><name>Kavya Menon</name></actor></movie>',
  );
  writeFileSync(
    path.join(media, 'Movies/Lantern Coast (2022)/Lantern Coast (2022).en.srt'),
    '1\n00:00:01,000 --> 00:00:05,000\nThe light is on.\n',
  );
  clip('Movies/Quiet Orbit (2018).mp4', { secs: 10, hue: 120 });
  clip('Series/Harbour Lights/Season 01/Harbour Lights S01E01 - Arrival.webm', {
    secs: 12,
    webm: true,
    hue: 200,
  });
  clip('Series/Harbour Lights/Season 01/Harbour Lights S01E02 - Storm.webm', {
    secs: 12,
    webm: true,
    hue: 220,
  });
  writeFileSync(path.join(media, '.complete'), 'ok');
}

Object.assign(process.env, {
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  PORT: process.env.E2E_PORT ?? '3100',
  DATA_DIR: path.join(data, 'data'),
  CACHE_DIR: path.join(data, 'cache'),
  BACKUP_DIR: path.join(data, 'backups'),
  DATABASE_URL: `file:${path.join(data, 'data', 'e2e.db').replace(/\\/g, '/')}`,
  MEDIA_ROOT: media,
  SCAN_ON_START: 'true',
  ADMIN_USERNAME: 'e2eadmin',
  ADMIN_PASSWORD: 'e2e-admin-password',
  MDNS_ENABLED: 'false',
  LOG_LEVEL: 'warn',
  LOG_PRETTY: 'false',
  SUPABASE_URL: 'http://192.0.2.1:9',
  SUPABASE_ANON_KEY: 'offline-test',
  SUPABASE_SERVICE_ROLE_KEY: '',
});

await import(pathToFileURL(serverDist).href);
