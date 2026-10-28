'use client';

import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Normalizira besedilo za iskanje: male črke + brez diakritike (č→c, š→s, ž→z). */
export function foldText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Deli besedilo na poudarjene/zadete dele glede na poizvedbo (1:1 dolžina po foldu). */
export function HighlightedText({ text, query }: { text: string; query: string }) {
  const needle = foldText(query.trim());
  if (needle.length < 2) return <>{text}</>;
  const hay = foldText(text);
  if (hay.length !== text.length) return <>{text}</>; // redki Unicode primeri — brez poudarkov
  const parts: { t: string; hit: boolean }[] = [];
  let i = 0;
  while (i < hay.length) {
    const at = hay.indexOf(needle, i);
    if (at < 0) {
      parts.push({ t: text.slice(i), hit: false });
      break;
    }
    if (at > i) parts.push({ t: text.slice(i, at), hit: false });
    parts.push({ t: text.slice(at, at + needle.length), hit: true });
    i = at + needle.length;
  }
  return (
    <>
      {parts.map((part, index) =>
        part.hit ? (
          <mark
            key={index}
            className="rounded-sm bg-amber-400/30 px-0.5 text-amber-100 [mark::selection]:bg-amber-400/50"
          >
            {part.t}
          </mark>
        ) : (
          <span key={index}>{part.t}</span>
        ),
      )}
    </>
  );
}

/** Vrstica iskanja v glavi scenarija (Apple Podcasts transkript-search stil). */
export function ScenarioSearchBar({
  query,
  onQueryChange,
  matchCount,
  activeIndex,
  onNext,
  onPrev,
  onClose,
  inputRef,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  matchCount: number;
  activeIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const hasMatches = matchCount > 0;
  return (
    <div
      className="flex min-w-0 max-w-full items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 pl-2 pr-1"
      role="search"
    >
      <Search className="size-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="Išči po scenariju …"
        aria-label="Išči po scenariju"
        className="h-8 w-24 min-w-0 border-0 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-400 focus-visible:ring-0 sm:w-48"
      />
      {query.trim().length >= 2 && (
        <span
          className="shrink-0 text-[11px] tabular-nums text-zinc-400"
          aria-live="polite"
          aria-label={`Zadetek ${hasMatches ? activeIndex + 1 : 0} od ${matchCount}`}
        >
          {hasMatches ? `${activeIndex + 1}/${matchCount}` : '0/0'}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        aria-label="Prejšnji zadetek"
        disabled={!hasMatches}
        onClick={onPrev}
      >
        <ChevronUp className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        aria-label="Naslednji zadetek"
        disabled={!hasMatches}
        onClick={onNext}
      >
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        aria-label="Zapri iskanje"
        onClick={onClose}
      >
        <X className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  );
}

/**
 * Vrne razred za zatemnitev vrstic brez zadetkov med aktivnim iskanjem.
 * Uporabimo FILTER (brightness/saturate) in NE opacity — framer-motion na `motion.li`
 * nastavlja inline `opacity`, ki bi preglasil Tailwind razred.
 */
export function dimIfNoMatch(hasMatch: boolean, searchActive: boolean): string {
  return cn(searchActive && !hasMatch && 'brightness-[0.45] saturate-50');
}
