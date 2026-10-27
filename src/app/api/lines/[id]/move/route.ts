import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  removeEpisodeExport,
  removeEpisodeRangeClips,
  serializeEpisode,
} from '@/lib/podcast-ai'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Premakni vrstico za ENO mesto gor ali dol (zamenjava vrstnega reda s sosedom).
 * Zvok vrstic se ne spreminja — samo `idx` se zamenja; izvoz in izrezki
 * poglavij postanejo zastareli (vrstni red je del miksane časovnice).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const body = (await req.json()) as { direction?: unknown }
    const direction = body.direction === 'up' || body.direction === 'down' ? body.direction : null

    if (!direction) {
      return NextResponse.json({ error: 'Smer mora biti "up" ali "down"' }, { status: 400 })
    }

    const line = await db.line.findUnique({ where: { id } })
    if (!line) {
      return NextResponse.json({ error: 'Vrstica ne obstaja' }, { status: 404 })
    }

    // Najbližji sosed v želeni smeri (vrstice iste epizode)
    const neighbor = await db.line.findFirst({
      where: {
        episodeId: line.episodeId,
        idx: direction === 'up' ? { lt: line.idx } : { gt: line.idx },
      },
      orderBy: { idx: direction === 'up' ? 'desc' : 'asc' },
    })
    if (!neighbor) {
      return NextResponse.json(
        {
          error:
            direction === 'up'
              ? 'Vrstica je že na začetku scenarija'
              : 'Vrstica je že na koncu scenarija',
        },
        { status: 400 },
      )
    }

    await db.$transaction([
      db.line.update({ where: { id: line.id }, data: { idx: neighbor.idx } }),
      db.line.update({ where: { id: neighbor.id }, data: { idx: line.idx } }),
    ])

    removeEpisodeExport(line.episodeId)
    // Če premik prečka mejo poglavja, se sestava obeh poglavij spremeni
    if ((line.chapter ?? null) !== (neighbor.chapter ?? null)) {
      removeEpisodeRangeClips(line.episodeId)
    }

    // Sveža epizoda (kontekstne pavze okoli zamenjanih vrstic so se spremenile)
    const fresh = await db.episode.findUnique({
      where: { id: line.episodeId },
      include: { lines: true },
    })

    return NextResponse.json({
      success: true,
      episode: fresh ? serializeEpisode(fresh) : null,
    })
  } catch (error) {
    console.error('[api/lines/:id/move POST]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Premikanje vrstice ni uspelo' },
      { status: 500 },
    )
  }
}
