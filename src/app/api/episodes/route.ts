import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { AUDIO_DIR, wavDurationMsFast } from '@/lib/podcast-ai'
import {
  STYLE_IDS,
  LANGUAGE_IDS,
  LENGTH_IDS,
  generatePodcastScript,
  generateShowNotes,
  fetchSourceContent,
  serializeEpisode,
} from '@/lib/podcast-ai'

export async function GET() {
  try {
    const episodes = await db.episode.findMany({
      orderBy: { createdAt: 'desc' },
      include: { lines: { select: { audioPath: true } } },
    })

    return NextResponse.json({
      episodes: episodes.map((e) => {
        // Skupno trajanje epizode (hitro branje WAV glav — brez nalaganja celih datotek)
        let totalDurationMs = 0
        for (const line of e.lines) {
          if (!line.audioPath) continue
          const file = path.join(AUDIO_DIR, path.basename(line.audioPath))
          if (fs.existsSync(file)) totalDurationMs += wavDurationMsFast(file)
        }
        return {
          id: e.id,
          title: e.title,
          topic: e.topic,
          style: e.style,
          language: e.language,
          status: e.status,
          length: e.length,
          sourceType: e.sourceType,
          coverPath: e.coverPath,
          hasSummary: Boolean(e.summaryJson),
          createdAt: e.createdAt,
          lineCount: e.lines.length,
          readyLines: e.lines.filter((l) => l.audioPath).length,
          totalDurationMs,
          playCount: e.playCount,
          lastPlayedAt: e.lastPlayedAt,
          progressMs: e.progressMs,
        }
      }),
    })
  } catch (error) {
    console.error('[api/episodes GET]', error)
    return NextResponse.json({ error: 'Napaka pri nalaganju epizod' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      topic?: unknown
      url?: unknown
      sourceText?: unknown
      style?: unknown
      language?: unknown
      length?: unknown
      focus?: unknown
      withGuest?: unknown
    }

    const style = typeof body.style === 'string' ? body.style : 'interview'
    const language = typeof body.language === 'string' ? body.language : 'sl'
    const length = typeof body.length === 'string' && (LENGTH_IDS as readonly string[]).includes(body.length) ? body.length : 'medium'
    const focus = typeof body.focus === 'string' ? body.focus.trim().slice(0, 2000) : ''
    const withGuest = body.withGuest === true
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''
    const rawText = typeof body.sourceText === 'string' ? body.sourceText.trim() : ''
    const topic = typeof body.topic === 'string' ? body.topic.trim() : ''

    if (!(STYLE_IDS as readonly string[]).includes(style)) {
      return NextResponse.json({ error: 'Neznan stil' }, { status: 400 })
    }
    if (!(LANGUAGE_IDS as readonly string[]).includes(language)) {
      return NextResponse.json({ error: 'Neznan jezik' }, { status: 400 })
    }

    // Vir epizode: tema / povezava / prilepljeno besedilo
    let sourceType = 'topic'
    let sourceUrl: string | null = null
    let sourceText: string | null = null
    let scriptTopic = topic

    try {
      if (rawUrl) {
        sourceType = 'url'
        sourceUrl = rawUrl
        if (rawUrl.length > 2000) {
          return NextResponse.json({ error: 'URL je predolg' }, { status: 400 })
        }
        scriptTopic = topic || 'Epizoda na podlagi spletnega članka'
      } else if (rawText) {
        sourceType = 'text'
        if (rawText.length < 100) {
          return NextResponse.json({ error: 'Besedilo vira je prekratko (najmanj 100 znakov)' }, { status: 400 })
        }
        if (rawText.length > 20000) {
          return NextResponse.json({ error: 'Besedilo vira je predolgo (največ 20.000 znakov)' }, { status: 400 })
        }
        sourceText = rawText
        scriptTopic = topic || 'Epizoda na podlagi prilepljenega besedila'
      }

      if (scriptTopic.length < 3 || scriptTopic.length > 500) {
        return NextResponse.json(
          { error: 'Tema mora imeti med 3 in 500 znakov' },
          { status: 400 },
        )
      }

      // Vir pridobimo PRED ustvarjanjem epizode (napaka URL → 400, brez mrtve epizode)
      let sourceContent: string | undefined
      if (sourceType === 'url' && sourceUrl) {
        try {
          sourceContent = await fetchSourceContent(sourceUrl)
        } catch (err) {
          return NextResponse.json(
            { error: `Vira ni bilo mogoče prebrati: ${err instanceof Error ? err.message : 'napaka'}` },
            { status: 400 },
          )
        }
        sourceText = sourceContent
      } else if (sourceType === 'text') {
        sourceContent = rawText
      }

      const script = await generatePodcastScript({
        topic: scriptTopic,
        style,
        language,
        length,
        focus: focus || undefined,
        withGuest,
        sourceContent: sourceContent || undefined,
      })

      // Show notes (povzetek + poudarki) — neuspel poskus NE prekliče epizode
      let summaryJson: string | null = null
      try {
        const notes = await generateShowNotes({
          title: script.title,
          topic: scriptTopic,
          language,
          lines: script.lines.map((l) => ({ speaker: l.speaker, text: l.text })),
        })
        summaryJson = JSON.stringify(notes)
      } catch (err) {
        console.error('[api/episodes POST] show notes failed (nadaljujem brez):', err)
      }

      const episode = await db.episode.create({
        data: {
          title: script.title,
          topic: scriptTopic,
          style,
          language,
          length,
          focus: focus || null,
          sourceType,
          sourceUrl,
          sourceText,
          status: 'script_ready',
          hostsJson: JSON.stringify(script.hosts),
          summaryJson,
          lines: {
            create: script.lines.map((line, idx) => ({
              idx,
              speaker: line.speaker,
              voice: line.voice,
              speed: line.speed,
              emotion: line.emotion,
              text: line.text,
              chapter: line.chapter,
            })),
          },
        },
        include: { lines: true },
      })

      return NextResponse.json({ episode: serializeEpisode(episode) })
    } catch (error) {
      console.error('[api/episodes POST]', error)
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? `Generiranje scenarija ni uspelo: ${error.message}`
              : 'Generiranje scenarija ni uspelo',
        },
        { status: 500 },
      )
    }
  } catch (error) {
    console.error('[api/episodes POST] body', error)
    return NextResponse.json({ error: 'Napačna zahteva' }, { status: 400 })
  }
}
