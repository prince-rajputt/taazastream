# TaazaStream architecture

## Runtime overview

```
                    ┌──────────────────── Server PC (Windows) ─────────────────────┐
 Browser (PWA)      │  Fastify (0.0.0.0:3000)                                       │
 phone/laptop/TV ───┼─▶ security: helmet CSP · CORS · rate-limit · CSRF · Zod        │
                    │   ├─ /api/*         REST (JSON envelope { ok, data | error })  │
                    │   ├─ /api/stream    LocalVideoStreamer (HTTP Range, 206)       │
                    │   ├─ /api/hls       HlsManager (remux / on-demand transcode)   │
                    │   ├─ /api/images    LocalImageServer (WebP cache)              │
                    │   └─ /*             web app (static, SPA fallback, PWA)        │
                    │                                                               │
                    │  Core (offline):  LocalDatabase (SQLite+Prisma, WAL, FTS5)     │
                    │                   LocalMediaScanner · LocalAuth · LocalSettings│
                    │                   StreamTracker · ProgressService · Backups    │
                    │  Tools:           FFprobe/FFmpeg (system or bundled)           │
                    │  Optional cloud:  SupabaseSync ─▶ SupabaseStorageProvider      │
                    └──────────────┬───────────────────────────────┬────────────────┘
                                   │                               │ (internet, optional)
                          Local HDD/SSD media             Supabase "Storage" project
```

## Request flow: playing a video

1. The player asks `GET /api/playback/:videoId?caps=…` with the codecs/containers the browser
   reported (`MediaSource.isTypeSupported` / `canPlayType`).
2. `decidePlayback()` (shared package) returns `direct`, `remux` or `transcode`.
3. **direct** → `<video src="/api/stream/:id">`. The server opens the file by ID (path from
   SQLite, re-validated inside its media folder), answers Range requests with `206`, streams with a
   256 KiB `ReadStream` and backpressure, and destroys the stream when the client disconnects.
4. **remux** → `/api/hls/:id/master.m3u8?mode=remux`: one FFmpeg process stream-copies video into
   MPEG-TS (or fMP4 for HEVC) HLS segments; audio is copied or converted to AAC. Results are cached.
5. **transcode** → a VOD playlist with fixed 4 s segments is generated immediately. Each segment
   request is served from cache, waits for the running encoder, or restarts FFmpeg at that segment
   (`-ss`, `-start_number`, `-output_ts_offset`, forced keyframes every 4 s) so timestamps remain
   continuous. Idle jobs stop after 30 s; jobs more than 120 segments ahead of the viewer stop;
   concurrent transcodes are capped (_Max transcodes_) with LRU eviction.
6. If direct play fails in the browser anyway, the player re-negotiates with conservative
   capabilities and falls back to server-side conversion at the same position.
7. Progress is reported every 10 s and on pause/exit (`keepalive` fetch). The server coalesces
   reports in memory and writes them to SQLite in one transaction every 15 s (immediately on
   pause/complete), so a film costs a few hundred small writes instead of one per second.

## Scanner

`walk` (no symlink following, skips recycle bins/system folders/samples) → compare with SQLite by
path, size and mtime → detect **moved** files (same name + size) to keep watch history → FFprobe the
new/changed ones (3 in parallel) → store container family, codecs, bit depth, duration, bitrate,
FPS, audio tracks and subtitles → parse names (`Title (Year)`, release-noise removal, `S01E02`,
`1x02`, season folders) → read `.nfo`/`.json` sidecars → link to Movie or Series/Season/Episode →
artwork from sidecar images or extracted frames (WebP) → update the FTS5 index. Files that
disappear are marked **missing** (never deleted automatically). Corrupt files are recorded with
the probe error and excluded from the catalog.

## Database (SQLite / Prisma)

`User` (admins + viewer profiles), `AdminSession`, `Movie`, `Series`, `Season`, `Episode`,
`Genre`, `VideoFile`, `AudioTrack`, `Subtitle`, `WatchHistory`, `ContinueWatching`, `Playlist`,
`PlaylistItem`, `Favorite` (My List), `ServerSetting`, `MediaFolder`, `ScanJob`, plus the
`search_fts` FTS5 virtual table maintained by `SearchService`. Foreign keys cascade where data
belongs to a parent; indexes cover catalog sorting, progress lookups and scanning.

## API

All JSON responses use `{ "ok": true, "data": … }` or `{ "ok": false, "error": { "code", "message", "details?" } }`.
State-changing requests require the header `X-TaazaStream: 1`.

| Method                | Path                                                                               | Purpose                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| GET                   | `/api/health`                                                                      | Liveness, DB/FFmpeg status, local-only vs cloud mode                                                              |
| GET                   | `/api/connect`                                                                     | LAN URLs + QR code (SVG)                                                                                          |
| GET                   | `/api/home`                                                                        | Hero + rows (Continue Watching, Trending, Recently Added, Movies, Series, My List, Popular, New Releases, genres) |
| GET                   | `/api/movies`, `/api/movies/:id`                                                   | Paged list (genre/sort/year), details incl. files, audio, subtitles, related                                      |
| GET                   | `/api/series`, `/api/series/:id`, `/api/series/:id/seasons`                        | Series, seasons and episodes with progress                                                                        |
| GET                   | `/api/genres`, `/api/genres/:slug`                                                 | Genres and their titles                                                                                           |
| GET                   | `/api/search?q=`, `/api/search/suggest?q=`                                         | FTS search and typeahead suggestions                                                                              |
| GET/POST/DELETE       | `/api/my-list`                                                                     | My List                                                                                                           |
| GET                   | `/api/continue-watching`                                                           | Resume rows (one per series, next episode after finishing)                                                        |
| POST                  | `/api/watch-progress`                                                              | Report position (debounced writes, `?flush=1` to persist now)                                                     |
| DELETE                | `/api/continue-watching/:videoId`                                                  | Hide from Continue Watching                                                                                       |
| GET/POST/PATCH/DELETE | `/api/profiles`                                                                    | Viewer profiles                                                                                                   |
| GET                   | `/api/playback/:videoId`                                                           | Playback negotiation (mode, URL, qualities, audio, subtitles, resume, next)                                       |
| GET/HEAD              | `/api/stream/:videoId`                                                             | Direct Range streaming                                                                                            |
| GET                   | `/api/hls/:videoId/master.m3u8`, `/:variant/index.m3u8`, `/:variant/:segment`      | HLS                                                                                                               |
| GET                   | `/api/subtitles/:videoId`, `/api/subtitles/:videoId/:id.vtt`                       | Subtitle list / WebVTT                                                                                            |
| GET                   | `/api/images/:name`                                                                | Cached artwork                                                                                                    |
| GET/POST              | `/api/auth/state`, `/setup`, `/login`, `/logout`, `/password`                      | Local admin auth                                                                                                  |
| GET                   | `/api/admin/stats`, `/devices`, `/streams`, `/server`                              | Dashboard                                                                                                         |
| GET/POST/PATCH/DELETE | `/api/admin/media-folders[/:id]`, `/api/admin/fs/browse`                           | Folders + server folder picker                                                                                    |
| GET/POST              | `/api/admin/scan`, `/api/admin/scan/cancel`                                        | Scanning                                                                                                          |
| GET/PATCH/DELETE      | `/api/admin/library`, `/movies/:id`, `/series/:id`, `/episodes/:id`, `/videos/:id` | Library editing                                                                                                   |
| POST                  | `/api/admin/:kind/:id/artwork/:role[/from-video]`                                  | Poster/backdrop upload or frame grab                                                                              |
| POST/DELETE           | `/api/admin/videos/:id/subtitles`, `/api/admin/subtitles/:id`                      | Subtitle management                                                                                               |
| GET/PATCH             | `/api/admin/settings`                                                              | Settings                                                                                                          |
| GET/POST/DELETE       | `/api/admin/backups[/:file]`                                                       | Backups                                                                                                           |
| GET/POST              | `/api/admin/cloud`, `/cloud/check`, `/cloud/sync`                                  | Optional Supabase                                                                                                 |
| GET/POST              | `/api/admin/cache`, `/cache/clear`, `/search/rebuild`                              | Maintenance                                                                                                       |

## Frontend

React 19 + React Router + TanStack Query + Zustand (per-device prefs) + Tailwind CSS 4.
Routes: home, movies, series, genres, details, search, My List, profiles, connect, player
(lazy, hls.js), admin (lazy). Spatial navigation maps arrow keys to the nearest focusable element
for TV remotes; TV browsers get a 125 % base size. The PWA service worker precaches the app shell
and caches artwork; it never caches video.

## Error handling

Missing/deleted files → `MEDIA_MISSING` (404) and marked missing on rescan; corrupted files →
`MEDIA_UNREADABLE` (422); unsupported codecs → automatic remux/transcode; FFmpeg failures →
`TRANSCODE_FAILED` (hardware encoder falls back to x264); disk full → `DISK_FULL` (507);
permission denied → `MEDIA_UNREADABLE` (403); network drops → hls.js retries with backoff and a
"can't reach server" banner; database errors → `DATABASE_ERROR`; Supabase unavailable → local-only;
invalid IDs → `VALIDATION_FAILED`/`NOT_FOUND`; unauthorized admin → 401/403.
