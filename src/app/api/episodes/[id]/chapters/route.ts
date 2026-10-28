import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildYoutubeChaptersText, computeExportChapters } from '@/lib/podcast-ai'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Poglavja epizode:
 *  - privzeto: format za YouTube opis (prvi žig 0:00, m:ss Naslov);
 *  - `?format=json`: Podcasting 2.0 chapters JSON (application/json+chapters)
 *    za `podcast:chapters` oznako v RSS — startTime v SEKUNDAH (float),
 *    prvo poglavje na 0 (uvodna melodija), kot na izvozu MP3/MP4.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
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
    const markers = computeExportChapters(
      lines.map((l) => ({
        speaker: l.speaker,
        text: l.text,
        audioPath: l.audioPath,
        chapter: l.chapter,
        emotion: l.emotion,
      })),
    )

    const asciiName =
      episode.title
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/["\\]/g, '')
        .trim() || 'epizoda'

    if (req.nextUrl.searchParams.get('format') === 'json') {
      const chaptersJson = {
        version: '1.2.0',
        title: episode.title,
        podcastName: 'AI Podcast Studio',
        chapters: markers.map((m) => ({
          startTime: Math.round(m.startMs) / 1000,
          title: m.title,
        })),
      }
      return new NextResponse(JSON.stringify(chaptersJson, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json+chapters; charset=utf-8',
          'Content-Disposition': `attachment; filename="${asciiName}-poglavja.json"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    const text = buildYoutubeChaptersText(markers)
    return new NextResponse(text, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${asciiName}-poglavja.txt"; filename*=UTF-8''${encodeURIComponent(episode.title)}-poglavja.txt`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[api/episodes/:id/chapters GET]', error)
    return NextResponse.json({ error: 'Prenos poglavij ni uspel' }, { status: 500 })
  }
}
