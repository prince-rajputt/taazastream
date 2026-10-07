import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

/**
 * Offline metadata: TaazaStream never calls TMDB or other online APIs. Rich metadata can be
 * supplied next to the media as Kodi/Jellyfin style `.nfo` files or a simple JSON file.
 */
export interface SidecarMetadata {
  title?: string;
  originalTitle?: string;
  year?: number;
  overview?: string;
  tagline?: string;
  genres?: string[];
  cast?: { name: string; role?: string | null }[];
  director?: string;
  rating?: number;
  contentRating?: string;
  episodeTitle?: string;
}

const jsonSchema = z
  .object({
    title: z.string().max(200).optional(),
    originalTitle: z.string().max(200).optional(),
    year: z.coerce.number().int().min(1870).max(2200).optional(),
    overview: z.string().max(5000).optional(),
    plot: z.string().max(5000).optional(),
    tagline: z.string().max(300).optional(),
    genres: z.array(z.string().max(40)).max(20).optional(),
    cast: z
      .array(
        z.union([
          z.string().max(120),
          z.object({ name: z.string().max(120), role: z.string().max(120).nullish() }),
        ]),
      )
      .max(100)
      .optional(),
    director: z.string().max(120).optional(),
    rating: z.coerce.number().min(0).max(10).optional(),
    contentRating: z.string().max(16).optional(),
  })
  .passthrough();

const MAX_SIDECAR_BYTES = 512 * 1024;

async function readSmall(file: string): Promise<string | null> {
  try {
    const buf = await readFile(file);
    if (buf.byteLength > MAX_SIDECAR_BYTES) return null;
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .trim();
}

function xmlTag(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  const v = m?.[1] ? decodeXml(m[1]) : undefined;
  return v ? v : undefined;
}

function xmlTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && out.length < 100) if (m[1]) out.push(decodeXml(m[1]));
  return out.filter(Boolean);
}

export function parseNfo(xml: string): SidecarMetadata {
  const meta: SidecarMetadata = {};
  const title = xmlTag(xml, 'title');
  if (title) meta.title = title;
  const original = xmlTag(xml, 'originaltitle');
  if (original) meta.originalTitle = original;
  const year = Number(xmlTag(xml, 'year') ?? xmlTag(xml, 'premiered')?.slice(0, 4));
  if (Number.isInteger(year) && year > 1870 && year < 2200) meta.year = year;
  const plot = xmlTag(xml, 'plot') ?? xmlTag(xml, 'outline');
  if (plot) meta.overview = plot.slice(0, 5000);
  const tagline = xmlTag(xml, 'tagline');
  if (tagline) meta.tagline = tagline;
  const genres = xmlTags(xml, 'genre').flatMap((g) => g.split(/\s*[/,|]\s*/));
  if (genres.length) meta.genres = [...new Set(genres)].slice(0, 20);
  const director = xmlTag(xml, 'director');
  if (director) meta.director = director;
  const rating = Number(xmlTag(xml, 'rating') ?? xmlTag(xml, 'value'));
  if (Number.isFinite(rating) && rating > 0 && rating <= 10)
    meta.rating = Math.round(rating * 10) / 10;
  const mpaa = xmlTag(xml, 'mpaa') ?? xmlTag(xml, 'certification');
  if (mpaa) meta.contentRating = mpaa.replace(/^Rated\s+/i, '').slice(0, 16);
  const actors = xmlTags(xml, 'actor')
    .map((a) => ({ name: xmlTag(a, 'name') ?? '', role: xmlTag(a, 'role') ?? null }))
    .filter((a) => a.name);
  if (actors.length) meta.cast = actors.slice(0, 50);
  return meta;
}

export function parseJsonSidecar(text: string): SidecarMetadata {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  const parsed = jsonSchema.safeParse(raw);
  if (!parsed.success) return {};
  const d = parsed.data;
  const meta: SidecarMetadata = {};
  if (d.title) meta.title = d.title;
  if (d.originalTitle) meta.originalTitle = d.originalTitle;
  if (d.year) meta.year = d.year;
  if (d.overview ?? d.plot) meta.overview = (d.overview ?? d.plot)!;
  if (d.tagline) meta.tagline = d.tagline;
  if (d.genres) meta.genres = d.genres;
  if (d.cast) meta.cast = d.cast.map((c) => (typeof c === 'string' ? { name: c } : c));
  if (d.director) meta.director = d.director;
  if (d.rating != null) meta.rating = d.rating;
  if (d.contentRating) meta.contentRating = d.contentRating;
  return meta;
}

/**
 * Look for metadata next to a video: `<name>.nfo`, `<name>.json`, then folder level
 * `movie.nfo` / `movie.json` (movies) or `tvshow.nfo` / `series.json` (series).
 */
export async function readSidecarMetadata(candidates: string[]): Promise<SidecarMetadata> {
  for (const file of candidates) {
    const text = await readSmall(file);
    if (text == null) continue;
    const meta =
      path.extname(file).toLowerCase() === '.nfo' ? parseNfo(text) : parseJsonSidecar(text);
    if (Object.keys(meta).length) return meta;
  }
  return {};
}
