// Odjemalske pomočnice za API + vrsta za generiranje zvoka (AI Podcast Studio).
// Vse zahteve uporabljajo RELATIVNE poti (isti origin) — nikoli absolutnih URL-jev ali vrat.

import type {
  Episode,
  EpisodeLength,
  EpisodeStyle,
  EpisodeSummary,
  Language,
  Line,
  ShowNotes,
  VoiceId,
} from './podcast-types';
import type { ShortsCaptionStyle } from '@/lib/podcast-ai';

interface LineAudioResponse {
  id: string;
  audioPath: string;
  durationMs: number;
}

/** Vrhnji podatki ene vrstice za obliko valovanja (Task 42). */
export interface PeaksLine {
  id: string;
  durationSec: number;
  preDelayMs: number;
  /** RMS vrhovi 0..1 (2 stolpca/s). */
  peaks: number[];
}

export interface PeaksResponse {
  lines: PeaksLine[];
}

/**
 * Oblika valovanja (Task 42): vrhovi po vrsticah. Ob napaki vrne `null` —
 * predvajalnik takrat pade nazaj na navaden drsnik (fail-soft).
 */
export async function fetchEpisodePeaks(id: string): Promise<PeaksResponse | null> {
  try {
    const res = await fetch(`/api/episodes/${id}/peaks`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as PeaksResponse;
  } catch {
    return null;
  }
}

/** Vir nove epizode: tema (privzeto), povezava do članka ali prilepljeno besedilo. */
export interface CreateEpisodeInput {
  topic?: string;
  url?: string;
  sourceText?: string;
  style: EpisodeStyle;
  language: Language;
  length?: EpisodeLength;
  focus?: string;
}

/** Lastna skripta brez AI modelov: razčlenjevalnik + lokalni Piper TTS (brezplačno). */
export interface CreateScriptEpisodeInput {
  title?: string;
  scriptText: string;
  /** Ime govorca (kot v skripti) → izbrani glas. */
  voices?: Record<string, VoiceId>;
}

function extractError(data: unknown, status: number): string {
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const message = (data as { error?: unknown }).error;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return `Napaka strežnika (${status})`;
}

async function parseResponse<T>(res: Response): Promise<T> {
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Odgovor brez JSON telesa.
  }
  if (!res.ok) throw new Error(extractError(data, res.status));
  return data as T;
}

export async function fetchEpisodes(): Promise<EpisodeSummary[]> {
  const res = await fetch('/api/episodes', { cache: 'no-store' });
  const data = await parseResponse<{ episodes: EpisodeSummary[] }>(res);
  return data.episodes ?? [];
}

export async function fetchEpisode(id: string): Promise<Episode> {
  const res = await fetch(`/api/episodes/${encodeURIComponent(id)}`, { cache: 'no-store' });
  const data = await parseResponse<{ episode: Episode }>(res);
  return data.episode;
}

export async function createEpisode(input: CreateEpisodeInput): Promise<Episode> {
  const res = await fetch('/api/episodes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await parseResponse<{ episode: Episode }>(res);
  return data.episode;
}

/** Epizoda iz lastne skripte — brez LLM, zvok kasneje sintetizira lokalni Piper. */
export async function createEpisodeFromScript(input: CreateScriptEpisodeInput): Promise<Episode> {
  const res = await fetch('/api/episodes/script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await parseResponse<{ episode: Episode }>(res);
  return data.episode;
}

export async function deleteEpisode(id: string): Promise<void> {
  const res = await fetch(`/api/episodes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await parseResponse<{ success: boolean }>(res);
}

export async function generateLineAudio(lineId: string): Promise<LineAudioResponse> {
  const res = await fetch(`/api/lines/${encodeURIComponent(lineId)}/audio`, { method: 'POST' });
  return parseResponse<LineAudioResponse>(res);
}

export async function fetchTtsPreview(voice: VoiceId): Promise<string> {
  const res = await fetch('/api/tts-preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice }),
  });
  const data = await parseResponse<{ audioPath: string }>(res);
  return data.audioPath;
}

/**
 * Prenese celotno epizodo kot MP3 (strežnik združi vrstice s pavzami)
 * in jo shrani v sistemsko mapo za prenose brskalnika.
 * Privzeto z uvodno/zaključno melodijo; z withJingle=false samo govor.
 */
export async function downloadEpisodeMp3(
  id: string,
  title: string,
  withJingle = true,
): Promise<void> {
  const res = await fetch(
    `/api/episodes/${encodeURIComponent(id)}/download${withJingle ? '' : '?jingle=0'}`,
  );
  if (!res.ok) {
    let message = `Napaka strežnika (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // brez JSON telesa
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const safeTitle = title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'epizoda';
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeTitle}.mp3`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Uredi besedilo vrstice — strežnik samodejno regenerira TTS za nov tekst.
 */
export async function updateLineText(
  lineId: string,
  text: string,
): Promise<LineAudioResponse & { text: string }> {
  const res = await fetch(`/api/lines/${encodeURIComponent(lineId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return parseResponse<LineAudioResponse & { text: string }>(res);
}

/**
 * Interaktivni način: voditelja vstavita vprašanje v oddajo in odgovorita
 * (3–6 novih vrstic na koncu). Traja 15–60 s (LLM + TTS).
 */
export async function askHosts(
  episodeId: string,
  question: string,
): Promise<{ episode: Episode; newLineIds: string[] }> {
  const res = await fetch(`/api/episodes/${encodeURIComponent(episodeId)}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  return parseResponse<{ episode: Episode; newLineIds: string[] }>(res);
}

/**
 * Generira AI ovitek epizode. Privzeto keširan na strežniku;
 * z force=true se stari ovitek izbriše in generira nov. Traja 10–30 s.
 */
export async function generateCover(episodeId: string, force = false): Promise<string> {
  const res = await fetch(`/api/episodes/${encodeURIComponent(episodeId)}/cover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  });
  const data = await parseResponse<{ coverPath: string }>(res);
  return data.coverPath;
}

/**
 * Prenese podnapise epizode (.srt) in jih shrani v sistemsko mapo
 * za prenose brskalnika (isti vzorec kot downloadEpisodeMp3).
 */
export async function downloadEpisodeSrt(id: string, title: string): Promise<void> {
  const res = await fetch(`/api/episodes/${encodeURIComponent(id)}/srt`);
  if (!res.ok) {
    let message = `Napaka strežnika (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // brez JSON telesa
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const safeTitle = title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'epizoda';
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeTitle}.srt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Skupni prenos besedilne datoteke (transkript .txt, poglavja .txt, video .mp4). */
async function downloadFile(url: string, filename: string, fallbackError: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    let message = `Napaka strežnika (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // brez JSON telesa
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function safeFileTitle(title: string): string {
  return title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'epizoda';
}

/** Audiogram video izvoz (MP4: ovitek + valovni obrazec + melodija + poglavja). */
export function downloadEpisodeVideo(id: string, title: string): Promise<void> {
  return downloadFile(
    `/api/episodes/${encodeURIComponent(id)}/video`,
    `${safeFileTitle(title)}.mp4`,
    'Izvoz videa ni uspel',
  );
}

/** Transkript epizode kot .txt (`Govorec: besedilo` + poglavja). */
export function downloadEpisodeTranscript(id: string, title: string): Promise<void> {
  return downloadFile(
    `/api/episodes/${encodeURIComponent(id)}/transcript`,
    `${safeFileTitle(title)}.txt`,
    'Prenos transkripta ni uspel',
  );
}

/** Poglavja v formatu za YouTube opis (0:00 Uvod, m:ss Naslov). */
export function downloadEpisodeChapters(id: string, title: string): Promise<void> {
  return downloadFile(
    `/api/episodes/${encodeURIComponent(id)}/chapters`,
    `${safeFileTitle(title)}-poglavja.txt`,
    'Prenos poglavij ni uspel',
  );
}

/**
 * Izrezek vrstice za deljenje (Pocket Casts "Clip Sharing" stil).
 * format 'mp3' — govor vrstice; 'video' — citatni audiogram 9:16 (TikTok/Reels).
 */
export function downloadLineClip(
  lineId: string,
  speaker: string,
  format: 'mp3' | 'video',
): Promise<void> {
  const safe = speaker.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'izrezek';
  return downloadFile(
    `/api/lines/${encodeURIComponent(lineId)}/clip${format === 'video' ? '?format=video' : ''}`,
    format === 'video' ? `izrezek-${safe}.mp4` : `izrezek-${safe}.mp3`,
    'Izvoz izrezka ni uspel',
  );
}

/** Izrezek poglavja kot MP3 (vrstice poglavja z pavzami). */
export function downloadChapterClip(
  episodeId: string,
  index: number,
  title: string,
): Promise<void> {
  return downloadFile(
    `/api/episodes/${encodeURIComponent(episodeId)}/chapterclip?index=${index}`,
    `poglavje-${safeFileTitle(title)}.mp3`,
    'Izvoz poglavja ni uspel',
  );
}

/** Poglavje kot SHORTS MP4 (9:16, vžgani podnapisi) — TikTok/Reels/Shorts. */
export function downloadChapterShort(
  episodeId: string,
  index: number,
  title: string,
  style: ShortsCaptionStyle = 'klasika',
): Promise<void> {
  const suffix = style === 'klasika' ? '' : `-${style}`;
  return downloadFile(
    `/api/episodes/${encodeURIComponent(episodeId)}/short?index=${index}&style=${style}`,
    `shorts${suffix}-${safeFileTitle(title)}.mp4`,
    'Izvoz shorts ni uspel',
  );
}

/** Shrani statistiko predvajanja (pozicija + štetje igre ≥ 30 s). Neurejene napake ignoriraj. */
export async function updateEpisodeProgress(
  id: string,
  progressMs: number,
  countPlay = false,
): Promise<void> {
  try {
    await fetch(`/api/episodes/${encodeURIComponent(id)}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progressMs: Math.max(0, Math.round(progressMs)), countPlay }),
    });
  } catch {
    // statistika ni kritična — napako ignoriraj
  }
}

/* ------------------------------------------------------------------ */
/* Javna delitev (Task 45): /?deli=<token>                              */
/* ------------------------------------------------------------------ */

export interface ShareState {
  shareToken: string | null;
  sharedAt: string | null;
  /** Polna povezava za deljenje (samo po POST vklopu). */
  url?: string;
}

/** Trenutno stanje delitve epizode (brez stranskih učinkov). */
export async function fetchShareState(id: string): Promise<ShareState> {
  const res = await fetch(`/api/episodes/${encodeURIComponent(id)}/share`, { cache: 'no-store' });
  return parseResponse<ShareState>(res);
}

/** Vklopi/izklopi javno povezavo epizode. */
export async function setEpisodeShare(id: string, enabled: boolean): Promise<ShareState> {
  const res = await fetch(`/api/episodes/${encodeURIComponent(id)}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  return parseResponse<ShareState>(res);
}

/** Javno objavljeni podatki epizode (brez ID-jev — samo vsebina za poslušanje). */
export interface ShareEpisode {
  title: string;
  topic: string;
  style: string;
  language: string;
  status: string;
  coverPath: string | null;
  hosts: { name: string; voice: string }[];
  summary: ShowNotes | null;
  createdAt: string;
  hasAudio: boolean;
  durationSec: number;
  chapters: { title: string; startSec: number }[];
  lines: { speaker: string; text: string; chapter: string | null }[];
}

/** Pridobi deljeno epizodo preko žetona. 404 → uporabniku prijazen Error. */
export async function fetchSharedEpisode(token: string): Promise<ShareEpisode> {
  const res = await fetch(`/api/share/${encodeURIComponent(token)}`, { cache: 'no-store' });
  const data = await parseResponse<{ episode: ShareEpisode }>(res);
  return data.episode;
}

const POSITION_KEY_PREFIX = 'aps_pos_';

/** Lokalna pozicija predvajanja (za "Nadaljuj od m:ss" — Apple/Spotify stil). */
export function saveLocalPosition(episodeId: string, positionMs: number): void {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem(POSITION_KEY_PREFIX + episodeId, String(Math.max(0, Math.round(positionMs))));
  } catch {
    // localStorage lahko manjka (zasebni način) — ignoriraj
  }
}

/** Preberi shranjeno pozicijo v ms ali null, če je ni. */
export function loadLocalPosition(episodeId: string): number | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(POSITION_KEY_PREFIX + episodeId);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Generira TTS zvok za vse vrstice brez `audioPath` z vzporednostjo 2
 * (dva delavca vlečeta iz skupnega števca). Neuspela vratica se poskusita
 * še enkrat po 1 s, nato se označita kot napaka (onLineError).
 *
 * Vrne funkcijo za preklic (AbortController) — klic ob odhodu iz studia.
 */
export function generateEpisodeAudio(
  episode: Episode,
  onLineUpdate: (line: Line, durationMs?: number) => void,
  onDone: () => void,
  onError: (message: string) => void,
  onLineError?: (lineId: string) => void,
): () => void {
  const controller = new AbortController();
  const signal = controller.signal;
  const lineById = new Map<string, Line>(episode.lines.map((line) => [line.id, line]));
  const queue = episode.lines
    .filter((line) => line.audioPath === null)
    .map((line) => line.id);
  let cursor = 0;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });

  const processLine = async (lineId: string): Promise<void> => {
    const retryWaits = [5000, 10000, 20000]; // potrpežljive ponovitve (429 okno traja ~1 min)
    for (let attempt = 0; attempt <= retryWaits.length; attempt += 1) {
      if (signal.aborted) return;
      try {
        const res = await fetch(`/api/lines/${encodeURIComponent(lineId)}/audio`, {
          method: 'POST',
          signal,
        });
        const data = await parseResponse<LineAudioResponse>(res);
        if (signal.aborted) return;
        const line = lineById.get(lineId);
        if (line) onLineUpdate({ ...line, audioPath: data.audioPath }, data.durationMs);
        return;
      } catch {
        if (signal.aborted) return;
        if (attempt < retryWaits.length) {
          await sleep(retryWaits[attempt]);
          continue;
        }
        onLineError?.(lineId);
      }
    }
  };

  const worker = async (): Promise<void> => {
    while (!signal.aborted) {
      const index = cursor;
      if (index >= queue.length) return;
      cursor += 1;
      await processLine(queue[index]);
    }
  };

  void Promise.all([worker(), worker()]) // vzporednost 2
    .then(() => {
      if (!signal.aborted) onDone();
    })
    .catch(() => {
      if (!signal.aborted) onError('Generiranje glasov ni uspelo.');
    });

  return () => controller.abort();
}
