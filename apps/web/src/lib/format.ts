const NAMES: Record<string, string> = {
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
};

export function languageName(code: string | null | undefined): string | null {
  if (!code) return null;
  return NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

export function channelsLabel(n: number | null): string {
  if (!n) return '';
  if (n === 1) return 'Mono';
  if (n === 2) return 'Stereo';
  if (n === 6) return '5.1';
  if (n === 8) return '7.1';
  return `${n}ch`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
