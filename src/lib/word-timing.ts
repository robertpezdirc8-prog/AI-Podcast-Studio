/**
 * Besedna časovnica za karaoke (Task 41) — 100 % deterministično, brez AI.
 *
 * Trajanje vrstice porazdeli po besedah sorazmerno z dolžino besede
 * (isti uravnotežen model kot pri podnapisih shorts: znaki + 1 za presledek).
 * Skupna časovnica ostaja NESPREMENJENA — to je samo prikazni sloj nad
 * obstoječo vrstično obnovo.
 */

export interface WordSpan {
  word: string;
  /** začetni čas besede znotraj vrstice (sekunde) */
  startSec: number;
  /** končni čas besede znotraj vrstice (sekunde) */
  endSec: number;
}

/**
 * Razdeli besedilo vrstice na besede s sorazmernimi časi.
 * `durationSec <= 0` ali prazno besedilo → prazen seznam (brez karaokeja).
 */
export function wordSpans(text: string, durationSec: number): WordSpan[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || durationSec <= 0) return [];

  const weights = words.map((w) => w.length + 1); // +1 za presledek po besedi
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return [];

  const spans: WordSpan[] = [];
  let acc = 0;
  for (let i = 0; i < words.length; i += 1) {
    const startSec = (acc / total) * durationSec;
    acc += weights[i];
    const endSec = Math.min(durationSec, (acc / total) * durationSec);
    spans.push({ word: words[i], startSec, endSec });
  }
  return spans;
}
