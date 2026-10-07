import path from 'node:path';

export const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.m4v',
  '.mkv',
  '.webm',
  '.mov',
  '.avi',
  '.wmv',
  '.flv',
  '.ts',
  '.m2ts',
  '.mts',
  '.mpg',
  '.mpeg',
  '.ogv',
  '.3gp',
]);

export const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa']);
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

export interface ParsedMovie {
  kind: 'movie';
  title: string;
  year: number | null;
}

export interface ParsedEpisode {
  kind: 'episode';
  seriesTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string | null;
  year: number | null;
}

export type ParsedName = ParsedMovie | ParsedEpisode;

/** Release-group noise removed from titles: "Movie.2014.1080p.BluRay.x264-GROUP". */
const NOISE =
  /\b(2160p|1080p|1080i|720p|576p|480p|4k|uhd|hdr10\+?|hdr|dv|dolby ?vision|sdr|bluray|blu-ray|bdrip|brrip|webrip|web-dl|webdl|web|hdtv|dvdrip|dvd|remux|x264|x265|h\.?264|h\.?265|hevc|avc|av1|xvid|divx|aac(2\.0|5\.1)?|ac3|eac3|ddp?(5\.1|2\.0)?|dts(-hd)?|truehd|atmos|10bit|8bit|proper|repack|extended|unrated|imax|internal|limited|multi|dual(-audio)?|subbed|dubbed|yts|yify|rarbg)\b.*$/i;

/** Turn "the.dark_knight" into "The Dark Knight" while keeping existing capitalisation. */
export function cleanTitle(raw: string): string {
  let s = raw
    .replace(/\[[^\]]*\]/g, ' ') // [Group] tags
    .replace(/[._]+/g, ' ')
    .replace(/\s+-\s*$/, '')
    .replace(NOISE, '')
    .replace(/[([{]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/[-–\s]+$/, '');
  if (!s) s = raw.trim();
  // Only title-case strings that are entirely lower case.
  if (s === s.toLowerCase()) {
    s = s.replace(/\b([a-z])/g, (c) => c.toUpperCase());
  }
  return s;
}

/** Key used to match the same title across files: lower case, no punctuation, no articles. */
export function sortTitleOf(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const YEAR = /(?:^|[\s.(_[-])((?:19|20)\d{2})(?:$|[\s.)_\]-])/;
const SXXEXX = /\bS(\d{1,3})[\s._-]*E(\d{1,4})(?:[\s._-]*-?E?\d{1,4})*\b/i;
const NXNN = /\b(\d{1,2})x(\d{2,3})\b/i;
const EPISODE_ONLY = /\b(?:E|EP|Episode)[\s._-]*(\d{1,4})\b/i;
const SEASON_DIR = /^(?:season|series|staffel|saison|temporada|s)[\s._-]*(\d{1,3})$/i;

function extractYear(s: string): { year: number | null; index: number } {
  // Use the *last* plausible year so "2001 A Space Odyssey (1968)" resolves to 1968.
  let match: RegExpExecArray | null = null;
  const re = new RegExp(YEAR.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    match = m;
    re.lastIndex = m.index + 1;
  }
  if (!match?.[1]) return { year: null, index: -1 };
  const year = Number(match[1]);
  const now = new Date().getFullYear() + 2;
  if (year < 1880 || year > now) return { year: null, index: -1 };
  // Do not treat a title that is only a year ("1917") as having no title.
  return { year, index: match.index + (match[0].startsWith(match[1]) ? 0 : 1) };
}

/**
 * Parse a video file path into movie/episode information.
 * `folderKind` lets admins force a library type ("movies" never yields episodes).
 */
export function parseMediaPath(
  filePath: string,
  folderKind: 'movies' | 'series' | 'mixed' = 'mixed',
): ParsedName {
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const parentDir = path.basename(path.dirname(filePath));
  const grandParentDir = path.basename(path.dirname(path.dirname(filePath)));

  if (folderKind !== 'movies') {
    const ep = parseEpisode(base, parentDir, grandParentDir);
    if (ep) return ep;
    if (folderKind === 'series') {
      // Series library without SxxEyy markers: use folder structure and trailing numbers.
      const seasonMatch = SEASON_DIR.exec(parentDir);
      const series = seasonMatch ? grandParentDir : parentDir;
      const epNum = /(\d{1,4})\D*$/.exec(base)?.[1];
      return {
        kind: 'episode',
        seriesTitle: cleanTitle(series),
        seasonNumber: seasonMatch?.[1] ? Number(seasonMatch[1]) : 1,
        episodeNumber: epNum ? Number(epNum) : 1,
        episodeTitle: cleanTitle(base),
        year: null,
      };
    }
  }

  return parseMovie(base, parentDir);
}

function parseEpisode(
  base: string,
  parentDir: string,
  grandParentDir: string,
): ParsedEpisode | null {
  let m = SXXEXX.exec(base);
  let season: number | null = null;
  let episode: number | null = null;
  let markerIndex = -1;
  let markerLength = 0;
  if (m?.[1] && m[2]) {
    season = Number(m[1]);
    episode = Number(m[2]);
    markerIndex = m.index;
    markerLength = m[0].length;
  } else if ((m = NXNN.exec(base)) && m[1] && m[2] && !/^\d{3,4}x\d{3,4}$/.test(m[0])) {
    season = Number(m[1]);
    episode = Number(m[2]);
    markerIndex = m.index;
    markerLength = m[0].length;
  } else {
    const seasonDir = SEASON_DIR.exec(parentDir);
    const epOnly = EPISODE_ONLY.exec(base);
    if (seasonDir?.[1] && epOnly?.[1]) {
      season = Number(seasonDir[1]);
      episode = Number(epOnly[1]);
      markerIndex = epOnly.index;
      markerLength = epOnly[0].length;
    }
  }
  if (season == null || episode == null) return null;

  const before = base.slice(0, markerIndex);
  const after = base.slice(markerIndex + markerLength);
  const seasonDirMatch = SEASON_DIR.test(parentDir);
  const folderSeries = seasonDirMatch ? grandParentDir : parentDir;
  const { year } = extractYear(before);
  let seriesRaw = before.replace(YEAR, ' ');
  if (!cleanTitle(seriesRaw) || cleanTitle(seriesRaw).length < 2) seriesRaw = folderSeries;
  const seriesTitle = cleanTitle(seriesRaw.replace(/\(\s*\)/g, ''));
  const epTitle = cleanTitle(after.replace(/^[\s._-]+/, ''));

  return {
    kind: 'episode',
    seriesTitle: seriesTitle || cleanTitle(folderSeries),
    seasonNumber: season,
    episodeNumber: episode,
    episodeTitle: epTitle && epTitle.length > 1 && epTitle !== seriesTitle ? epTitle : null,
    year,
  };
}

function parseMovie(base: string, parentDir: string): ParsedMovie {
  const { year, index } = extractYear(base);
  let titlePart = index > 0 ? base.slice(0, index) : base;
  let title = cleanTitle(titlePart.replace(/[([]\s*$/, ''));
  let finalYear = year;

  // Generic file names like "movie.mkv" or "video_ts": fall back to the folder name.
  if (!title || /^(movie|video|film|main|feature|sample|title\s*\d*)$/i.test(title)) {
    const folder = extractYear(parentDir);
    titlePart = folder.index > 0 ? parentDir.slice(0, folder.index) : parentDir;
    title = cleanTitle(titlePart);
    finalYear = finalYear ?? folder.year;
  }
  if (!title && year) title = String(year);
  return { kind: 'movie', title, year: finalYear };
}

/** Parse "Movie.en.forced.srt" style sidecar names relative to the video basename. */
export function parseSubtitleSidecar(
  videoBase: string,
  subtitleFile: string,
): { language: string | null; forced: boolean; isDefault: boolean } | null {
  const ext = path.extname(subtitleFile);
  const base = path.basename(subtitleFile, ext);
  if (base.toLowerCase() === videoBase.toLowerCase())
    return { language: null, forced: false, isDefault: false };
  if (!base.toLowerCase().startsWith(`${videoBase.toLowerCase()}.`)) return null;
  const flags = base
    .slice(videoBase.length + 1)
    .toLowerCase()
    .split('.')
    .filter(Boolean);
  const forced = flags.includes('forced');
  const isDefault = flags.includes('default');
  const language =
    flags.find((f) => /^[a-z]{2,3}(-[a-z]{2})?$/.test(f) && !['sdh', 'cc'].includes(f)) ?? null;
  return { language, forced, isDefault };
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  eng: 'English',
  hi: 'Hindi',
  hin: 'Hindi',
  es: 'Spanish',
  spa: 'Spanish',
  fr: 'French',
  fre: 'French',
  fra: 'French',
  de: 'German',
  ger: 'German',
  deu: 'German',
  it: 'Italian',
  ita: 'Italian',
  pt: 'Portuguese',
  por: 'Portuguese',
  ru: 'Russian',
  rus: 'Russian',
  ja: 'Japanese',
  jpn: 'Japanese',
  ko: 'Korean',
  kor: 'Korean',
  zh: 'Chinese',
  chi: 'Chinese',
  zho: 'Chinese',
  ar: 'Arabic',
  ara: 'Arabic',
  ta: 'Tamil',
  tam: 'Tamil',
  te: 'Telugu',
  tel: 'Telugu',
  ml: 'Malayalam',
  mal: 'Malayalam',
  kn: 'Kannada',
  kan: 'Kannada',
  bn: 'Bengali',
  ben: 'Bengali',
  mr: 'Marathi',
  mar: 'Marathi',
  pa: 'Punjabi',
  pan: 'Punjabi',
  ur: 'Urdu',
  urd: 'Urdu',
  tr: 'Turkish',
  tur: 'Turkish',
  nl: 'Dutch',
  dut: 'Dutch',
  nld: 'Dutch',
  sv: 'Swedish',
  swe: 'Swedish',
  pl: 'Polish',
  pol: 'Polish',
  id: 'Indonesian',
  ind: 'Indonesian',
  th: 'Thai',
  tha: 'Thai',
  vi: 'Vietnamese',
  vie: 'Vietnamese',
};

export function languageLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}
