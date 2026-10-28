'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, MessageCircleQuestion, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Equalizer } from './equalizer';

interface AskHostsCardProps {
  /** Pokliče API, ustavi predvajanje, zamenja vrstice in skoči na prvi odgovor. Vrne ID-je novih vrstic. */
  onAsk: (question: string) => Promise<string[]>;
}

/** Slovenski pravilni množinski zapis: »5 novih vrstic«, »3 nove vrstice«, »2 novi vrstici«. */
function newLinesLabel(count: number): string {
  if (count === 1) return '1 nova vrstica';
  if (count === 2) return '2 novi vrstici';
  if (count === 3 || count === 4) return `${count} nove vrstice`;
  return `${count} novih vrstic`;
}

/**
 * Interaktivni način: poslušalec zastavi vprašanje, voditelja ga prebereta
 * v oddaji in odgovorita (3–6 novih vrstic na koncu scenarija).
 */
export function AskHostsCard({ onAsk }: AskHostsCardProps) {
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Števec sekund med čakanjem (LLM + TTS traja 15–60 s).
  useEffect(() => {
    if (!pending) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((prev) => prev + 1), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  const handleAsk = async () => {
    const q = question.trim();
    if (q.length < 3 || pending) return;
    setPending(true);
    try {
      const newLineIds = await onAsk(q);
      toast.success(`Voditelja sta odgovorila — ${newLinesLabel(newLineIds.length)}!`);
      setQuestion('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Vprašanja ni bilo mogoče vstaviti v oddajo. Poskusi znova.');
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  };

  return (
    <motion.section
      aria-label="Vprašaj voditelja"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mt-6 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 sm:p-6"
    >
      <div className="flex items-center gap-2">
        <MessageCircleQuestion className="size-5 shrink-0 text-amber-400" aria-hidden="true" />
        <h3 className="text-base font-semibold text-zinc-100">Vprašaj voditelja</h3>
      </div>
      <p className="mt-1 text-sm text-zinc-400">
        Poslušalci lahko vstavijo vprašanje v oddajo — voditelja ga prebereta in odgovorita.
      </p>

      <div className="mt-4 flex gap-2">
        <Input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void handleAsk();
          }}
          placeholder="Zastavi vprašanje voditeljema …"
          maxLength={500}
          disabled={pending}
          aria-label="Tvoje vprašanje za voditelja"
          className="h-10 border-zinc-800 bg-zinc-950/60 text-zinc-100 placeholder:text-zinc-400 focus-visible:border-amber-500/50 focus-visible:ring-amber-500/20"
        />
        <Button
          size="icon"
          aria-label="Pošlji vprašanje"
          disabled={pending || question.trim().length < 3}
          onClick={() => void handleAsk()}
          className="size-10 shrink-0 bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-orange-950/40 hover:from-amber-400 hover:to-orange-500"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
        </Button>
      </div>

      {pending && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          className="mt-3 flex items-center gap-3 rounded-lg border border-amber-500/20 bg-zinc-950/40 px-3 py-2.5"
        >
          <Equalizer active bars={4} className="h-4 shrink-0" />
          <div className="min-w-0 flex-1 text-sm">
            <span className="font-medium text-amber-200">Voditelja prebereta vprašanje …</span>
            <span className="ml-1.5 text-xs tabular-nums text-zinc-400">
              {elapsed} s · to lahko traja do 60 s
            </span>
          </div>
        </motion.div>
      )}
    </motion.section>
  );
}
