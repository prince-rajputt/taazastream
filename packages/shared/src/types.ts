/**
 * API contract shared by the TaazaStream server and the web client.
 * Every JSON endpoint responds with an {@link ApiResponse} envelope.
 */

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = {
  ok: false;
  error: { code: ApiErrorCode; message: string; details?: unknown };
};
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'RANGE_NOT_SATISFIABLE'
  | 'MEDIA_MISSING'
  | 'MEDIA_UNREADABLE'
  | 'TRANSCODE_FAILED'
  | 'TRANSCODER_UNAVAILABLE'
  | 'STREAM_LIMIT'
  | 'DISK_FULL'
  | 'DATABASE_ERROR'
  | 'INTERNAL_ERROR';

export type TitleKind = 'movie' | 'series';

export interface ProgressInfo {
  videoId: string;
  positionSec: number;
  durationSec: number;
  /** 0..1 */
  percent: number;
  updatedAt: string;
}

export interface TitleCard {
  id: string;
  kind: TitleKind;
  title: string;
  year: number | null;
  overview: string | null;
  genres: string[];
  rating: number | null;
  contentRating: string | null;
  durationSec: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  /** Short accent colour (hex) derived from artwork or title, used for placeholders. */
  accent: string;
  addedAt: string;
  seasonCount?: number;
  episodeCount?: number;
  /** For movies: the default video file to play. */
  videoId?: string | null;
  progress?: ProgressInfo | null;
  inMyList?: boolean;
}

export interface AudioTrackInfo {
  /** Index among audio streams (0-based), stable for a given file. */
  index: number;
  codec: string;
  language: string | null;
  title: string | null;
  channels: number | null;
  isDefault: boolean;
}

export interface SubtitleInfo {
  id: string;
  language: string | null;
  label: string;
  format: string;
  source: 'embedded' | 'sidecar' | 'uploaded';
  isDefault: boolean;
  forced: boolean;
  /** WebVTT URL usable by <track>. Null for image based subtitles that cannot be converted. */
  url: string | null;
}

export interface VideoInfo {
  id: string;
  fileName: string;
  container: string | null;
  durationSec: number;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
  fps: number | null;
  bitDepth: number | null;
  audioTracks: AudioTrackInfo[];
  subtitles: SubtitleInfo[];
  available: boolean;
}

export interface CastMember {
  name: string;
  role?: string | null;
}

export interface MovieDetail extends TitleCard {
  kind: 'movie';
  tagline: string | null;
  cast: CastMember[];
  director: string | null;
  videos: VideoInfo[];
  related: TitleCard[];
}

export interface EpisodeInfo {
  id: string;
  seriesId: string;
  seasonId: string;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  overview: string | null;
  durationSec: number | null;
  thumbUrl: string | null;
  videoId: string | null;
  airDate: string | null;
  progress?: ProgressInfo | null;
}

export interface SeasonInfo {
  id: string;
  seriesId: string;
  number: number;
  title: string;
  overview: string | null;
  posterUrl: string | null;
  episodes: EpisodeInfo[];
}

export interface SeriesDetail extends TitleCard {
  kind: 'series';
  cast: CastMember[];
  seasons: SeasonInfo[];
  related: TitleCard[];
  /** Episode the viewer should continue with (or start at). */
  nextUp: EpisodeInfo | null;
}

export interface ContinueWatchingItem {
  videoId: string;
  kind: TitleKind;
  titleId: string;
  episodeId: string | null;
  title: string;
  subtitle: string | null;
  positionSec: number;
  durationSec: number;
  percent: number;
  backdropUrl: string | null;
  posterUrl: string | null;
  accent: string;
  updatedAt: string;
}

export interface HomeRow {
  id: string;
  title: string;
  variant: 'poster' | 'landscape' | 'continue' | 'ranked';
  items: TitleCard[];
  continueItems?: ContinueWatchingItem[];
  /** Link to "see all" page. */
  href?: string;
}

export interface HomeFeed {
  hero: TitleCard[];
  rows: HomeRow[];
  genres: GenreInfo[];
  libraryEmpty: boolean;
}

export interface GenreInfo {
  id: string;
  name: string;
  slug: string;
  count: number;
}

export interface SearchSuggestion {
  id: string;
  kind: TitleKind;
  title: string;
  year: number | null;
  posterUrl: string | null;
  accent: string;
}

export interface SearchResult {
  query: string;
  items: TitleCard[];
  genres: GenreInfo[];
  total: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/* ------------------------------------------------------------------ */
/* Playback                                                            */
/* ------------------------------------------------------------------ */

export type PlaybackMode = 'direct' | 'remux' | 'transcode';
export type QualityId = 'original' | '1080p' | '720p' | '480p';

export interface QualityOption {
  id: QualityId;
  label: string;
  height: number | null;
}

export interface PlaybackInfo {
  videoId: string;
  mode: PlaybackMode;
  /** Human readable reason, shown in the player's stats overlay. */
  reason: string;
  url: string;
  isHls: boolean;
  title: string;
  subtitle: string | null;
  durationSec: number;
  resumeSec: number;
  backdropUrl: string | null;
  qualities: QualityOption[];
  quality: QualityId;
  audioTracks: AudioTrackInfo[];
  audioIndex: number;
  subtitles: SubtitleInfo[];
  next: NextEpisode | null;
  titleId: string;
  kind: TitleKind;
}

export interface NextEpisode {
  episodeId: string;
  videoId: string;
  title: string;
  seasonNumber: number;
  episodeNumber: number;
  thumbUrl: string | null;
}

/** What the browser told us it can decode. */
export interface ClientCapabilities {
  video: string[];
  audio: string[];
  containers: string[];
  hls: 'native' | 'mse' | 'none';
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export interface ServerInfo {
  name: string;
  version: string;
  host: string;
  port: number;
  lanAddresses: string[];
  primaryUrl: string;
  urls: string[];
  mdnsHost: string | null;
  mdnsEnabled: boolean;
  uptimeSec: number;
  platform: string;
  nodeVersion: string;
  ffmpeg: { available: boolean; path: string | null; version: string | null; source: string };
  ffprobe: { available: boolean; path: string | null; version: string | null; source: string };
  cloud: CloudStatus;
}

export interface CloudStatus {
  configured: boolean;
  reachable: boolean;
  mode: 'local-only' | 'cloud-sync';
  lastCheckedAt: string | null;
  lastSyncAt: string | null;
  message: string;
  canWrite: boolean;
}

export interface DiskInfo {
  path: string;
  label: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
}

export interface AdminStats {
  counts: {
    movies: number;
    series: number;
    seasons: number;
    episodes: number;
    videos: number;
    missingVideos: number;
    mediaFolders: number;
  };
  storage: {
    libraryBytes: number;
    disks: DiskInfo[];
    cacheBytes: number;
  };
  system: {
    cpuPercent: number;
    cpuCount: number;
    cpuModel: string;
    loadAvg: number[];
    memTotalBytes: number;
    memUsedBytes: number;
    processRssBytes: number;
    processHeapBytes: number;
  };
  network: {
    currentBps: number;
    totalBytesSent: number;
    history: { t: number; bps: number }[];
  };
  streams: {
    active: number;
    max: number;
    transcodes: number;
    maxTranscodes: number;
  };
  devices: { connected: number };
  lastScan: ScanJobInfo | null;
  server: ServerInfo;
}

export type DeviceType = 'Phone' | 'Tablet' | 'Desktop' | 'TV' | 'Unknown';

export interface DeviceInfo {
  id: string;
  ip: string;
  type: DeviceType;
  browser: string;
  os: string;
  status: 'Streaming' | 'Paused' | 'Idle';
  currentVideo: string | null;
  /** Videos open on this device right now (several tabs/windows count separately). */
  activeStreams: number;
  mode: PlaybackMode | null;
  bandwidthBps: number;
  bytesSent: number;
  firstSeen: string;
  lastSeen: string;
}

export interface ActiveStream {
  id: string;
  videoId: string;
  title: string;
  ip: string;
  deviceType: DeviceType;
  mode: PlaybackMode;
  quality: QualityId;
  state: 'playing' | 'paused';
  startedAt: string;
  lastActivity: string;
  bytesSent: number;
  bandwidthBps: number;
}

export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ScanJobInfo {
  id: string;
  status: ScanStatus;
  folderId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  filesSeen: number;
  filesAdded: number;
  filesUpdated: number;
  filesRemoved: number;
  filesFailed: number;
  currentFile: string | null;
  message: string | null;
  progress: number;
}

export interface MediaFolderInfo {
  id: string;
  path: string;
  label: string;
  kind: 'movies' | 'series' | 'mixed';
  enabled: boolean;
  exists: boolean;
  videoCount: number;
  lastScannedAt: string | null;
  createdAt: string;
}

export interface AdminSettings {
  serverName: string;
  ffmpegPath: string;
  ffprobePath: string;
  defaultQuality: QualityId;
  maxStreams: number;
  maxTranscodes: number;
  transcodePreset: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium';
  hardwareAcceleration: 'none' | 'nvenc' | 'qsv' | 'amf';
  hlsSegmentSeconds: number;
  cacheMaxGb: number;
  thumbnailsEnabled: boolean;
  mdnsEnabled: boolean;
  mdnsHostname: string;
  autoScanIntervalMinutes: number;
  cloudSyncEnabled: boolean;
}

export interface AdminLibraryItem {
  id: string;
  kind: TitleKind;
  title: string;
  year: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  accent: string;
  genres: string[];
  videoCount: number;
  episodeCount?: number;
  missing: boolean;
  addedAt: string;
  path: string | null;
}

export interface AdminVideoFile {
  id: string;
  path: string;
  sizeBytes: number;
  durationSec: number;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  container: string | null;
  missing: boolean;
  subtitles: SubtitleInfo[];
  audioTracks: AudioTrackInfo[];
}

export interface AdminUser {
  id: string;
  username: string;
  role: 'ADMIN' | 'VIEWER';
}

/** Files the admin shares with every device on the LAN (PDFs and gallery images). */
export type SharedKind = 'pdf' | 'image';

export interface SharedFile {
  id: string;
  kind: SharedKind;
  /** Original file name as uploaded (display only). */
  name: string;
  sizeBytes: number;
  uploadedAt: string;
  /** Inline view URL. */
  url: string;
  /** Same file with `Content-Disposition: attachment`. */
  downloadUrl: string;
  /** Small WebP/JPEG preview for images; null for PDFs or when FFmpeg is unavailable. */
  thumbUrl: string | null;
}

export interface AuthState {
  authenticated: boolean;
  user: AdminUser | null;
  setupRequired: boolean;
  /** True when setup can be performed from this client (only from the server itself). */
  setupAllowedFromHere: boolean;
}

export interface Profile {
  id: string;
  name: string;
  color: string;
  isKids: boolean;
}

export interface BackupInfo {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}
