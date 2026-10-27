import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  ttsToFile,
  syncEpisodeStatus,
  removeEpisodeExport,
  removeEpisodeRangeClips,
  serializeEpisode,
  type HostJson,
} from '@/lib/podcast-ai'

type Ctx = { params: Promise<{ id: string }> }

const FALLBACK_VOICE_KEYS = ['rok', 'petra', 'jakob', 'matjaz'] as const

/*
 * Določi glas + hitrost za novega govorca (v tem vrstnem redu):
 * 1. voditelj iz hostsJson z enakim imenom,
 * 2. obstoječa vrstica z istim govorcem (epizoda je vir resnice),
 * 3. hevristika: ime brez šumnikov malo (Matjaž → matjaz) med znanimi ključi,
 * 4. privzeti Rok.
 */
function resolveVoiceFor(
  speaker: string,
  hosts: HostJson[],
  lines: { speaker: string; voice: string; speed: number }[],
): { voice: string; speed: number } {
  const host = hosts.find((h) => h.name === speaker)
  if (host) return { voice: host.voice, speed: host.speed }
  const same = lines.find((l) => l.speaker === speaker)
  if (same) return { voice: same.voice, speed: same.speed }
  const key = speaker
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '')
  if ((FALLBACK_VOICE_KEYS as readonly string[]).includes(key)) return { voice: key, speed: 1.0 }
  return { voice: 'rok', speed: 1.0 }
}

/**
 * Vstavi NOVO vrstico v scenarij (brez AI): pod podano vrstico (`afterLineId`)
 * ali na konec (`afterLineId: null`). Vse vrstice za vstavitveno mesto se
 * premaknejo za eno mesto naprej, glas pa se takoj sintetizira (Edge TTS /
 * Piper rezerva) — vrstica je po odgovoru takoj predvajalna.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const body = (await req.json()) as {
      afterLineId?: unknown
      speaker?: unknown
      text?: unknown
    }
    const afterLineId = typeof body.afterLineId === 'string' ? body.afterLineId : null
    const speaker = typeof body.speaker === 'string' ? body.speaker.trim().slice(0, 60) : ''
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 900) : ''

    if (!speaker) {
      return NextResponse.json({ error: 'Govorec je obvezen' }, { status: 400 })
    }
    if (!text) {
      return NextResponse.json({ error: 'Besedilo ne sme biti prazno' }, { status: 400 })
    }

    const episode = await db.episode.findUnique({
      where: { id },
      include: { lines: true },
    })
    if (!episode) {
      return NextResponse.json({ error: 'Epizoda ne obstaja' }, { status: 404 })
    }

    let hosts: HostJson[] = []
    try {
      const parsed = JSON.parse(episode.hostsJson) as HostJson[]
      if (Array.isArray(parsed)) hosts = parsed
    } catch {
      hosts = []
    }

    // Vstavitveno mesto: idx podane vrstice + 1, sicer konec scenarija
    let insertIdx: number
    if (afterLineId) {
      const after = episode.lines.find((l) => l.id === afterLineId)
      if (!after) {
        return NextResponse.json({ error: 'Referenčna vrstica ne obstaja' }, { status: 400 })
      }
      insertIdx = after.idx + 1
    } else {
      insertIdx = episode.lines.reduce((m, l) => Math.max(m, l.idx), -1) + 1
    }

    const { voice, speed } = resolveVoiceFor(speaker, hosts, episode.lines)

    // Premik obstoječih + vstavitev v ENI transakciji (brez unique omejitve na idx)
    const created = await db.$transaction(async (tx) => {
      await tx.line.updateMany({
        where: { episodeId: id, idx: { gte: insertIdx } },
        data: { idx: { increment: 1 } },
      })
      return tx.line.create({
        data: {
          episodeId: id,
          idx: insertIdx,
          speaker,
          voice,
          speed,
          emotion: null,
          text,
          chapter: null,
        },
      })
    })

    // Takojšnja sinteza — enak vzorec kot urejanje vrstice (PATCH)
    let durationMs = 0
    let audioPath: string | null = null
    try {
      const result = await ttsToFile(text, voice, speed, `${created.id}.wav`)
      audioPath = `/api/audio/${created.id}.wav`
      durationMs = result.durationMs
      await db.line.update({ where: { id: created.id }, data: { audioPath } })
    } catch (ttsError) {
      console.error('[api/episodes/:id/lines POST] TTS ni uspel:', ttsError)
      // vrstica ostane brez zvoka — uporabnik jo lahko sintetizira kasneje
    }

    await syncEpisodeStatus(id)
    removeEpisodeExport(id)
    removeEpisodeRangeClips(id)

    // Celoten svež odgovor: kontekstne pavze (preDelayMs) sosednjih vrstic se
    // spremene ob vsakem vstavljanju — klient zamenja celoten seznam vrstic.
    const fresh = await db.episode.findUnique({
      where: { id },
      include: { lines: true },
    })

    return NextResponse.json({
      episode: fresh ? serializeEpisode(fresh) : null,
      lineId: created.id,
      durationMs,
    })
  } catch (error) {
    console.error('[api/episodes/:id/lines POST]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Vstavljanje vrstice ni uspelo' },
      { status: 500 },
    )
  }
}
