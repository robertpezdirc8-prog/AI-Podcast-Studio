'use client';

/**
 * Ciljno trajanje (Task 47) — skupni gradniki za dialog nove epizode in
 * Dramaturgijo v studiu. Izbirnik cilja (1/2/3/5/10 min) + vrstica odmika
 * (pod/dosežen/nad ciljem, toleranca ±15 %). Izračuni: script-analysis.ts,
 * 100 % lokalno, brez AI modelov.
 */

import { CircleCheck, Target } from 'lucide-react';

import {
  durationDelta,
  formatDuration,
  TARGET_OPTIONS,
} from '@/lib/script-analysis';
import { cn } from '@/lib/utils';

interface TargetDurationRowProps {
  value: number | null;
  onChange: (sec: number | null) => void;
  className?: string;
}

/** Vrstica čipov: »Ciljno trajanje:  Brez · 1 min · 2 min · 3 min · 5 min · 10 min«. */
export function TargetDurationRow({ value, onChange, className }: TargetDurationRowProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} role="group" aria-label="Ciljno trajanje epizode">
      <span className="mr-1 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
        <Target className="size-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
        Ciljno trajanje
      </span>
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={value === null}
        className={cn(
          'rounded-full border px-2.5 py-1 text-xs transition-colors',
          value === null
            ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
            : 'border-zinc-700 bg-zinc-950/60 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200',
        )}
      >
        Brez
      </button>
      {TARGET_OPTIONS.map((option) => (
        <button
          key={option.sec}
          type="button"
          onClick={() => onChange(option.sec)}
          aria-pressed={value === option.sec}
          className={cn(
            'rounded-full border px-2.5 py-1 text-xs tabular-nums transition-colors',
            value === option.sec
              ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
              : 'border-zinc-700 bg-zinc-950/60 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface TargetDeltaLineProps {
  /** dejansko (realno/ocenjeno) trajanje v sekundah */
  actualSec: number;
  /** izbrani cilj v sekundah (null → komponenta ne izpiše ničesar) */
  targetSec: number | null;
  /** izvor trajanja — samo za razlage v namigu */
  sourceHint?: string;
}

/** Vrstica odmika proti cilju: pod/dosežen/nad (toleranca ±15 %). */
export function TargetDeltaLine({ actualSec, targetSec, sourceHint }: TargetDeltaLineProps) {
  if (!targetSec || targetSec <= 0 || actualSec <= 0) return null;
  const delta = durationDelta(actualSec, targetSec);
  const actualLabel = formatDuration(actualSec);
  const targetLabel = formatDuration(targetSec);

  let detail: string;
  if (delta.state === 'ok') {
    detail = `Cilj dosežen — ${actualLabel} ob cilju ${targetLabel} (toleranca ±15 %).`;
  } else if (delta.state === 'under') {
    detail = `${actualLabel} je za ${Math.abs(delta.diffSec)} s pod ciljem ${targetLabel} — dodaj približno ${delta.wordsDelta} besed (≈ 1 vrstica na 20 besed).`;
  } else {
    detail = `${actualLabel} je za ${Math.abs(delta.diffSec)} s nad ciljem ${targetLabel} — odstrani približno ${delta.wordsDelta} besed ali skrajšaj premore.`;
  }

  const ok = delta.state === 'ok';
  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed',
        ok
          ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
          : 'border-amber-500/30 bg-amber-500/5 text-amber-300',
      )}
      title={sourceHint}
    >
      {ok ? (
        <CircleCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Target className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      )}
      <span>{detail}</span>
    </p>
  );
}
