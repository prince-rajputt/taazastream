# TaazaStream

**Your private home cinema.** TaazaStream turns one Windows PC into a streaming server for your
own movies and series. Every phone, laptop, tablet and Smart TV on the same Wi-Fi/LAN can browse
and watch them in the browser — **no internet, no cloud, no app install required.**

```
Phone / Laptop / TV  ──Wi-Fi/LAN──▶  TaazaStream server PC  ──▶  Local HDD/SSD  ──▶  Streaming engine
```

- Premium dark, cinematic OTT-style interface (original TaazaStream design) — works on phones, desktops and Smart TVs (remote/arrow-key navigation).
- Direct HTTP Range streaming of your original files with instant seeking; automatic **remux** (MKV → HLS, no re-encode) or **FFmpeg HLS transcoding** only when a device can't play the file.
- Media scanner: new/changed/moved/deleted files, FFprobe metadata (duration, resolution, codecs, bitrate, FPS, audio & subtitle tracks), thumbnails & backdrops, `.nfo`/`.json` metadata and sidecar subtitles/artwork.
- Continue Watching, My List, profiles, series with seasons/episodes and next-episode autoplay.
- Local full-text search (SQLite FTS5) by title, genre, year, cast and description.
- Admin dashboard: library, media folders, devices, live streams, CPU/RAM/network/disk, settings, backups, QR code to connect devices.
- Offline-first: SQLite is the only required database. Supabase is optional (metadata backup/sync only).
- Installable PWA. All fonts, icons and scripts are bundled — zero external requests at runtime.

---

## Contents

1. [Architecture](#architecture)
2. [Installation (Windows)](#installation-windows)
3. [FFmpeg](#ffmpeg)
4. [Creating media folders](#creating-media-folders)
5. [Starting the server](#starting-the-server)
6. [Finding the local IP & connecting devices](#finding-the-local-ip--connecting-devices)
7. [Offline mode](#offline-mode)
8. [Supabase (optional)](#supabase-optional)
9. [GitHub](#github)
10. [Docker](#docker)
11. [Security](#security)
12. [Windows Firewall](#windows-firewall)
13. [Troubleshooting](#troubleshooting)
14. [Performance](#performance)
15. [Backup](#backup)
16. [Development](#development)
17. [Production deployment](#production-deployment)

---

## Architecture

```
taazastream/
├── apps/
│   ├── server/        Fastify REST API · scanner · range streaming · HLS · auth (TypeScript)
│   └── web/           React + Vite + Tailwind PWA · player (hls.js) · admin dashboard
├── packages/
│   ├── shared/        API types, Zod schemas, playback decision rules
│   └── config/        shared tsconfig
├── prisma/            SQLite schema + migrations (Prisma)
├── supabase/          optional cloud schema (metadata sync/backup)
├── scripts/           Windows launcher/installer/firewall, fixtures, perf test, secret check
├── docker/            Dockerfile
└── docs/              architecture, performance, offline acceptance test
```

**Offline-first core** (never touches the network): `LocalDatabase` (SQLite/Prisma, WAL),
`LocalMediaScanner`, `LocalVideoStreamer`, `LocalImageServer`, `LocalAuth`, `LocalSettings`.
**Optional cloud**: `SupabaseSync` (CloudMetadata + CloudBackup) behind a `StorageProvider`
abstraction (`LocalStorageProvider` / `SupabaseStorageProvider`). If Supabase is unreachable the
server logs `Supabase unavailable. Continuing in local-only mode.` and carries on.

**Playback decision** (no blind transcoding):

```
Video ─▶ FFprobe ─▶ Can this browser decode container + codecs?
                     ├─ yes ─────────────────────▶ Direct HTTP Range streaming (0 CPU)
                     ├─ codecs yes, container no ─▶ Remux to HLS, stream-copy video (≈0 CPU)
                     └─ no ──────────────────────▶ FFmpeg HLS transcode (1080p/720p/480p)
```

Transcoded HLS uses a seekable VOD playlist: segments are produced on demand and the encoder
restarts at the requested position when you seek, so seeking is instant even mid-conversion.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details and the full API list.

---

## Installation (Windows)

Requirements: Windows 10/11, **Node.js 20.18+ (24 LTS recommended)**, ~500 MB disk for the app.

1. Install Node.js LTS from https://nodejs.org (or `winget install OpenJS.NodeJS.LTS`).
2. Download TaazaStream (Code → Download ZIP, or `git clone`) and open the folder.
3. Right-click **`scripts\windows\install.ps1`** → _Run with PowerShell_, or in a terminal:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1
   ```

   It enables pnpm (Corepack), installs dependencies, builds the server and web app, creates
   `.env`, and — when run as Administrator — adds a firewall rule for **Private** networks.

Manual install (any OS):

```bash
corepack enable
pnpm install
pnpm db:generate
pnpm build
cp .env.example .env
```

## FFmpeg

TaazaStream ships with a bundled FFmpeg build (via `ffmpeg-static`/`ffprobe-static`), so it
works out of the box. For the newest codecs and GPU encoders, install FFmpeg system-wide:

```powershell
winget install Gyan.FFmpeg
```

Detection order: **Admin → Settings path → `FFMPEG_PATH`/`FFPROBE_PATH` in `.env` → system PATH → bundled**.
The dashboard shows which one is in use. Hardware encoding (NVIDIA NVENC, Intel Quick Sync,
AMD AMF) can be enabled in **Admin → Settings**; it falls back to CPU automatically.

## Creating media folders

Keep videos wherever they are — TaazaStream indexes them in place and never copies them.
Recommended layout:

```
D:\TaazaStream\Movies\Interstellar (2014)\Interstellar (2014).mkv
D:\TaazaStream\Movies\Interstellar (2014)\Interstellar (2014).en.srt     ← subtitles (any language code)
D:\TaazaStream\Movies\Interstellar (2014)\poster.jpg · fanart.jpg         ← optional artwork
D:\TaazaStream\Movies\Interstellar (2014)\movie.nfo                       ← optional metadata (Kodi format)
D:\TaazaStream\Series\Dark\tvshow.nfo · poster.jpg
D:\TaazaStream\Series\Dark\Season 01\Dark S01E01 - Secrets.mkv
```

Supported: MP4, M4V, MKV, WebM, MOV, AVI, WMV, FLV, TS/M2TS, MPG, OGV, 3GP. Episodes are
recognised as `S01E02`, `1x02`, or `Season 1\Episode 2`. Metadata can also come from a
`<video name>.json` (`{ "title", "year", "overview", "genres", "cast", "rating" }`) and can be edited
in **Admin → Library** (edits are locked against rescans).

Then: **Admin → Media folders → Browse… → Add & scan.** Multiple folders/drives are supported
(e.g. `D:\TaazaStream\Movies`, `E:\Movies`, `F:\Videos`).

## Starting the server

Double-click **`scripts\windows\start-taazastream.bat`** (keep the window open), or run `pnpm start`.
The console shows the addresses to use:

```
  │  This PC:        http://localhost:3000
  │  Phones / TVs:   http://192.168.1.100:3000
  │  Admin:          http://localhost:3000/admin
```

First run: open **http://localhost:3000/admin on the server PC itself** to create the admin
account (for security this is only allowed locally). Start automatically at sign-in with
`scripts\windows\autostart.ps1`.

## Finding the local IP & connecting devices

The server detects its LAN IP and shows it in the console, the admin dashboard and on the
**Connect a device** page (profile menu → _Connect a device_) with a **QR code**.
You can also run `ipconfig` and look for the _IPv4 Address_ of your Wi-Fi/Ethernet adapter.

- **Phone/tablet (Android, iPhone, iPad):** join the same Wi-Fi, scan the QR code or open `http://SERVER-IP:3000`. Use _Add to Home Screen_ for an app-like experience.
- **Laptop:** open `http://SERVER-IP:3000` in any modern browser.
- **Smart TV:** open the TV's web browser and type `http://SERVER-IP:3000`. TV browsers get a larger UI and arrow-key/remote navigation automatically (toggle in Admin → Settings → This device).
- **mDNS:** many devices also accept `http://taazastream.local:3000`. The IP address is the guaranteed method — some Android/TV browsers do not resolve `.local` names.

## Offline mode

TaazaStream needs **no internet at all**: the router only has to provide the local Wi-Fi.
With the internet unplugged, the website, artwork, search, playback, seeking, Continue Watching,
library scanning and the admin dashboard all keep working. The UI bundles its fonts and icons and
never calls CDNs, TMDB, YouTube or analytics. Supabase being unreachable is reported as
`local-only` mode, not an error. See [docs/OFFLINE-TEST.md](docs/OFFLINE-TEST.md) for the
acceptance test and how to repeat it at home.

## Supabase (optional)

Used only for metadata backup, artwork and sync — never for video playback, and video files are
never uploaded. The schema is in `supabase/migrations/` (tables with Row Level Security and no
public policies, plus a private `taazastream-artwork` bucket).

1. In `.env` set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Supabase → Project Settings → API).
2. To enable sync/backup, also set **`SUPABASE_SERVICE_ROLE_KEY`** — server-side only, never shared with browsers.
3. Admin → Backup & cloud → **Check connection** / **Sync now**, and enable _Cloud sync_ in Settings.

## GitHub

The repository excludes `.env`, databases, media and caches (see `.gitignore`); `pnpm check:secrets`
verifies this and runs in CI. GitHub Actions (`.github/workflows/ci.yml`) runs install, lint,
format check, typecheck, unit/API tests, builds, offline Playwright E2E, `pnpm audit` and the
secret/media check on every push and pull request.

## Docker

Native Windows is the primary deployment; Docker is provided for Linux servers/NAS:

```bash
docker compose up -d --build
```

Mount media read-only in `docker-compose.yml` (e.g. `- /srv/movies:/media/movies:ro`), then add
`/media/movies` in Admin → Media folders. On Linux, `network_mode: host` enables mDNS; pass
`/dev/dri` for Intel/AMD hardware transcoding.

## Security

Designed for a private LAN: admin APIs require login **and** a private IP; first admin can only be
created on the server PC; scrypt password hashing; HttpOnly SameSite=Strict session cookies;
CSRF header check; rate limiting; Zod validation; strict CSP via Helmet; files are only served by
database ID and re-checked against registered folders (no path traversal, no arbitrary file
serving); secrets never reach the browser or the logs. Details: [SECURITY.md](SECURITY.md).
**Do not port-forward TaazaStream to the internet** — use a VPN for remote access.

## Windows Firewall

Phones and TVs need inbound access to TCP 3000 on the server PC. Allow it for **Private networks
only** (run PowerShell as Administrator):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\firewall.ps1 -Port 3000
```

This adds an inbound rule limited to the _Private_ profile and the _local subnet_. Make sure your
home network is set to Private: Settings → Network & Internet → your Wi-Fi/Ethernet → _Network
profile type: Private_. Manual alternative: Windows Defender Firewall → Advanced settings → Inbound
Rules → New Rule → Port → TCP 3000 → Allow → **Private only**. Remove with `-Remove`.
Do not enable the rule for Public networks.

## Troubleshooting

| Problem                       | Fix                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phone can't open the site     | Same Wi-Fi as the server? Firewall rule added and network set to _Private_? Use the IP, not `.local`. Some routers have "AP/client isolation" — disable it.                     |
| `Port 3000 is already in use` | Close the other program or set `PORT=3001` in `.env`.                                                                                                                           |
| A video won't play            | The player automatically falls back to server-side conversion. Check **Admin → Settings → FFmpeg** shows _available_. Bitmap subtitles (PGS/VobSub) can't be shown in browsers. |
| Stuttering during transcoding | Lower the quality in the player, enable hardware acceleration, or pre-convert to H.264/AAC MP4 (direct play needs no CPU).                                                      |
| Titles missing after scan     | Check file names (see above) and **Admin → Library → Only missing files**. Corrupted files are reported in the scan summary.                                                    |
| Drive unplugged               | Its videos show as _missing_ and reappear after a rescan.                                                                                                                       |
| Forgot admin password         | On the server PC: `pnpm --filter @taazastream/server reset-admin admin NEW-PASSWORD`                                                                                            |
| Logs                          | The server console prints structured JSON logs; set `LOG_PRETTY=true` for readable output.                                                                                      |

## Performance

Streaming is designed for low CPU and RAM: files are streamed with backpressure (never loaded
into memory), keep-alive connections, cacheable range responses, per-stream tracking with limits
(**Max streams**, **Max transcodes**), idle FFmpeg jobs are stopped, encoders that run far ahead of
the viewer are paused, and the transcode cache is pruned by size. Direct play and remux cost
almost no CPU; each software transcode costs roughly 1–3 CPU cores at 1080p.

Real-world capacity depends on **server CPU, HDD/SSD speed, network speed, Wi-Fi quality, video
bitrate, the number of simultaneous viewers and whether transcoding is needed**. There is no
"unlimited" viewer count. Tips: connect the server by **Gigabit Ethernet**, prefer 5 GHz Wi-Fi
for clients, store media as H.264/AAC MP4 for direct play, and enable GPU encoding.
Measured results: [docs/PERFORMANCE-RESULTS.md](docs/PERFORMANCE-RESULTS.md) · run `pnpm test:perf`.

## Backup

**Admin → Backup & cloud → Back up now** (or `scripts\windows\backup.bat` / `pnpm backup`) writes
to `backups\`: a consistent SQLite snapshot (`.db`) and a portable metadata/settings export
(`.json`). The 10 newest backups are kept. Restore: stop the server, copy a `.db` over
`data\taazastream.db`, start again. Optional cloud backup goes to Supabase (above).

**Video files are not backed up automatically** — they're usually far too large. Back up your
media separately, e.g. a scheduled copy to an external drive (`robocopy D:\TaazaStream E:\Backup\TaazaStream /MIR`),
File History, or a NAS. Keep at least one copy on a different disk.

## Development

```bash
pnpm install && pnpm db:generate
node scripts/make-test-media.mjs   # synthetic sample library in ./test-media (git-ignored)
pnpm dev                           # API on :3000 (watch) + Vite on :5173 (proxying /api)
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Production deployment

1. `pnpm install --frozen-lockfile && pnpm db:generate && pnpm build`
2. Configure `.env` (port, optional media roots, optional Supabase).
3. Allow the port on the firewall for Private networks.
4. Run `pnpm start` (or the `.bat` launcher / scheduled task). Migrations apply automatically.
5. Create the admin on the server PC, add media folders, scan, connect devices.

## License

MIT — see [LICENSE](LICENSE). TaazaStream is an original project and is not affiliated with any
commercial streaming service.
