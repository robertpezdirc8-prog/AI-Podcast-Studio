import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  ttsToFile,
  syncEpisodeStatus,
  removeEpisodeExport,
  removeEpisodeRangeClips,
  removeLineClip,
  serializeEpisode,
  AUDIO_DIR,
  wavDurationMs,
} from '@/lib/podcast-ai'
import fs from 'fs'
import path from 'path'

type Ctx = { params: Promise<{ id: string }> }

/** Uredi besedilo vrstice + regeneriraj zvok (Jellypod script editor stil). */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const body = (await req.json()) as { text?: unknown }
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 900) : ''

    if (!text) {
      return NextResponse.json({ error: 'Besedilo ne sme biti prazno' }, { status: 400 })
    }

    const line = await db.line.findUnique({
      where: { id },
      include: { episode: { select: { id: true, title: true } } },
    })
    if (!line) {
      return NextResponse.json({ error: 'Vrstica ne obstaja' }, { status: 404 })
    }

    // Izbriši star zvok (če je besedilo spremenjeno, je zvok zastarel)
    const textChanged = text !== line.text
    let audioPath: string | null = line.audioPath

    if (textChanged) {
      if (line.audioPath) {
        const filePath = path.join(AUDIO_DIR, path.basename(line.audioPath))
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
        } catch {
          // ignore
        }
      }
      audioPath = null
    }

    await db.line.update({ where: { id }, data: { text, audioPath } })

    // Takoj regeneriraj zvok, če je besedilo spremenjeno
    let durationMs = 0
    if (textChanged) {
      const filename = `${line.id}.wav`
      const result = await ttsToFile(text, line.voice, line.speed, filename)
      audioPath = `/api/audio/${filename}`
      durationMs = result.durationMs
      await db.line.update({ where: { id }, data: { audioPath } })
      await syncEpisodeStatus(line.episode.id)
      removeEpisodeExport(line.episode.id)
      // Citatni izrezek vrstice je po urejanju zastarel
      removeLineClip(id)
      // Izrezki poglavij (ključ <epizoda>:<index>) so prav tako zastareli
      removeEpisodeRangeClips(line.episode.id)
    }

    const updated = await db.line.findUnique({ where: { id } })
    return NextResponse.json({
      id,
      text,
      audioPath: updated?.audioPath ?? audioPath,
      durationMs,
    })
  } catch (error) {
    console.error('[api/lines/:id PATCH]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Urejanje vrstice ni uspelo' },
      { status: 500 },
    )
  }
}

/** Izbriši vrstico (z zvokom) in prerazporedi indekse preostalih vrstic. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const line = await db.line.findUnique({ where: { id } })
    if (!line) {
      return NextResponse.json({ error: 'Vrstica ne obstaja' }, { status: 404 })
    }

    // Zvok vrstice ni več potreben
    if (line.audioPath) {
      const filePath = path.join(AUDIO_DIR, path.basename(line.audioPath))
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      } catch {
        // ignore
      }
    }

    await db.line.delete({ where: { id } })

    // Kompaktna reindeksacija: idx = pozicija med preostalimi (0..n-1)
    const remaining = await db.line.findMany({
      where: { episodeId: line.episodeId },
      orderBy: { idx: 'asc' },
    })
    await db.$transaction(
      remaining.map((l, i) => db.line.update({ where: { id: l.id }, data: { idx: i } })),
    )

    await syncEpisodeStatus(line.episodeId)
    removeEpisodeExport(line.episodeId)
    removeLineClip(id)
    removeEpisodeRangeClips(line.episodeId)

    // Sveža epizoda (nove pavze sosednjih vrstic po reindeksaciji)
    const fresh = await db.episode.findUnique({
      where: { id: line.episodeId },
      include: { lines: true },
    })

    return NextResponse.json({
      success: true,
      episode: fresh ? serializeEpisode(fresh) : null,
    })
  } catch (error) {
    console.error('[api/lines/:id DELETE]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Brisanje vrstice ni uspelo' },
      { status: 500 },
    )
  }
}
