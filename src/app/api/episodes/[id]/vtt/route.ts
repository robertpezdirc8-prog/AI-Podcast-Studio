import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildVtt } from '@/lib/podcast-ai'

type Ctx = { params: Promise<{ id: string }> }

/**
 * WebVTT podnapisi (Podcasting 2.0 podcast:transcript type="text/vtt").
 * Časovni žigi sovpadajo z MP3 izvozom (kontekstne pavze + prekrivanja).
 * Prav tako jih znajo predvajalniki prikazati kot captions.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const episode = await db.episode.findUnique({
      where: { id },
      include: { lines: true },
    })
    if (!episode) {
      return NextResponse.json({ error: 'Epizoda ne obstaja' }, { status: 404 })
    }

    const lines = episode.lines.slice().sort((a, b) => a.idx - b.idx)
    const language = episode.language || 'sl'
    const vtt = buildVtt(
      lines.map((l) => ({
        speaker: l.speaker,
        text: l.text,
        audioPath: l.audioPath,
        chapter: l.chapter,
        emotion: l.emotion,
      })),
      language,
    )
    if (!vtt) {
      return NextResponse.json({ error: 'Podnapisi niso na voljo (ni zvoka)' }, { status: 409 })
    }

    const safeTitle = episode.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 60) || 'epizoda'
    return new NextResponse(vtt, {
      status: 200,
      headers: {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(safeTitle)}.vtt"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[api/episodes/:id/vtt GET]', error)
    return NextResponse.json({ error: 'Napaka pri generiranju WebVTT' }, { status: 500 })
  }
}
