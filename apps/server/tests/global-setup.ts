import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

/** Small, fast synthetic library shared by all integration tests (generated once). */
export const MEDIA_DIR = path.join(os.tmpdir(), 'taazastream-test-media-v1');

function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    return createRequire(import.meta.url)('ffmpeg-static') as string;
  }
}

export default function setup() {
  process.env.TAAZASTREAM_TEST_MEDIA = MEDIA_DIR;
  if (existsSync(path.join(MEDIA_DIR, '.complete'))) return;
  const ff = ffmpegPath();
  const run = (args: string[]) =>
    execFileSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  const clip = (
    file: string,
    opts: { secs?: number; codec?: string; audio?: number; size?: string } = {},
  ) => {
    const full = path.join(MEDIA_DIR, file);
    mkdirSync(path.dirname(full), { recursive: true });
    const secs = opts.secs ?? 6;
    const args = [
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=${opts.size ?? '640x360'}:rate=24:duration=${secs}`,
    ];
    const maps = ['-map', '0:v'];
    for (let i = 0; i < (opts.audio ?? 1); i++) {
      args.push(
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=${440 + i * 220}:sample_rate=48000:duration=${secs}`,
      );
      maps.push(
        '-map',
        `${i + 1}:a`,
        `-metadata:s:a:${i}`,
        `language=${['eng', 'hin'][i] ?? 'und'}`,
      );
    }
    const v =
      opts.codec === 'hevc'
        ? [
            '-c:v',
            'libx265',
            '-preset',
            'ultrafast',
            '-x265-params',
            'log-level=error',
            '-tag:v',
            'hvc1',
          ]
        : ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'];
    run([...args, ...maps, ...v, '-c:a', 'aac', '-b:a', '96k', '-shortest', full]);
  };

  mkdirSync(MEDIA_DIR, { recursive: true });
  clip('Movies/Test Voyage (2020)/Test Voyage (2020).mp4', { secs: 10 });
  writeFileSync(
    path.join(MEDIA_DIR, 'Movies/Test Voyage (2020)/Test Voyage (2020).nfo'),
    '<movie><title>Test Voyage</title><year>2020</year><plot>A ship of testers sails toward the lighthouse.</plot><genre>Adventure</genre><actor><name>Ravi Iyer</name></actor><rating>7.7</rating></movie>',
  );
  writeFileSync(
    path.join(MEDIA_DIR, 'Movies/Test Voyage (2020)/Test Voyage (2020).en.srt'),
    '1\n00:00:01,000 --> 00:00:03,000\nHello lighthouse\n',
  );
  clip('Movies/Dual Audio (2019).mkv', { secs: 6, audio: 2 });
  clip('Movies/Heavy.Codec.2022.1080p.x265.mkv', { secs: 8, codec: 'hevc' });
  writeFileSync(path.join(MEDIA_DIR, 'Movies/Corrupt (2001).mp4'), Buffer.alloc(4096, 7));
  clip('Series/Signal Box/Season 01/Signal Box S01E01 - Pilot.mp4', { secs: 5 });
  clip('Series/Signal Box/Season 01/Signal Box S01E02 - Relay.mp4', { secs: 5 });
  writeFileSync(path.join(MEDIA_DIR, '.complete'), new Date().toISOString());
}
