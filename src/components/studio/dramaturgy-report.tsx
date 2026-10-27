'use client';

/**
 * Poročilo o dramaturgiji (Task 44) — isti pravili kot dialog za novo epizodo
 * (script-analysis.ts), prikazano za OBSTOJEČO epizodo v studiu.
 *
 * Prikazuje:
 *  - statistične čipe (trajanje, vrstice, besede, poglavja, govorci, dolžina vrstic)
 *  - ravnovesje govorcev (vrstice + besede, stolpci)
 *  - 7 dramaturških pregledov z ikonami po stanju (ok / warn / info)
 *
 * Vsi izračuni so lokalni (regexi + štetje besed) — 0 AI modelov.
 */

import { CircleCheck, Info, TriangleAlert } from 'lucide-react';

import { formatDuration, type ScriptAnalysis } from '@/lib/script-analysis';
import { hostColor } from '@/lib/podcast-types';
import { cn } from '@/lib/utils';

interface DramaturgyReportProps {
  analysis: ScriptAnalysis;
  /** realno trajanje v sekundah (iz avdia); če ni znano, se izpiše ocena */
  realSeconds?: number;
}

export function DramaturgyReport({ analysis, realSeconds }: DramaturgyReportProps) {
  const hasRealDuration = typeof realSeconds === 'number' && realSeconds > 0;
  const durationSec = hasRealDuration ? (realSeconds as number) : analysis.estimatedSeconds;
  const totalLines = analysis.balance.reduce((sum, b) => sum + b.lines, 0);
  const totalWords = analysis.balance.reduce((sum, b) => sum + b.words, 0);

  const stats: { label: string; value: string; hint?: string }[] = [
    {
      label: 'Trajanje',
      value: formatDuration(durationSec),
      hint: hasRealDuration ? 'iz avdia' : 'ocena iz besed',
    },
    { label: 'Vrstice', value: String(totalLines) },
    { label: 'Besede', value: totalWords.toLocaleString('sl-SI') },
    { label: 'Poglavja', value: String(analysis.chapterCount) },
    {
      label: 'Govorci',
      value: String(analysis.speakerCount),
      hint: analysis.balance.map((b) => b.speaker).join(', '),
    },
    {
      label: 'Povprečna vrstica',
      value: `${String(analysis.avgWordsPerLine).replace('.', ',')} besed`,
    },
    { label: 'Najdaljša vrstica', value: `${String(analysis.longestLineWords)} besed` },
  ];

  return (
    <div className="space-y-5">
      {/* Statistični čipi */}
      <div className="flex flex-wrap gap-2">
        {stats.map((stat) => (
          <div
            key={stat.label}
            title={stat.hint}
            className="min-w-24 flex-1 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 sm:flex-none sm:basis-28"
          >
            <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
              {stat.label}
            </p>
            <p className="mt-0.5 text-lg leading-tight font-semibold tabular-nums text-zinc-100">
              {stat.value}
            </p>
            {stat.hint && (
              <p className="mt-0.5 truncate text-[11px] text-zinc-600">{stat.hint}</p>
            )}
          </div>
        ))}
      </div>

      {/* Pregledi */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold tracking-[0.2em] text-zinc-500 uppercase">
          Dramaturški pregled
          {analysis.warnings > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] tracking-normal text-amber-400 normal-case">
              <TriangleAlert className="size-3" aria-hidden="true" />
              {analysis.warnings}{' '}
              {analysis.warnings === 1
                ? 'opozorilo'
                : analysis.warnings === 2
                  ? 'opozorili'
                  : 'opozorila'}
            </span>
          )}
        </h4>
        <ul className="grid gap-2.5 md:grid-cols-2">
          {analysis.checks.map((check) => (
            <li
              key={check.id}
              className="flex gap-2.5 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3"
            >
              {check.state === 'ok' ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden="true" />
              ) : check.state === 'warn' ? (
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
              ) : (
                <Info className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden="true" />
              )}
              <div className="min-w-0">
                <p
                  className={cn(
                    'text-sm font-medium',
                    check.state === 'ok'
                      ? 'text-emerald-400'
                      : check.state === 'warn'
                        ? 'text-amber-400'
                        : 'text-zinc-300',
                  )}
                >
                  {check.title}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{check.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Ravnovesje govorcev */}
      {analysis.balance.length >= 2 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold tracking-[0.2em] text-zinc-500 uppercase">
            Ravnovesje govorcev
          </h4>
          {analysis.balance.map((b, i) => (
            <div key={b.speaker} className="flex items-center gap-3">
              <span
                className={cn('size-2.5 shrink-0 rounded-full', hostColor(i).dot)}
                aria-hidden="true"
              />
              <span className="w-24 shrink-0 truncate text-sm text-zinc-200">{b.speaker}</span>
              <div
                className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-800"
                role="img"
                aria-label={`${b.speaker}: ${Math.round(b.share * 100)} % vrstic, ${b.words} besed`}
              >
                <div
                  className={cn('h-full rounded-full', hostColor(i).dot)}
                  style={{ width: `${Math.round(b.share * 100)}%` }}
                />
              </div>
              <span className="w-32 shrink-0 text-right text-xs tabular-nums text-zinc-500">
                {b.lines} vrst. · {b.words} besed
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-zinc-600">
        Pravila so izpeljana iz poklicne radijske dramaturgije (kavelj, vodniki, poglavja,
        monologi, ravnovesje, zaključek, tempo) — pregled teče lokalno, brez AI modelov.
      </p>
    </div>
  );
}
