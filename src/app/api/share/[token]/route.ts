import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeExportTimeline, parseSummary } from '@/lib/podcast-ai'

type Ctx = { params: Promise<{ token: string }> }

const SAFE_TOKEN = /^[A-Za-z0-9_-]{10,40}$/

/** Javni žeton ne sme razkriti ID-ja epizode — zato ločen, gol odgovor (Task 45). */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { token } = await ctx.params
    if (!SAFE_TOKEN.test(token)) {
      return NextResponse.json({ error: 'Povezava ne velja' }, { status: 404 })
    }

    const episode = await db.episode.findFirst({
      where: { shareToken: token, sharedAt: { not: null } },
      include: { lines: { orderBy: { idx: 'asc' } } },
    })
    if (!episode) {
      return NextResponse.json(
        { error: 'Ta povezava ne velja več — delitev je bila izklopljena.' },
        { status: 404 },
      )
    }

    let hosts: { name: string; voice: string }[] = []
    try {
      const parsed = JSON.parse(episode.hostsJson) as { name?: string; voice?: string }[]
      if (Array.isArray(parsed)) {
        hosts = parsed
          .map((h) => ({ name: String(h?.name ?? '').trim(), voice: String(h?.voice ?? '') }))
          .filter((h) => h.name.length > 0)
      }
    } catch {
      hosts = []
    }

    const sorted = episode.lines.slice().sort((a, b) => a.idx - b.idx)
    const readyLines = sorted.filter((l) => l.audioPath)
    const hasAudio = sorted.length > 0 && readyLines.length === sorted.length

    /*
     * Poglavja + trajanje na ISTI časovni liniji kot MP3 izvoz (uvodna
     * melodija, kontekstne pavze, prekrivanja) — samo ko je zvok popoln.
     */
    let chapters: { title: string; startSec: number }[] = []
    let durationSec = 0
    if (hasAudio) {
      const timeline = computeExportTimeline(readyLines)
      chapters = timeline.markers.map((m) => ({
        title: m.title,
        startSec: Math.round(m.startMs / 100) / 10,
      }))
      durationSec = Math.round(timeline.totalMs / 1000)
    }

    return NextResponse.json({
      episode: {
        title: episode.title,
        topic: episode.topic,
        style: episode.style,
        language: episode.language,
        status: episode.status,
        coverPath: episode.coverPath,
        hosts,
        summary: parseSummary(episode.summaryJson),
        createdAt: episode.createdAt,
        hasAudio,
        durationSec,
        chapters,
        lines: sorted.map((l) => ({
          speaker: l.speaker,
          text: l.text,
          chapter: l.chapter,
        })),
      },
    })
  } catch (error) {
    console.error('[api/share/:token GET]', error)
    return NextResponse.json({ error: 'Napaka pri nalaganju deljene epizode' }, { status: 500 })
  }
}
