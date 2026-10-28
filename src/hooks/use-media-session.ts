'use client';

import { useEffect, useRef } from 'react';

/**
 * Media Session API (Task 51) — kontrole na zaklenjenem zaslonu / sistemu
 * (naslov, ovitek, predvajaj/pavza, ±skok, prejšnja/naslednja »sled«) za
 * predvajalnik v studiu IN javno delitveno stran. Vse tiho ignorirano v
 * brskalnikih brez podpore — funkcija je čista izboljšava.
 */

export interface MediaSessionConfig {
  title: string;
  /** Npr. imena gostiteljev ("Rok · Petra") ali "AI Podcast Studio". */
  artist: string;
  album: string;
  /** URL ovitka (podprta .png oz. sicer jpeg). */
  artworkUrl?: string | null;
  onPlay?: () => void;
  onPause?: () => void;
  /** seekOffset v sekundah (privzeto 10, kot on-screen gumba). */
  onSeekBackward?: (seekOffset: number) => void;
  onSeekForward?: (seekOffset: number) => void;
  onPrevTrack?: () => void;
  onNextTrack?: () => void;
}

/** Kje je API na voljo (SSR + stari brskalniki). */
function supported(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

/**
 * Nastavi metapodatke + akcije. `key` določa, KDAJ se vezava ponovi — vključi
 * vse, kar mora osvežiti metapodatke (npr. `${episode.id}:${episode.title}`);
 * povratni klici se branijo prek ref-a, zato spreminjanje closures NE
 * sproži ponovne vezave.
 */
export function useMediaSession(config: MediaSessionConfig, key: string): void {
  // Ref namesto deps: akcije vedno kličejo NAJNOVEJŠE closures. Uskladitev
  // poteka v efektu (pravilo react-hooks/refs prepoveduje pisanje med
  // renderjanjem); ta efekt je deklariran PRED vezavo, zato vezava vedno
  // bere svežo konfiguracijo.
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  useEffect(() => {
    if (!supported()) return;
    const ms = navigator.mediaSession;

    const artworkUrl = configRef.current.artworkUrl;
    try {
      ms.metadata = new MediaMetadata({
        title: configRef.current.title,
        artist: configRef.current.artist,
        album: configRef.current.album,
        artwork: artworkUrl
          ? [
              {
                src: artworkUrl,
                sizes: '1024x1024',
                type: artworkUrl.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
              },
            ]
          : [],
      });
    } catch {
      // MediaMetadata ni na voljo — nadaljujemo samo z akcijami.
    }

    const set = (
      action: MediaSessionAction,
      handler: ((details: MediaSessionActionDetails) => void) | null,
    ) => {
      try {
        ms.setActionHandler(action, handler as MediaSessionActionHandler);
      } catch {
        // Akcija v tem brskalniku ni podprta — nič hudega.
      }
    };

    set('play', () => configRef.current.onPlay?.());
    set('pause', () => configRef.current.onPause?.());
    set('seekbackward', (details) => configRef.current.onSeekBackward?.(details.seekOffset ?? 10));
    set('seekforward', (details) => configRef.current.onSeekForward?.(details.seekOffset ?? 10));
    set('previoustrack', () => configRef.current.onPrevTrack?.());
    set('nexttrack', () => configRef.current.onNextTrack?.());

    return () => {
      ms.metadata = null;
      for (const action of [
        'play',
        'pause',
        'seekbackward',
        'seekforward',
        'previoustrack',
        'nexttrack',
      ] as const) {
        set(action, null);
      }
    };
    // `key` = identiteta predvajane vsebine (nov episod/žeton → nova vezava).
  }, [key]);
}

/** Stanje za zaklenjeni zaslon (drsnik pozicije + hitrost). Tiho fail-soft. */
export function setMediaPositionState(
  durationSec: number,
  positionSec: number,
  playbackRate: number,
): void {
  if (!supported()) return;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: durationSec,
      position: Math.min(Math.max(0, positionSec), durationSec),
      playbackRate: playbackRate > 0 ? playbackRate : 1,
    });
  } catch {
    // Razpon ni veljaven (npr. pozicija > trajanje) — nič hudega.
  }
}

/** Ikona predvajanja na zaklenjenem zaslonu (playing/paused). Tiho fail-soft. */
export function setMediaPlaybackState(state: 'playing' | 'paused'): void {
  if (!supported()) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch {
    // Ni podprto — nič hudega.
  }
}
