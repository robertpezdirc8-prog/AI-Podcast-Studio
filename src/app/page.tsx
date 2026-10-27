'use client';

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Mic, Plus, Rss } from 'lucide-react';
import { toast } from 'sonner';

import { EpisodeLibrary } from '@/components/studio/episode-library';
import { EpisodeStudio } from '@/components/studio/episode-studio';
import { NewEpisodeDialog } from '@/components/studio/new-episode-dialog';
import { ShareView } from '@/components/studio/share-view';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/sonner';
import { deleteEpisode, fetchEpisode, fetchEpisodes } from '@/lib/podcast-client';
import type { Episode, EpisodeSummary } from '@/lib/podcast-types';

const viewTransition = { duration: 0.22, ease: 'easeOut' } as const;

export default function Home() {
  const [episodes, setEpisodes] = useState<EpisodeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [studioId, setStudioId] = useState<string | null>(null);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const [playing, setPlaying] = useState(false);
  // Javna delitev (Task 45): /?deli=<token> upodobi javno stran poslušanja.
  const [shareToken, setShareToken] = useState<string | null>(null);

  const isStudio = studioId !== null;
  const isShare = shareToken !== null;

  const loadEpisodes = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const data = await fetchEpisodes();
      setEpisodes(data);
    } catch {
      toast.error('Napaka pri nalaganju epizod.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEpisodes(true);
  }, [loadEpisodes]);

  // Žeton delitve beremo ob zagonu in ob gumbu Nazaj v brskalniku.
  useEffect(() => {
    const read = () => setShareToken(new URLSearchParams(window.location.search).get('deli'));
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);

  // Pridobi celotno epizodo, kadar se odpre studio.
  useEffect(() => {
    if (!studioId) {
      setEpisode(null);
      return;
    }
    let active = true;
    setEpisode(null);
    setPlaying(false);
    fetchEpisode(studioId)
      .then((data) => {
        if (active) setEpisode(data);
      })
      .catch(() => {
        if (!active) return;
        toast.error('Epizoda ni bila najdena.');
        setStudioId(null);
      });
    return () => {
      active = false;
    };
  }, [studioId]);

  const openStudio = useCallback((id: string, play = false) => {
    setAutoPlay(play);
    setStudioId(id);
  }, []);

  const backToLibrary = useCallback(() => {
    setStudioId(null);
    setPlaying(false);
    void loadEpisodes(false); // tiha osvežitev povzetkov
  }, [loadEpisodes]);

  // Izhod iz javnega pogleda — počistimo URL in pokažemo knjižnico.
  const exitShare = useCallback(() => {
    window.history.replaceState({}, '', '/');
    setShareToken(null);
    void loadEpisodes(false);
  }, [loadEpisodes]);

  const handleCreated = useCallback(
    (created: Episode) => {
      setDialogOpen(false);
      setAutoPlay(false);
      setStudioId(created.id);
      void loadEpisodes(false);
    },
    [loadEpisodes],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteEpisode(id);
        setEpisodes((prev) => prev.filter((item) => item.id !== id));
        toast.success('Epizoda izbrisana.');
      } catch {
        toast.error('Brisanje epizode ni uspelo.');
      }
    },
    [],
  );

  return (
    <div className="studio-dark flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-orange-950/50">
              <Mic className="size-5 text-white" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-base font-bold tracking-tight sm:text-lg">
                  AI Podcast Studio
                </h1>
                <AnimatePresence>
                  {playing && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.15 }}
                      className="flex shrink-0 items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-widest text-red-400"
                    >
                      <span className="relative flex size-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                        <span className="relative inline-flex size-2 rounded-full bg-red-500" />
                      </span>
                      ON AIR
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
              <p className="hidden text-xs text-zinc-500 sm:block">
                Ustvari podcast z umetno inteligenco
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isShare ? null : isStudio ? (
              <Button
                variant="ghost"
                onClick={backToLibrary}
                className="text-zinc-300 hover:bg-zinc-800 hover:text-white"
              >
                <ArrowLeft className="size-4" /> Knjižnica
              </Button>
            ) : (
              <Button
                onClick={() => setDialogOpen(true)}
                className="bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-orange-950/40 hover:from-amber-400 hover:to-orange-500"
              >
                <Plus className="size-4" /> Nova epizoda
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col">
        <AnimatePresence mode="wait" initial={false}>
          {isShare ? (
            <motion.div
              key="share"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={viewTransition}
              className="flex flex-1 flex-col"
            >
              <ShareView key={shareToken} token={shareToken} onExit={exitShare} />
            </motion.div>
          ) : isStudio ? (
            <motion.div
              key="studio"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={viewTransition}
              className="flex flex-1 flex-col"
            >
              {episode ? (
                <EpisodeStudio
                  key={episode.id}
                  episode={episode}
                  playing={playing}
                  autoPlay={autoPlay}
                  onPlayingChange={setPlaying}
                />
              ) : (
                <div className="mx-auto w-full max-w-5xl flex-1 space-y-4 px-4 py-6 md:py-8">
                  <Skeleton className="h-32 w-full rounded-xl bg-zinc-800/60" />
                  <Skeleton className="h-12 w-2/3 rounded-lg bg-zinc-800/60" />
                  <Skeleton className="h-10 w-full rounded-lg bg-zinc-800/60" />
                  <Skeleton className="h-10 w-full rounded-lg bg-zinc-800/60" />
                  <Skeleton className="h-10 w-5/6 rounded-lg bg-zinc-800/60" />
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="library"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -14 }}
              transition={viewTransition}
              className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 md:py-8"
            >
              <EpisodeLibrary
                episodes={episodes}
                loading={loading}
                onOpen={openStudio}
                onDelete={(id) => void handleDelete(id)}
                onNew={() => setDialogOpen(true)}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="mt-auto border-t border-zinc-800 py-4">
        <div className="flex flex-col items-center justify-center gap-1.5 px-4 sm:flex-row sm:gap-3">
          <p className="text-center text-xs text-zinc-500">
            AI Podcast Studio — narejeno z Z.ai veščinami (LLM + TTS)
          </p>
          <a
            href="/api/rss"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-amber-400"
            aria-label="RSS feed podkasta (odpre se v novem zavihku)"
          >
            <Rss className="size-3.5" aria-hidden="true" /> RSS feed
          </a>
        </div>
      </footer>

      <NewEpisodeDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={handleCreated} />
      <Toaster theme="dark" richColors position="top-center" />
    </div>
  );
}
