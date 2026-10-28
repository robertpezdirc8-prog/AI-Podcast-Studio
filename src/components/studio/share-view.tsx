'use client';

/**
 * Javna delitvena stran (Task 45) — upodobljena znotraj / route ob povezavi
 * `/?deli=<token>`. Čista stran za POSLUŠALCE: ovitek, predvajalnik, poglavja,
 * zapiski, prepis in prenos MP3. Ne razkriva ID-ja epizode niti studio
 * vmesnika — vse teče preko žetona /api/share/<token>.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Headphones,
  ListOrdered,
  Loader2,
  Mic,
  NotebookText,
  Pause,
  Play,
  Radio,
  SkipBack,
  SkipForward,
  TriangleAlert,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import {
  fetchSharedEpisode,
  type ShareEpisode,
} from '@/lib/podcast-client';
import { hostColor } from '@/lib/podcast-types';
import {
  setMediaPlaybackState,
  setMediaPositionState,
  useMediaSession,
} from '@/hooks/use-media-session';
import { cn } from '@/lib/utils';

interface ShareViewProps {
  token: string;
  onExit: () => void;
}

/** m:ss oz. h:mm:ss (isti zapis kot ostali izvozi). */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Hitrosti predvajanja (Pocket Casts stil) — prikaz v slovenski obliki (1,25×). */
const RATES = [1, 1.25, 1.5, 2] as const;
const rateLabel = (r: number) => `${r.toLocaleString('sl-SI')}×`;

export function ShareView({ token, onExit }: ShareViewProps) {
  const [data, setData] = useState<ShareEpisode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [rateIdx, setRateIdx] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Zadnji zapis pozicije na zaklenjeni zaslon (dušilnik ~1 s). */
  const posStateAtRef = useRef(0);
  /**
   * Ali uporabnik trenutno VLEČE drsnik (Task 53). Med vlečenjem `timeupdate`
   * (~4 Hz) ne sme prevzemati položaja — sicer se palec drsnika "bori" z
   * vlečenjem in nazadnje skače. Ref namesto stanja: brez ponovnega risanja.
   */
  const scrubbingRef = useRef(false);

  useEffect(() => {
    // Začetno stanje (nalaganje) je že deklarirano pri useState —
    // nov žeton pomeni REMOUNT (key={token} v page.tsx), zato tukaj
    // nastavljamo samo v asinhronih povratnih klicih.
    let active = true;
    fetchSharedEpisode(token)
      .then((episode) => {
        if (!active) return;
        setData(episode);
        if (episode.durationSec > 0) setTotal(episode.durationSec);
        // zapiski privzeto odprti, kadar so na voljo
        setNotesOpen(episode.summary != null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Epizoda ni bila najdena.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  // Barve govorcev po vrstnem redu prve pojavitve (isti vzorec kot v studiu).
  const speakerIndex = useMemo(() => {
    const map = new Map<string, number>();
    if (data) {
      for (const line of data.lines) {
        if (!map.has(line.speaker)) map.set(line.speaker, map.size);
      }
    }
    return map;
  }, [data]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, []);

  /**
   * Skok na ciljno sekundo. Stanje nastavimo na CILJ (ne na odčitavanje
   * `audio.currentTime` — iskanje je asinhrono), tako se vmesnik odzove
   * takoj; mejimo na trajanje, da ±10 s ob koncu ne pokaže prekoračitve.
   */
  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const dur = audio.duration;
    const target = Math.min(
      Math.max(0, seconds),
      Number.isFinite(dur) && dur > 0 ? dur : seconds,
    );
    audio.currentTime = target;
    setCurrent(target);
  }, []);

  const changeRate = useCallback((idx: number) => {
    setRateIdx(idx);
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = RATES[idx];
      // Drsnik na zaklenjenem zaslonu mora poznati novo hitrost.
      setMediaPositionState(audio.duration || total, audio.currentTime, RATES[idx]);
    }
  }, [total]);

  /**
   * Tipkovne bližnjice poslušalca (Task 50): preslednica = predvajaj/pavza,
   * ←/→ = skok ±10 s. Isti vzorec varovanja kot v studiu — ne posegamo, ko
   * je fokus v vnosnem polju, gumbu, drsniku ali povezavi.
   */
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
        seekTo((audioRef.current?.currentTime ?? 0) + 10);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekTo((audioRef.current?.currentTime ?? 0) - 10);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seekTo]);

  /* Naslov zavihka (Task 53): deljena epizoda nosi svoj naslov; ob izhodu
     iz delitvenega pogleda se povrne prejšnji naslov. */
  useEffect(() => {
    if (!data) return;
    const prev = document.title;
    document.title = `${data.title} · AI Podcast Studio`;
    return () => {
      document.title = prev;
    };
  }, [data]);

  const activeChapter = useMemo(() => {
    if (!data) return -1;
    let idx = -1;
    for (let i = 0; i < data.chapters.length; i += 1) {
      if (current + 0.25 >= data.chapters[i].startSec) idx = i;
    }
    return idx;
  }, [data, current]);

  /*
   * Media Session (Task 51): naslov/ovitek/gostitelji na zaklenjenem zaslonu,
   * medijske tipke — ±skok (10 s), prejšnja/naslednja POGRAVJE (kot »sled«).
   * Klici berejo ŽIVO currentTime prek audioRef — brez zastarelih closures.
   */
  useMediaSession(
    {
      title: data?.title ?? '',
      artist: data?.hosts.map((h) => h.name).join(' · ') || 'AI Podcast Studio',
      album: 'AI Podcast Studio',
      artworkUrl: data?.coverPath ?? null,
      onPlay: () => void audioRef.current?.play().catch(() => undefined),
      onPause: () => audioRef.current?.pause(),
      onSeekBackward: (offset) => seekTo((audioRef.current?.currentTime ?? 0) - offset),
      onSeekForward: (offset) => seekTo((audioRef.current?.currentTime ?? 0) + offset),
      onPrevTrack: () => {
        if (!data?.chapters.length) return;
        const t = audioRef.current?.currentTime ?? 0;
        const prev = [...data.chapters].reverse().find((c) => c.startSec <= t - 1.5);
        if (prev) seekTo(prev.startSec);
      },
      onNextTrack: () => {
        if (!data?.chapters.length) return;
        const t = audioRef.current?.currentTime ?? 0;
        const next = data.chapters.find((c) => c.startSec > t + 0.5);
        if (next) seekTo(next.startSec);
      },
    },
    `${token}:${data?.title ?? ''}:${data?.coverPath ?? ''}`,
  );

  /* ---------- Stanja: nalaganje / napaka ---------- */
  if (loading) {
    return (
      <div className="mx-auto w-full max-w-2xl flex-1 space-y-4 px-4 py-8">
        <Skeleton className="mx-auto h-44 w-44 rounded-2xl bg-zinc-800/60" />
        <Skeleton className="mx-auto h-8 w-3/4 rounded-lg bg-zinc-800/60" />
        <Skeleton className="mx-auto h-4 w-1/2 rounded-lg bg-zinc-800/60" />
        <Skeleton className="h-24 w-full rounded-xl bg-zinc-800/60" />
        <Skeleton className="h-16 w-full rounded-xl bg-zinc-800/60" />
        <p className="flex items-center justify-center gap-2 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Nalagam epizodo …
        </p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10">
          <TriangleAlert className="size-6 text-amber-400" aria-hidden="true" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-zinc-100">Povezava ne deluje</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
          {error ?? 'Epizoda ni bila najdena.'}
        </p>
        <Button
          onClick={onExit}
          className="mt-6 bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-orange-950/40 hover:from-amber-400 hover:to-orange-500"
        >
          <Headphones className="size-4" aria-hidden="true" />
          Odpri AI Podcast Studio
        </Button>
      </div>
    );
  }

  const created = (() => {
    try {
      return new Intl.DateTimeFormat('sl-SI', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(new Date(data.createdAt));
    } catch {
      return '';
    }
  })();

  const audioUrl = `/api/share/${encodeURIComponent(token)}/audio`;
  const hasChapters = data.chapters.length > 1;

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 md:py-10">
      {/* Ovitek + naslov */}
      <div className="flex flex-col items-center text-center">
        {data.coverPath ? (
          <img
            src={data.coverPath}
            alt={`Ovitek epizode ${data.title}`}
            className="aspect-square w-44 rounded-2xl border border-zinc-800 object-cover shadow-xl shadow-black/40 sm:w-52"
          />
        ) : (
          <div className="flex aspect-square w-44 items-center justify-center rounded-2xl border border-zinc-800 bg-gradient-to-br from-amber-500/20 to-orange-600/10 sm:w-52">
            <Mic className="size-14 text-amber-500/70" aria-hidden="true" />
          </div>
        )}
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-zinc-50 sm:text-3xl">
          {data.title}
        </h1>
        {data.topic.trim() !== data.title.trim() && (
          <p className="mt-2 line-clamp-3 max-w-xl text-sm leading-relaxed text-zinc-400">
            {data.topic}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-400">
            <Radio className="size-3" aria-hidden="true" />
            Podcast
          </Badge>
          {created && (
            <Badge variant="outline" className="border-zinc-700 text-zinc-400">
              {created}
            </Badge>
          )}
          {data.hasAudio && data.durationSec > 0 && (
            <Badge variant="outline" className="border-zinc-700 text-zinc-400">
              {clock(data.durationSec)}
            </Badge>
          )}
        </div>
        {data.hosts.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {data.hosts.map((host, i) => {
              const color = hostColor(i);
              return (
                <span
                  key={`${host.name}-${i}`}
                  className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/60 px-2.5 py-1 text-xs text-zinc-300"
                >
                  <span className={cn('size-2 rounded-full', color.dot)} aria-hidden="true" />
                  <span className="font-medium text-zinc-200">{host.name}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Predvajalnik */}
      {data.hasAudio ? (
        <Card className="mt-6 border-zinc-800 bg-zinc-900/70">
          <CardContent className="p-4 sm:p-5">
            <audio
              ref={audioRef}
              src={audioUrl}
              preload="metadata"
              onPlay={() => {
                setPlaying(true);
                setMediaPlaybackState('playing');
              }}
              onPause={() => {
                setPlaying(false);
                setMediaPlaybackState('paused');
              }}
              onEnded={() => {
                setPlaying(false);
                setMediaPlaybackState('paused');
              }}
              onTimeUpdate={(e) => {
                // Uporabnik vleče drsnik — prevzem položaja bi povzročil
                // poskok palca (Task 53).
                if (scrubbingRef.current) return;
                const t = e.currentTarget.currentTime;
                setCurrent(t);
                // Drsnik na zaklenjenem zaslonu — dovolj na ~1 s (timeupdate pripne 4×).
                const now = Date.now();
                if (now - posStateAtRef.current >= 1000) {
                  posStateAtRef.current = now;
                  setMediaPositionState(
                    e.currentTarget.duration || total,
                    t,
                    RATES[rateIdx],
                  );
                }
              }}
              onLoadedMetadata={(e) => {
                const dur = e.currentTarget.duration;
                if (Number.isFinite(dur) && dur > 0) setTotal(dur);
              }}
            />
            <div className="flex items-center gap-3 sm:gap-4">
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playing ? 'Ustavi predvajanje' : 'Predvajaj epizodo'}
                className="flex size-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg shadow-orange-950/40 transition-transform hover:scale-105 active:scale-95"
              >
                {playing ? (
                  <Pause className="size-6" aria-hidden="true" />
                ) : (
                  <Play className="size-6 translate-x-0.5" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                onClick={() => seekTo(current - 10)}
                aria-label="Nazaj 10 sekund"
                className="hidden size-9 shrink-0 items-center justify-center rounded-full border border-zinc-700 text-zinc-300 transition-colors hover:border-amber-500/40 hover:text-amber-400 sm:flex"
              >
                <SkipBack className="size-4" aria-hidden="true" />
              </button>
              <div className="min-w-0 flex-1">
                <Slider
                  value={[Math.min(current, total || 1)]}
                  max={total > 0 ? total : 1}
                  step={0.1}
                  onValueChange={(value) => seekTo(value[0] ?? 0)}
                  onPointerDown={() => {
                    scrubbingRef.current = true;
                  }}
                  /* Potrjeno ob spustu tipke in tudi po tipkovnici (Radix)
                     — predvajanje znova prevzame položaj. */
                  onValueCommit={() => {
                    scrubbingRef.current = false;
                  }}
                  aria-label="Položaj predvajanja"
                  className="cursor-pointer [&_[data-slot=slider-range]]:bg-gradient-to-r [&_[data-slot=slider-range]]:from-amber-500 [&_[data-slot=slider-range]]:to-orange-600 [&_[data-slot=slider-thumb]]:border-amber-500 [&_[data-slot=slider-thumb]]:bg-zinc-950 [&_[data-slot=slider-track]]:bg-zinc-800"
                />
                <div className="mt-1.5 flex items-center justify-between text-xs tabular-nums text-zinc-500">
                  <span>{clock(current)}</span>
                  <span>{total > 0 ? clock(total) : '–:––'}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => seekTo(current + 10)}
                aria-label="Naprej 10 sekund"
                className="hidden size-9 shrink-0 items-center justify-center rounded-full border border-zinc-700 text-zinc-300 transition-colors hover:border-amber-500/40 hover:text-amber-400 sm:flex"
              >
                <SkipForward className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => changeRate((rateIdx + 1) % RATES.length)}
                aria-label={`Hitrost predvajanja: ${rateLabel(RATES[rateIdx])} — klikni za naslednjo`}
                title="Hitrost predvajanja"
                className="flex size-9 shrink-0 items-center justify-center rounded-full border border-zinc-700 text-xs font-semibold tabular-nums text-zinc-300 transition-colors hover:border-amber-500/40 hover:text-amber-400"
              >
                {rateLabel(RATES[rateIdx])}
              </button>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="shrink-0 gap-1.5 border-zinc-700 bg-zinc-950/60 text-zinc-300 hover:border-amber-500/40 hover:text-amber-400"
              >
                <a href={`${audioUrl}?prenos=1`} download aria-label="Prenesi epizodo kot MP3">
                  <Download className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">MP3</span>
                </a>
              </Button>
            </div>
            <p className="mt-2.5 hidden text-[11px] text-zinc-600 sm:block">
              Preslednica = predvajaj · ← → = ±10 s
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-6 flex items-start gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-400">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" aria-hidden="true" />
          <p>
            Zvok te epizode še ni sintetiziran — spodaj je na voljo le prepis pogovora.
          </p>
        </div>
      )}

      {/* Poglavja */}
      {hasChapters && (
        <section className="mt-6" aria-labelledby="share-chapters">
          <h2
            id="share-chapters"
            className="text-xs font-semibold tracking-[0.2em] text-zinc-500 uppercase"
          >
            <ListOrdered className="mr-1.5 inline size-3.5" aria-hidden="true" />
            Poglavja
          </h2>
          <ul className="mt-2.5 space-y-1">
            {data.chapters.map((chapter, i) => (
              <li key={`${chapter.title}-${i}`}>
                <button
                  type="button"
                  disabled={!data.hasAudio}
                  onClick={() => seekTo(chapter.startSec)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                    i === activeChapter
                      ? 'bg-amber-500/10 text-amber-300'
                      : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100',
                    !data.hasAudio && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <span className="w-14 shrink-0 text-xs tabular-nums text-zinc-500">
                    {clock(chapter.startSec)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {chapter.title}
                  </span>
                  {i === activeChapter && playing && (
                    <span className="flex shrink-0 items-end gap-0.5" aria-hidden="true">
                      <span className="h-3 w-0.5 animate-pulse rounded bg-amber-400" />
                      <span className="h-4 w-0.5 animate-pulse rounded bg-amber-400 [animation-delay:150ms]" />
                      <span className="h-2.5 w-0.5 animate-pulse rounded bg-amber-400 [animation-delay:300ms]" />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Zapiski (povzetek + poudarki) */}
      {data.summary && (
        <section className="mt-6" aria-labelledby="share-notes">
          <button
            type="button"
            onClick={() => setNotesOpen((v) => !v)}
            aria-expanded={notesOpen}
            className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left"
          >
            <span
              id="share-notes"
              className="text-xs font-semibold tracking-[0.2em] text-zinc-500 uppercase"
            >
              <NotebookText className="mr-1.5 inline size-3.5" aria-hidden="true" />
              Zapiski oddaje
            </span>
            <span className="text-xs text-zinc-500">{notesOpen ? 'skrij' : 'prikaži'}</span>
          </button>
          {notesOpen && (
            <div className="mt-2.5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-sm leading-relaxed text-zinc-300">{data.summary.summary}</p>
              {data.summary.takeaways.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {data.summary.takeaways.map((t, i) => (
                    <li key={i} className="flex gap-2 text-sm text-zinc-400">
                      <span
                        className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-500"
                        aria-hidden="true"
                      />
                      <span className="min-w-0">{t}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}

      {/* Prepis */}
      {data.lines.length > 0 && (
        <section className="mt-6" aria-labelledby="share-transcript">
          <button
            type="button"
            onClick={() => setTranscriptOpen((v) => !v)}
            aria-expanded={transcriptOpen}
            className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left"
          >
            <span
              id="share-transcript"
              className="text-xs font-semibold tracking-[0.2em] text-zinc-500 uppercase"
            >
              <Mic className="mr-1.5 inline size-3.5" aria-hidden="true" />
              Prepis ({data.lines.length}{' '}
              {data.lines.length === 1 ? 'vrstica' : 'vrstic'})
            </span>
            <span className="text-xs text-zinc-500">
              {transcriptOpen ? 'skrij' : 'prikaži'}
            </span>
          </button>
          {transcriptOpen && (
            <div className="podcast-scroll mt-2.5 max-h-96 space-y-2.5 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              {data.lines.map((line, i) => {
                const spIdx = speakerIndex.get(line.speaker) ?? 0;
                const color = hostColor(spIdx);
                return (
                  <div key={i}>
                    {line.chapter && (
                      <p className="mt-3 mb-1.5 text-[11px] font-semibold tracking-[0.18em] text-amber-500/80 uppercase">
                        {line.chapter}
                      </p>
                    )}
                    <p className="text-sm leading-relaxed">
                      <span className="mr-2 inline-flex items-center gap-1.5 align-baseline">
                        <span
                          className={cn('size-1.5 rounded-full', color.dot)}
                          aria-hidden="true"
                        />
                        <span className="text-xs font-semibold text-zinc-300">
                          {line.speaker}:
                        </span>
                      </span>
                      <span className="text-zinc-400">{line.text}</span>
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Peta */}
      <div className="mt-10 flex flex-col items-center gap-1.5 border-t border-zinc-800 pt-6 text-center">
        <button
          type="button"
          onClick={onExit}
          className="text-xs text-zinc-500 transition-colors hover:text-amber-400"
        >
          Ustvari svoj podcast — AI Podcast Studio
        </button>
      </div>
    </div>
  );
}
