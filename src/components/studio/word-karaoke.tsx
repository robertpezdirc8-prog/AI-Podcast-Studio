'use client';

/**
 * Besedni karaoke (Task 41) — 100 % brez AI modelov.
 *
 * Aktivna vrstica se izrise besedo po besedo:
 *  - TEKOČA beseda  → jantarni poudarek (kotali se s currentTime)
 *  - PREBERENE      → rahlo zatemnjene
 *  - PRIHAJAJOČE    → običajne
 *  - klik na besedo → skok na njen čas znotraj vrstice (onWordClick)
 *
 * Časovnica: sorazmerna porazdelitev po dolžini besed (word-timing.ts) —
 * isti dokazan pristop kot podnapisi shorts; skupna timeline je nespremenjena.
 */

import { memo, useMemo } from 'react';

import { wordSpans } from '@/lib/word-timing';
import { cn } from '@/lib/utils';

interface WordKaraokeProps {
  text: string;
  elapsedSec: number;
  durationSec: number;
  onWordClick?: (startSec: number) => void;
}

export const WordKaraoke = memo(function WordKaraoke({
  text,
  elapsedSec,
  durationSec,
  onWordClick,
}: WordKaraokeProps) {
  const spans = useMemo(
    () => wordSpans(text, durationSec),
    [text, durationSec],
  );

  return (
    <span
      role="group"
      aria-label="Besedilo vrstice — klik na besedo skoči na njen čas"
      className="flex flex-wrap gap-x-[0.30em] gap-y-0.5"
    >
      {spans.map((span, i) => {
        const active = elapsedSec >= span.startSec && elapsedSec < span.endSec;
        const read = elapsedSec >= span.endSec;
        return (
          <span
            key={i}
            onClick={
              onWordClick
                ? (e) => {
                    /* NE razlivaj na vrstico (li onClick = play/toggle → bi pavziralo!) */
                    e.stopPropagation();
                    onWordClick(span.startSec);
                  }
                : undefined
            }
            className={cn(
              onWordClick && 'cursor-pointer transition-colors',
              active &&
                'rounded-sm bg-amber-400/20 px-0.5 font-semibold text-amber-200',
              !active && read && 'text-zinc-400',
              !active && !read && 'text-zinc-300',
              active && onWordClick && 'hover:bg-amber-400/35',
              !active && onWordClick && 'hover:text-amber-200',
            )}
          >
            {span.word}
          </span>
        );
      })}
    </span>
  );
});
