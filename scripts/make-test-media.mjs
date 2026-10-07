#!/usr/bin/env node
// Generates a small synthetic media library for development, tests and performance checks.
// Uses the system FFmpeg or the bundled ffmpeg-static binary. Output is git-ignored.
//
//   node scripts/make-test-media.mjs [outDir] [--long]
//
// --long also produces 3-minute 1080p/720p files used by scripts/perf-test.mjs.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const long = args.includes('--long');
const out = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(root, 'test-media'));

function findFfmpeg() {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH))
    return process.env.FFMPEG_PATH;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    const require = createRequire(path.join(root, 'apps', 'server', 'package.json'));
    return require('ffmpeg-static');
  }
}

const ffmpeg = findFfmpeg();
const run = (a) =>
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'inherit' });

function video(
  file,
  {
    seconds = 20,
    w = 1920,
    h = 1080,
    vcodec = 'libx264',
    acodec = 'aac',
    extra = [],
    audioTracks = 1,
    subs = false,
    hue = 0,
    vbitrate,
  } = {},
) {
  const full = path.join(out, file);
  if (existsSync(full)) return;
  mkdirSync(path.dirname(full), { recursive: true });
  const inputs = [
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${w}x${h}:rate=24:duration=${seconds},hue=h=${hue}`,
  ];
  const maps = ['-map', '0:v'];
  for (let i = 0; i < audioTracks; i++) {
    inputs.push(
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${330 + i * 110}:sample_rate=48000:duration=${seconds}`,
    );
    maps.push('-map', `${i + 1}:a`);
  }
  const meta = [];
  for (let i = 0; i < audioTracks; i++) {
    meta.push(`-metadata:s:a:${i}`, `language=${['eng', 'hin', 'spa'][i] ?? 'und'}`);
    meta.push(
      `-metadata:s:a:${i}`,
      `title=${['English Stereo', 'Hindi Stereo', 'Spanish'][i] ?? 'Track'}`,
    );
  }
  if (subs) {
    const srt = path.join(out, '.tmp-subs.srt');
    writeFileSync(
      srt,
      '1\n00:00:01,000 --> 00:00:05,000\nEmbedded subtitle line one\n\n2\n00:00:06,000 --> 00:00:10,000\nEmbedded subtitle line two\n',
    );
    inputs.push('-i', srt);
    maps.push('-map', `${audioTracks + 1}:s`);
    meta.push('-metadata:s:s:0', 'language=eng');
  }
  const vb = vbitrate ? ['-b:v', vbitrate, '-maxrate', vbitrate, '-bufsize', vbitrate] : [];
  const vcodecArgs =
    vcodec === 'libx264'
      ? ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', ...vb]
      : vcodec === 'libx265'
        ? [
            '-c:v',
            'libx265',
            '-preset',
            'ultrafast',
            '-pix_fmt',
            'yuv420p',
            '-tag:v',
            'hvc1',
            '-x265-params',
            'log-level=error',
            ...vb,
          ]
        : vcodec === 'libvpx-vp9'
          ? [
              '-c:v',
              'libvpx-vp9',
              '-deadline',
              'realtime',
              '-cpu-used',
              '8',
              '-b:v',
              vbitrate ?? '1M',
            ]
          : ['-c:v', vcodec];
  const acodecArgs =
    acodec === 'libopus' ? ['-c:a', 'libopus', '-b:a', '96k'] : ['-c:a', acodec, '-b:a', '128k'];
  const subArgs = subs ? ['-c:s', file.endsWith('.mp4') ? 'mov_text' : 'srt'] : [];
  run([...inputs, ...maps, ...vcodecArgs, ...acodecArgs, ...subArgs, ...meta, ...extra, full]);
  console.log('  created', file);
}

function text(file, content) {
  const full = path.join(out, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

console.log(`Generating test media in ${out} using ${ffmpeg}`);
mkdirSync(out, { recursive: true });

// Movies
video('Movies/Aurora Drift (2021)/Aurora Drift (2021).mp4', {
  seconds: 30,
  hue: 0,
  extra: ['-movflags', '+faststart'],
});
text(
  'Movies/Aurora Drift (2021)/Aurora Drift (2021).nfo',
  `<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>Aurora Drift</title>
  <year>2021</year>
  <plot>A lone cartographer follows the northern lights across a frozen sea to map a coastline that should not exist.</plot>
  <tagline>Some maps draw themselves.</tagline>
  <genre>Adventure</genre>
  <genre>Sci-Fi</genre>
  <rating>8.1</rating>
  <mpaa>PG-13</mpaa>
  <director>Mira Kalani</director>
  <actor><name>Asha Verma</name><role>Ilse</role></actor>
  <actor><name>Jonas Reed</name><role>Captain Holt</role></actor>
</movie>
`,
);
text(
  'Movies/Aurora Drift (2021)/Aurora Drift (2021).en.srt',
  '1\n00:00:01,000 --> 00:00:04,000\nThe lights are moving north.\n\n2\n00:00:05,000 --> 00:00:09,000\n<i>Then so are we.</i>\n',
);
text(
  'Movies/Aurora Drift (2021)/Aurora Drift (2021).hi.srt',
  '1\n00:00:01,000 --> 00:00:04,000\nRoshni uttar ki taraf ja rahi hai.\n',
);

video('Movies/Ocean Drift (2019).mkv', { seconds: 24, hue: 120, audioTracks: 2, subs: true });
text(
  'Movies/Ocean Drift (2019).json',
  JSON.stringify(
    {
      title: 'Ocean Drift',
      year: 2019,
      overview: 'Two rival divers discover a sunken radio station that still broadcasts.',
      genres: ['Drama', 'Mystery'],
      cast: ['Leena Das', 'Marco Silva'],
      rating: 7.4,
    },
    null,
    2,
  ),
);

video('Movies/Neon.Nights.2023.1080p.WEB-DL.x265-GRP.mkv', {
  seconds: 20,
  vcodec: 'libx265',
  hue: 240,
});
video('Movies/Mountain Air (2020).webm', {
  seconds: 20,
  w: 1280,
  h: 720,
  vcodec: 'libvpx-vp9',
  acodec: 'libopus',
  hue: 60,
});
video('Movies/Paper Planes (2018).mov', { seconds: 15, w: 1280, h: 720, hue: 300 });
video('Movies/Old Reel (1999).avi', {
  seconds: 12,
  w: 854,
  h: 480,
  vcodec: 'mpeg4',
  acodec: 'mp3',
  hue: 30,
});

// Corrupted file (error handling)
text('Movies/Broken Signal (2010).mp4', 'this is not a real video file'.repeat(100));

// Series
text(
  'Series/Star Signals/tvshow.nfo',
  `<tvshow><title>Star Signals</title><year>2022</year><plot>A night-shift radio operator starts receiving messages from her future self.</plot><genre>Sci-Fi</genre><genre>Drama</genre><rating>8.6</rating><actor><name>Nadia Rahman</name><role>Tara</role></actor></tvshow>`,
);
video('Series/Star Signals/Season 01/Star Signals S01E01 - Pilot.mp4', { seconds: 20, hue: 200 });
video('Series/Star Signals/Season 01/Star Signals S01E02 - Static.mp4', { seconds: 20, hue: 210 });
video('Series/Star Signals/Season 01/Star Signals S01E03 - Feedback.mp4', {
  seconds: 20,
  hue: 220,
});
video('Series/Star Signals/Season 02/Star Signals S02E01 - Echo.mkv', { seconds: 20, hue: 230 });
video('Series/Kitchen Stories/Kitchen.Stories.1x01.Saffron.mp4', {
  seconds: 15,
  w: 1280,
  h: 720,
  hue: 20,
});
video('Series/Kitchen Stories/Kitchen.Stories.1x02.Cardamom.mp4', {
  seconds: 15,
  w: 1280,
  h: 720,
  hue: 25,
});

if (long) {
  // Heavier files for the multi-client performance test.
  video('Perf/Perf Film A (2024).mp4', {
    seconds: 180,
    vbitrate: '8M',
    hue: 10,
    extra: ['-movflags', '+faststart'],
  });
  video('Perf/Perf Film B (2024).mp4', {
    seconds: 180,
    vbitrate: '8M',
    hue: 90,
    extra: ['-movflags', '+faststart'],
  });
  video('Perf/Perf Film C (2024).mkv', {
    seconds: 180,
    vcodec: 'libx265',
    vbitrate: '6M',
    hue: 180,
  });
}

console.log('Done.');
