'use client';

/**
 * Delitveni dialog (Task 45) — vklop/izklop javne povezave epizode.
 * Povezava `/?deli=<token>` je neugljiva (16 znakov base64url) in ostane
 * STABILNA: izklop le skrije epizodo, ponoven vklop uporabi isti žeton.
 */

import { useEffect, useState } from 'react';
import { Copy, ExternalLink, Link2, Loader2, Share2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { fetchShareState, setEpisodeShare, type ShareState } from '@/lib/podcast-client';

interface ShareDialogProps {
  episodeId: string;
  episodeTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareDialog({ episodeId, episodeTitle, open, onOpenChange }: ShareDialogProps) {
  const [state, setState] = useState<ShareState | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  // Stanje delitve naložimo vsakič, ko se dialog odpre.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setState(null);
    fetchShareState(episodeId)
      .then((data) => {
        if (active) setState(data);
      })
      .catch(() => {
        if (active) toast.error('Stanja delitve ni bilo mogoče naložiti.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, episodeId]);

  const enabled = state?.sharedAt != null;
  const fullUrl =
    state?.shareToken && enabled
      ? `${window.location.origin}/?deli=${state.shareToken}`
      : null;

  const handleToggle = async (next: boolean) => {
    setPending(true);
    try {
      const updated = await setEpisodeShare(episodeId, next);
      setState(updated);
      toast.success(next ? 'Javna povezava je vklopljena.' : 'Javna povezava je izklopljena.');
    } catch {
      toast.error('Nastavitve delitve ni bilo mogoče shraniti.');
    } finally {
      setPending(false);
    }
  };

  const handleCopy = async () => {
    if (!fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      toast.success('Povezava kopirana v odložišče.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Kopiranja ni bilo mogoče izvesti.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Share2 className="size-4 text-amber-400" aria-hidden="true" />
            Deli epizodo
          </DialogTitle>
          <DialogDescription className="text-zinc-400">
            Javna povezava za <span className="line-clamp-1 font-medium text-zinc-300">{episodeTitle}</span>
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-400">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Nalagam stanje delitve …
          </div>
        ) : (
          <div className="space-y-4">
            {/* Vklop / izklop */}
            <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-100">Javna povezava</p>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-400">
                  Vsi, ki imajo povezavo, lahko epizodo poslušajo, preberejo prepis in
                  prenesejo MP3.
                </p>
              </div>
              <Switch
                checked={enabled}
                disabled={pending || !state}
                onCheckedChange={(checked) => void handleToggle(checked)}
                aria-label={enabled ? 'Izklopi javno povezavo' : 'Vklopi javno povezavo'}
              />
            </div>

            {/* Povezava */}
            {enabled && fullUrl && (
              <div className="space-y-2.5">
                <label htmlFor="deli-url" className="sr-only">
                  Javna povezava epizode
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Link2
                      className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-zinc-500"
                      aria-hidden="true"
                    />
                    <Input
                      id="deli-url"
                      readOnly
                      value={fullUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      className="truncate border-zinc-800 bg-zinc-900 pr-2 pl-8 font-mono text-xs text-zinc-300"
                    />
                  </div>
                  {/* aria-live (Task 61): sprememba »Kopiraj → Kopirano« se
                      objavi bralcem zaslona, ne le vizualno. */}
                  <Button
                    size="sm"
                    variant="outline"
                    aria-live="polite"
                    className="shrink-0 gap-1.5 border-zinc-700 bg-zinc-950/60 text-zinc-300 hover:border-amber-500/40 hover:text-amber-400"
                    onClick={() => void handleCopy()}
                  >
                    {copied ? (
                      <>
                        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                        Kopirano
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5" aria-hidden="true" />
                        Kopiraj
                      </>
                    )}
                  </Button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={fullUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-amber-400 transition-colors hover:text-amber-300"
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                    Odpri javno stran
                  </a>
                  {state?.sharedAt && (
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                      Deljeno
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-zinc-400">
                  Prvi zagon predvajanja pripravi skupni MP3 (traja nekaj sekund), nato se
                  založi na disku.
                </p>
              </div>
            )}

            {!enabled && (
              <p className="text-xs leading-relaxed text-zinc-400">
                Izklopljena povezava preneha delovati takoj. Če jo kasneje znova vklopiš,
                žeton ostane enak — stara povezava spet deluje.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
