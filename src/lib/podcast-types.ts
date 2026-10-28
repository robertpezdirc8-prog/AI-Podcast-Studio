// Skupni tipi in konstante za AI Podcast Studio (slovenski vmesnik).

export type VoiceId = 'artur' | 'jakob' | 'matjaz' | 'rok' | 'petra' | 'srecko';

export type EpisodeStyle = 'interview' | 'debate' | 'storytelling' | 'education' | 'custom';
export type Language = 'sl' | 'en';
export type EpisodeLength = 'short' | 'medium' | 'long' | 'custom';
export type SourceType = 'topic' | 'url' | 'text' | 'script';

export interface Host {
  name: string;
  voice: VoiceId;
  speed: number;
}

export interface Line {
  id: string;
  idx: number;
  speaker: string;
  voice: VoiceId;
  speed: number;
  emotion: string | null;
  text: string;
  chapter: string | null;
  audioPath: string | null;
  /** Kontekstna pavza PRED vrstico (ms) — enaka logika kot pri MP3 izvozu. */
  preDelayMs?: number;
}

export interface ShowNotes {
  summary: string;
  takeaways: string[];
}

export interface Episode {
  id: string;
  title: string;
  topic: string;
  style: EpisodeStyle;
  language: Language;
  status: 'script_ready' | 'ready';
  length: EpisodeLength;
  focus: string | null;
  sourceType: SourceType;
  sourceUrl: string | null;
  coverPath: string | null;
  summary: ShowNotes | null;
  hosts: Host[];
  lines: Line[];
  createdAt: string;
}

export interface EpisodeSummary {
  id: string;
  title: string;
  topic: string;
  style: EpisodeStyle;
  language: Language;
  status: string;
  length: EpisodeLength;
  sourceType: SourceType;
  coverPath: string | null;
  hasSummary: boolean;
  createdAt: string;
  lineCount: number;
  readyLines: number;
  totalDurationMs: number;
  // Statistika predvajanja (Jellypod/Spotify stil)
  playCount: number;
  lastPlayedAt: string | null;
  progressMs: number;
}

export const VOICES: Record<VoiceId, { name: string; desc: string }> = {
  rok: { name: 'Rok', desc: 'naravni moški glas (Microsoft Neural) — priporočeno' },
  petra: { name: 'Petra', desc: 'naravni ženski glas (Microsoft Neural) — priporočeno' },
  artur: { name: 'Artur', desc: 'lokalni slovenski glas — deluje brez povezave' },
  jakob: { name: 'Jakob', desc: 'višji, energičen moški glas' },
  matjaz: { name: 'Matjaž', desc: 'nižji, umirjen moški glas' },
  srecko: { name: 'Srečko', desc: 'gost iz Hrvaške — rahel hrvaški naglas (Microsoft Neural)' },
};

export const STYLE_OPTIONS: { value: EpisodeStyle; label: string; desc: string }[] = [
  { value: 'interview', label: 'Intervju', desc: 'Novinarja sprašujeta strokovnjaka' },
  { value: 'debate', label: 'Debata', desc: 'Dva mnenja se spopadata' },
  { value: 'storytelling', label: 'Zgodba', desc: 'Pripovedovalca pripovedujeta zgodbo' },
  { value: 'education', label: 'Izobraževanje', desc: 'Moderator razlaga temo' },
];

export const STYLE_LABELS: Record<EpisodeStyle, string> = {
  interview: 'Intervju',
  debate: 'Debata',
  storytelling: 'Zgodba',
  education: 'Izobraževanje',
  custom: 'Lastna skripta',
};

export const EPISODE_LENGTHS: { value: EpisodeLength; label: string; desc: string }[] = [
  { value: 'short', label: 'Kratka', desc: '~1–2 min, hitro dajanje' },
  { value: 'medium', label: 'Srednja', desc: '~3–5 min, klasična oddaja' },
  { value: 'long', label: 'Dolga', desc: '~6–9 min, poglobljena debata' },
];

export const LENGTH_LABELS: Record<EpisodeLength, string> = {
  short: 'Kratka',
  medium: 'Srednja',
  long: 'Dolga',
  custom: 'Poljubna',
};

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  topic: 'tema',
  url: 'članek',
  text: 'besedilo',
  script: 'skripta',
};

export const LANGUAGE_LABELS: Record<Language, string> = {
  sl: '🇸🇮 sl',
  en: '🇬🇧 en',
};

// Paleta barv voditeljev po indeksu (izraziti Tailwind razredi, brez modre).
export interface HostColor {
  dot: string;
  avatar: string;
}

export const HOST_COLORS: HostColor[] = [
  { dot: 'bg-amber-500', avatar: 'bg-amber-500/15 text-amber-400' },
  { dot: 'bg-emerald-500', avatar: 'bg-emerald-500/15 text-emerald-400' },
  { dot: 'bg-rose-500', avatar: 'bg-rose-500/15 text-rose-400' },
  { dot: 'bg-violet-500', avatar: 'bg-violet-500/15 text-violet-400' },
];

export function hostColor(index: number): HostColor {
  const len = HOST_COLORS.length;
  return HOST_COLORS[((index % len) + len) % len];
}
