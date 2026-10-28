'use client';

import { useState } from 'react';
import {
  Check,
  ListEnd,
  Moon,
  Music,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Timer,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { Equalizer } from './equalizer';
import { Waveform } from './waveform';

const RATES = [0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const;
const SKIP_SECONDS = 10;

/** Izbira ure za spanje: izklop, pavza na koncu epizode ali odštevalnik v minutah. */
export type SleepTimerChoice = 'off' | 'episode' | '5' | '10' | '15' | '30';

const SLEEP_OPTIONS: { value: SleepTimerChoice; label: string; Icon: LucideIcon }[] = [
  { value: 'off', label: 'Izključeno', Icon: X },
  { value: 'episode', label: 'Konec epizode', Icon: ListEnd },
  { value: '5', label: '5 min', Icon: Timer },
  { value: '10', label: '10 min', Icon: Timer },
  { value: '15', label: '15 min', Icon: Timer },
  { value: '30', label: '30 min', Icon: Timer },
];

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(safe / 3600);
  const m = String(Math.floor((safe % 3600) / 60)).padStart(h > 0 ? 2 : 1, '0');
  const s = String(safe % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

interface PlayerBarProps {
  title: string;
  playing: boolean;
  /** Tekoča jingle faza (Task 30): 'intro' = uvodna melodija, 'outro' = zaključna. */
  jinglePhase?: 'intro' | 'outro' | null;
  hasAudio: boolean;
  elapsed: number;
  total: number;
  rate: number;
  muted: boolean;
  /** Preostanek ure za spanje v ms (null = odštevalnik ne teče). */
  sleepRemainingMs: number | null;
  /** Trenutno izbrana možnost ure za spanje (za označbo v meniju). */
  sleepMode?: SleepTimerChoice;
  onSetSleepTimer: (option: SleepTimerChoice) => void;
  onTogglePlay: () => void;
  onPrevLine: () => void;
  onNextLine: () => void;
  onSkip: (seconds: number) => void;
  onRateChange: (rate: number) => void;
  onToggleMute: () => void;
  /**
   * Oblika valovanja (Task 42): stolpci vrhov 0..1 za mini-mapo. `null` =
   * pade nazaj na navaden drsnik (podatki še ne znani / napaka).
   */
  waveform?: number[] | null;
  /** Skok na globalni čas (ms) — klik/vleci obliki valovanja. */
  onSeekMs?: (ms: number) => void;
  /** Začetek/konec vlečenja valovanja (Task 54) — za scrub-guard v studiu. */
  onWaveformScrub?: (active: boolean) => void;
}

/** Gumb za skok naprej/nazaj 10 s (podcast standard, stil Pocket Casts/Snipd). */
function SkipButton({
  forward,
  onClick,
  disabled,
}: {
  forward: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  const Icon = forward ? RotateCw : RotateCcw;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="relative size-10 text-zinc-400 hover:bg-zinc-800 hover:text-white"
      onClick={onClick}
      disabled={disabled}
      aria-label={forward ? `Naprej ${SKIP_SECONDS} sekund` : `Nazaj ${SKIP_SECONDS} sekund`}
      title={forward ? `Naprej ${SKIP_SECONDS} s (→)` : `Nazaj ${SKIP_SECONDS} s (←)`}
    >
      <Icon className={cn('size-[18px]', forward && '-scale-x-100')} aria-hidden="true" />
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[7px] font-bold tracking-tight">
        {SKIP_SECONDS}
      </span>
    </Button>
  );
}

/** Gumb ura za spanje (Moon) z odštevalnikom in menijskim izborom (Pocket Casts stil). */
function SleepTimerButton({
  activeOption,
  remainingMs,
  onSelect,
}: {
  activeOption: SleepTimerChoice | null;
  remainingMs: number | null;
  onSelect: (option: SleepTimerChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = activeOption !== null && activeOption !== 'off';
  const title =
    remainingMs !== null
      ? `Ura za spanje: še ${formatTime(remainingMs / 1000)}`
      : active
        ? 'Ura za spanje: pavza na koncu epizode'
        : 'Ura za spanje';
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'relative size-10 text-zinc-400 hover:bg-zinc-800 hover:text-white',
            active && 'text-amber-400 hover:text-amber-300',
          )}
          aria-label="Ura za spanje"
          aria-expanded={open}
          title={title}
        >
          <Moon className="size-4" aria-hidden="true" />
          {remainingMs !== null && (
            <span className="pointer-events-none absolute right-0.5 bottom-0.5 text-[9px] leading-none font-semibold tabular-nums text-amber-400">
              {formatTime(remainingMs / 1000)}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className="w-44 border-zinc-800 bg-zinc-900 p-1.5 shadow-xl shadow-black/40"
      >
        <div role="menu" aria-label="Možnosti ure za spanje" className="flex flex-col gap-0.5">
          {SLEEP_OPTIONS.map(({ value, label, Icon }) => {
            const isActive = activeOption === value;
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => {
                  onSelect(value);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors',
                  isActive
                    ? 'bg-amber-500/15 text-amber-400'
                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-white',
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">{label}</span>
                {isActive && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Lepljiv spodnji predvajalnik (karaoke stil). Na mobitelu se napredek
 * zaviha v svojo vrstico, tipke za predvajanje pa ostanejo na prvi.
 */
export function PlayerBar({
  title,
  playing,
  jinglePhase = null,
  hasAudio,
  elapsed,
  total,
  rate,
  muted,
  sleepRemainingMs,
  sleepMode,
  onSetSleepTimer,
  onTogglePlay,
  onPrevLine,
  onNextLine,
  onSkip,
  onRateChange,
  onToggleMute,
  waveform = null,
  onSeekMs,
  onWaveformScrub,
}: PlayerBarProps) {
  const max = total > 0 ? total : 100;
  const value = Math.min(elapsed, max);
  const showWaveform = Boolean(waveform && waveform.length > 8 && onSeekMs && total > 0);

  return (
    <section
      aria-label="Predvajalnik"
      className="sticky bottom-0 z-40 border-t border-zinc-800 bg-zinc-900/90 backdrop-blur"
    >
      <div
        className={cn(
          'mx-auto w-full max-w-5xl px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
          !hasAudio && 'pointer-events-none opacity-50 select-none',
        )}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Tipke za upravljanje predvajanja */}
          <div className="flex items-center gap-0.5 sm:gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-10 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              onClick={onPrevLine}
              disabled={!hasAudio}
              aria-label="Prejšnja vrstica"
              title="Prejšnja vrstica"
            >
              <SkipBack className="size-4" />
            </Button>
            <SkipButton forward={false} onClick={() => onSkip(-SKIP_SECONDS)} disabled={!hasAudio} />
            <button
              type="button"
              onClick={onTogglePlay}
              disabled={!hasAudio}
              aria-label={playing ? 'Ustavi predvajanje' : 'Predvajaj'}
              title={playing ? 'Ustavi (preslednica)' : 'Predvajaj (preslednica)'}
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-amber-400 to-orange-600 text-white shadow-lg shadow-orange-950/50 transition-all hover:from-amber-300 hover:to-orange-500 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
            >
              {playing ? (
                <Pause className="size-5 fill-current" />
              ) : (
                <Play className="size-5 translate-x-px fill-current" />
              )}
            </button>
            <SkipButton forward onClick={() => onSkip(SKIP_SECONDS)} disabled={!hasAudio} />
            <Button
              variant="ghost"
              size="icon"
              className="size-10 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              onClick={onNextLine}
              disabled={!hasAudio}
              aria-label="Naslednja vrstica"
              title="Naslednja vrstica"
            >
              <SkipForward className="size-4" />
            </Button>
          </div>

          {/* Naslov + napredek (na mobitelu lastna vrstica čez celo širino) */}
          <div className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
            <div className="flex items-center gap-2">
              {playing && <Equalizer active bars={3} className="h-3 shrink-0" />}
              <p className="truncate text-xs font-medium text-zinc-300">{title}</p>
              {jinglePhase !== null && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400"
                  aria-label={jinglePhase === 'intro' ? 'Predvaja se uvodna melodija' : 'Predvaja se zaključna melodija'}
                >
                  <Music className="size-3" aria-hidden="true" />
                  {jinglePhase === 'intro' ? 'uvodna melodija' : 'zaključna melodija'}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-3">
              {showWaveform ? (
                /* Oblika valovanja (Task 42): mini-map z klikom/vlečenjem = skok. */
                <Waveform
                  bars={waveform as number[]}
                  progress={max > 0 ? Math.min(1, Math.max(0, value / max)) : 0}
                  onSeekFraction={(fraction) => onSeekMs?.(Math.round(fraction * total * 1000))}
                  onScrubChange={onWaveformScrub}
                  disabled={!hasAudio}
                />
              ) : (
                <Slider
                  value={[value]}
                  max={max}
                  step={0.1}
                  disabled={!hasAudio}
                  aria-label="Napredek predvajanja"
                  className="flex-1 cursor-default [&_[data-slot=slider-range]]:bg-gradient-to-r [&_[data-slot=slider-range]]:from-amber-500 [&_[data-slot=slider-range]]:to-orange-600 [&_[data-slot=slider-thumb]]:border-amber-500 [&_[data-slot=slider-thumb]]:bg-zinc-950 [&_[data-slot=slider-track]]:bg-zinc-800"
                />
              )}
              <span className="shrink-0 text-xs tabular-nums text-zinc-400">
                {formatTime(elapsed)} / {formatTime(total)}
              </span>
            </div>
          </div>

          {/* Hitrost + ura za spanje + utišanje */}
          <div className="ml-auto flex items-center gap-1 sm:ml-0">
            <Select value={String(rate)} onValueChange={(v) => onRateChange(Number(v))}>
              <SelectTrigger
                size="sm"
                aria-label="Hitrost predvajanja"
                className="w-[4.75rem] border-zinc-800 bg-zinc-900/80 text-zinc-300 hover:bg-zinc-800"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
                {RATES.map((r) => (
                  <SelectItem
                    key={r}
                    value={String(r)}
                    className="focus:bg-zinc-800 focus:text-amber-300"
                  >
                    {String(r).replace('.', ',')}×
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SleepTimerButton
              activeOption={sleepMode ?? (sleepRemainingMs !== null ? null : 'off')}
              remainingMs={sleepRemainingMs}
              onSelect={onSetSleepTimer}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-10 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              onClick={onToggleMute}
              aria-label={muted ? 'Vklopi zvok' : 'Utišaj zvok'}
            >
              {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
