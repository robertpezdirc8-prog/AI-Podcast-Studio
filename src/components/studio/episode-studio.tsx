'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  BookOpen,
  Captions,
  CaptionsOff,
  Check,
  ChevronDown,
  Clapperboard,
  ClipboardPaste,
  Copy,
  Download,
  EllipsisVertical,
  FileText,
  Highlighter,
  ImagePlus,
  Keyboard,
  Link2,
  ListChecks,
  ListOrdered,
  Loader2,
  Mic,
  Music,
  NotebookText,
  Pencil,
  Plus,
  Quote,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Trash2,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  askHosts,
  addLine,
  deleteLine,
  downloadChapterClip,
  downloadChapterShort,
  downloadEpisodeChapters,
  downloadEpisodeMp3,
  downloadEpisodeSrt,
  downloadEpisodeTranscript,
  downloadEpisodeVideo,
  downloadLineClip,
  generateCover,
  generateEpisodeAudio,
  generateLineAudio,
  fetchEpisodePeaks,
  loadLocalPosition,
  saveLocalPosition,
  loadDeviceRate,
  loadDeviceSound,
  saveDeviceRate,
  saveDeviceSound,
  moveLine,
  updateEpisodeProgress,
  updateLineText,
} from '@/lib/podcast-client';
import type { PeaksResponse } from '@/lib/podcast-client';
import type { ShortsCaptionStyle } from '@/lib/podcast-ai';
import {
  setMediaPlaybackState,
  setMediaPositionState,
  useMediaSession,
} from '@/hooks/use-media-session';
import {
  LANGUAGE_LABELS,
  SOURCE_TYPE_LABELS,
  STYLE_LABELS,
  VOICES,
  hostColor,
  type Episode,
  type Line,
} from '@/lib/podcast-types';
import { cn } from '@/lib/utils';
import { activatePan, setElementPan } from '@/lib/audio-pan';
import { panForSpeaker, speakerPanMapFor } from '@/lib/podcast-pan';
import { analyzeScript } from '@/lib/script-analysis';
import { AskHostsCard } from './ask-hosts-card';
import { ChaptersRow, type ChapterChip } from './chapters-row';
import { DramaturgyReport } from './dramaturgy-report';
import { Equalizer } from './equalizer';
import { PlayerBar, RATES, type SleepTimerChoice } from './player-bar';
import { downloadQuoteCard } from './quote-card';
import { dimIfNoMatch, foldText, HighlightedText, ScenarioSearchBar } from './scenario-search';
import { WordKaraoke } from './word-karaoke';
import { ShowNotesPanel } from './show-notes-panel';
import { ShortcutsDialog } from './shortcuts-dialog';
import { ShareDialog } from './share-dialog';

interface EpisodeStudioProps {
  episode: Episode;
  playing: boolean;
  autoPlay?: boolean;
  onPlayingChange: (playing: boolean) => void;
}

function nextAudioIndex(lines: Line[], from: number): number | null {
  for (let i = Math.max(0, from); i < lines.length; i += 1) {
    if (lines[i].audioPath) return i;
  }
  return null;
}

function prevAudioIndex(lines: Line[], before: number): number | null {
  for (let i = Math.min(lines.length - 1, before); i >= 0; i -= 1) {
    if (lines[i].audioPath) return i;
  }
  return null;
}

/**
 * Strežnik regenerirani TTS zapiše v ISTO datoteko (`{lineId}.wav`), ki jo
 * brskalnik kešira z `immutable`. Zato po urejanju vrstice dodamo `?v=n`,
 * da audio element prav zagotovo naloži svež zvok.
 */
function withCacheBust(audioPath: string, version: number): string {
  return `${audioPath}${audioPath.includes('?') ? '&' : '?'}v=${version}`;
}

/** Vrsta izvoza, ki trenutno teče (null = ni aktivnega izvoza). */
type ExportKind = 'mp3j' | 'mp3s' | 'video' | 'srt' | 'txt' | 'chapters';

/** Vrsta izrezka za deljenje na vrstici (MP3 govor, MP4 audiogram, poglavje). */
type ClipKind = 'mp3' | 'video' | 'chapter' | 'chapterVideo';

/** Ura za spanje: odštevalnik v ms, pavza na koncu epizode ali null (izklopljena). */
type SleepTimerState =
  | { mode: 'ms'; deadline: number; totalMs: number }
  | { mode: 'episode' }
  | null;

const EXPORT_ITEMS: {
  kind: ExportKind;
  label: string;
  hint?: string;
  Icon: LucideIcon;
  needsAudio: boolean;
}[] = [
  { kind: 'mp3j', label: 'MP3 — z uvodno melodijo', Icon: Music, needsAudio: true },
  { kind: 'mp3s', label: 'MP3 — samo govor', Icon: Mic, needsAudio: true },
  {
    kind: 'video',
    label: 'Video MP4 (audiogram)',
    hint: 'Generiranje traja 5–45 s',
    Icon: Clapperboard,
    needsAudio: true,
  },
  { kind: 'srt', label: 'Podnapisi (.srt)', Icon: Captions, needsAudio: true },
  { kind: 'txt', label: 'Transkript (.txt)', Icon: FileText, needsAudio: false },
  { kind: 'chapters', label: 'Poglavja — YouTube (.txt)', Icon: ListOrdered, needsAudio: false },
];

/** Milisekunde → m:ss ali h:mm:ss (npr. toast „Nadaljuj od 0:42“). */
function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = String(Math.floor((total % 3600) / 60)).padStart(h > 0 ? 2 : 1, '0');
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

/*
 * GREJE HTTP predpomnilnik za zvočne datoteke (vrstice + pavze). Audio
 * elementi z preload='auto' brskalnik rada obreže na metadata — ekspliciten
 * fetch() pa prisili celotni prenos (odgovori so immutable) → menjave vrstic,
 * prekrivni vzkliki (ghost) in room-tone pavze zaženejo BREZ mrežne latence
 * (izmerjeno: ghost zagon 120 ms → ~10 ms).
 */
const audioPrefetchCache = new Set<string>();
function prefetchAudio(src: string): void {
  if (audioPrefetchCache.has(src)) return;
  audioPrefetchCache.add(src);
  void fetch(src, { cache: 'force-cache' }).catch(() => {
    audioPrefetchCache.delete(src); // neuspeh → poskus ob naslednji uporabi
  });
}

/** Skupni čas vseh zvočnih vrstic pred `index` (v ms). */
function cumulativeBeforeMs(
  lines: Line[],
  durations: Record<string, number>,
  index: number,
): number {
  let before = 0;
  for (let i = 0; i < index; i += 1) {
    // Pavze (preDelayMs) se prištevajo — statistika/pozicija se ujemata z izvoženim MP3
    if (lines[i].audioPath)
      before += (durations[lines[i].id] ?? 0) * 1000 + (lines[i].preDelayMs ?? 0);
  }
  return before;
}

/**
 * Studio za eno epizodo: glava (ovitek, vir, podnapisi), poglavja, show notes,
 * karaoke seznam z urejanjem vrstic, vprašanje voditelju in lepljivi predvajalnik.
 * Vsa predvajalna logika živi tukaj, stanje `playing` pa je dvignjeno v page.tsx
 * (nalepka ON AIR v glavi).
 */
export function EpisodeStudio({
  episode,
  playing,
  autoPlay = false,
  onPlayingChange,
}: EpisodeStudioProps) {
  const [lines, setLines] = useState<Line[]>(episode.lines);
  const [lineErrors, setLineErrors] = useState<string[]>([]);
  const [retryingIds, setRetryingIds] = useState<string[]>([]);
  const [durations, setDurations] = useState<Record<string, number>>({});
  /** Oblika valovanja (Task 42): per-line vrhovi (null = pade nazaj na drsnik). */
  const [peaksData, setPeaksData] = useState<PeaksResponse | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  /* Nastavitve naprave (Task 59): glasnost/utislitev/hitrost ostanejo med
     obiski. Studio se upodobi SAMO odjemalsko (HomeShell), zato so leni
     initializerji varni (brez hidracijskega neujemlja). Hitrost je VREDNOST —
     če je delitev shranila 1,25×, jo studio uporabi; 2,5× studio pozna, 1,25
     pa ne obstaja v njegovem seznamu → paden nazaj na 1×. */
  const [rate, setRate] = useState(() => {
    const saved = loadDeviceRate();
    return (RATES as readonly number[]).includes(saved) ? saved : 1;
  });
  const [muted, setMuted] = useState(() => loadDeviceSound().muted);
  const [volume, setVolume] = useState(() => loadDeviceSound().volume);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [clipBusy, setClipBusy] = useState<{ lineId: string; kind: ClipKind } | null>(null);
  const [shareMenuLineId, setShareMenuLineId] = useState<string | null>(null);
  const [sleepTimer, setSleepTimer] = useState<SleepTimerState>(null);
  const [sleepRemainingMs, setSleepRemainingMs] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [coverPath, setCoverPath] = useState<string | null>(episode.coverPath);
  const [coverPending, setCoverPending] = useState(false);
  const [coverVersion, setCoverVersion] = useState(0);

  // Urejanje vrstice
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [savingLineId, setSavingLineId] = useState<string | null>(null);

  // Upravljanje vrstic (Task 48): vstavljanje, premikanje, brisanje
  const [insertAfter, setInsertAfter] = useState<{ lineId: string | null } | null>(null);
  const [insertSpeaker, setInsertSpeaker] = useState('');
  const [insertText, setInsertText] = useState('');
  const [inserting, setInserting] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ line: Line; index: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Iskanje po scenariju (Apple Podcasts transkript-search stil) + pomoč za bližnjice
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActiveIdx, setSearchActiveIdx] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Javna delitev epizode (Task 45)
  const [shareOpen, setShareOpen] = useState(false);

  // Trojni pogled studia (V4 iz analize UI): Scenarij / Zapiski / Dramaturgija
  const [studioTab, setStudioTab] = useState<'scenarij' | 'zapiski' | 'dramaturgija'>(
    'scenarij',
  );

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  /*
   * Stereo umestitev gostiteljev (Task 28) — isti ±0,25 pan kot v MP3 izvozu
   * (skupni vir resnice: podcast-pan.ts). Ref zato, da startGap/startGhost
   * dostopata do svežega zemljevida brez spreminjanja svojih odvisnosti.
   */
  const panBySpeaker = useMemo(() => speakerPanMapFor(lines), [lines]);
  const panBySpeakerRef = useRef(panBySpeaker);
  panBySpeakerRef.current = panBySpeaker;
  const currentIndexRef = useRef<number | null>(null);
  currentIndexRef.current = currentIndex;
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const durationsRef = useRef(durations);
  durationsRef.current = durations;
  const episodeIdRef = useRef(episode.id);
  const sleepTimerRef = useRef<SleepTimerState>(null);
  sleepTimerRef.current = sleepTimer;
  const finishEpisodeRef = useRef<() => void>(() => {});
  const exportingRef = useRef<ExportKind | null>(null);
  const clipBusyRef = useRef<{ lineId: string; kind: ClipKind } | null>(null);
  const sessionPlayedRef = useRef(0); // poslušano ms v tej seji (igra = ≥ 30 s)
  const countedPlayRef = useRef(false);
  const lastProgressPostRef = useRef(0); // debelo vsak ~5 s
  const lastTickAtRef = useRef(0); // stenska ura zadnjega timeupdate med predvajanjem
  const lastElapsedMsRef = useRef(0); // zadnja znana pozicija (za flush ob odhodu)
  const mediaPosAtRef = useRef(0); // dušilnik (~1 s) za drsnik na zaklenjenem zaslonu
  const totalDurationRef = useRef(0); // trajanje epizode (s) za Media Session
  const finishingRef = useRef(false); // konec epizode v teku — ne pošiljaj več progressa
  const pendingSeekRef = useRef<{ index: number; offsetSec: number; play: boolean } | null>(null);
  const resumeDoneRef = useRef(false);
  const lineErrorsRef = useRef<string[]>([]);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);
  const probesRef = useRef<HTMLAudioElement[]>([]);
  const triedDurationIdsRef = useRef<Set<string>>(new Set());
  const autoPlayDoneRef = useRef(false);
  const audioVersionsRef = useRef<Map<string, number>>(new Map());
  // Kontekstne pavze med vrsticami (room tone) — enaka akustika kot MP3 izvoz
  const gapAudioRef = useRef<HTMLAudioElement | null>(null);
  const gapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingGapNextRef = useRef<number | null>(null);
  const ghostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ghostRafRef = useRef<number | null>(null);
  const ghostActiveRef = useRef(false);
  /**
   * Ali uporabnik trenutno VLEČE obliko valovanja (Task 54). Med vlečenjem
   * `timeupdate` (~4 Hz) ne sme prevzemati pozicije — sicer se glava
   * predvajanja kratkotrajno vrne na staro mesto med premiki miške.
   * Waveform to sporoča prek `onScrubChange` (ref, ne stanje — brez rerenderjev).
   */
  const waveformScrubRef = useRef(false);
  /*
   * JINGLE UVOD/IZHOD (Task 30) — isti knjižni zvočni znaki kot v MP3 izvozu.
   * Uvod: pre-roll pred 1. vrstico ob zagonu od začetka (NI del časovne osi
   * vrstic — napredek ostane 0). Izhod: po zadnji vrstici. Ločen element (ne
   * gapAudioRef), da ne meša z kalibriranim ghost/pavze mehanizmom.
   */
  const introAudioRef = useRef<HTMLAudioElement | null>(null);
  const introTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const introPhaseRef = useRef<'intro' | 'outro' | null>(null);
  const introDoneRef = useRef<() => void>(() => {});
  const [jinglePhase, setJinglePhase] = useState<'intro' | 'outro' | null>(null);

  /** Ustavi rAF opazovalca prekrivanja (ob pavzi/prekinitvi/meni vrstice). */
  const stopGhostWatch = useCallback(() => {
    if (ghostRafRef.current !== null) {
      cancelAnimationFrame(ghostRafRef.current);
      ghostRafRef.current = null;
    }
  }, []);

  const addLineError = useCallback((lineId: string) => {
    if (lineErrorsRef.current.includes(lineId)) return;
    lineErrorsRef.current = [...lineErrorsRef.current, lineId];
    setLineErrors(lineErrorsRef.current);
  }, []);

  const removeLineError = useCallback((lineId: string) => {
    if (!lineErrorsRef.current.includes(lineId)) return;
    lineErrorsRef.current = lineErrorsRef.current.filter((id) => id !== lineId);
    setLineErrors(lineErrorsRef.current);
  }, []);

  // ── Kontekstne pavze (room tone) med vrsticami — ustrezajo MP3 izvozu ──
  const clearGapTimers = useCallback(() => {
    stopGhostWatch();
    if (gapTimerRef.current) {
      clearTimeout(gapTimerRef.current);
      gapTimerRef.current = null;
    }
    if (ghostTimerRef.current) {
      clearTimeout(ghostTimerRef.current);
      ghostTimerRef.current = null;
    }
    const gapAudio = gapAudioRef.current;
    if (gapAudio) {
      gapAudio.onended = null;
      gapAudio.onerror = null;
      gapAudio.ontimeupdate = null;
      gapAudio.pause();
      try {
        gapAudio.currentTime = 0;
      } catch {
        // ni kritično
      }
    }
    // Jingle (uvod/izhod) — isti kanal čiščenja: vsak skok/pavza ga prekliče
    if (introTimerRef.current) {
      clearTimeout(introTimerRef.current);
      introTimerRef.current = null;
    }
    const intro = introAudioRef.current;
    if (intro) {
      intro.onended = null;
      intro.onerror = null;
      intro.pause();
    }
    if (introPhaseRef.current) {
      introPhaseRef.current = null;
      setJinglePhase(null);
    }
    ghostActiveRef.current = false;
  }, [stopGhostWatch]);

  /** Prekliči tekočo pavzo (klik/pauza/skok uporabnika — ostane na trenutni vrstici). */
  const cancelGap = useCallback(() => {
    pendingGapNextRef.current = null;
    clearGapTimers();
  }, [clearGapTimers]);

  // ── Jingle uvod/izhod (Task 30) — poravnava aplikacije z MP3 izvozom ──
  /**
   * Predvaja uvodno/zaključno melodijo (isti ffmpeg sting kot v izvozu).
   * Uvod: pre-roll pred 1. vrstico ob zagonu od začetka (napredek ostane 0 —
   * melodija NI del časovne osi vrstic). Izhod: po zadnji vrstici.
   * Pauza med melodijo jo zamrzne (nadaljuj = doigra od mesta pavze); skok /
   * klik na vrstico prek cancelGap–clearGapTimers melodijo prekličejo.
   * Napaka/zavrnitev play() → takoj naprej (fallback: brez melodije).
   */
  const startJingle = useCallback(
    (kind: 'intro' | 'outro', onDone: () => void) => {
      clearGapTimers();
      const src =
        kind === 'intro' ? '/api/audio/jingle_intro.wav' : '/api/audio/jingle_outro.wav';
      prefetchAudio(src);
      let el = introAudioRef.current;
      if (!el) {
        el = new Audio();
        el.preload = 'auto';
        introAudioRef.current = el;
      }
      el.src = src;
      const done = () => {
        if (introTimerRef.current) {
          clearTimeout(introTimerRef.current);
          introTimerRef.current = null;
        }
        el.onended = null;
        el.onerror = null;
        introPhaseRef.current = null;
        setJinglePhase(null);
        onDone();
      };
      introDoneRef.current = done;
      el.onended = done;
      el.onerror = done;
      introPhaseRef.current = kind;
      setJinglePhase(kind);
      // Melodija sledi utišanju/glasnosti naprave (Task 59) — brez tega bi
      // utišanje pustilo uvodno melodijo glasno.
      el.volume = volumeRef.current;
      el.muted = mutedRef.current;
      // Varnostna mreža (glavni sprožilec je onended; melodiji sta 2,2 / 3,0 s)
      introTimerRef.current = setTimeout(done, 9000);
      // Melodija sredinsko (v izvozu dual-mono) + tekoč kontekst za pan
      setElementPan(el, 0);
      activatePan();
      void el.play().catch(done);
    },
    [clearGapTimers],
  );

  /** Zaključi pavzo takoj in preklopi na čakajočo vrstico. */
  const finishGap = useCallback(() => {
    const next = pendingGapNextRef.current;
    if (next === null) return;
    /*
     * OPOMBA: glavni zvok je tu VEDNO `paused` (vrstica se je naravno končala →
     * `ended`). Prejšnje preverjanje `audio.paused` je zato odpovedalo VSE
     * pozitivne pavze → predvajanje je obtičilo ob vsaki menjavi vrstic.
     * Pauza uporabnika med pavzo je že pokrita: `togglePlay`/`handlePause`
     * pokliče `cancelGap` → `pendingGapNextRef` je prazn → zgornji early-return.
     * Zamrznjen prekrivni vzklik pa ne kliče `finishGap` (njegovi sprožilci so
     * počiščeni; nadaljevanje gre prek `togglePlay` → `handleGhostEnded`).
     */
    pendingGapNextRef.current = null;
    clearGapTimers();
    setCurrentIndex(next);
  }, [clearGapTimers]);

  /**
   * Pavza pred naslednjo vrstico: predvaja `gap_<s>.wav` (isti room tone kot
   * vrstice in izvoz — glej ensureGapFile), nato preklopi. Brez datoteke (404)
   * → tiha pavza z istim trajanjem. Menjava govorca/poglavja v appu zveni
   * NARAVNO, ne kot takojšnje stiskanje vrstic skupaj.
   */
  const startGap = useCallback(
    (nextIndex: number, gapMs: number) => {
      cancelGap();
      if (gapMs < 30) {
        setCurrentIndex(nextIndex);
        return;
      }
      pendingGapNextRef.current = nextIndex;
      const gapSrc = `/api/audio/gap_${(gapMs / 1000).toFixed(2)}.wav`;
      prefetchAudio(gapSrc); // obrambno — gretje, če še ni bilo prednalagano
      let gapAudio = gapAudioRef.current;
      if (!gapAudio) {
        gapAudio = new Audio();
        gapAudio.preload = 'auto';
        gapAudioRef.current = gapAudio;
      }
      gapAudio.src = gapSrc;
      gapAudio.onended = finishGap;
      gapAudio.onerror = finishGap; // manjkajoča datoteka → takoj naprej
      // Room tone sledi utišanju/glasnosti naprave (Task 59) — hitrost NE:
      // trajanje pavze je del časovnice in se ne skrajša pri 2×.
      gapAudio.volume = volumeRef.current;
      gapAudio.muted = mutedRef.current;
      gapTimerRef.current = setTimeout(finishGap, gapMs + 250); // varnostna mreža
      // Room tone ostane SREDINSKO (v izvozu je bed dual-mono) + obnovi kontekst
      setElementPan(gapAudio, 0);
      activatePan();
      void gapAudio.play().catch(() => { /* room tone ni kritičen */ });
    },
    [cancelGap, finishGap],
  );

  /** Konec prekrivnega vzklika (drugi kanal) → običajna kontekstna pavza naprej. */
  const handleGhostEnded = useCallback(() => {
    const next = pendingGapNextRef.current;
    pendingGapNextRef.current = null;
    clearGapTimers(); // počisti tudi ghostActiveRef
    if (next === null) return;
    const after = nextAudioIndex(linesRef.current, next + 1);
    if (after !== null) {
      startGap(after, linesRef.current[after]?.preDelayMs ?? 0);
    } else {
      finishEpisodeRef.current();
    }
  }, [clearGapTimers, startGap]);

  /**
   * Vnaprejšnja priprava prekrivnega vzklika: isti element (`gapAudioRef`) dobi
   * PRAVI `src` ŽE OB RAZPOREDITVI (tudi vsebina je v predpomnilniku prek
   * prefetchAudio) → ob sprožitvi je `play()` takojšen (pripravljen dekoder).
   * Izmerjeno: nastavljanje `src` ob sprožitvi doda 120–240 ms latence →
   * slišno prekrivanje se skrči s 180 ms na ~50 ms.
   */
  const prepareGhost = useCallback((nextIdx: number) => {
    const line = linesRef.current[nextIdx];
    if (!line?.audioPath) return;
    prefetchAudio(line.audioPath);
    let ghost = gapAudioRef.current;
    if (!ghost) {
      ghost = new Audio();
      ghost.preload = 'auto';
      gapAudioRef.current = ghost;
    }
    const want = new URL(line.audioPath, window.location.href).href;
    if (ghost.paused && ghost.src !== want) {
      ghost.src = line.audioPath;
      ghost.preload = 'auto';
      ghost.load();
    }
  }, []);

  /**
   * PREKRIVNI VZKLIK (backchannel): naslednjo vrstico predvaja DRUGI kanal
   * (ghost), ki se začne |overlapMs| PRED koncem trenutne — kot v resničnem
   * pogovoru („Resno?!“ nad zadnjim zlogom). Glavni zvok neopazno doigra,
   * karaoke pa se preklopi TAKOJ (vzklik je dramaturško aktiven).
   */
  const startGhost = useCallback(
    (nextIndex: number, overlapMs: number) => {
      if (pendingGapNextRef.current !== null || ghostActiveRef.current) return;
      const line = linesRef.current[nextIndex];
      if (!line?.audioPath) return;
      prefetchAudio(line.audioPath); // obrambno — vzklik mora začeti TAKOJ
      ghostActiveRef.current = true;
      pendingGapNextRef.current = nextIndex;
      let ghost = gapAudioRef.current;
      if (!ghost) {
        ghost = new Audio();
        ghost.preload = 'auto';
        gapAudioRef.current = ghost;
      }
      // Če je element že pripravljen (prepareGhost → isti src, naložen), NE
      // ponastavljaj src — to bi sprožilo ponoven load (120–240 ms latence).
      const want = new URL(line.audioPath, window.location.href).href;
      if (ghost.src !== want) {
        ghost.src = line.audioPath;
      } else {
        try {
          ghost.currentTime = 0; // prejšnji doigran vzklik → nazaj na začetek
        } catch {
          // ni kritično
        }
      }
      ghost.playbackRate = rateRef.current;
      ghost.volume = volumeRef.current;
      ghost.muted = mutedRef.current;
      ghost.ontimeupdate = () => setCurrentTime(ghost.currentTime);
      ghost.onended = handleGhostEnded;
      ghost.onerror = handleGhostEnded; // napaka → naprej, kot da je doigral
      // Vzklik pripada svojemu govorcu → njegov pan (enako kot v izvozu)
      setElementPan(ghost, panForSpeaker(panBySpeakerRef.current, line.speaker));
      activatePan();
      void ghost.play().catch(() => { /* vzklik izpusti — tok teče normalno */ });
      setCurrentIndex(nextIndex);
    },
    [handleGhostEnded, prepareGhost],
  );

  /**
   * Natančen sprožilec prekrivanja na AVDIO uri: vsak frame (rAF, ~60 Hz)
   * primerja `audio.currentTime` z `audio.duration + overlap`. Brskalnikov
   * `duration` je natančno dekodirano trajanje datoteke, zato zagon NI odvisen
   * od stenskega zamika med razporeditvijo in dejanskim začetkom zvoka (latenca
   * `play()`: fetch/dekoda do ~300 ms) — prekrivanje zadene ±1 slišni okvir.
   * rAF v skritem zavihku miruje → pokrijeta ga avdio-urejen wall-clock timer
   * (`scheduleGhostFor`) in rezervni timeupdate sprožilec.
   */
  const armGhostWatch = useCallback(() => {
    stopGhostWatch();
    const tick = () => {
      ghostRafRef.current = null;
      const audio = audioRef.current;
      if (!audio || audio.paused || ghostActiveRef.current || pendingGapNextRef.current !== null) {
        return; // pavza/vzklik teče/čaka pavza → opazovalec ni potreben
      }
      const idx = currentIndexRef.current;
      if (idx === null) return;
      const nextIdx = nextAudioIndex(linesRef.current, idx + 1);
      if (nextIdx === null) return;
      const gapMs = linesRef.current[nextIdx]?.preDelayMs ?? 0;
      if (gapMs >= 0) return; // pozitivna pavza → handleEnded/startGap
      prepareGhost(nextIdx); // vzklik naložen vnaprej → play() takojšen
      const dur = audio.duration;
      if (!Number.isFinite(dur) || dur <= 0) {
        ghostRafRef.current = requestAnimationFrame(tick); // metadata še ni pripravljena
        return;
      }
      if (audio.currentTime >= dur + gapMs / 1000) {
        startGhost(nextIdx, -gapMs);
        return;
      }
      ghostRafRef.current = requestAnimationFrame(tick);
    };
    ghostRafRef.current = requestAnimationFrame(tick);
  }, [startGhost, stopGhostWatch]);

  /** Razporedi prekrivni vzklik za vrstico PO `idx` (če ima negativno pavzo). */
  const scheduleGhostFor = useCallback(
    (idx: number) => {
      if (ghostTimerRef.current) {
        clearTimeout(ghostTimerRef.current);
        ghostTimerRef.current = null;
      }
      const nextIdx = nextAudioIndex(linesRef.current, idx + 1);
      if (nextIdx === null) return;
      const gapMs = linesRef.current[nextIdx]?.preDelayMs ?? 0;
      if (gapMs >= 0) return;
      prepareGhost(nextIdx); // vzklik naložen vnaprej → play() takojšen
      const cur = linesRef.current[idx];
      const durSec = cur ? (durationsRef.current[cur.id] ?? 0) : 0;
      if (durSec <= 0) return; // trajanje ni znano — poskrbi rezervni timeupdate sprožilec
      /*
       * Wall-clock varnostna mreža (pokrije skrit zavihek, kjer rAF miruje).
       * Sidro NI trenutev razporeditve — `play()` ima latenca fetch/dekoda do
       * ~300 ms, zaradi česar je vzklik streljal PREZGODAJ (izmerjeno 426 ms
       * prekrivanja namesto nameravnih 180 ms). Ob zagonu preveri DEJANSKI
       * položaj na avdio uri in se po potrebi znova razporedi — prekrivanje
       * zadenemo glede na zvok, ne glede na mrežne/dekodirne zamike.
       */
      const fire = () => {
        ghostTimerRef.current = null;
        const audio = audioRef.current;
        if (!audio || audio.paused) return; // pavzirano → handlePlay ob nadaljevanju
        const dur = audio.duration;
        if (Number.isFinite(dur) && dur > 0) {
          const remainMs = Math.round(((dur + gapMs / 1000 - audio.currentTime) * 1000) / rateRef.current);
          if (remainMs > 0) {
            ghostTimerRef.current = setTimeout(fire, remainMs); // ponovno sidraj na avdio uro
            return;
          }
        }
        startGhost(nextIdx, -gapMs);
      };
      ghostTimerRef.current = setTimeout(
        fire,
        Math.max(0, Math.round(((durSec + gapMs / 1000) * 1000) / rateRef.current)),
      );
    },
    [startGhost, prepareGhost],
  );

  // En sam HTMLAudioElement za predvajanje cele epizode.
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audioRef.current = audio;
    const handlePlay = () => {
      activatePan(); // AudioContext teče za vsakim predvajanjem (aktivacija strani)
      finishingRef.current = false; // novo predvajanje — konec epizode ni več v teku
      lastTickAtRef.current = Date.now();
      armGhostWatch(); // natančen sprožilec prekrivanja na avdio uri (tudi po pavzi/iskanju)
      setMediaPlaybackState('playing'); // ikona predvajanja na zaklenjenem zaslonu
      onPlayingChange(true);
    };
    const handlePause = () => {
      // Naravni konec vrstice, prekrivni vzklik še teče → predvajanje NI končano
      // (vzklik doigra na drugem kanalu); togglePlay eksplicitno nastavi stanje
      if (ghostActiveRef.current && audio.ended) return;
      setMediaPlaybackState('paused');
      onPlayingChange(false);
      // Takojšnja objava napredka ob pavzi (tudi ob preklopu vrstice).
      if (finishingRef.current) {
        finishingRef.current = false; // pozicija je že ponastavljena na 0
        return;
      }
      const idx = currentIndexRef.current;
      if (idx === null) return;
      const elapsedMs = Math.max(
        0,
        Math.round(
          cumulativeBeforeMs(linesRef.current, durationsRef.current, idx) + audio.currentTime * 1000,
        ),
      );
      lastElapsedMsRef.current = elapsedMs;
      saveLocalPosition(episodeIdRef.current, elapsedMs);
      void updateEpisodeProgress(episodeIdRef.current, elapsedMs, false);
    };
    const handleTime = () => {
      const t = audio.currentTime;
      // Med vlečenjem valovanja položaja NE prevzemamo (glava sledi prstu;
      // nadzor prevzame naslednji timeupdate po spustu — Task 54).
      if (!waveformScrubRef.current) setCurrentTime(t);
      if (audio.paused) return;
      // Rezervni sprožilec prekrivnega vzklika (če razporejeni časovnik zamudi
      // — npr. zaradi spremembe hitrosti predvajanja)
      if (!ghostActiveRef.current && pendingGapNextRef.current === null && audio.duration > 0) {
        const nIdx = nextAudioIndex(linesRef.current, (currentIndexRef.current ?? 0) + 1);
        const nGap = nIdx !== null ? (linesRef.current[nIdx]?.preDelayMs ?? 0) : 0;
        if (nIdx !== null && nGap < 0 && t >= audio.duration + nGap / 1000) {
          startGhost(nIdx, -nGap);
        }
      }
      const idx = currentIndexRef.current;
      if (idx === null) return;
      const elapsedMs = Math.max(
        0,
        Math.round(cumulativeBeforeMs(linesRef.current, durationsRef.current, idx) + t * 1000),
      );
      lastElapsedMsRef.current = elapsedMs;
      // Drsnik na zaklenjenem zaslonu — dovolj na ~1 s (timeupdate pripne 4×).
      const nowTs = Date.now();
      if (nowTs - mediaPosAtRef.current >= 1000) {
        mediaPosAtRef.current = nowTs;
        setMediaPositionState(totalDurationRef.current, elapsedMs / 1000, rateRef.current);
      }
      const id = episodeIdRef.current;
      saveLocalPosition(id, elapsedMs); // nadaljuj od mesta ustavitve
      const now = Date.now();
      const last = lastTickAtRef.current;
      lastTickAtRef.current = now;
      if (last > 0) {
        sessionPlayedRef.current += Math.min(now - last, 2000); // realni dt, odrezani odskoki
      }
      if (!countedPlayRef.current && sessionPlayedRef.current >= 30000) {
        countedPlayRef.current = true; // Spotify definicija igre: ≥ 30 s poslušanja
        void updateEpisodeProgress(id, elapsedMs, true);
      }
      if (now - lastProgressPostRef.current >= 5000) {
        lastProgressPostRef.current = now;
        void updateEpisodeProgress(id, elapsedMs, false);
      }
    };
    const handleEnded = () => {
      if (ghostActiveRef.current) return; // vzklik še predvaja drugi kanal
      const current = currentIndexRef.current;
      if (current === null) return;
      const next = nextAudioIndex(linesRef.current, current + 1);
      if (next !== null) {
        const gapMs = linesRef.current[next]?.preDelayMs ?? 0;
        if (gapMs < 0) {
          // PREKRIVANJE: vzklik se začne pred koncem (zadnji/varni sprožilec)
          startGhost(next, -gapMs);
        } else {
          // Kontekstna pavza (menjava govorca/poglavje + room tone) — kot v izvozu
          startGap(next, gapMs);
        }
      } else {
        finishEpisodeRef.current(); // konec epizode → ponastavi pozicijo/statistiko
      }
      // Na zadnji vrstici: `pause` dogodek je stanje `playing` že izklopil,
      // currentTime ostane na koncu → prikazani čas = skupno trajanje.
    };
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTime);
    audio.addEventListener('ended', handleEnded);
    return () => {
      cancelGap();
      audio.pause();
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTime);
      audio.removeEventListener('ended', handleEnded);
      audio.src = '';
      audioRef.current = null;
    };
  }, [onPlayingChange, cancelGap, startGap, startGhost, armGhostWatch]);

  // Ko se spremeni trenutna vrstica (njen audioPath) → nastavi vir in predvajaj.
  // Če čaka iskalni poskus („Nadaljuj od …“), najprej tiho poskoči na pozicijo.
  const currentLine = currentIndex !== null ? (lines[currentIndex] ?? null) : null;
  const currentAudioPath = currentLine?.audioPath ?? null;
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || currentIndex === null) return;
    // Prekrivni vzklik predvaja to vrstico drugi kanal — glavnega zvoka ne tipkaj
    if (ghostActiveRef.current) return;
    cancelGap(); // počisti morebitne pavze/časovnike prejšnje tranzicije
    const line = linesRef.current[currentIndex];
    if (!line?.audioPath) return;
    const seek =
      pendingSeekRef.current !== null && pendingSeekRef.current.index === currentIndex
        ? pendingSeekRef.current
        : null;
    if (seek) pendingSeekRef.current = null;
    const expected = new URL(line.audioPath, window.location.href).href;
    if (audio.src !== expected) {
      audio.src = line.audioPath;
      audio.load();
    } else {
      audio.currentTime = 0;
    }
    audio.playbackRate = rateRef.current;
    audio.volume = volumeRef.current;
    audio.muted = mutedRef.current;
    // Stereo umestitev govorca te vrstice — route/preklop ŠE PRED play() (element
    // je pavziran → brez zvočnega preloma; kontekst teče po aktivaciji strani)
    setElementPan(audio, panForSpeaker(panBySpeakerRef.current, line.speaker));
    setCurrentTime(seek ? seek.offsetSec : 0);
    if (seek) {
      const applySeek = () => {
        try {
          audio.currentTime = seek.offsetSec;
        } catch {
          // iskanje ni uspelo — nadaljuj od začetka vrstice
        }
        setCurrentTime(seek.offsetSec);
        if (seek.play) void audio.play().catch(() => {});
      };
      if (audio.readyState >= 1) {
        applySeek();
      } else {
        audio.addEventListener('loadedmetadata', applySeek, { once: true });
      }
      return;
    }
    void audio.play().catch(() => {}); // zavrnitve avtopredvajanja so neškodljive
    scheduleGhostFor(currentIndex);
  }, [currentIndex, currentAudioPath, cancelGap, scheduleGhostFor]);

  // Avtopredvajanje ob vstopu iz knjižnice (gumb Play na kartici).
  useEffect(() => {
    if (autoPlayDoneRef.current) return;
    autoPlayDoneRef.current = true;
    if (!autoPlay) return;
    const first = nextAudioIndex(linesRef.current, 0);
    if (first !== null) setCurrentIndex(first);
  }, [autoPlay]);

  // Trajanja posameznih vrstic: `durationMs` iz API-ja takoj, natenjeno ob loadedmetadata.
  useEffect(() => {
    for (const line of lines) {
      if (!line.audioPath) continue;
      prefetchAudio(line.audioPath); // celoten zvok v predpomnilniku → takojšnji zagoni
      if ((line.preDelayMs ?? 0) >= 30) {
        // room-tone pavze, ki jih bo predvajalnik potreboval (distinct vrednosti)
        prefetchAudio(`/api/audio/gap_${((line.preDelayMs ?? 0) / 1000).toFixed(2)}.wav`);
      }
      if (triedDurationIdsRef.current.has(line.id)) continue;
      triedDurationIdsRef.current.add(line.id);
      const probe = new Audio(line.audioPath);
      // preload='auto' → celoten zvok že v predpomnilniku: menjave vrstic in
      // prekrivni vzkliki (ghost.play()) zaženejo BREZ mrežne latence.
      probe.preload = 'auto';
      probe.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(probe.duration) && probe.duration > 0) {
          setDurations((prev) => ({ ...prev, [line.id]: probe.duration }));
        }
      });
      probesRef.current.push(probe);
    }
  }, [lines]);

  // Vrsta za generiranje zvoka (vzporednost 2), preklic ob odhodu iz studia.
  useEffect(() => {
    if (!episode.lines.some((line) => line.audioPath === null)) return;
    const cancel = generateEpisodeAudio(
      episode,
      (line, durationMs) => {
        setLines((prev) =>
          prev.map((item) => (item.id === line.id ? { ...item, audioPath: line.audioPath } : item)),
        );
        if (durationMs && durationMs > 0) {
          setDurations((prev) => ({ ...prev, [line.id]: durationMs / 1000 }));
        }
        removeLineError(line.id);
      },
      () => {
        if (lineErrorsRef.current.length === 0) {
          toast.success('Epizoda je pripravljena! 🎧');
        } else {
          toast.error('Nekatere vrstice niso uspele. Klikni ikono za ponovni poskus.');
        }
      },
      () => toast.error('Generiranje glasov ni uspelo. Poskusi znova.'),
      addLineError,
    );
    return cancel;
  }, [episode, addLineError, removeLineError]);

  // Avtomatski pomik aktivne vrstice v vidno polje.
  useEffect(() => {
    if (currentIndex === null) return;
    rowRefs.current[currentIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentIndex]);

  const readyCount = useMemo(() => lines.filter((line) => line.audioPath).length, [lines]);
  const totalCount = lines.length;
  const pendingCount = totalCount - readyCount;
  const generating = pendingCount > 0;

  const totalDuration = useMemo(
    () =>
      lines.reduce(
        (sum, line) =>
          line.audioPath ? sum + (durations[line.id] ?? 0) + (line.preDelayMs ?? 0) / 1000 : sum,
        0,
      ),
    [lines, durations],
  );
  totalDurationRef.current = totalDuration; // Media Session (drsnik na zaklenjenem zaslonu)

  // Dramaturška analiza epizode (isti pravili kot dialog za novo epizodo; 100 % lokalno).
  const dramaAnalysis = useMemo(() => {
    if (lines.length === 0) return null;
    const speakers: string[] = [];
    for (const line of lines) {
      if (!speakers.includes(line.speaker)) speakers.push(line.speaker);
    }
    return analyzeScript({
      lines: lines.map((l) => ({ speaker: l.speaker, text: l.text, chapter: l.chapter })),
      speakers,
      chapterCount: new Set(lines.map((l) => l.chapter).filter(Boolean)).size,
    });
  }, [lines]);

  const elapsed = useMemo(() => {
    if (currentIndex === null) return 0;
    let before = 0;
    for (let i = 0; i < currentIndex; i += 1) {
      before += lines[i].audioPath
        ? (durations[lines[i].id] ?? 0) + (lines[i].preDelayMs ?? 0) / 1000
        : 0;
    }
    return before + currentTime;
  }, [currentIndex, currentTime, durations, lines]);

  // Trajanja vseh zvočnih vrstic so znana (pogoj za tihi skok na shranjeno pozicijo).
  const durationsReady = useMemo(
    () => lines.every((line) => !line.audioPath || (durations[line.id] ?? 0) > 0),
    [lines, durations],
  );

  /*
   * Stolpci oblike valovanja (Task 42): ENAKA matematika kot `elapsed` —
   * vrstica zaseda [start, start+dur), pavza (preDelayMs) sledi zanjo kot
   * nizki stolpci → glava predvajanja (elapsed/total) je Natančno poravnana.
   * Dolge epizode se max-poolajo na ≤ 420 stolpcev.
   */
  const waveformBars = useMemo(() => {
    if (!peaksData || peaksData.lines.length === 0) return null;
    const byId = new Map(peaksData.lines.map((entry) => [entry.id, entry]));
    const bars: number[] = [];
    for (const line of lines) {
      if (!line.audioPath) continue;
      const entry = byId.get(line.id);
      const dur = durations[line.id] ?? 0;
      if (!entry || entry.peaks.length === 0 || dur <= 0) {
        bars.push(0.05); // vrstica še brez vrhov → tiha oznaka
        continue;
      }
      const src = entry.peaks;
      const want = Math.max(2, Math.round((entry.durationSec || dur) * 2));
      for (let i = 0; i < want; i += 1) {
        const a = Math.floor((i / want) * src.length);
        const b = Math.max(a + 1, Math.ceil(((i + 1) / want) * src.length));
        let peak = 0;
        for (let k = a; k < b && k < src.length; k += 1) peak = Math.max(peak, src[k]);
        bars.push(Math.max(0.04, peak));
      }
      const gapSec = Math.max(0, (line.preDelayMs ?? 0) / 1000);
      const gapBars = Math.round(gapSec * 2);
      for (let g = 0; g < gapBars; g += 1) bars.push(0.045);
    }
    if (bars.length < 10) return null;
    const MAX_BARS = 420;
    if (bars.length <= MAX_BARS) return bars;
    const pooled: number[] = [];
    const factor = bars.length / MAX_BARS;
    for (let i = 0; i < MAX_BARS; i += 1) {
      const a = Math.floor(i * factor);
      const b = Math.max(a + 1, Math.floor((i + 1) * factor));
      let peak = 0;
      for (let k = a; k < b && k < bars.length; k += 1) peak = Math.max(peak, bars[k]);
      pooled.push(peak);
    }
    return pooled;
  }, [peaksData, lines, durations]);

  // Ogrevanje predpomnilnika za jingle melodije (Task 30) — zagon brez latence
  useEffect(() => {
    prefetchAudio('/api/audio/jingle_intro.wav');
    prefetchAudio('/api/audio/jingle_outro.wav');
  }, [episode.id]);

  /*
   * OBFORMA VALOVANJA (Task 42): vrhovi po vrsticah. Ponovni pridobiv ob
   * vsaki spremembi množice zvočnih datotek (generacija napreduje vrstica po
   * vrstici / re-voice) — keš na strežniku je inkrementalen (samo nove vrstice
   * računa). Ob napaki pade na drsnik (fail-soft).
   */
  const audioPathsKey = lines.map((line) => line.audioPath ?? '').join('|');
  useEffect(() => {
    let alive = true;
    if (!audioPathsKey) {
      setPeaksData(null);
      return;
    }
    void fetchEpisodePeaks(episode.id).then((data) => {
      if (alive) setPeaksData(data);
    });
    return () => {
      alive = false;
    };
  }, [episode.id, audioPathsKey]);

  // Nadaljuj od mesta ustavitve (localStorage, Apple/Spotify stil): tihi skok
  // na pravo vrstico + offset, BREZ avtomatskega predvajanja (razen eksplicitnega
  // Play iz knjižnice).
  useEffect(() => {
    if (resumeDoneRef.current) return;
    if (!durationsReady || totalDuration <= 0) return;
    /*
     * RACE (Task 30): če uporabnik že posluša (uvodna melodija / vrstica),
     * obnova NE SME ugrabiti predvajanja na shranjeno pozicijo — eksplicitni
     * zagon od začetka porabi obnovo (Apple/Spotify stil: play pri 0 = od 0).
     */
    if (introPhaseRef.current !== null || currentIndexRef.current !== null) {
      resumeDoneRef.current = true;
      return;
    }
    resumeDoneRef.current = true;
    const savedMs = loadLocalPosition(episode.id);
    if (savedMs === null) return;
    const savedSec = savedMs / 1000;
    if (savedSec <= 10 || savedSec >= totalDuration - 8) return;
    lastElapsedMsRef.current = savedMs; // tihi resume: flush ob odhodu ne sme resetirati na 0
    let acc = 0; // začetek trenutne vrstice na časovnici (pavze lahko NEGATIVNE)
    for (let i = 0; i < linesRef.current.length; i += 1) {
      const line = linesRef.current[i];
      if (!line.audioPath) continue;
      const d = durationsRef.current[line.id] ?? 0;
      const nextIdx = nextAudioIndex(linesRef.current, i + 1);
      const nextGapSec =
        nextIdx !== null ? (linesRef.current[nextIdx].preDelayMs ?? 0) / 1000 : 0;
      const nextStart = acc + d + nextGapSec;
      if (savedSec < nextStart) {
        const offsetSec = Math.min(Math.max(0, savedSec - acc), d);
        if (i === currentIndexRef.current) {
          // ista vrstica — iskalcni poskus neposredno na audio element
          const audio = audioRef.current;
          const applySeek = () => {
            if (!audio) return;
            try {
              audio.currentTime = offsetSec;
            } catch {
              // iskanje ni uspelo — nadaljuj od začetka vrstice
            }
            setCurrentTime(offsetSec);
            if (autoPlay) void audio.play().catch(() => {});
          };
          if (audio && audio.readyState >= 1) {
            applySeek();
          } else if (audio) {
            audio.addEventListener('loadedmetadata', applySeek, { once: true });
          }
        } else {
          pendingSeekRef.current = { index: i, offsetSec, play: autoPlay };
          setCurrentIndex(i);
        }
        toast.success(`Nadaljujem od ${formatMs(savedMs)}`);
        return;
      }
      acc = nextStart;
    }
  }, [durationsReady, totalDuration, episode.id, autoPlay]);

  // Poglavja: zaporedne vrstice z istim naslovom poglavja so en čip.
  const chapters = useMemo<ChapterChip[]>(() => {
    const result: ChapterChip[] = [];
    for (let i = 0; i < lines.length; i += 1) {
      const chapter = lines[i].chapter;
      if (!chapter) continue;
      const last = result[result.length - 1];
      if (last && last.title === chapter) continue;
      result.push({ title: chapter, index: i });
    }
    return result;
  }, [lines]);

  const hostIndexOf = useCallback(
    (speaker: string) => {
      const idx = episode.hosts.findIndex((host) => host.name === speaker);
      return idx >= 0 ? idx : 0;
    },
    [episode.hosts],
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      // Jingle (uvod/izhod) teče → samo zamrzni melodijo (ob nadaljevanju doigra)
      if (introPhaseRef.current && introAudioRef.current) {
        introAudioRef.current.pause();
        if (introTimerRef.current) {
          clearTimeout(introTimerRef.current);
          introTimerRef.current = null;
        }
        onPlayingChange(false);
        return;
      }
      audio.pause(); // ended zvok ne sproži 'pause' dogodka → eksplicitno:
      onPlayingChange(false);
      const secondary = gapAudioRef.current;
      if (ghostActiveRef.current && pendingGapNextRef.current !== null) {
        // prekrivni vzklik: samo zamrzni (ob play nadaljuje od mesta pavze)
        if (secondary && !secondary.paused) secondary.pause();
        if (gapTimerRef.current) {
          clearTimeout(gapTimerRef.current);
          gapTimerRef.current = null;
        }
      } else {
        cancelGap(); // room-tone pavza → prekini (ob play se ponovi vrstica)
      }
      return;
    }
    if (introPhaseRef.current && introAudioRef.current) {
      // nadaljuj melodijo (uvod ali izhod) od mesta pavze
      activatePan();
      introTimerRef.current = setTimeout(() => introDoneRef.current(), 9000);
      void introAudioRef.current.play().catch(() => {});
      onPlayingChange(true);
      return;
    }
    if (ghostActiveRef.current && pendingGapNextRef.current !== null && gapAudioRef.current) {
      // nadaljuj prekrivni vzklik od mesta pavze
      activatePan(); // kontekst teče pred nadaljevanjem drugega kanala
      void gapAudioRef.current.play().catch(() => {});
      onPlayingChange(true);
      return;
    }
    if (currentIndexRef.current === null) {
      /*
       * Eksplicitni zagon od začetka PORABI obnovo pozicije (race z
       * durationsReady — glej restore efekt zgoraj): uporabnik je izbral play,
       * zato kasnejši prihod trajanj ne sme skočiti na shranjeno pozicijo.
       */
      resumeDoneRef.current = true;
      const first = nextAudioIndex(linesRef.current, 0);
      if (first !== null) {
        /*
         * UVODNA MELODIJA (Task 30): pre-roll pred 1. vrstico — kot v izvozu.
         * Ob koncu melodije se zažene obstoječa veriga (efekt naloži + predvaja
         * vrstico); napaka/odmene → fallback takoj na vrstico.
         */
        startJingle('intro', () => setCurrentIndex(first));
        onPlayingChange(true);
      }
      return;
    }
    void audio.play().catch(() => {});
  }, [playing, cancelGap, onPlayingChange, startJingle]);

  const playLine = useCallback(
    (index: number) => {
      const line = linesRef.current[index];
      if (!line?.audioPath) return; // vrstice brez zvoka niso klikabilne
      if (index === currentIndexRef.current) {
        togglePlay();
        return;
      }
      cancelGap();
      setCurrentIndex(index);
    },
    [togglePlay, cancelGap],
  );

  /** Skok na vrstico iz poglavja: vedno na začetek vrstice (predvajaj ali prevrti). */
  const jumpToLine = useCallback((index: number) => {
    const line = linesRef.current[index];
    if (!line?.audioPath) return;
    if (index === currentIndexRef.current) {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        void audio.play().catch(() => {});
      }
      return;
    }
    cancelGap();
    setCurrentIndex(index);
  }, [cancelGap]);

  /**
   * Skok iz čipov poglavij (Task 44): preklopi na zavihek Scenarij (seznam je tam),
   * predvaja vrstico in po remountu gladko prinese vrstico v vidno polje.
   */
  const jumpFromChapters = useCallback(
    (index: number) => {
      setStudioTab('scenarij');
      jumpToLine(index);
      window.setTimeout(() => {
        rowRefs.current[index]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 90);
    },
    [jumpToLine],
  );

  /*
   * KLIK NA BESEDO (Task 41): skok znotraj AKTIVNE vrstice na njen čas.
   * Sprotno predvajanje se nadaljuje; če je pavza, začne igrati od besede
   * (isti občutek kot klik na vrstico, samo finejši — na raven besede).
   */
  const seekWithinLine = useCallback((offsetSec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      audio.currentTime = offsetSec;
    } catch {
      return; // iskanje ni uspelo — nič hudega
    }
    setCurrentTime(offsetSec);
    if (audio.paused) void audio.play().catch(() => {});
  }, []);

  const playNextLine = useCallback(() => {
    const current = currentIndexRef.current;
    const start = current === null ? 0 : current + 1;
    const next = nextAudioIndex(linesRef.current, start);
    if (next !== null) {
      cancelGap();
      setCurrentIndex(next);
    } else if (current !== null) {
      audioRef.current?.pause(); // konec epizode
      finishEpisodeRef.current();
    }
  }, [cancelGap]);

  const playPrevLine = useCallback(() => {
    const current = currentIndexRef.current;
    if (current === null) {
      const first = nextAudioIndex(linesRef.current, 0);
      if (first !== null) setCurrentIndex(first);
      return;
    }
    const prev = prevAudioIndex(linesRef.current, current - 1);
    if (prev !== null) {
      cancelGap();
      setCurrentIndex(prev);
      return;
    }
    const audio = audioRef.current; // ni prejšnje → ponovi trenutno
    if (audio) {
      audio.currentTime = 0;
      void audio.play().catch(() => {});
    }
  }, [cancelGap]);

  // ── Iskanje po scenariju (Apple Podcasts transkript-search stil) ──
  const searchNeedle = foldText(searchQuery.trim());
  const searchActive = searchOpen && searchNeedle.length >= 2;
  const searchMatches = useMemo(() => {
    if (!searchActive) return [];
    const out: { lineIndex: number; start: number; end: number }[] = [];
    lines.forEach((line, lineIndex) => {
      const hay = foldText(line.text);
      if (hay.length !== line.text.length) return; // redki Unicode primeri — brez pozicij
      let from = 0;
      while (from <= hay.length - searchNeedle.length) {
        const at = hay.indexOf(searchNeedle, from);
        if (at < 0) break;
        out.push({ lineIndex, start: at, end: at + searchNeedle.length });
        from = at + searchNeedle.length;
      }
    });
    return out;
  }, [lines, searchActive, searchNeedle]);
  const lineMatchCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const match of searchMatches) {
      map.set(match.lineIndex, (map.get(match.lineIndex) ?? 0) + 1);
    }
    return map;
  }, [searchMatches]);

  useEffect(() => {
    setSearchActiveIdx(0);
  }, [searchMatches]);

  const openSearch = useCallback(() => {
    setStudioTab('scenarij'); // iskanje živi v zavihku Scenarij — prinesi ga v ospredje
    setSearchOpen(true);
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchActiveIdx(0);
  }, []);

  /** Skok na zadetek: predvajanje od vrstice + gladek scroll v vidno polje. */
  const goToMatch = useCallback(
    (idx: number) => {
      if (searchMatches.length === 0) return;
      const wrapped = ((idx % searchMatches.length) + searchMatches.length) % searchMatches.length;
      setSearchActiveIdx(wrapped);
      const match = searchMatches[wrapped];
      jumpToLine(match.lineIndex);
      rowRefs.current[match.lineIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
    [searchMatches, jumpToLine],
  );


  const changeRate = useCallback((value: number) => {
    setRate(value);
    saveDeviceRate(value); // nastavitev naprave (Task 59)
    if (audioRef.current) audioRef.current.playbackRate = value;
  }, []);

  /** Glasnost na VSEH živih elementih (glavni, room tone, vzklik, melodija). */
  const changeVolume = useCallback((values: number[]) => {
    const next = Math.min(1, Math.max(0, values[0] ?? 1));
    volumeRef.current = next;
    setVolume(next);
    // Vlečenje drsnika iz utišanega stanja povrne zvok (splošna navada).
    const unmute = next > 0 && mutedRef.current;
    if (unmute) {
      mutedRef.current = false;
      setMuted(false);
    }
    for (const el of [audioRef.current, gapAudioRef.current, introAudioRef.current]) {
      if (el) {
        el.volume = next;
        if (unmute) el.muted = false;
      }
    }
    saveDeviceSound(next, unmute ? false : mutedRef.current);
  }, []);

  /** Skok ±10 s znotraj trenutne vrstice; čez konec → naslednja vrstica. */
  const skipSeconds = useCallback(
    (delta: number) => {
      const audio = audioRef.current;
      if (!audio || currentIndexRef.current === null) return;
      cancelGap(); // prekliči pavzo/vzklik — skok velja takoj
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
      const target = audio.currentTime + delta;
      if (target >= audio.duration - 0.08) {
        playNextLine();
        return;
      }
      audio.currentTime = Math.max(0, target);
    },
    [playNextLine, cancelGap],
  );

  /*
   * Skok na GLOBALNI čas (ms) — klik/vleci oblike valovanja (Task 42).
   * Enaka segmentacija kot `elapsed` (dur + preDelay po vrstici).
   * Isti mehanizem kot obnova pozicije: pendingSeekRef (vleci med predvajanjem
   * = nadaljuj, med pavzo = ostani pavziran na novi poziciji).
   */
  const seekToGlobalMs = useCallback(
    (ms: number) => {
      const segments: { index: number; start: number; end: number }[] = [];
      let acc = 0;
      for (let i = 0; i < linesRef.current.length; i += 1) {
        const line = linesRef.current[i];
        if (!line.audioPath) continue;
        const d = durationsRef.current[line.id] ?? 0;
        if (d <= 0) continue;
        segments.push({ index: i, start: acc, end: acc + d });
        acc = acc + d + (line.preDelayMs ?? 0) / 1000;
      }
      if (segments.length === 0) return;
      const target = Math.max(0, ms) / 1000;
      const last = segments[segments.length - 1];
      const seg = segments.find((s) => target < s.end) ?? last;
      const offsetSec = Math.min(Math.max(0, target - seg.start), seg.end - seg.start);
      cancelGap();
      if (seg.index === currentIndexRef.current) {
        const audio = audioRef.current;
        if (!audio) return;
        try {
          audio.currentTime = offsetSec;
        } catch {
          return; // iskanje ni uspelo — nič hudega
        }
        setCurrentTime(offsetSec);
      } else {
        pendingSeekRef.current = { index: seg.index, offsetSec, play: playing };
        setCurrentIndex(seg.index);
      }
    },
    [cancelGap, playing],
  );

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      mutedRef.current = next;
      // Utišanje velja za VSE žive elemente (Task 59) — prej je melodija/
      // room tone/vzklik glasno vzklikali tudi ob utišanju.
      for (const el of [audioRef.current, gapAudioRef.current, introAudioRef.current]) {
        if (el) el.muted = next;
      }
      saveDeviceSound(volumeRef.current, next);
      return next;
    });
  }, []);

  /*
   * Media Session (Task 51): naslov/ovitek/gostitelji epizode na zaklenjenem
   * zaslonu; medijske tipke — ±10 s, prejšnja/naslednja vrstica, play/pavza
   * (tudi ko je zavihek v ozadju). Isto vedenje kot tipkovne bližnjice.
   */
  useMediaSession(
    {
      title: episode.title,
      artist: episode.hosts.map((h) => h.name).join(' · ') || 'AI Podcast Studio',
      album: 'AI Podcast Studio',
      artworkUrl: episode.coverPath,
      onPlay: () => {
        if (!playing) togglePlay();
      },
      onPause: () => {
        if (playing) togglePlay();
      },
      onSeekBackward: (offset) => skipSeconds(-offset),
      onSeekForward: (offset) => skipSeconds(offset),
      onPrevTrack: () => playPrevLine(),
      onNextTrack: () => playNextLine(),
    },
    `${episode.id}:${episode.title}:${episode.coverPath ?? ''}`,
  );

  // Tipkovne bližnjice: preslednica = predvajaj/ustavi, ←/→ = skok ±10 s,
  // ↑/↓ = prejšnja/naslednja vrstica, M = utišaj, / = iskanje, ? = pomoč.
  // Ignoriramo vnosna polja in gumba (da ne škodujemo domačemu kliku/urejanju).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName?.toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        el?.isContentEditable ||
        el?.closest('button, [role="button"], [role="slider"], a[href]')
      ) {
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        skipSeconds(10);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        skipSeconds(-10);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        playNextLine();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        playPrevLine();
      } else if (e.key === 'm' || e.key === 'M') {
        toggleMute();
      } else if (e.key === '/') {
        e.preventDefault();
        openSearch();
      } else if (e.key === '?') {
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, skipSeconds, playNextLine, playPrevLine, toggleMute, openSearch]);

  // ── Ura za spanje (Pocket Casts stil) ───────────────────────────
  // Odštevalnik teče samo med predvajanjem; ročna pavza ga ne prekliče.
  useEffect(() => {
    if (!playing || sleepTimer === null || sleepTimer.mode !== 'ms') return;
    const tick = () => {
      const timer = sleepTimerRef.current;
      if (!timer || timer.mode !== 'ms') return;
      const remaining = timer.deadline - Date.now();
      if (remaining <= 0) {
        setSleepRemainingMs(null);
        setSleepTimer(null);
        audioRef.current?.pause();
        introAudioRef.current?.pause(); // tudi jingle (uvod/izhod) zamrzni
        toast('Ura za spanje — predvajanje ustavljeno');
        return;
      }
      setSleepRemainingMs(remaining);
    };
    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [playing, sleepTimer]);

  const handleSetSleepTimer = useCallback((option: SleepTimerChoice) => {
    if (option === 'off') {
      setSleepTimer(null);
      setSleepRemainingMs(null);
      toast('Ura za spanje izklopljena');
      return;
    }
    if (option === 'episode') {
      setSleepTimer({ mode: 'episode' });
      setSleepRemainingMs(null);
      toast('Ura za spanje: pavza na koncu epizode');
      return;
    }
    const minutes = Number(option);
    const totalMs = minutes * 60000;
    setSleepTimer({ mode: 'ms', deadline: Date.now() + totalMs, totalMs });
    setSleepRemainingMs(totalMs);
    toast(`Ura za spanje: pavza čez ${minutes} min`);
  }, []);

  /** Konec epizode: ponastavi pozicijo + statistiko; pri uri 'episode' še pavza + toast. */
  const finishEpisode = useCallback(() => {
    finishingRef.current = true;
    lastElapsedMsRef.current = 0;
    saveLocalPosition(episode.id, 0);
    void updateEpisodeProgress(episode.id, 0, false);
    /*
     * Pozicija/karaoke se ponastavita ZDAJ (izvoz ponastavi napredek takoj po
     * zadnji vrstici) → naslednji zagon gre čez svežo pot (z uvodno melodijo).
     */
    setCurrentIndex(null);
    if (sleepTimerRef.current?.mode === 'episode') {
      setSleepTimer(null);
      setSleepRemainingMs(null);
      toast('Ura za spanje — predvajanje ustavljeno');
      return;
    }
    /*
     * ZAKLJUČNA MELODIJA (Task 30) — statistika je že poravnana; ob koncu
     * melodije se stanje predvajanja izklopi. Ura za spanje (minute) lahko
     * melodijo med igranjem zamrzne (togglePlay) — enako kot vrstico.
     */
    startJingle('outro', () => onPlayingChange(false));
    onPlayingChange(true);
  }, [episode.id, startJingle, onPlayingChange]);

  useEffect(() => {
    finishEpisodeRef.current = finishEpisode;
  }, [finishEpisode]);

  // Ob odhodu iz studia (ali zamenjavi epizode) še zadnji flush statistike.
  useEffect(() => {
    return () => {
      saveLocalPosition(episodeIdRef.current, lastElapsedMsRef.current);
      void updateEpisodeProgress(episodeIdRef.current, lastElapsedMsRef.current, false);
    };
  }, []);

  const retryLine = useCallback(
    async (lineId: string) => {
      if (retryingIds.includes(lineId)) return;
      setRetryingIds((prev) => (prev.includes(lineId) ? prev : [...prev, lineId]));
      try {
        const data = await generateLineAudio(lineId);
        setLines((prev) =>
          prev.map((item) => (item.id === lineId ? { ...item, audioPath: data.audioPath } : item)),
        );
        if (data.durationMs > 0) {
          setDurations((prev) => ({ ...prev, [lineId]: data.durationMs / 1000 }));
        }
        removeLineError(lineId);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Generiranje glasu ni uspelo.');
      } finally {
        setRetryingIds((prev) => prev.filter((id) => id !== lineId));
      }
    },
    [retryingIds, removeLineError],
  );

  const hasAudio = useMemo(() => lines.some((l) => l.audioPath), [lines]);

  const handleExport = useCallback(
    async (kind: ExportKind) => {
      if (exportingRef.current !== null) return;
      exportingRef.current = kind;
      setExporting(kind);
      try {
        switch (kind) {
          case 'mp3j':
            await downloadEpisodeMp3(episode.id, episode.title, true);
            toast.success('Epizoda prenesena (MP3 z melodijo).');
            break;
          case 'mp3s':
            await downloadEpisodeMp3(episode.id, episode.title, false);
            toast.success('Epizoda prenesena (MP3, samo govor).');
            break;
          case 'video':
            await downloadEpisodeVideo(episode.id, episode.title);
            toast.success('Video MP4 prenešen.');
            break;
          case 'srt':
            await downloadEpisodeSrt(episode.id, episode.title);
            toast.success('Podnapisi preneseni (.srt).');
            break;
          case 'txt':
            await downloadEpisodeTranscript(episode.id, episode.title);
            toast.success('Transkript prenešen (.txt).');
            break;
          case 'chapters':
            await downloadEpisodeChapters(episode.id, episode.title);
            toast.success('Poglavja prenešena (.txt).');
            break;
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Izvoz ni uspel.');
      } finally {
        exportingRef.current = null;
        setExporting(null);
        if (kind === 'video') setExportOpen(false); // dolg izvoz — zapri meni ob koncu
      }
    },
    [episode.id, episode.title],
  );

  const handleCover = useCallback(async () => {
    if (coverPending) return;
    setCoverPending(true);
    try {
      // force=true, če ovitek že obstaja ("Nov ovitek" → res nov ovitek, ne keš)
      const path = await generateCover(episode.id, Boolean(coverPath));
      setCoverPath(path);
      setCoverVersion((prev) => prev + 1); // razbije brskalni keš slike
      toast.success('Ovitek ustvarjen!');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Generiranje ovitka ni uspelo.');
    } finally {
      setCoverPending(false);
    }
  }, [coverPending, coverPath, episode.id]);

  const handleCopyTranscript = useCallback(async () => {
    const text = linesRef.current.map((l) => `${l.speaker}: ${l.text}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Transkript kopiran v odložišče.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Kopiranje ni uspelo.');
    }
  }, []);

  // ── Deljenje izrezkov na vrstici (Pocket Casts "Clip Sharing" stil) ──

  /** Pozicija odpiralnega čipa poglavja v seznamu poglavij (0-based) ali -1. */
  const chapterIndexOf = useCallback(
    (chapter: string) => chapters.findIndex((chip) => chip.title === chapter),
    [chapters],
  );

  /**
   * Izvoz izrezka vrstice/poglavja. Klic gre direktno prek onClick — NI vezan
   * na življenjski cikel menija (meni se lahko zapre, izvoz teče naprej).
   * Med delovanjem se vsi elementi menija onemogočijo, aktivni dobi Loader2;
   * ker se meni ob videu zapre, spinner kažemo tudi na Share2 sprožilcu.
   */
  const handleClipShare = useCallback(
    async (line: Line, kind: ClipKind, shortStyle: ShortsCaptionStyle = 'klasika') => {
      if (clipBusyRef.current) return;
      const busy = { lineId: line.id, kind };
      clipBusyRef.current = busy;
      setClipBusy(busy);
      try {
        if (kind === 'mp3') {
          await downloadLineClip(line.id, line.speaker, 'mp3');
          toast.success('Izrezek prenešen');
        } else if (kind === 'video') {
          await downloadLineClip(line.id, line.speaker, 'video'); // generiranje 5–30 s
          toast.success('Izrezek MP4 prenešen');
        } else {
          if (!line.chapter) return;
          const index = chapterIndexOf(line.chapter);
          if (index < 0) throw new Error('Poglavja ni bilo mogoče najti.');
          if (kind === 'chapterVideo') {
            await downloadChapterShort(episode.id, index, line.chapter, shortStyle); // generiranje 5–40 s
            toast.success('Shorts MP4 prenešen');
          } else {
            await downloadChapterClip(episode.id, index, line.chapter);
            toast.success('Poglavje prenešeno');
          }
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Izvoz izrezka ni uspel.');
      } finally {
        clipBusyRef.current = null;
        setClipBusy(null);
        // MP3/poglavje držita meni odprt med generiranjem → zapri ob koncu;
        // video meni se zapre sam ob kliku (spinner ostane na Share2).
        if (kind !== 'video') setShareMenuLineId(null);
      }
    },
    [chapterIndexOf, episode.id],
  );

  /** Citatna kartica (PNG 1080×1350) — risba na canvas v brskalniku. */
  const handleQuoteCard = useCallback(
    async (line: Line) => {
      try {
        await downloadQuoteCard({
          text: line.text,
          speaker: line.speaker,
          episodeTitle: episode.title,
        });
        toast.success('Citatna kartica prenešena');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Ustvarjanje kartice ni uspelo.');
      }
    },
    [episode.title],
  );

  /** Kopiraj citat vrstice v odložišče (slovenski narekovaj „…“). */
  const handleCopyQuote = useCallback(async (line: Line) => {
    try {
      await navigator.clipboard.writeText(`„${line.text}“ — ${line.speaker}`);
      toast.success('Citat kopiran');
    } catch {
      toast.error('Kopiranje ni uspelo.');
    }
  }, []);

  // Urejanje vrstice: klik na svinčnik ustavi predvajanje in odpre urejanje.
  const startEditLine = useCallback((line: Line) => {
    audioRef.current?.pause();
    setEditingId(line.id);
    setEditText(line.text);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText('');
  }, []);

  const saveEditLine = useCallback(
    async (lineId: string) => {
      if (savingLineId) return;
      const line = linesRef.current.find((item) => item.id === lineId);
      const text = editText.trim();
      if (!text) {
        toast.error('Besedilo ne sme biti prazno.');
        return;
      }
      if (line && text === line.text) {
        cancelEdit(); // ni spremembe → ni regeneracije
        return;
      }
      setSavingLineId(lineId);
      try {
        const data = await updateLineText(lineId, text);
        const version = (audioVersionsRef.current.get(lineId) ?? 0) + 1;
        audioVersionsRef.current.set(lineId, version);
        const audioPath = data.audioPath ? withCacheBust(data.audioPath, version) : null;
        setLines((prev) =>
          prev.map((item) => (item.id === lineId ? { ...item, text: data.text, audioPath } : item)),
        );
        if (data.durationMs > 0) {
          setDurations((prev) => ({ ...prev, [lineId]: data.durationMs / 1000 }));
        }
        toast.success('Vrstica urejena in glas regeneriran.');
        setEditingId(null);
        setEditText('');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Urejanje vrstice ni uspelo.');
      } finally {
        setSavingLineId(null);
      }
    },
    [editText, savingLineId, cancelEdit],
  );

  // — Upravljanje vrstic (Task 48): vstavljanje, premikanje, brisanje —

  // Govorci na voljo za novo vrstico: voditelji + vsi govorci, ki se pojavijo v vrsticah.
  const speakerOptions = useMemo(() => {
    const names = episode.hosts.map((host) => host.name);
    for (const line of lines) {
      if (!names.includes(line.speaker)) names.push(line.speaker);
    }
    return names;
  }, [episode.hosts, lines]);

  /** Odpri kompozitor: pod vrstico `afterLineId` (ali na konec, če je null). */
  const startInsert = useCallback((afterLineId: string | null, defaultSpeaker: string) => {
    audioRef.current?.pause();
    setEditingId(null);
    setEditText('');
    setInsertAfter({ lineId: afterLineId });
    setInsertSpeaker(defaultSpeaker);
    setInsertText('');
  }, []);

  const cancelInsert = useCallback(() => {
    setInsertAfter(null);
    setInsertText('');
  }, []);

  /** Shrani novo vrstico: API sintetizira glas, klient zamenja celoten seznam. */
  const saveInsert = useCallback(async () => {
    if (!insertAfter || inserting) return;
    const text = insertText.trim();
    if (!text) {
      toast.error('Besedilo ne sme biti prazno.');
      return;
    }
    setInserting(true);
    try {
      const data = await addLine(episode.id, insertAfter.lineId, insertSpeaker, text);
      if (data.episode) setLines(data.episode.lines);
      const at = data.episode?.lines.findIndex((l) => l.id === data.lineId) ?? -1;
      if (data.durationMs > 0) {
        setDurations((prev) => ({ ...prev, [data.lineId]: data.durationMs / 1000 }));
      }
      // Vstavljena vrstica PRED aktivno premakne aktivno mesto — prekini
      // poudarjanje (predvajanje je že pavzirano; brez presenetljivih zagonov).
      if (at >= 0) {
        setCurrentIndex((cur) => (cur !== null && cur >= at ? null : cur));
      }
      toast.success('Vrstica dodana — glas sintetiziran.');
      setInsertAfter(null);
      setInsertText('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Vstavljanje vrstice ni uspelo.');
    } finally {
      setInserting(false);
    }
  }, [insertAfter, inserting, insertText, insertSpeaker, episode.id]);

  /** Premakni vrstico gor/dol (zamenjava s sosedom); zvok se ne spreminja. */
  const handleMoveLine = useCallback(
    async (index: number, direction: 'up' | 'down') => {
      const target = index + (direction === 'up' ? -1 : 1);
      const current = linesRef.current;
      if (target < 0 || target >= current.length) return;
      const line = current[index];
      audioRef.current?.pause();
      setMovingId(line.id);
      try {
        const fresh = await moveLine(line.id, direction);
        if (fresh) setLines(fresh.lines);
        // Če je bil premik čez aktivno vrstico, poudarjanje pade (brez zagonov)
        setCurrentIndex((cur) =>
          cur !== null && (cur === index || cur === target) ? null : cur,
        );
        toast.success(direction === 'up' ? 'Vrstica premaknjena gor.' : 'Vrstica premaknjena dol.');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Premikanje vrstice ni uspelo.');
      } finally {
        setMovingId(null);
      }
    },
    [],
  );

  /** Prvi klik na „Izbriši“ odpre potrditveni dialog (trajna sprememba). */
  const confirmDeleteLine = useCallback(
    (line: Line, index: number) => {
      audioRef.current?.pause();
      setDeleteTarget({ line, index });
    },
    [],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget || deleting) return;
    const { line, index } = deleteTarget;
    setDeleting(true);
    try {
      const fresh = await deleteLine(line.id);
      if (fresh) setLines(fresh.lines);
      setDurations((prev) => {
        const next = { ...prev };
        delete next[line.id];
        return next;
      });
      setLineErrors((prev) => prev.filter((id) => id !== line.id));
      // Aktivna vrstica izbrisana ali premaknjena naprej → poudarjanje pade
      setCurrentIndex((cur) => (cur !== null && cur >= index ? null : cur));
      // Kompozitor pod izbrisano vrstico zapri (referenca ne obstaja več)
      setInsertAfter((cur) => (cur?.lineId === line.id ? null : cur));
      toast.success('Vrstica izbrisana.');
      setDeleteTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Brisanje vrstice ni uspelo.');
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, deleting]);

  /** Kompozitor vstavljanja (isti JSX pod vrstico in na koncu scenarija). */
  const renderInsertComposer = () => (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-[0.18em] text-amber-300 uppercase">
          Nova vrstica
        </span>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Govorec nove vrstice">
          {speakerOptions.map((name) => {
            const chip = hostColor(hostIndexOf(name));
            const selected = insertSpeaker === name;
            return (
              <button
                key={name}
                type="button"
                aria-pressed={selected}
                onClick={() => setInsertSpeaker(name)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
                  selected
                    ? cn('border-transparent', chip.avatar)
                    : 'border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200',
                )}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>
      <Textarea
        autoFocus
        rows={2}
        maxLength={900}
        value={insertText}
        onChange={(e) => setInsertText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void saveInsert();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            cancelInsert();
          }
        }}
        disabled={inserting}
        aria-label="Besedilo nove vrstice"
        placeholder="Besedilo nove vrstice …"
        className="mt-2 min-h-16 resize-none border-zinc-700 bg-zinc-950/70 text-sm leading-relaxed text-zinc-100 focus-visible:border-amber-500/50 focus-visible:ring-amber-500/20"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="h-7 gap-1 rounded-md bg-gradient-to-r from-amber-500 to-orange-600 px-2.5 text-xs font-semibold text-white hover:from-amber-400 hover:to-orange-500"
          onClick={() => void saveInsert()}
          disabled={inserting || insertText.trim().length === 0}
        >
          {inserting ? (
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="size-3" aria-hidden="true" />
          )}
          Dodaj in sintetiziraj
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 rounded-md px-2.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          onClick={cancelInsert}
          disabled={inserting}
        >
          <X className="size-3" aria-hidden="true" />
          Prekliči
        </Button>
        <span className="text-xs text-zinc-400">
          ⌘/Ctrl + Enter · {insertText.length}/900
        </span>
      </div>
    </div>
  );


  // Vprašaj voditelja: pavza → API → zamenjava vrstic → skok na prvi odgovor.
  const handleAskHosts = useCallback(
    async (question: string): Promise<string[]> => {
      audioRef.current?.pause();
      const { episode: fresh, newLineIds } = await askHosts(episode.id, question);
      setLines(fresh.lines);
      if (newLineIds.length > 0) {
        const firstNew = fresh.lines.findIndex((line) => line.id === newLineIds[0]);
        if (firstNew >= 0 && fresh.lines[firstNew]?.audioPath) {
          setCurrentIndex(firstNew); // efekt naloži in predvaja novo vrstico
        }
      }
      return newLineIds;
    },
    [episode.id],
  );

  const coverSrc =
    coverPath && coverVersion > 0 ? withCacheBust(coverPath, coverVersion) : coverPath;

  return (
    <>
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:py-8">
        {/* Glava epizode */}
        <Card className="border-zinc-800 bg-zinc-900/60 py-5 shadow-none">
          <CardContent className="px-5">
            <div className="flex items-start gap-4">
              {coverSrc && (
                <img
                  src={coverSrc}
                  alt={`Ovitek epizode ${episode.title}`}
                  className="size-14 shrink-0 rounded-lg border border-zinc-700 object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <h2 className="line-clamp-2 text-xl font-bold tracking-tight text-zinc-100 sm:text-2xl">
                  {episode.title}
                </h2>
                {episode.topic.trim() !== episode.title.trim() && (
                  <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{episode.topic}</p>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-400">
                {STYLE_LABELS[episode.style] ?? episode.style}
              </Badge>
              <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                {LANGUAGE_LABELS[episode.language] ?? episode.language}
              </Badge>
              {episode.sourceType !== 'topic' && (
                <Badge
                  asChild={Boolean(episode.sourceUrl)}
                  variant="outline"
                  className="border-zinc-700 text-zinc-400"
                >
                  {episode.sourceUrl ? (
                    <a
                      href={episode.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={episode.sourceUrl}
                    >
                      <Link2 className="size-3" aria-hidden="true" />
                      {SOURCE_TYPE_LABELS[episode.sourceType]}
                    </a>
                  ) : (
                    <span>
                      {episode.sourceType === 'text' && (
                        <ClipboardPaste className="size-3" aria-hidden="true" />
                      )}
                      {episode.sourceType === 'script' && (
                        <FileText className="size-3" aria-hidden="true" />
                      )}
                      {SOURCE_TYPE_LABELS[episode.sourceType]}
                    </span>
                  )}
                </Badge>
              )}
              <span className="text-xs text-zinc-400">
                {totalCount} {totalCount === 1 ? 'vrstica' : 'vrstic'}
              </span>
            </div>
            {episode.hosts.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {episode.hosts.map((host, i) => {
                  const color = hostColor(i);
                  return (
                    <span
                      key={`${host.name}-${i}`}
                      className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/60 px-2.5 py-1 text-xs text-zinc-300"
                    >
                      <span className={cn('size-2 rounded-full', color.dot)} aria-hidden="true" />
                      <span className="font-medium text-zinc-200">{host.name}</span>
                      <span className="text-zinc-400">· {VOICES[host.voice]?.name ?? host.voice}</span>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <DropdownMenu open={exportOpen} onOpenChange={setExportOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 border-zinc-700 bg-zinc-950/60 text-zinc-300 hover:border-amber-500/40 hover:text-amber-400"
                    aria-label="Izvoz epizode"
                  >
                    {exporting ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Download className="size-4" aria-hidden="true" />
                    )}
                    <span className="hidden sm:inline">{exporting ? 'Izvažam …' : 'Izvoz'}</span>
                    <ChevronDown className="size-3 opacity-60" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="border-zinc-800 bg-zinc-900 text-zinc-100"
                >
                  {EXPORT_ITEMS.map(({ kind, label, hint, Icon, needsAudio }) => (
                    <DropdownMenuItem
                      key={kind}
                      disabled={exporting !== null || (needsAudio && !hasAudio)}
                      onSelect={kind === 'video' ? (e) => e.preventDefault() : undefined}
                      onClick={() => void handleExport(kind)}
                      title={hint}
                      className="focus:bg-zinc-800 focus:text-amber-300"
                    >
                      {kind === 'video' && exporting === 'video' ? (
                        <Loader2
                          className="size-4 animate-spin text-amber-400"
                          aria-hidden="true"
                        />
                      ) : (
                        <Icon className="size-4" aria-hidden="true" />
                      )}
                      <span className="flex min-w-0 flex-col">
                        <span>{label}</span>
                        {hint && <span className="text-[11px] text-zinc-400">{hint}</span>}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-zinc-700 bg-zinc-950/60 text-zinc-300 hover:border-amber-500/40 hover:text-amber-400"
                onClick={() => setShareOpen(true)}
                aria-label="Deli epizodo z javno povezavo"
              >
                <Share2 className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Deli</span>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-zinc-700 bg-zinc-950/60 text-zinc-300 hover:border-amber-500/40 hover:text-amber-400"
                onClick={() => void handleCover()}
                disabled={coverPending}
                aria-label={coverPath ? 'Ustvari nov ovitek' : 'Ustvari ovitek epizode'}
              >
                {coverPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : coverPath ? (
                  <RefreshCw className="size-4" aria-hidden="true" />
                ) : (
                  <ImagePlus className="size-4" aria-hidden="true" />
                )}
                {coverPending ? 'Ustvarjam …' : coverPath ? 'Nov ovitek' : 'Ustvari ovitek'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-zinc-700 bg-zinc-950/60 text-zinc-300 hover:border-amber-500/40 hover:text-amber-400"
                onClick={() => void handleCopyTranscript()}
                aria-label="Kopiraj transkript epizode"
              >
                {copied ? (
                  <Check className="size-4 text-emerald-500" aria-hidden="true" />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
                Kopiraj transkript
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Poglavja (čipi — vedno vidni, skok deluje tudi iz drugih zavihkov) */}
        {chapters.length > 0 && (
          <div className="mt-4">
            <ChaptersRow chapters={chapters} activeIndex={currentIndex} onJump={jumpFromChapters} />
          </div>
        )}

        {/* Napredek generiranja glasov */}
        <AnimatePresence initial={false}>
          {generating && (
            <motion.div
              key="generation"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
                <Loader2 className="size-5 shrink-0 animate-spin text-amber-400" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-amber-200">Generiram glasove …</span>
                    <span className="shrink-0 tabular-nums text-amber-400/90">
                      {readyCount}/{totalCount}
                    </span>
                  </div>
                  <Progress
                    value={totalCount > 0 ? (readyCount / totalCount) * 100 : 0}
                    aria-label="Napredek generiranja glasov"
                    className="mt-2 h-2 bg-zinc-800 [&_[data-slot=progress-indicator]]:bg-gradient-to-r [&_[data-slot=progress-indicator]]:from-amber-500 [&_[data-slot=progress-indicator]]:to-orange-600"
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Trojni pogled (V4 iz analize UI) — Scenarij · Zapiski · Dramaturgija */}
        <Tabs
          value={studioTab}
          onValueChange={(v) => setStudioTab(v as typeof studioTab)}
          className="mt-6"
        >
          <TabsList
            aria-label="Pogled studia"
            className="h-auto w-full justify-start gap-1 rounded-xl border border-zinc-800 bg-zinc-950/60 p-1 sm:w-auto"
          >
            <TabsTrigger
              value="scenarij"
              className="min-h-11 gap-1.5 rounded-lg px-3 py-1.5 text-sm text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-amber-300 sm:min-h-9"
            >
              <AudioLines className="size-4" aria-hidden="true" />
              Scenarij
            </TabsTrigger>
            <TabsTrigger
              value="zapiski"
              className="min-h-11 gap-1.5 rounded-lg px-3 py-1.5 text-sm text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-amber-300 sm:min-h-9"
            >
              <NotebookText className="size-4" aria-hidden="true" />
              Zapiski
            </TabsTrigger>
            <TabsTrigger
              value="dramaturgija"
              className="min-h-11 gap-1.5 rounded-lg px-3 py-1.5 text-sm text-zinc-400 data-[state=active]:bg-zinc-800 data-[state=active]:text-amber-300 sm:min-h-9"
            >
              <ListChecks className="size-4" aria-hidden="true" />
              Dramaturgija
              {dramaAnalysis && dramaAnalysis.warnings > 0 && (
                <span
                  className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1 text-[10px] font-semibold text-amber-400"
                  title={`${dramaAnalysis.warnings} dramaturških opozoril`}
                >
                  {dramaAnalysis.warnings}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scenarij" className="mt-4">
        <section aria-label="Scenarij">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-xs font-semibold tracking-[0.2em] text-zinc-400 uppercase">
              Scenarij
            </h3>
            {searchOpen ? (
              <ScenarioSearchBar
                query={searchQuery}
                onQueryChange={setSearchQuery}
                matchCount={searchMatches.length}
                activeIndex={searchActiveIdx}
                onNext={() => goToMatch(searchActiveIdx + 1)}
                onPrev={() => goToMatch(searchActiveIdx - 1)}
                onClose={closeSearch}
                inputRef={searchInputRef}
              />
            ) : (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                  aria-label="Išči po scenariju"
                  title="Išči po scenariju (/)"
                  onClick={openSearch}
                >
                  <Search className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                  aria-label="Tipkovniške bližnjice"
                  title="Bližnjice (?)"
                  onClick={() => setShortcutsOpen(true)}
                >
                  <Keyboard className="size-4" aria-hidden="true" />
                </Button>
                <span className="text-xs tabular-nums text-zinc-400">
                  {readyCount}/{totalCount} vrstic z glasom
                </span>
              </div>
            )}
          </div>
          <ol className="podcast-scroll space-y-2 pr-1 md:max-h-[55vh] md:overflow-y-auto">
            {lines.map((line, index) => {
              const isActive = index === currentIndex;
              const clickable = Boolean(line.audioPath);
              const hasError = lineErrors.includes(line.id);
              const isRetrying = retryingIds.includes(line.id);
              const isEditing = editingId === line.id;
              const isSaving = savingLineId === line.id;
              const canEdit = Boolean(line.audioPath) && !hasError;
              const color = hostColor(hostIndexOf(line.speaker));
              return (
                <Fragment key={line.id}>
                <motion.li
                  layout="position"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.45) }}
                  ref={(el) => {
                    rowRefs.current[index] = el;
                  }}
                  onClick={clickable && !isEditing ? () => playLine(index) : undefined}
                  aria-current={isActive || undefined}
                  className={cn(
                    'group flex gap-3 rounded-xl border p-3 transition-colors sm:p-4',
                    isActive
                      ? 'border-amber-500/60 bg-amber-500/10 ring-2 ring-amber-500/40'
                      : 'border-zinc-800/80 bg-zinc-900/40',
                    clickable && !isActive && !isEditing && 'cursor-pointer hover:border-zinc-600',
                    dimIfNoMatch((lineMatchCounts.get(index) ?? 0) > 0, searchActive),
                  )}
                >
                  <span
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                      color.avatar,
                    )}
                    aria-hidden="true"
                  >
                    {line.speaker.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className="text-sm font-semibold text-zinc-200">{line.speaker}</span>
                      {line.emotion && (
                        <span className="text-xs italic text-zinc-400">{line.emotion}</span>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                        <Textarea
                          autoFocus
                          rows={2}
                          maxLength={900}
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault();
                              void saveEditLine(line.id);
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelEdit();
                            }
                          }}
                          disabled={isSaving}
                          aria-label="Uredi besedilo vrstice"
                          className="min-h-16 resize-none border-zinc-700 bg-zinc-950/70 text-sm leading-relaxed text-zinc-100 focus-visible:border-amber-500/50 focus-visible:ring-amber-500/20"
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            className="h-7 gap-1 rounded-md bg-gradient-to-r from-amber-500 to-orange-600 px-2.5 text-xs font-semibold text-white hover:from-amber-400 hover:to-orange-500"
                            onClick={() => void saveEditLine(line.id)}
                            disabled={isSaving || editText.trim().length === 0}
                          >
                            {isSaving ? (
                              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                            ) : (
                              <Check className="size-3" aria-hidden="true" />
                            )}
                            Shrani
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 rounded-md px-2.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                            onClick={cancelEdit}
                            disabled={isSaving}
                          >
                            <X className="size-3" aria-hidden="true" />
                            Prekliči
                          </Button>
                          <span className="text-xs text-zinc-400">⌘/Ctrl + Enter</span>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-1 text-sm leading-relaxed text-zinc-300">
                        {searchActive ? (
                          <HighlightedText text={line.text} query={searchQuery} />
                        ) : isActive && (durations[line.id] ?? 0) > 0 ? (
                          /* Besedni karaoke (Task 41): samo AKTIVNA vrstica z znano dolžino. */
                          <WordKaraoke
                            text={line.text}
                            elapsedSec={currentTime}
                            durationSec={durations[line.id] ?? 0}
                            onWordClick={seekWithinLine}
                          />
                        ) : (
                          line.text
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 self-center">
                    {canEdit && !isEditing && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-zinc-500 opacity-100 transition-opacity hover:bg-amber-500/10 hover:text-amber-300 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                        aria-label="Uredi besedilo vrstice"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditLine(line);
                        }}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </Button>
                    )}
                    {!isEditing && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-zinc-500 opacity-100 transition-opacity hover:bg-amber-500/10 hover:text-amber-300 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                        aria-label="Vstavi vrstico pod"
                        title="Vstavi vrstico pod"
                        onClick={(e) => {
                          e.stopPropagation();
                          startInsert(line.id, line.speaker);
                        }}
                      >
                        <Plus className="size-3.5" aria-hidden="true" />
                      </Button>
                    )}
                    {!isEditing && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-zinc-500 opacity-100 transition-opacity hover:bg-zinc-800 hover:text-zinc-200 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                            aria-label="Možnosti vrstice"
                            aria-haspopup="menu"
                            title="Možnosti vrstice"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <EllipsisVertical className="size-3.5" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-60 border-zinc-800 bg-zinc-900 text-zinc-100"
                          // REACT portali bubblajo sintetične dogodke po KOMPONENTNEM
                          // drevesu — klik v meniju ne sme sprožiti playLine.
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenuItem
                            disabled={index === 0 || movingId !== null}
                            onSelect={(e) => e.preventDefault()} // meni ostane odprt → zaporedni premiki
                            onClick={() => void handleMoveLine(index, 'up')}
                            className="focus:bg-zinc-800 focus:text-amber-300"
                          >
                            {movingId === line.id ? (
                              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <ArrowUp className="size-4" aria-hidden="true" />
                            )}
                            Premakni gor
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={index === lines.length - 1 || movingId !== null}
                            onSelect={(e) => e.preventDefault()}
                            onClick={() => void handleMoveLine(index, 'down')}
                            className="focus:bg-zinc-800 focus:text-amber-300"
                          >
                            <ArrowDown className="size-4" aria-hidden="true" />
                            Premakni dol
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => startInsert(line.id, line.speaker)}
                            className="focus:bg-zinc-800 focus:text-amber-300"
                          >
                            <Plus className="size-4" aria-hidden="true" />
                            Vstavi vrstico pod
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-zinc-800" />
                          <DropdownMenuItem
                            disabled={deleting}
                            onClick={() => confirmDeleteLine(line, index)}
                            className="text-red-400 focus:bg-red-500/10 focus:text-red-300"
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                            Izbriši vrstico …
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {Boolean(line.audioPath) && !isEditing && (
                      <DropdownMenu
                        open={shareMenuLineId === line.id}
                        onOpenChange={(open) => setShareMenuLineId(open ? line.id : null)}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-zinc-500 opacity-100 transition-opacity hover:bg-zinc-800 hover:text-zinc-200 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                            aria-label="Deli vrstico"
                            aria-expanded={shareMenuLineId === line.id}
                            title="Deli vrstico"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {clipBusy?.lineId === line.id ? (
                              <Loader2
                                className="size-3.5 animate-spin text-amber-400"
                                aria-hidden="true"
                              />
                            ) : (
                              <Share2 className="size-3.5" aria-hidden="true" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-64 border-zinc-800 bg-zinc-900 text-zinc-100"
                          // REACT portali bubblajo sintetične dogodke po KOMPONENTNEM drevesu
                          // (ne po DOM): klik na element menija bi sicer dosegel onClick
                          // vrstice (playLine) in nemoteno sprožil predvajanje.
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenuItem
                            disabled={clipBusy !== null}
                            onSelect={(e) => e.preventDefault()}
                            onClick={() => void handleClipShare(line, 'mp3')}
                            className="focus:bg-zinc-800 focus:text-amber-300"
                          >
                            {clipBusy?.lineId === line.id && clipBusy.kind === 'mp3' ? (
                              <Loader2
                                className="size-4 animate-spin text-amber-400"
                                aria-hidden="true"
                              />
                            ) : (
                              <AudioLines className="size-4" aria-hidden="true" />
                            )}
                            Izrezek MP3
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={clipBusy !== null}
                            onClick={() => void handleClipShare(line, 'video')}
                            className="focus:bg-zinc-800 focus:text-amber-300"
                          >
                            {clipBusy?.lineId === line.id && clipBusy.kind === 'video' ? (
                              <Loader2
                                className="size-4 animate-spin text-amber-400"
                                aria-hidden="true"
                              />
                            ) : (
                              <Clapperboard className="size-4" aria-hidden="true" />
                            )}
                            <span className="flex min-w-0 flex-col">
                              <span>Izrezek MP4 — 9:16</span>
                              <span className="text-[11px] text-zinc-400">
                                TikTok/Reels · generiranje 5–30 s
                              </span>
                            </span>
                          </DropdownMenuItem>
                          {line.chapter && (
                            <DropdownMenuItem
                              disabled={clipBusy !== null || chapterIndexOf(line.chapter) < 0}
                              onSelect={(e) => e.preventDefault()}
                              onClick={() => void handleClipShare(line, 'chapter')}
                              className="focus:bg-zinc-800 focus:text-amber-300"
                            >
                              {clipBusy?.lineId === line.id && clipBusy.kind === 'chapter' ? (
                                <Loader2
                                  className="size-4 animate-spin text-amber-400"
                                  aria-hidden="true"
                                />
                              ) : (
                                <BookOpen className="size-4" aria-hidden="true" />
                              )}
                              <span className="flex min-w-0 flex-col">
                                <span>Izrezek poglavja MP3</span>
                                <span className="text-[11px] text-zinc-400">{line.chapter}</span>
                              </span>
                            </DropdownMenuItem>
                          )}
                          {line.chapter && (
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger
                                disabled={clipBusy !== null || chapterIndexOf(line.chapter) < 0}
                                className="focus:bg-zinc-800 focus:text-amber-300 data-[state=open]:bg-zinc-800"
                              >
                                {clipBusy?.lineId === line.id && clipBusy.kind === 'chapterVideo' ? (
                                  <Loader2
                                    className="size-4 animate-spin text-amber-400"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <Clapperboard className="size-4" aria-hidden="true" />
                                )}
                                <span className="flex min-w-0 flex-col">
                                  <span>Shorts MP4 — podnapisi</span>
                                  <span className="text-[11px] text-zinc-400">
                                    TikTok/Reels · {line.chapter} · 3 stili · 5–40 s
                                  </span>
                                </span>
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent className="border-zinc-700 bg-zinc-900 text-zinc-100">
                                {(
                                  [
                                    { style: 'klasika', label: 'Klasika', desc: 'belo + črni obrobni', Icon: Captions },
                                    { style: 'okvir', label: 'TikTok okvir', desc: 'belo na črnem kvadru', Icon: CaptionsOff },
                                    { style: 'poudarek', label: 'Rumeni poudarek', desc: 'rumeno + debelejša obroba', Icon: Highlighter },
                                  ] as const
                                ).map(({ style, label, desc, Icon }) => (
                                  <DropdownMenuItem
                                    key={style}
                                    disabled={clipBusy !== null}
                                    onSelect={(e) => e.preventDefault()}
                                    onClick={() => void handleClipShare(line, 'chapterVideo', style)}
                                    className="focus:bg-zinc-800 focus:text-amber-300"
                                  >
                                    <Icon className="size-4" aria-hidden="true" />
                                    <span className="flex min-w-0 flex-col">
                                      <span>{label}</span>
                                      <span className="text-[11px] text-zinc-400">{desc}</span>
                                    </span>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                          )}
                          <DropdownMenuItem
                            disabled={clipBusy !== null}
                            onClick={() => void handleQuoteCard(line)}
                            className="focus:bg-zinc-800 focus:text-amber-300"
                          >
                            <Quote className="size-4" aria-hidden="true" />
                            Citatna kartica (PNG)
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={clipBusy !== null}
                            onClick={() => void handleCopyQuote(line)}
                            className="focus:bg-zinc-800 focus:text-amber-300"
                          >
                            <Copy className="size-4" aria-hidden="true" />
                            Kopiraj besedilo
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    {isSaving ? (
                      <Loader2
                        className="size-4 animate-spin text-amber-400"
                        aria-hidden="true"
                      />
                    ) : hasError ? (
                      <>
                        <TriangleAlert className="size-4 text-red-500" aria-hidden="true" />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-zinc-400 hover:bg-red-500/10 hover:text-red-400"
                          aria-label="Poskusi znova"
                          disabled={isRetrying}
                          onClick={(e) => {
                            e.stopPropagation();
                            void retryLine(line.id);
                          }}
                        >
                          {isRetrying ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="size-3.5" />
                          )}
                        </Button>
                      </>
                    ) : line.audioPath ? (
                      isActive ? (
                        <Equalizer active={playing} bars={4} className="h-4" />
                      ) : (
                        <Check className="size-4 text-emerald-500" aria-hidden="true" />
                      )
                    ) : (
                      <Loader2
                        className="size-4 animate-spin text-zinc-600"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                </motion.li>
                {insertAfter?.lineId === line.id && (
                  <li className="list-none" aria-label="Vstavljanje nove vrstice">
                    {renderInsertComposer()}
                  </li>
                )}
                </Fragment>
              );
            })}
          </ol>

          {/* Kompozitor na koncu scenarija (vstavljanje na konec) */}
          {insertAfter && insertAfter.lineId === null && (
            <div className="mt-2">{renderInsertComposer()}</div>
          )}

          {/* Dodajanje vrstice na konec scenarija (skrito, kadar je kompozitor že odprt tam) */}
          {insertAfter?.lineId !== null && (
            <Button
              variant="outline"
              className="mt-3 w-full gap-2 rounded-xl border-dashed border-zinc-800 bg-transparent text-zinc-500 hover:border-amber-500/40 hover:bg-amber-500/5 hover:text-amber-300"
              onClick={() =>
                startInsert(
                  null,
                  lines[lines.length - 1]?.speaker ?? episode.hosts[0]?.name ?? 'Rok',
                )
              }
            >
              <Plus className="size-4" aria-hidden="true" />
              Dodaj vrstico na konec
            </Button>
          )}

          {/* Vprašaj voditelja (interaktivni način) */}
          <AskHostsCard onAsk={handleAskHosts} />
        </section>
          </TabsContent>

          <TabsContent value="zapiski" className="mt-4">
            {episode.summary ? (
              <ShowNotesPanel summary={episode.summary} />
            ) : (
              <p className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-6 text-sm leading-relaxed text-zinc-400">
                Za to epizodo ni zapiskov. Povzetek, ključne točke in oznake nastanejo, ko
                epizodo ustvariš iz teme ali vira (AI scenarij).
              </p>
            )}
          </TabsContent>

          <TabsContent value="dramaturgija" className="mt-4">
            {dramaAnalysis ? (
              <Card className="border-zinc-800/80 bg-zinc-900/30">
                <CardContent className="p-4 sm:p-6">
                  <DramaturgyReport analysis={dramaAnalysis} realSeconds={totalDuration} />
                </CardContent>
              </Card>
            ) : (
              <p className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-6 text-sm leading-relaxed text-zinc-400">
                Dramaturgija bo na voljo, ko epizoda dobi vrstice scenarija.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <PlayerBar
        title={episode.title}
        playing={playing}
        jinglePhase={jinglePhase}
        hasAudio={readyCount > 0}
        elapsed={elapsed}
        total={totalDuration}
        rate={rate}
        muted={muted}
        volume={volume}
        onVolumeChange={changeVolume}
        sleepRemainingMs={sleepRemainingMs}
        sleepMode={
          sleepTimer === null
            ? 'off'
            : sleepTimer.mode === 'episode'
              ? 'episode'
              : (String(sleepTimer.totalMs / 60000) as SleepTimerChoice)
        }
        onSetSleepTimer={handleSetSleepTimer}
        onTogglePlay={togglePlay}
        onPrevLine={playPrevLine}
        onNextLine={playNextLine}
        onSkip={skipSeconds}
        onRateChange={changeRate}
        onToggleMute={toggleMute}
        waveform={waveformBars}
        onSeekMs={seekToGlobalMs}
        onWaveformScrub={(active) => {
          waveformScrubRef.current = active;
        }}
      />

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <ShareDialog
        episodeId={episode.id}
        episodeTitle={episode.title}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />

      {/* Potrditev brisanja vrstice (trajna sprememba — besedilo + zvok) */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Izbriši vrstico?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              {deleteTarget
                ? `„${deleteTarget.line.text.length > 120 ? `${deleteTarget.line.text.slice(0, 120)}…` : deleteTarget.line.text}" — ${deleteTarget.line.speaker}`
                : ''}
              <br />
              Besedilo in sintetiziran zvok vrstice bosta TRAJNO izbrisana. Izvoz in
              izrezki se ob naslednjem klicu znova izdelajo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="border-zinc-700 hover:bg-zinc-800">
              Prekliči
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault(); // dialog zapremo šele po uspehu
                void handleConfirmDelete();
              }}
              className="bg-red-600 text-white hover:bg-red-500 focus-visible:ring-red-500/40"
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
              Izbriši
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
