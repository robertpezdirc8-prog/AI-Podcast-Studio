/**
 * Dramaturški pregled skripte (Task 43) — 100 % brez AI modelov.
 *
 * Deterministični nabor pravil, izpeljan iz poklicne radijske dramaturgije
 * (isti pravili, ki jih sledijo vgrajene šablone v script-templates.ts):
 *  1. KAVELJ      — prva vrstica ne sme biti gol pozdrav, obljubi zgodbo/vprašanje
 *  2. VODNIKI     — uvodne vrstice naj napovejo vsebino oddaje
 *  3. POGRAVJA    — daljša skripta z ## poglavji (ID3 žigi, glasbena podlaga, shorts)
 *  4. MONOLOGI    — eno-odstavnih govorov naj ne bo (mejna slušnost ≈ 45 besed)
 *  5. RAVNOVESJE  — dialog naj ne bo monokultura (delež najglasnejšega govorca)
 *  6. ZAKLJUČEK   — zadnja vrstica naj vsebuje poziv k dejanju / napoved
 *  7. POVZREDNOST — preveč ultra-kraških pritrdilnih vrstic ubija tempo
 *
 * Poleg tega: ravnovesje govorcev (vrstice + besede) in ocena trajanja
 * (hitrost govora ≈ 2,5 besede/s + premor med vrsticami).
 *
 * Čista TS koda brez Node odvisnosti — uporabna na odjemalcu in strežniku.
 */

import type { ParsedScript } from '@/lib/script-parser';

export interface SpeakerBalance {
  speaker: string;
  lines: number;
  words: number;
  /** delež vrstic (0..1) */
  share: number;
}

export type ScriptCheckState = 'ok' | 'warn' | 'info';

export interface ScriptCheck {
  id: string;
  state: ScriptCheckState;
  title: string;
  detail: string;
}

export interface ScriptAnalysis {
  /** skupno število besed (očiščen govor) */
  words: number;
  /** groba ocena trajanja v sekundah */
  estimatedSeconds: number;
  /** ravnovesje govorcev, razvrščeno po številu vrstic (padajoče) */
  balance: SpeakerBalance[];
  /** največji delež vrstic enega govorca (0..1) */
  dominantShare: number;
  checks: ScriptCheck[];
  warnings: number;
  infos: number;
}

const WORDS_PER_SECOND = 2.5;
const LINE_OVERHEAD_S = 0.4;

/** Vrste pozdravov, ki same po sebi NISO kavelj. */
const GREETING_RE =
  /^(dober\s+(dan|večer)|dobro\s+jutro|živjo|zdravo|dobrodošli|pozdravljeni|dober\s+večer!)/i;

/** Markers vodnikov / napovedi vsebine. */
const AGENDA_RE =
  /\b(danes|v\s+(današnji|oddaji|tem\s+oddaji)|tema|tri|dva|pet)?\s*(bomo|boste)\b|v\s+današnji\s+oddaji|kaj\s+pravi|po\s+vrsti|začn(i|iva|imo)|napoved|v\s+studiu|gost|zgodba\s+o|moj\s+predlog|vprašanje\s+za/i;

/** Markers poziva k dejanju / napovedi v zadnji vrstici. */
const CTA_RE =
  /\b(delite|ocene|oceno|pustite|pišite|napišite|sporočite|naslednjič|se\s+slišimo|se\s+beremo|prisluhnite|sledite|naročite|komentar|vprašanja|ne\s+pozabite|glasujte|povejte)\b/i;

const MONOLOG_WORD_LIMIT = 45;
const ULTRA_SHORT_WORDS = 2;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Ocena trajanja v sekundah: govor + premori med vrsticami. */
export function estimateScriptSeconds(words: number, lines: number): number {
  return words / WORDS_PER_SECOND + lines * LINE_OVERHEAD_S;
}

/** Trajanje v m:ss ali h:mm:ss (iz sekund). */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function analyzeScript(parsed: ParsedScript): ScriptAnalysis {
  const { lines, speakers, chapterCount } = parsed;

  const words = lines.reduce((sum, l) => sum + wordCount(l.text), 0);

  // Ravnovesje govorcev
  const perSpeaker = new Map<string, SpeakerBalance>();
  for (const line of lines) {
    const entry = perSpeaker.get(line.speaker) ?? {
      speaker: line.speaker,
      lines: 0,
      words: 0,
      share: 0,
    };
    entry.lines += 1;
    entry.words += wordCount(line.text);
    perSpeaker.set(line.speaker, entry);
  }
  const balance = [...perSpeaker.values()]
    .map((b) => ({ ...b, share: lines.length > 0 ? b.lines / lines.length : 0 }))
    .sort((a, b) => b.lines - a.lines);
  const dominantShare = balance.length > 0 ? balance[0].share : 0;

  const checks: ScriptCheck[] = [];
  const plural = (n: number, one: string, few: string, many: string) =>
    n === 1 ? one : n === 2 ? few : many;

  // 1. KAVELJ — prva vrstica
  if (lines.length > 0) {
    const first = lines[0];
    const fw = wordCount(first.text);
    if (GREETING_RE.test(first.text) && fw <= 8) {
      checks.push({
        id: 'kavelj',
        state: 'warn',
        title: 'Kavelj',
        detail: `Prva vrstica je gol pozdrav („${first.text.slice(0, 40)}…“). Kavelj obljubi zgodbo, vprašanje ali številko — pozdrav prilepite v drugo vrstico.`,
      });
    } else if (fw >= 4) {
      checks.push({
        id: 'kavelj',
        state: 'ok',
        title: 'Kavelj',
        detail: 'Prva vrstica nosi vsebino — poslušalcu da razlog, da ostane.',
      });
    } else {
      checks.push({
        id: 'kavelj',
        state: 'info',
        title: 'Kavelj',
        detail: 'Prva vrstica je zelo kratka — razmislite o močnejšem uvodnem stavku.',
      });
    }
  }

  // 2. VODNIKI — napoved vsebine v uvodnih vrsticah
  if (lines.length >= 6) {
    const intro = lines.slice(0, 4).map((l) => l.text).join(' ');
    if (AGENDA_RE.test(intro)) {
      checks.push({
        id: 'vodniki',
        state: 'ok',
        title: 'Vodniki',
        detail: 'Uvod napove vsebino — poslušalec ve, kaj sledi.',
      });
    } else {
      checks.push({
        id: 'vodniki',
        state: 'info',
        title: 'Vodniki',
        detail: 'V prvih 3–4 vrsticah na kratko napovejte sklope oddaje („V današnji oddaji …“).',
      });
    }
  }

  // 3. POGRAVJA
  if (lines.length >= 8) {
    if (chapterCount === 0) {
      checks.push({
        id: 'poglavja',
        state: 'warn',
        title: 'Poglavja',
        detail:
          'Ni poglavij. Vrstice z naslovom „## Poglavje“ omogočijo ID3 žige, glasbeno podlago na prehode in kraješe izrezke (shorts).',
      });
    } else if (lines.length >= 24 && chapterCount < 3) {
      checks.push({
        id: 'poglavja',
        state: 'info',
        title: 'Poglavja',
        detail: `${chapterCount} ${plural(chapterCount, 'poglavje', 'poglavji', 'poglavja')} za ${lines.length} vrstic — pri daljši epizodi so priporočena vsaj tri.`,
      });
    } else {
      checks.push({
        id: 'poglavja',
        state: 'ok',
        title: 'Poglavja',
        detail: `${chapterCount} ${plural(chapterCount, 'poglavje', 'poglavji', 'poglavja')} — žigi, podlaga in shorts so omogočeni.`,
      });
    }
  }

  // 4. MONOLOGI — predolge vrstice
  const longest = lines
    .map((l, i) => ({ idx: i + 1, speaker: l.speaker, words: wordCount(l.text) }))
    .sort((a, b) => b.words - a.words)[0];
  if (longest && longest.words > MONOLOG_WORD_LIMIT) {
    checks.push({
      id: 'monologi',
      state: 'warn',
      title: 'Monologi',
      detail: `Vrstica ${longest.idx} (${longest.speaker}) ima ${longest.words} besed. Slušnost posamezne vrstice obupi pri ~${MONOLOG_WORD_LIMIT} — razdelite jo na dve.`,
    });
  } else if (longest && lines.length >= 4) {
    checks.push({
      id: 'monologi',
      state: 'ok',
      title: 'Monologi',
      detail: `Najdaljša vrstica ima ${longest.words} besed — tempo je pod premico slušnosti.`,
    });
  }

  // 5. RAVNOVESJE — monokultura / solistična oddaja
  if (speakers.length === 1 && lines.length >= 6) {
    checks.push({
      id: 'ravnovesje',
      state: 'info',
      title: 'Ravnovesje',
      detail: `Skripta ima samo enega govorca (${speakers[0]}). Monolog je legitimna oblika — če pa je cilj dialog, dodelite vrstice drugemu govorcu.`,
    });
  } else if (speakers.length >= 2 && lines.length >= 4) {
    const top = balance[0];
    const pct = Math.round(dominantShare * 100);
    if (dominantShare > 0.75) {
      checks.push({
        id: 'ravnovesje',
        state: 'warn',
        title: 'Ravnovesje',
        detail: `${top.speaker} ima ${pct} % vseh vrstic. Dialog naj ne bo monokultura — dodelite ostalim govorcem vsaj vsak drugi sklop.`,
      });
    } else if (dominantShare > 0.6) {
      checks.push({
        id: 'ravnovesje',
        state: 'info',
        title: 'Ravnovesje',
        detail: `${top.speaker} vodi z ${pct} % vrstic — sprejemljivo (voditelj), a lahko še izenačite.`,
      });
    } else {
      checks.push({
        id: 'ravnovesje',
        state: 'ok',
        title: 'Ravnovesje',
        detail: `Govorci so uravnoteženi (najmočnejši: ${top.speaker}, ${pct} %).`,
      });
    }
  }

  // 6. ZAKLJUČEK — poziv k dejanju
  if (lines.length >= 4) {
    const last = lines[lines.length - 1].text;
    if (CTA_RE.test(last)) {
      checks.push({
        id: 'zakljucek',
        state: 'ok',
        title: 'Zaključek',
        detail: 'Zadnja vrstica vsebuje poziv k dejanju ali napoved — odličen odhod.',
      });
    } else {
      checks.push({
        id: 'zakljucek',
        state: 'info',
        title: 'Zaključek',
        detail:
          'Zadnja vrstica naj vabi k dejanju (delitev, ocena, sporočilo) ali napove naslednjo epizodo.',
      });
    }
  }

  // 7. POVZREDNOST — ultra kratke pritrdilne vrstice
  if (lines.length >= 10) {
    const ultraShort = lines.filter((l) => wordCount(l.text) <= ULTRA_SHORT_WORDS).length;
    const ratio = ultraShort / lines.length;
    if (ratio > 0.25) {
      checks.push({
        id: 'povzrednost',
        state: 'warn',
        title: 'Povzrednost',
        detail: `${ultraShort} od ${lines.length} vrstic ima ≤ 2 besedi (pritrdilni kanali). Vsaka kratka vrstica naj vsaj nosi vsebino — sicer jo spojite s sosednjo.`,
      });
    } else {
      checks.push({
        id: 'povzrednost',
        state: 'ok',
        title: 'Tempo',
        detail: 'Pritrdilnih vrstic je malo — dialog nosi vsebino.',
      });
    }
  }

  const warnings = checks.filter((c) => c.state === 'warn').length;
  const infos = checks.filter((c) => c.state === 'info').length;

  return {
    words,
    estimatedSeconds: estimateScriptSeconds(words, lines.length),
    balance,
    dominantShare,
    checks,
    warnings,
    infos,
  };
}
