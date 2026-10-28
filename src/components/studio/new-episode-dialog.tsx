'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  CircleCheck,
  ClipboardPaste,
  Clock,
  FileText,
  Info,
  Link2,
  ListChecks,
  Loader2,
  PenLine,
  Play,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  createEpisode,
  createEpisodeFromScript,
  fetchTtsPreview,
  type CreateEpisodeInput,
} from '@/lib/podcast-client';
import { activatePan, setElementPan } from '@/lib/audio-pan';
import { panForVoice } from '@/lib/podcast-pan';
import { parseScript, SCRIPT_LIMITS } from '@/lib/script-parser';
import {
  analyzeScript,
  formatDuration,
  readTargetSeconds,
  writeTargetSeconds,
} from '@/lib/script-analysis';
import { SCRIPT_TEMPLATES, type ScriptTemplate } from '@/lib/script-templates';
import {
  EPISODE_LENGTHS,
  STYLE_OPTIONS,
  VOICES,
  hostColor,
  type Episode,
  type EpisodeLength,
  type EpisodeStyle,
  type Language,
  type SourceType,
  type VoiceId,
} from '@/lib/podcast-types';
import { cn } from '@/lib/utils';
import { TargetDeltaLine, TargetDurationRow } from './target-duration';

const TOPIC_SUGGESTIONS = [
  'Zakaj je nebo modro?',
  'Zgodovina piratov',
  'Kako deluje človeški možgani?',
  'Prihodnost vesoljskih potovanj',
];

const SOURCE_OPTIONS: { value: SourceType; label: string; icon: typeof Sparkles }[] = [
  { value: 'topic', label: 'Tema', icon: Sparkles },
  { value: 'url', label: 'Povezava', icon: Link2 },
  { value: 'text', label: 'Besedilo', icon: ClipboardPaste },
];

const SUBMITTING_LABELS: Record<Exclude<SourceType, 'script'>, string> = {
  topic: 'AI piše scenarij … (do 30 s)',
  url: 'AI bere članek in piše scenarij … (do 60 s)',
  text: 'AI piše scenarij iz besedila …',
};

const SCRIPT_PLACEHOLDER = `Rok: Živjo, dobrodošli v podcastu!
Matej: Živjo! Danes govoriva o …

## Naslov poglavja
Rok: In zdaj pa glavna tema …`;

const SAMPLE_SCRIPT = `Rok: Živjo in dobrodošli nazaj! Danes pa imava temo, ki deli ljudi bolj kot ananas na pici.
Petra: O ne, spet ti. Saj veš, da je ananas na pici popolnoma v redu?
Rok: Ma daj! Tvojega mnenja ne bom niti komentiral. Ampak daj, prepričaj me.

## Največja debata
Petra: Predstavljaj si, da naročiš pico, prijedelka topla, sir se trese, in potem – bum – ananas.
Rok: Nočna mora! Sladko in slano skupaj? To pač ne gre skupaj.
Petra: Sej tudi slanikova rolka ima sladko slivo, pa je nihče ne graja.
Rok: … dobro, točko si zadel. Ampak še vedno: klasična marinara ali nič!

## Zaključek
Petra: In to, dragi poslušalci, je razlog, zakaj ta podcast obstaja – debate brez usmiljenja.
Rok: Prisluhnite naslednjič, ko bova argumentirala o kuumi. Se vidimo!`;

type DialogMode = 'script' | 'ai';

const MODE_OPTIONS: { value: DialogMode; label: string; desc: string; icon: typeof Sparkles }[] = [
  { value: 'script', label: 'Moja skripta', desc: 'brez AI · brezplačno', icon: PenLine },
  { value: 'ai', label: 'AI scenarij', desc: 'AI napiše dialog', icon: Sparkles },
];

interface NewEpisodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (episode: Episode) => void;
}

export function NewEpisodeDialog({ open, onOpenChange, onCreated }: NewEpisodeDialogProps) {
  const [mode, setMode] = useState<DialogMode>('script');

  // --- način: MOJA SKRIPTA (brez AI, brezplačno) ---
  const [scriptTitle, setScriptTitle] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [scriptVoices, setScriptVoices] = useState<Record<string, VoiceId>>({});
  const parsed = useMemo(() => parseScript(scriptText), [scriptText]);
  const analysis = useMemo(() => analyzeScript(parsed), [parsed]);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  // Ciljno trajanje (Task 47) — ista izbira kot v tabu Dramaturgija studia.
  // Dialog je montiran od začetka, zato stanje OBOŽIMO ob vsakem odprtju
  // (v studiu lahko uporabnik cilj medtem spremeni).
  const [targetSec, setTargetSec] = useState<number | null>(() => readTargetSeconds());
  useEffect(() => {
    if (open) setTargetSec(readTargetSeconds());
  }, [open]);
  const scriptValid =
    scriptText.trim().length >= SCRIPT_LIMITS.minChars &&
    parsed.lines.length >= SCRIPT_LIMITS.minLines;

  // --- način: AI SCENARIJ ---
  const [source, setSource] = useState<SourceType>('topic');
  const [topic, setTopic] = useState('');
  const [url, setUrl] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [length, setLength] = useState<EpisodeLength>('medium');
  const [focus, setFocus] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [style, setStyle] = useState<EpisodeStyle>('interview');
  const [language, setLanguage] = useState<Language>('sl');
  // Tretji udeleženec — gost Srečko iz Hrvaške (Task 64, hr-HR-SreckoNeural).
  const [withGuest, setWithGuest] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState<VoiceId | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState<VoiceId | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  // Ustavi predogled ob zaprtju pogovornega okna in ob odmontiranju.
  useEffect(() => {
    if (!open) {
      previewRef.current?.pause();
      previewRef.current = null;
      setPreviewPlaying(null);
      setPreviewLoading(null);
    }
  }, [open]);

  useEffect(() => {
    return () => previewRef.current?.pause();
  }, []);

  const sourceValueValid =
    source === 'topic'
      ? topic.trim().length >= 3
      : source === 'url'
        ? /^https?:\/\/\S+/i.test(url.trim())
        : sourceText.trim().length >= 100;
  const canSubmit = !submitting && (mode === 'script' ? scriptValid : sourceValueValid);

  const handlePreview = async (voice: VoiceId) => {
    if (previewLoading) return;
    previewRef.current?.pause();
    previewRef.current = null;
    setPreviewPlaying(null);
    setPreviewLoading(voice);
    try {
      const audioPath = await fetchTtsPreview(voice);
      const audio = new Audio(audioPath);
      previewRef.current = audio;
      /*
       * Stereo umestitev tudi v predogledu (Task 29 — backlog iz 28): privzeti
       * duo (Rok/Petra) zveni na isti strani kot bo v epizodi. Klik = gesture
       * → activatePan() omogoči resume; če kontekst ne teče, element ostane
       * neroutiran (sredinsko) — nikoli tiho (varnostni model iz Task 28).
       */
      activatePan();
      setElementPan(audio, panForVoice(voice));
      audio.addEventListener('ended', () => {
        setPreviewPlaying((current) => (current === voice ? null : current));
      });
      await audio.play().catch(() => {});
      setPreviewPlaying(voice);
    } catch {
      toast.error('Predogled glasu ni uspel. Poskusi znova.');
    } finally {
      setPreviewLoading(null);
    }
  };

  /** Vstavi profesionalno šablono (Task 40): besedilo + naslov, če je prazen. */
  const applyTemplate = (template: ScriptTemplate) => {
    setScriptText(template.script);
    if (!scriptTitle.trim()) setScriptTitle(template.title);
    toast.success(`Šablona vstavljena: ${template.name}`);
  };

  const handleScriptSubmit = async () => {
    if (!scriptValid || submitting) {
      toast.error('Skripta mora imeti vsaj 2 vrstici dialoga (oblika „Ime: besedilo“).');
      return;
    }
    setSubmitting(true);
    try {
      // Pošlji le izbrane glasove (ostali dobijo privzeti cikel na strežniku).
      const chosen: Record<string, VoiceId> = {};
      for (const [speaker, voice] of Object.entries(scriptVoices)) {
        if (parsed.speakers.includes(speaker) && voice) chosen[speaker] = voice;
      }
      const episode = await createEpisodeFromScript({
        title: scriptTitle.trim() || undefined,
        scriptText: scriptText.trim(),
        voices: Object.keys(chosen).length > 0 ? chosen : undefined,
      });
      toast.success('Skripta je pripravljena — glasovi se generirajo v studiu 🎙️');
      onCreated(episode);
      setScriptTitle('');
      setScriptText('');
      setScriptVoices({});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ustvarjanje epizode ni uspelo.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAiSubmit = async () => {
    if (!sourceValueValid || submitting) return;

    // Prijazna validacija aktivnega vira (toast namesto tihega gumba).
    if (source === 'topic' && topic.trim().length < 3) {
      toast.error('Tema mora imeti vsaj 3 znake.');
      return;
    }
    if (source === 'url' && !/^https?:\/\/\S+/i.test(url.trim())) {
      toast.error('Vpiši veljavno povezavo, ki se začne s https:// …');
      return;
    }
    if (source === 'text' && sourceText.trim().length < 100) {
      toast.error('Besedilo mora imeti vsaj 100 znakov.');
      return;
    }

    setSubmitting(true);
    try {
      const payload: CreateEpisodeInput = { style, language, length, withGuest };
      if (source === 'topic') payload.topic = topic.trim();
      else if (source === 'url') payload.url = url.trim();
      else payload.sourceText = sourceText.trim();
      const trimmedFocus = focus.trim();
      if (trimmedFocus) payload.focus = trimmedFocus;

      const episode = await createEpisode(payload);
      toast.success('Scenarij je napisan! 🎙️');
      onCreated(episode);
      setSource('topic');
      setTopic('');
      setUrl('');
      setSourceText('');
      setLength('medium');
      setFocus('');
      setAdvancedOpen(false);
      setStyle('interview');
      setLanguage('sl');
      setWithGuest(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ustvarjanje epizode ni uspelo.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = () => (mode === 'script' ? handleScriptSubmit() : handleAiSubmit());

  const voiceForSpeaker = (speaker: string, index: number): VoiceId =>
    scriptVoices[speaker] ??
    (['rok', 'petra', 'rok', 'petra'][index % 4] as VoiceId);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next);
      }}
    >
      <DialogContent
        className="max-h-[85vh] overflow-y-auto border-zinc-800 bg-zinc-950 text-zinc-100"
        onEscapeKeyDown={(e) => {
          if (submitting) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (submitting) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (submitting) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-zinc-100">Nova epizoda</DialogTitle>
          <DialogDescription className="text-zinc-400">
            {mode === 'script'
              ? 'Napiši ali prilepi lastno skripto — zvok generira lokalni glas. 100 % brezplačno, brez AI.'
              : 'AI napiše scenarij in posodi glase.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Način: Moja skripta (privzeto, brezplačno) / AI scenarij */}
          <div className="grid grid-cols-2 gap-2">
            {MODE_OPTIONS.map((option) => {
              const selected = mode === option.value;
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={submitting}
                  onClick={() => setMode(option.value)}
                  aria-pressed={selected}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-all disabled:pointer-events-none disabled:opacity-50',
                    selected
                      ? 'border-amber-500/60 bg-amber-500/10 ring-2 ring-amber-500/30'
                      : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700',
                  )}
                >
                  <span
                    className={cn(
                      'flex items-center gap-1.5 text-sm font-semibold',
                      selected ? 'text-amber-300' : 'text-zinc-200',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    {option.label}
                  </span>
                  <span
                    className={cn(
                      'mt-0.5 block text-xs',
                      selected && option.value === 'script'
                        ? 'text-emerald-400'
                        : 'text-zinc-400',
                    )}
                  >
                    {option.desc}
                  </span>
                </button>
              );
            })}
          </div>

          {mode === 'script' ? (
            <>
              {/* Naslov (neobvezno) */}
              <div className="space-y-2">
                <Label htmlFor="script-title" className="text-zinc-300">
                  Naslov <span className="font-normal text-zinc-400">(neobvezno)</span>
                </Label>
                <Input
                  id="script-title"
                  value={scriptTitle}
                  onChange={(e) => setScriptTitle(e.target.value)}
                  maxLength={120}
                  placeholder="npr. Ananas na pici: zločin ali genij?"
                  disabled={submitting}
                  className="border-zinc-800 bg-zinc-900/60 text-zinc-100 placeholder:text-zinc-400 focus-visible:border-amber-500/50 focus-visible:ring-amber-500/20"
                />
              </div>

              {/* Skripta */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="script-text" className="text-zinc-300">
                    Skripta
                  </Label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        disabled={submitting}
                        className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-300 disabled:pointer-events-none disabled:opacity-50"
                      >
                        <BookOpen className="mr-1 inline size-3" aria-hidden="true" />
                        Profesionalne šablone
                        <ChevronDown className="ml-0.5 inline size-3" aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-80">
                      <DropdownMenuLabel>Celotne skripte — brez AI</DropdownMenuLabel>
                      {SCRIPT_TEMPLATES.map((template) => (
                        <DropdownMenuItem key={template.id} onSelect={() => applyTemplate(template)}>
                          <span className="flex min-w-0 flex-col gap-0.5 py-0.5">
                            <span className="text-sm font-medium text-zinc-100">{template.name}</span>
                            <span className="truncate text-xs text-zinc-400">{template.desc}</span>
                          </span>
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setScriptText(SAMPLE_SCRIPT)}>
                        <ClipboardPaste className="mr-2 inline size-3.5" aria-hidden="true" />
                        Preprost primer (ananas)
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <Textarea
                  id="script-text"
                  rows={10}
                  value={scriptText}
                  onChange={(e) => setScriptText(e.target.value)}
                  placeholder={SCRIPT_PLACEHOLDER}
                  disabled={submitting}
                  className="resize-y border-zinc-800 bg-zinc-900/60 font-mono text-sm leading-relaxed text-zinc-100 placeholder:font-sans placeholder:text-zinc-400 focus-visible:border-amber-500/50 focus-visible:ring-amber-500/20"
                />
                <p className="text-xs leading-relaxed text-zinc-400">
                  Vsaka vrstica: <code className="text-zinc-400">Ime: besedilo</code>. Vrstica,
                  ki se začne s <code className="text-zinc-400">#</code>, je naslov poglavja.
                  Brez imena = nadaljevanje prejšnjega govorca.
                </p>
                <p
                  className={cn(
                    'text-right text-xs tabular-nums',
                    scriptText.length > SCRIPT_LIMITS.maxChars
                      ? 'text-red-400'
                      : 'text-zinc-400',
                  )}
                >
                  {scriptText.length.toLocaleString('sl-SI')} / {SCRIPT_LIMITS.maxChars.toLocaleString('sl-SI')}
                </p>
              </div>

              {/* Živi povzetek razčlembe */}
              {scriptText.trim().length > 0 && (
                <div
                  className={cn(
                    'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2.5 text-sm',
                    scriptValid
                      ? 'border-emerald-500/30 bg-emerald-500/5'
                      : 'border-zinc-800 bg-zinc-900/40',
                  )}
                  aria-live="polite"
                >
                  <span className={scriptValid ? 'text-emerald-400' : 'text-zinc-400'}>
                    {parsed.lines.length}{' '}
                    {parsed.lines.length === 1 ? 'vrstica' : 'vrstic'}
                  </span>
                  <span className="text-zinc-600">·</span>
                  <span className={parsed.speakers.length > 0 ? 'text-amber-400' : 'text-zinc-400'}>
                    {parsed.speakers.length}{' '}
                    {parsed.speakers.length === 1 ? 'govorec' : 'govorcev'}
                  </span>
                  {parsed.chapterCount > 0 && (
                    <>
                      <span className="text-zinc-600">·</span>
                      <span className="text-violet-400">
                        {parsed.chapterCount}{' '}
                        {parsed.chapterCount === 1 ? 'poglavje' : 'poglavij'}
                      </span>
                    </>
                  )}
                  {!scriptValid && (
                    <span className="text-xs text-zinc-400">
                      (potrebna sta vsaj 2 vrstici „Ime: besedilo“)
                    </span>
                  )}
                  {analysis.words > 0 && (
                    <>
                      <span className="text-zinc-600">·</span>
                      <span
                        className="flex items-center gap-1 text-zinc-400"
                        title="ocena trajanja: govor + premori"
                      >
                        <Clock className="size-3.5" aria-hidden="true" />
                        ≈ {formatDuration(analysis.estimatedSeconds)}
                      </span>
                    </>
                  )}
                </div>
              )}

              {/* Dramaturški pregled — deterministična radijska pravila, brez AI */}
              {scriptText.trim().length > 0 && analysis.checks.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
                  <button
                    type="button"
                    onClick={() => setAnalysisOpen((o) => !o)}
                    aria-expanded={analysisOpen}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-zinc-900/80"
                  >
                    <ListChecks className="size-4 shrink-0 text-zinc-500" aria-hidden="true" />
                    <span className="font-medium text-zinc-300">Dramaturški pregled</span>
                    {analysis.warnings > 0 ? (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                          'bg-amber-500/10 text-amber-400',
                        )}
                      >
                        <TriangleAlert className="size-3" aria-hidden="true" />
                        {analysis.warnings}{' '}
                        {analysis.warnings === 1
                          ? 'opozorilo'
                          : analysis.warnings === 2
                            ? 'opozorili'
                            : 'opozorila'}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">
                        <CircleCheck className="size-3" aria-hidden="true" />
                        uredu
                      </span>
                    )}
                    <ChevronDown
                      className={cn(
                        'ml-auto size-4 shrink-0 text-zinc-500 transition-transform',
                        analysisOpen && 'rotate-180',
                      )}
                      aria-hidden="true"
                    />
                  </button>
                  {analysisOpen && (
                    <div className="space-y-3.5 border-t border-zinc-800 px-3 py-3">
                      {/* Ciljno trajanje — odmik ocene proti izbranemu cilju */}
                      <div className="space-y-2">
                        <TargetDurationRow
                          value={targetSec}
                          onChange={(sec) => {
                            setTargetSec(sec);
                            writeTargetSeconds(sec); // ista izbira tudi v studiu
                          }}
                        />
                        <TargetDeltaLine
                          actualSec={analysis.estimatedSeconds}
                          targetSec={targetSec}
                          sourceHint="Odmik izračunan proti OCENI trajanja (govor + premori)."
                        />
                      </div>

                      <ul className="space-y-2.5">
                        {analysis.checks.map((check) => (
                          <li key={check.id} className="flex gap-2.5">
                            {check.state === 'ok' ? (
                              <CircleCheck
                                className="mt-0.5 size-4 shrink-0 text-emerald-500"
                                aria-hidden="true"
                              />
                            ) : check.state === 'warn' ? (
                              <TriangleAlert
                                className="mt-0.5 size-4 shrink-0 text-amber-500"
                                aria-hidden="true"
                              />
                            ) : (
                              <Info
                                className="mt-0.5 size-4 shrink-0 text-zinc-500"
                                aria-hidden="true"
                              />
                            )}
                            <div className="min-w-0">
                              <p
                                className={cn(
                                  'text-sm font-medium',
                                  check.state === 'ok'
                                    ? 'text-emerald-400'
                                    : check.state === 'warn'
                                      ? 'text-amber-400'
                                      : 'text-zinc-300',
                                )}
                              >
                                {check.title}
                              </p>
                              <p className="text-xs leading-relaxed text-zinc-400">
                                {check.detail}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                      {analysis.balance.length >= 2 && (
                        <div className="space-y-1.5 border-t border-zinc-800/80 pt-3">
                          <p className="text-xs font-medium text-zinc-400">
                            Ravnovesje vrstic
                          </p>
                          {analysis.balance.map((b, i) => (
                            <div key={b.speaker} className="flex items-center gap-2">
                              <span
                                className={cn('size-2 shrink-0 rounded-full', hostColor(i).dot)}
                                aria-hidden="true"
                              />
                              <span className="w-20 shrink-0 truncate text-xs text-zinc-300">
                                {b.speaker}
                              </span>
                              <div
                                className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800"
                                role="img"
                                aria-label={`${b.speaker}: ${Math.round(b.share * 100)} % vrstic`}
                              >
                                <div
                                  className={cn('h-full rounded-full', hostColor(i).dot)}
                                  style={{ width: `${Math.round(b.share * 100)}%` }}
                                />
                              </div>
                              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-zinc-400">
                                {Math.round(b.share * 100)} %
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="border-t border-zinc-800/80 pt-2.5 text-[11px] leading-relaxed text-zinc-400">
                        Pravila so izpeljana iz poklicne radijske dramaturgije — pregled teče
                        lokalno, brez AI modelov.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Glasovi za zaznane govorce */}
              {parsed.speakers.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-zinc-300">Glasovi govorcev</Label>
                  <ul className="space-y-1.5">
                    {parsed.speakers.map((speaker, index) => {
                      const color = hostColor(index);
                      const current = voiceForSpeaker(speaker, index);
                      return (
                        <li
                          key={speaker}
                          className="flex items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2"
                        >
                          <span
                            className={cn('size-2.5 shrink-0 rounded-full', color.dot)}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200">
                            {speaker}
                          </span>
                          <Select
                            value={current}
                            onValueChange={(v) =>
                              setScriptVoices((prev) => ({ ...prev, [speaker]: v as VoiceId }))
                            }
                            disabled={submitting}
                          >
                            <SelectTrigger
                              size="sm"
                              aria-label={`Glas za ${speaker}`}
                              className="w-40 shrink-0 border-zinc-800 bg-zinc-900/60 text-zinc-100"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
                              {(Object.entries(VOICES) as [VoiceId, { name: string; desc: string }][]).map(
                                ([voiceId, voice]) => (
                                  <SelectItem
                                    key={voiceId}
                                    value={voiceId}
                                    className="focus:bg-zinc-800"
                                  >
                                    {voice.name}
                                  </SelectItem>
                                ),
                              )}
                            </SelectContent>
                          </Select>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Vir: tema / povezava / besedilo */}
              <div className="space-y-2">
                <Label className="text-zinc-300">Vir</Label>
                <div className="grid grid-cols-3 gap-2">
                  {SOURCE_OPTIONS.map((option) => {
                    const selected = source === option.value;
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={submitting}
                        onClick={() => setSource(option.value)}
                        aria-pressed={selected}
                        className={cn(
                          'flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50',
                          selected
                            ? 'border-amber-500/60 bg-amber-500/10 text-amber-300 ring-2 ring-amber-500/30'
                            : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-700',
                        )}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                {source === 'topic' && (
                  <div className="space-y-2 pt-1">
                    <Textarea
                      id="topic"
                      rows={3}
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      placeholder="O čem naj bo podcast?"
                      disabled={submitting}
                      className="resize-none border-zinc-800 bg-zinc-900/60 text-zinc-100 placeholder:text-zinc-400 focus-visible:border-amber-500/50 focus-visible:ring-amber-500/20"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {TOPIC_SUGGESTIONS.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          disabled={submitting}
                          onClick={() => setTopic(suggestion)}
                          className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-xs text-zinc-400 transition-colors hover:border-amber-500/50 hover:text-amber-300 disabled:pointer-events-none disabled:opacity-50"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {source === 'url' && (
                  <div className="space-y-2 pt-1">
                    <Input
                      type="url"
                      inputMode="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://… članek, ki ga AI spremeni v podcast"
                      disabled={submitting}
                      className="border-zinc-800 bg-zinc-900/60 text-zinc-100 placeholder:text-zinc-400 focus-visible:border-amber-500/50 focus-visible:ring-amber-500/20"
                    />
                    <p className="text-xs text-zinc-400">
                      AI prebere članek in iz njega napiše epizodo.
                    </p>
                  </div>
                )}

                {source === 'text' && (
                  <div className="space-y-1 pt-1">
                    <Textarea
                      rows={5}
                      value={sourceText}
                      onChange={(e) => setSourceText(e.target.value)}
                      placeholder="Prilepi besedilo (članek, zapiski, transkript …) iz katerega AI napiše epizodo."
                      disabled={submitting}
                      className="resize-none border-zinc-800 bg-zinc-900/60 text-zinc-100 placeholder:text-zinc-400 focus-visible:border-amber-500/50 focus-visible:ring-amber-500/20"
                    />
                    <p
                      className={cn(
                        'text-right text-xs tabular-nums',
                        sourceText.trim().length >= 100 ? 'text-emerald-500' : 'text-zinc-400',
                      )}
                    >
                      {sourceText.trim().length} znakov / min. 100
                    </p>
                  </div>
                )}
              </div>

              {/* Dolžina */}
              <div className="space-y-2">
                <Label className="text-zinc-300">Dolžina</Label>
                <div className="grid grid-cols-3 gap-2">
                  {EPISODE_LENGTHS.map((option) => {
                    const selected = length === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={submitting}
                        onClick={() => setLength(option.value)}
                        aria-pressed={selected}
                        className={cn(
                          'rounded-lg border p-3 text-left transition-all disabled:pointer-events-none disabled:opacity-50',
                          selected
                            ? 'border-amber-500/60 bg-amber-500/10 ring-2 ring-amber-500/30'
                            : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700',
                        )}
                      >
                        <span
                          className={cn(
                            'flex items-center gap-1 text-sm font-semibold',
                            selected ? 'text-amber-300' : 'text-zinc-200',
                          )}
                        >
                          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-zinc-400">
                          {option.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Dodatna navodila (fokus) — neobvezno */}
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setAdvancedOpen((prev) => !prev)}
                  aria-expanded={advancedOpen}
                  className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-400 uppercase transition-colors hover:text-amber-300 disabled:pointer-events-none disabled:opacity-50"
                >
                  <ChevronDown
                    className={cn('size-3.5 transition-transform', advancedOpen && 'rotate-180')}
                    aria-hidden="true"
                  />
                  Napredno
                </button>
                {advancedOpen && (
                  <div className="space-y-1">
                    <Textarea
                      rows={2}
                      value={focus}
                      onChange={(e) => setFocus(e.target.value)}
                      maxLength={2000}
                      placeholder="npr. naj bo tekmovalno, ali: poudari zgodovino, ne tehnikalij"
                      disabled={submitting}
                      className="resize-none border-zinc-800 bg-zinc-900/60 text-sm text-zinc-100 placeholder:text-zinc-400 focus-visible:border-amber-500/50 focus-visible:ring-amber-500/20"
                    />
                    <p className="text-right text-xs tabular-nums text-zinc-400">{focus.length} / 2000</p>
                  </div>
                )}
              </div>

              {/* Stil */}
              <div className="space-y-2">
                <Label className="text-zinc-300">Stil</Label>
                <div className="grid grid-cols-2 gap-2">
                  {STYLE_OPTIONS.map((option) => {
                    const selected = style === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        disabled={submitting}
                        onClick={() => setStyle(option.value)}
                        aria-pressed={selected}
                        className={cn(
                          'rounded-lg border p-3 text-left transition-all disabled:pointer-events-none disabled:opacity-50',
                          selected
                            ? 'border-amber-500/60 bg-amber-500/10 ring-2 ring-amber-500/30'
                            : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700',
                        )}
                      >
                        <span
                          className={cn(
                            'block text-sm font-semibold',
                            selected ? 'text-amber-300' : 'text-zinc-200',
                          )}
                        >
                          {option.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-zinc-400">
                          {option.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Jezik */}
              <div className="space-y-2">
                <Label htmlFor="language" className="text-zinc-300">
                  Jezik
                </Label>
                <Select
                  value={language}
                  onValueChange={(v) => setLanguage(v as Language)}
                  disabled={submitting}
                >
                  <SelectTrigger
                    id="language"
                    className="w-full border-zinc-800 bg-zinc-900/60 text-zinc-100"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
                    <SelectItem value="sl" className="focus:bg-zinc-800">
                      🇸🇮 Slovenščina
                    </SelectItem>
                    <SelectItem value="en" className="focus:bg-zinc-800">
                      🇬🇧 English
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Gost iz Hrvaške — tretji udeleženec (Task 64) */}
              <button
                type="button"
                disabled={submitting}
                onClick={() => setWithGuest((prev) => !prev)}
                aria-pressed={withGuest}
                aria-label="Gost iz Hrvaške — dodaj Srečka kot tretjega udeleženca"
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-all disabled:pointer-events-none disabled:opacity-50',
                  withGuest
                    ? 'border-amber-500/60 bg-amber-500/10 ring-2 ring-amber-500/30'
                    : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700',
                )}
              >
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block text-sm font-semibold',
                      withGuest ? 'text-amber-300' : 'text-zinc-200',
                    )}
                  >
                    Gost iz Hrvaške
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-zinc-400">
                    Tretji udeleženec Srečko (rahel hrvaški naglas) — okoli četrtine vrstic
                  </span>
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
                    withGuest
                      ? 'bg-amber-500/15 text-amber-400'
                      : 'bg-zinc-800 text-zinc-400',
                  )}
                  aria-hidden="true"
                >
                  {withGuest ? 'vklopljen' : 'izklopljen'}
                </span>
              </button>
            </>
          )}

          {/* Glasi — predogled (uporabno v obeh načinih) */}
          <div className="space-y-2">
            <Label className="text-zinc-300">Glasi</Label>
            <p className="text-xs text-zinc-400">
              Poslušaj razpoložljive glasove — v slušalkah sta privzeta voditelja rahlo umestjena (Rok levo, Petra desno)
            </p>
            <ul className="space-y-1.5">
              {(Object.entries(VOICES) as [VoiceId, { name: string; desc: string }][]).map(
                ([voiceId, voice]) => {
                  const isLoading = previewLoading === voiceId;
                  const isPlaying = previewPlaying === voiceId;
                  return (
                    <li
                      key={voiceId}
                      className="flex items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2"
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 rounded-full text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
                        onClick={() => void handlePreview(voiceId)}
                        disabled={previewLoading !== null || submitting}
                        aria-label={`Predogled glasu ${voice.name}`}
                      >
                        {isLoading ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Play className="size-3.5 fill-current" />
                        )}
                      </Button>
                      <div className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-zinc-200">
                          {voice.name}
                        </span>
                        <span className="block text-xs text-zinc-400">{voice.desc}</span>
                      </div>
                      {isPlaying && <span className="text-xs text-amber-400">predvajam …</span>}
                    </li>
                  );
                },
              )}
            </ul>
          </div>

          <Button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="h-11 w-full bg-gradient-to-r from-amber-500 to-orange-600 text-base font-semibold text-white shadow-lg shadow-orange-950/40 hover:from-amber-400 hover:to-orange-500"
          >
            {submitting ? (
              mode === 'script' ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Pripravljam vrstice …
                </>
              ) : (
                <>
                  <Loader2 className="size-4 animate-spin" /> {SUBMITTING_LABELS[source]}
                </>
              )
            ) : mode === 'script' ? (
              <>
                <FileText className="size-4" /> Ustvari epizodo iz skripte
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> Ustvari epizodo
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
