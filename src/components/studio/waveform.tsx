'use client';

/**
 * Oblika valovanja (Task 42) — mini-map v predvajalniku, 100 % brez AI.
 *
 * Dvo-plastna tehnika (duotone clip): statična SVG plast v cink barvi + enaka
 * plast v jantarni barvi, obrezana na `progress` širino → premik predvajanja
 * NE re-renderja stolpcev (samo clip-path + playhead), učinkovito na 4 Hz.
 *
 * Interakcija: klik / vleci (pointer capture) = skok na čas; tipkovnica
 * ←/→ = ±5 % epizode (role="slider", aria-valuenow v %).
 */

import { memo, useCallback, useRef } from 'react';

import { cn } from '@/lib/utils';

interface WaveformProps {
  /** Stolpci vrhov 0..1 (že vključujejo pavze kot nizke vrednosti). */
  bars: number[];
  /** Položaj predvajanja 0..1. */
  progress: number;
  /** Klik/vleci: frakcija 0..1 → caller pretvori v ms. */
  onSeekFraction: (fraction: number) => void;
  /**
   * Začetek/konec VLEČENJA (Task 54): klicatelj med vlečenjem prekine
   * prevzemanje položaja iz `timeupdate`, sicer glava poskakuje.
   */
  onScrubChange?: (active: boolean) => void;
  /**
   * Besedilo vrednosti za bralnike zaslona (Task 61) — npr. »0:45 od 2:10«.
   * Brez tega napove »aria-valuenow« v odstotkih, kar časa ne pove.
   */
  valueText?: string;
  disabled?: boolean;
  className?: string;
}

/** Stolpce v SVG path niz zgradimo ENKRAT (bars se v seji ne spreminjajo). */
function barsToPath(bars: number[]): string {
  const gap = 0.18;
  const width = 1 - gap;
  let d = '';
  for (let i = 0; i < bars.length; i += 1) {
    const h = Math.min(100, Math.max(2.5, bars[i] * 100)); // min višina = tihina vidna
    const y = (100 - h) / 2;
    d += `M${(i + gap / 2).toFixed(2)} ${y.toFixed(2)}h${width.toFixed(2)}v${h.toFixed(2)}h${(-width).toFixed(2)}z`;
  }
  return d;
}

export const Waveform = memo(function Waveform({
  bars,
  progress,
  onSeekFraction,
  onScrubChange,
  valueText,
  disabled = false,
  className,
}: WaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const pathD = barsToPath(bars);
  const viewBoxW = bars.length;

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onSeekFraction(fraction);
    },
    [onSeekFraction],
  );

  return (
    <div
      ref={containerRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label="Napredek predvajanja (oblika valovanja)"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const delta = e.key === 'ArrowRight' ? 0.05 : -0.05;
          onSeekFraction(Math.min(1, Math.max(0, progress + delta)));
        }
      }}
      onPointerDown={(e) => {
        if (disabled) return;
        draggingRef.current = true;
        onScrubChange?.(true);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // sintetični dogodki (testi) nimajo aktivnega kazalca — seek vseeno deluje
        }
        seekFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (disabled || !draggingRef.current) return;
        seekFromClientX(e.clientX);
      }}
      onPointerUp={(e) => {
        draggingRef.current = false;
        onScrubChange?.(false);
        try {
          e.currentTarget.releasePointerCapture?.(e.pointerId);
        } catch {
          // brez zajema ni kaj sprostiti
        }
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
        onScrubChange?.(false);
      }}
      className={cn(
        'relative h-9 w-full touch-none select-none',
        disabled ? 'pointer-events-none opacity-50' : 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500/60',
        className,
      )}
    >
      {/* Plast 1: nepravedani stolpci (cink) */}
      <svg
        viewBox={`0 0 ${viewBoxW} 100`}
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
      >
        <path d={pathD} fill="currentColor" className="text-zinc-700" />
      </svg>
      {/* Plast 2: predvajani del (jantarni gradient), obrezan na progress */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)` }}
      >
        <svg
          viewBox={`0 0 ${viewBoxW} 100`}
          preserveAspectRatio="none"
          className="h-full w-full"
        >
          <defs>
            <linearGradient id="waveform-played" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#f97316" />
            </linearGradient>
          </defs>
          <path d={pathD} fill="url(#waveform-played)" />
        </svg>
      </div>
      {/* Glava predvajanja */}
      <div
        aria-hidden="true"
        className="absolute top-0 bottom-0 w-0.5 rounded-full bg-amber-100/90 shadow-[0_0_6px_rgba(251,191,36,0.8)]"
        style={{ left: `${Math.min(100, Math.max(0, progress * 100))}%` }}
      />
    </div>
  );
});
