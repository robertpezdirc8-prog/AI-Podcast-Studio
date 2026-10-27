'use client';

import { useMemo, useState } from 'react';
import type { Ref } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ClipboardPaste,
  Clock,
  Link2,
  ListMusic,
  Mic,
  Play,
  Plus,
  Search,
  SearchX,
  Trash2,
} from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  LANGUAGE_LABELS,
  LENGTH_LABELS,
  SOURCE_TYPE_LABELS,
  STYLE_LABELS,
  type EpisodeSummary,
  type SourceType,
} from '@/lib/podcast-types';

interface EpisodeLibraryProps {
  episodes: EpisodeSummary[];
  loading: boolean;
  onOpen: (id: string, play?: boolean) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  // Kratek zapis brez leta (v kartici je prostor omejen; polni datum v title)
  return date.toLocaleDateString('sl-SI', { day: 'numeric', month: 'short' });
}
/** Trajanje v m:ss ali h:mm:ss (iz milisekund). */
function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = String(Math.floor((total % 3600) / 60)).padStart(h > 0 ? 2 : 1, '0');
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

/** Relativni čas (KRATKI zapis za meta vrstico): "pravkar", "5 min", "2 h", "3 dni". */
function formatRelative(value: string | null | undefined): string {
  if (!value) return '';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (diffSec < 60) return 'pravkar';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} h`;
  const diffD = Math.floor(diffH / 24);
  return diffD === 1 ? '1 dnem' : `${diffD} dni`;
}

/** Slovenski množinski zapis: 1 epizoda, 2 epizodi, 3/4 epizode, 5+ epizod. */
function episodeCountLabel(count: number): string {
  if (count === 1) return '1 epizoda';
  if (count === 2) return '2 epizodi';
  if (count === 3 || count === 4) return `${count} epizode`;
  return `${count} epizod`;
}

function SourceBadgeIcon({ sourceType }: { sourceType: SourceType }) {
  if (sourceType === 'url') return <Link2 className="size-3" aria-hidden="true" />;
  if (sourceType === 'text') return <ClipboardPaste className="size-3" aria-hidden="true" />;
  return null;
}

function EpisodeCard({
  ref,
  episode,
  onOpen,
  onDelete,
}: {
  ref?: Ref<HTMLDivElement>;
  episode: EpisodeSummary;
  onOpen: (id: string, play?: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const playable = episode.lineCount > 0 && episode.readyLines === episode.lineCount;
  // Statistika predvajanja (polja so lahko manjkajoča, če je API odgovor keširan)
  const playCount = episode.playCount ?? 0;
  const lastPlayedLabel = formatRelative(episode.lastPlayedAt);
  const progressMs = episode.progressMs ?? 0;
  const totalDurationMs = episode.totalDurationMs ?? 0;
  const showProgress =
    progressMs > 15000 && totalDurationMs > 0 && progressMs < totalDurationMs * 0.9;

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(episode.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(episode.id);
        }
      }}
      className="flex cursor-pointer flex-col rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 transition-colors hover:border-amber-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
    >
      <div className="flex gap-3">
        {episode.coverPath && (
          <img
            src={episode.coverPath}
            alt={`Ovitek epizode ${episode.title}`}
            className="aspect-square h-16 w-16 shrink-0 rounded-lg border border-zinc-700 object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-semibold leading-snug text-zinc-100">{episode.title}</h3>
          {episode.topic.trim() !== episode.title.trim() && (
            <p className="mt-1 line-clamp-2 text-sm text-zinc-400">{episode.topic}</p>
          )}
        </div>
      </div>
      <div className="mb-4 mt-3 flex flex-wrap items-center gap-1.5">
        <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-400">
          {STYLE_LABELS[episode.style] ?? episode.style}
        </Badge>
        <Badge variant="outline" className="border-zinc-700 text-zinc-400">
          {LANGUAGE_LABELS[episode.language] ?? episode.language}
        </Badge>
        <Badge variant="outline" className="border-zinc-700 text-zinc-400">
          <Clock className="size-3" aria-hidden="true" />
          {LENGTH_LABELS[episode.length] ?? episode.length}
        </Badge>
        {episode.sourceType !== 'topic' && (
          <Badge variant="outline" className="border-zinc-700 text-zinc-400">
            <SourceBadgeIcon sourceType={episode.sourceType} />
            {SOURCE_TYPE_LABELS[episode.sourceType]}
          </Badge>
        )}
        {playable && (
          <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
            Pripravljeno
          </Badge>
        )}
      </div>
      {showProgress && (
        <div
          className="mb-4 h-1 rounded-full bg-zinc-800"
          role="progressbar"
          aria-label={`Napredek predvajanja: ${formatDuration(progressMs)} od ${formatDuration(totalDurationMs)}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, Math.round((progressMs / totalDurationMs) * 100))}
        >
          <div
            className="h-1 rounded-full bg-amber-500"
            style={{ width: `${Math.min(100, (progressMs / totalDurationMs) * 100)}%` }}
          />
        </div>
      )}
      <div
        className="mt-auto flex items-center justify-between gap-2 border-t border-zinc-800/70 pt-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-500">
          <ListMusic className="size-3.5 shrink-0" aria-hidden="true" />
          {(() => {
            // Meta vrstica ostane KRATKA: ko obstaja zgodovina predvajanja,
            // datum nastanka pade v namig (polni datum + nazadnje predvajano).
            const createdFull = new Date(episode.createdAt).toLocaleDateString('sl-SI', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            });
            const hasHistory = playCount > 0 || Boolean(lastPlayedLabel);
            const hint = [
              createdFull && `Ustvarjeno ${createdFull}`,
              playCount > 0 && `predvajano ${playCount}×`,
              lastPlayedLabel &&
                `nazadnje predvajano ${lastPlayedLabel === 'pravkar' ? 'pravkar' : `pred ${lastPlayedLabel}`}`,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <span className="truncate" title={hint || undefined}>
                {episode.lineCount} {episode.lineCount === 1 ? 'vrstica' : 'vrstic'}
                {episode.totalDurationMs > 0 && (
                  <>
                    {' · '}
                    <Clock className="mb-0.5 inline size-3" aria-hidden="true" />{' '}
                    {formatDuration(episode.totalDurationMs)}
                  </>
                )}
                {!hasHistory && formatDate(episode.createdAt) && <> · {formatDate(episode.createdAt)}</>}
                {lastPlayedLabel && (
                  <>
                    {' · '}
                    <Play className="mb-0.5 inline size-3" aria-hidden="true" />{' '}
                    {playCount >= 2 ? `${playCount}× · ${lastPlayedLabel}` : lastPlayedLabel}
                  </>
                )}
              </span>
            );
          })()}
          {showProgress && (
            <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
              Nadaljuj {formatDuration(progressMs)}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {playable && (
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
              aria-label={`Predvajaj: ${episode.title}`}
              onClick={() => onOpen(episode.id, true)}
            >
              <Play className="size-4 fill-current" />
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
                aria-label={`Izbriši: ${episode.title}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
              <AlertDialogHeader>
                <AlertDialogTitle>Izbriši epizodo?</AlertDialogTitle>
                <AlertDialogDescription className="text-zinc-400">
                  Epizoda „{episode.title}“ bo trajno izbrisana skupaj z zvokom. Tega ni mogoče
                  razveljaviti.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-800 hover:text-white">
                  Prekliči
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 text-white hover:bg-red-500"
                  onClick={() => onDelete(episode.id)}
                >
                  Izbriši
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </motion.div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-zinc-800 px-6 py-16 text-center"
    >
      <div className="flex size-24 items-center justify-center rounded-full border-2 border-dashed border-zinc-700 bg-zinc-900/40">
        <Mic className="size-10 text-zinc-600" aria-hidden="true" />
      </div>
      <h3 className="mt-6 text-xl font-semibold text-zinc-100">Še ni epizod</h3>
      <p className="mt-1 text-sm text-zinc-400">Ustvari svojo prvo AI epizodo!</p>
      <Button
        onClick={onNew}
        className="mt-6 bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-orange-950/40 hover:from-amber-400 hover:to-orange-500"
      >
        <Plus className="size-4" /> Nova epizoda
      </Button>
    </motion.div>
  );
}

function NoResultsState({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-zinc-800 px-6 py-14 text-center"
    >
      <div className="flex size-20 items-center justify-center rounded-full border-2 border-dashed border-zinc-700 bg-zinc-900/40">
        <SearchX className="size-8 text-zinc-600" aria-hidden="true" />
      </div>
      <h3 className="mt-5 text-lg font-semibold text-zinc-100">
        Ni zadetkov za „{query}“
      </h3>
      <p className="mt-1 text-sm text-zinc-400">
        Preveri črkovanje ali poskusi z drugačnim iskalnim izrazom.
      </p>
      <Button
        variant="outline"
        onClick={onClear}
        className="mt-5 border-zinc-700 bg-zinc-950/60 text-zinc-300 hover:border-amber-500/40 hover:text-amber-400"
      >
        Počisti iskanje
      </Button>
    </motion.div>
  );
}

function LibrarySkeleton() {
  return (
    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <Skeleton className="h-5 w-3/4 bg-zinc-800" />
          <Skeleton className="mt-2 h-4 w-full bg-zinc-800" />
          <Skeleton className="mt-1.5 h-4 w-2/3 bg-zinc-800" />
          <div className="mt-4 flex gap-2">
            <Skeleton className="h-5 w-16 rounded-full bg-zinc-800" />
            <Skeleton className="h-5 w-12 rounded-full bg-zinc-800" />
          </div>
          <Skeleton className="mt-4 h-4 w-1/2 bg-zinc-800" />
        </div>
      ))}
    </div>
  );
}

export function EpisodeLibrary({ episodes, loading, onOpen, onDelete, onNew }: EpisodeLibraryProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return episodes;
    return episodes.filter(
      (episode) =>
        episode.title.toLowerCase().includes(q) || episode.topic.toLowerCase().includes(q),
    );
  }, [episodes, query]);

  const isFiltering = query.trim().length > 0;
  const showSearch = !loading && episodes.length > 0;

  return (
    <section aria-label="Knjižnica epizod">
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-100">Tvoje epizode</h2>
        <Badge variant="outline" className="border-zinc-800 bg-zinc-800/80 text-zinc-300">
          {episodes.length}
        </Badge>
      </div>

      {showSearch && (
        <div className="mt-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Išči po naslovu ali temi …"
              aria-label="Išči epizode"
              className="h-10 border-zinc-800 bg-zinc-900/60 pl-9 text-zinc-100 placeholder:text-zinc-600 focus-visible:border-amber-500/50 focus-visible:ring-amber-500/20"
            />
          </div>
          {isFiltering && (
            <p className="mt-2 text-xs text-zinc-500" role="status">
              Najdenih: {episodeCountLabel(filtered.length)}
            </p>
          )}
        </div>
      )}

      {loading ? (
        <LibrarySkeleton />
      ) : episodes.length === 0 ? (
        <EmptyState onNew={onNew} />
      ) : filtered.length === 0 ? (
        <NoResultsState query={query.trim()} onClear={() => setQuery('')} />
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout" initial={false}>
            {filtered.map((episode) => (
              <EpisodeCard key={episode.id} episode={episode} onOpen={onOpen} onDelete={onDelete} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
