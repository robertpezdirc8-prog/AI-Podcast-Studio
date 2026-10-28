import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { db } from '@/lib/db'
import { exportEpisodeMp3Locked } from '@/lib/podcast-ai'
import { rangeResponse } from '@/lib/http-range'

type Ctx = { params: Promise<{ token: string }> }

const SAFE_TOKEN = /^[A-Za-z0-9_-]{10,40}$/

/**
 * Javni zvok deljene epizode (Task 45) — ISTDMP3 kot "Izvoz" (uvodna melodija,
 * kontekstne pavze, ID3 znake, ovitek), vendar dostopna LE preko žetona.
 * `?prenos=1` vsili prenos (attachment), privzeto inline za predvajalnik.
 * Prvi klic lahko traja nekaj sekund (ffmpeg) — izvod se kešira na disku.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { token } = await ctx.params
    if (!SAFE_TOKEN.test(token)) {
      return NextResponse.json({ error: 'Povezava ne velja' }, { status: 404 })
    }

    const episode = await db.episode.findFirst({
      where: { shareToken: token, sharedAt: { not: null } },
      include: { lines: true },
    })
    if (!episode) {
      return NextResponse.json(
        { error: 'Ta povezava ne velja več — delitev je bila izklopljena.' },
        { status: 404 },
      )
    }

    const lines = episode.lines.slice().sort((a, b) => a.idx - b.idx)
    if (lines.length === 0 || !lines.every((l) => l.audioPath)) {
      return NextResponse.json(
        { error: 'Epizoda še ni pripravljena — zvok ni na voljo' },
        { status: 409 },
      )
    }

    let artist = 'AI Podcast Studio'
    try {
      const hosts = JSON.parse(episode.hostsJson) as { name?: string }[]
      const names = Array.isArray(hosts)
        ? hosts.map((h) => (h?.name ?? '').trim()).filter(Boolean)
        : []
      if (names.length > 0) artist = names.join(' & ')
    } catch {
      // privzeta vrednost ostane
    }

    const exportFile = await exportEpisodeMp3Locked(episode.id, lines, {
      withJingle: true,
      title: episode.title,
      artist,
      coverPath: episode.coverPath,
    })
    const buffer = fs.readFileSync(exportFile.filePath)

    const asDownload = req.nextUrl.searchParams.get('prenos') === '1'
    const asciiName =
      episode.title
        .replace(/[^\x20-\x7E]/g, '')
        .replace(/["\\]/g, '')
        .trim() || 'epizoda'

    /*
     * Range (Task 57): pravi 206/416 — brskalnik ob iskanju ne prejme več
     * celega MP3, `?prenos=1` pa postane NADALJUJEM prenos (curl -C -).
     */
    return rangeResponse(req, buffer, 'audio/mpeg', 'no-store', {
      'Content-Disposition': asDownload
        ? `attachment; filename="${asciiName}.mp3"; filename*=UTF-8''${encodeURIComponent(episode.title)}.mp3`
        : 'inline',
    })
  } catch (error) {
    console.error('[api/share/:token/audio GET]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Zvok deljene epizode ni uspel' },
      { status: 500 },
    )
  }
}
