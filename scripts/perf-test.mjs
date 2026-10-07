#!/usr/bin/env node
// Multi-client streaming performance test.
//
//   pnpm build && node scripts/perf-test.mjs [--seconds 60]
//
// Starts the production server on port 3200 with the "--long" sample library and simulates:
//   Client 1 → 1080p direct play (MP4, ~8 Mbps)
//   Client 2 → 1080p direct play (MP4, ~8 Mbps)
//   Client 3 → 720p HLS transcode (HEVC source → H.264)
// Each client behaves like a video player: it buffers up to 30 s ahead, plays in real time,
// seeks once, and records startup time, seek latency and stalls. Server CPU/RAM/network are
// sampled from the admin API. Results are written to docs/PERFORMANCE-RESULTS.md.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seconds = Number(process.argv[process.argv.indexOf('--seconds') + 1]) || 60;
const PORT = 3200;
const BASE = `http://127.0.0.1:${PORT}`;
const BUFFER_AHEAD = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const perfMedia = path.join(repo, 'test-media', 'Perf');
if (!existsSync(path.join(perfMedia, 'Perf Film C (2024).mkv'))) {
  console.log('Generating 3-minute 1080p sample files (one-time)...');
  execFileSync(process.execPath, [path.join(repo, 'scripts', 'make-test-media.mjs'), '--long'], {
    stdio: 'inherit',
  });
}
if (!existsSync(path.join(repo, 'apps', 'server', 'dist', 'index.js'))) {
  console.error('Run "pnpm build" first.');
  process.exit(1);
}

const runDir = path.join(os.tmpdir(), 'taazastream-perf');
rmSync(runDir, { recursive: true, force: true });
mkdirSync(runDir, { recursive: true });
const server = spawn(process.execPath, [path.join(repo, 'apps', 'server', 'dist', 'index.js')], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(PORT),
    DATA_DIR: path.join(runDir, 'data'),
    CACHE_DIR: path.join(runDir, 'cache'),
    BACKUP_DIR: path.join(runDir, 'backups'),
    DATABASE_URL: `file:${path.join(runDir, 'data', 'perf.db').replace(/\\/g, '/')}`,
    MEDIA_ROOT: perfMedia,
    SCAN_ON_START: 'true',
    ADMIN_USERNAME: 'perf',
    ADMIN_PASSWORD: 'perf-test-password',
    MDNS_ENABLED: 'false',
    LOG_LEVEL: 'warn',
    LOG_PRETTY: 'false',
    SUPABASE_URL: '',
  },
  stdio: 'ignore',
});
const stopServer = () => server.kill();
process.on('exit', stopServer);

async function api(url, init = {}) {
  const res = await fetch(BASE + url, {
    ...init,
    headers: { 'x-taazastream': '1', 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  return res;
}

// Wait for the server and the startup scan.
let movies = [];
for (let i = 0; i < 240; i++) {
  try {
    const res = await api('/api/movies');
    if (res.ok) {
      movies = (await res.json()).data.items;
      if (movies.length >= 3) break;
    }
  } catch {
    /* not up yet */
  }
  await sleep(1000);
}
if (movies.length < 3) {
  console.error('Server or scan did not become ready.');
  process.exit(1);
}
const login = await api('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ username: 'perf', password: 'perf-test-password' }),
});
const cookie = login.headers.get('set-cookie').split(';')[0];
const byTitle = (t) => movies.find((m) => m.title === t);

/* ------------------------------------------------------------------ */
/* Simulated players                                                   */
/* ------------------------------------------------------------------ */

async function directClient(name, title, seekTo) {
  const m = byTitle(title);
  const head = await fetch(`${BASE}/api/stream/${m.videoId}`, { method: 'HEAD' });
  const size = Number(head.headers.get('content-length'));
  const duration = m.durationSec;
  const bytesPerSec = size / duration;
  const result = {
    name,
    title,
    mode: 'direct',
    bitrateMbps: +((bytesPerSec * 8) / 1e6).toFixed(1),
    startupMs: 0,
    seekMs: 0,
    stalls: 0,
    stallSeconds: 0,
    bytes: 0,
  };

  async function play(fromSec, untilWall) {
    const start = performance.now();
    const res = await fetch(`${BASE}/api/stream/${m.videoId}`, {
      headers: { range: `bytes=${Math.floor(fromSec * bytesPerSec)}-` },
    });
    const reader = res.body.getReader();
    let received = 0;
    let firstFrameAt = 0;
    let playPos = 0; // seconds of content consumed since this request
    let last = performance.now();
    let stalledSince = 0;
    while (performance.now() < untilWall) {
      const buffered = received / bytesPerSec - playPos;
      if (buffered > BUFFER_AHEAD) {
        await sleep(200);
      } else {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.length;
        result.bytes += value.length;
      }
      const now = performance.now();
      if (!firstFrameAt && received / bytesPerSec >= 2) firstFrameAt = now; // 2 s of video buffered
      if (firstFrameAt) {
        const canPlay = received / bytesPerSec - playPos;
        const dt = (now - last) / 1000;
        if (canPlay >= dt) {
          playPos += dt;
          if (stalledSince) {
            result.stallSeconds += (now - stalledSince) / 1000;
            stalledSince = 0;
          }
        } else if (!stalledSince) {
          stalledSince = now;
          result.stalls++;
        }
      }
      last = now;
    }
    await reader.cancel().catch(() => undefined);
    return firstFrameAt ? firstFrameAt - start : -1;
  }

  const t0 = performance.now();
  const wallEnd = t0 + seconds * 1000;
  result.startupMs = Math.round(await play(0, t0 + (seconds * 1000) / 2));
  result.seekMs = Math.round(await play(seekTo, wallEnd));
  return result;
}

async function hlsClient(name, title, quality, seekSegment) {
  const m = byTitle(title);
  const result = {
    name,
    title,
    mode: `hls ${quality}`,
    bitrateMbps: 0,
    startupMs: 0,
    seekMs: 0,
    stalls: 0,
    stallSeconds: 0,
    bytes: 0,
  };
  const variant = `t-${quality}-a0`;
  const t0 = performance.now();
  const master = await (
    await fetch(`${BASE}/api/hls/${m.videoId}/master.m3u8?mode=transcode&quality=${quality}`)
  ).text();
  if (!master.includes(variant)) throw new Error('variant missing in master playlist');
  const playlist = await (await fetch(`${BASE}/api/hls/${m.videoId}/${variant}/index.m3u8`)).text();
  const segs = playlist.split('\n').filter((l) => l.startsWith('seg_'));
  const segDur = Number(/#EXTINF:([\d.]+)/.exec(playlist)[1]);

  async function run(fromSeg, untilWall) {
    const start = performance.now();
    let firstAt = 0;
    for (let i = fromSeg; i < segs.length && performance.now() < untilWall; i++) {
      // Respect the player's buffer: don't fetch more than BUFFER_AHEAD seconds ahead.
      if (firstAt) {
        const playedSec = (performance.now() - firstAt) / 1000;
        const aheadSec = (i - fromSeg) * segDur - playedSec;
        if (aheadSec > BUFFER_AHEAD) await sleep((aheadSec - BUFFER_AHEAD) * 1000);
      }
      const res = await fetch(`${BASE}/api/hls/${m.videoId}/${variant}/${segs[i]}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      result.bytes += buf.length;
      const now = performance.now();
      if (!firstAt) firstAt = now;
      else {
        const deadline = firstAt + (i - fromSeg) * segDur * 1000;
        if (now > deadline) {
          result.stalls++;
          result.stallSeconds += (now - deadline) / 1000;
        }
      }
    }
    return firstAt - start;
  }
  const wallEnd = t0 + seconds * 1000;
  result.startupMs = Math.round(await run(0, t0 + (seconds * 1000) / 2));
  result.seekMs = Math.round(await run(seekSegment, wallEnd));
  result.bitrateMbps = +((result.bytes * 8) / 1e6 / seconds).toFixed(1);
  return result;
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

const samples = [];
let sampling = true;
const sampler = (async () => {
  while (sampling) {
    try {
      const s = (await (await api('/api/admin/stats', { headers: { cookie } })).json()).data;
      samples.push({
        cpu: s.system.cpuPercent,
        rss: s.system.processRssBytes,
        memUsed: s.system.memUsedBytes,
        bps: s.network.currentBps,
        streams: s.streams.active,
        transcodes: s.streams.transcodes,
      });
    } catch {
      /* ignore */
    }
    await sleep(2000);
  }
})();

console.log(`Running 3 simulated clients for ${seconds}s...`);
const results = await Promise.all([
  directClient('Client 1', 'Perf Film A', 120),
  directClient('Client 2', 'Perf Film B', 90),
  hlsClient('Client 3', 'Perf Film C', '720p', 30),
]);
sampling = false;
await sampler;
stopServer();

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const max = (xs) => (xs.length ? Math.max(...xs) : 0);
const busy = samples.slice(1);
const summary = {
  cpuAvg: avg(busy.map((s) => s.cpu)).toFixed(1),
  cpuMax: max(busy.map((s) => s.cpu)).toFixed(1),
  rssMaxMb: (max(busy.map((s) => s.rss)) / 1048576).toFixed(0),
  netAvgMbps: (avg(busy.map((s) => s.bps)) / 1e6).toFixed(1),
  netMaxMbps: (max(busy.map((s) => s.bps)) / 1e6).toFixed(1),
  maxStreams: max(busy.map((s) => s.streams)),
  maxTranscodes: max(busy.map((s) => s.transcodes)),
};

const machine = `${os.cpus()[0]?.model.trim()} (${os.cpus().length} threads), ${(os.totalmem() / 1073741824).toFixed(0)} GB RAM, ${os.type()} ${os.release()}, Node ${process.version}`;
const md = `# Performance test results

Generated by \`node scripts/perf-test.mjs --seconds ${seconds}\` on ${new Date().toISOString().slice(0, 10)}.

**Machine:** ${machine}
**Network:** loopback (server and simulated clients on the same PC — measures server cost, not Wi-Fi)

| Client | Title | Mode | Media bitrate | Startup | Seek latency | Stalls (total s) |
| --- | --- | --- | --- | --- | --- | --- |
${results.map((r) => `| ${r.name} | ${r.title} | ${r.mode} | ${r.bitrateMbps} Mbps | ${r.startupMs} ms | ${r.seekMs} ms | ${r.stalls} (${r.stallSeconds.toFixed(1)} s) |`).join('\n')}

| Server metric | Value |
| --- | --- |
| CPU average / peak (whole system) | ${summary.cpuAvg}% / ${summary.cpuMax}% |
| TaazaStream process memory (peak RSS) | ${summary.rssMaxMb} MB |
| Network out average / peak | ${summary.netAvgMbps} / ${summary.netMaxMbps} Mbps |
| Concurrent streams / transcodes (peak) | ${summary.maxStreams} / ${summary.maxTranscodes} |

Startup = time until 2 s of video were buffered (direct) or the first HLS segment arrived.
Seek latency = time from the seek request until playback could resume at the new position.
Clients buffer up to ${BUFFER_AHEAD} s ahead, like browser players.
`;
mkdirSync(path.join(repo, 'docs'), { recursive: true });
writeFileSync(path.join(repo, 'docs', 'PERFORMANCE-RESULTS.md'), md);
console.log(md);
process.exit(0);
