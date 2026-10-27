import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { AUDIO_DIR, serializeEpisode } from '@/lib/podcast-ai'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Oblika valovanja (Task 42) — per-line vrhovi za mini-mapo v predvajalniku.
 *
 * 100 % lokalno: vrstični zvoki so naši WAV PCM16 (24 kHz mono) → RIFF/PCM
 * razčlenjevalnik prebere vzorce DIREKTNO iz datoteke (brez ffmpeg) in izračuna
 * RMS po vedrih (2 vedra/s). Rezultat je keširan v `db/audio/peaks_<id>.json`
 * (neurejene RMS vrednosti; normalizacija 0..1 ob odgovoru prek globalnega
 * maksimuma — dodajanje novih vrstic pravilno prerazporedi lestvico).
 *
 * Časovnica: `durationSec` pride iz WAV glave ISTIH datotek, ki jih predvaja
 * predvajalnik → mini-map je poravnan z urnikom (elapsed/total) brez odmikov.
 */

/** Ločljivost vrhov: 2 stolpca na sekundo (dovolj gladko, majhen JSON). */
const PEAKS_PER_SECOND = 2

interface ParsedWavPeaks {
  durationSec: number
  /** neurejene RMS vrednosti po vedrih */
  rms: number[]
}

/**
 * Prebere RIFF/WAVE (PCM16) in izračuna RMS po vedrih.
 * Vrne `null`, če datoteka ni podprt WAV (takrat vrstice ne keširamo —
 * ob ponovni zahtevi poskusimo znova).
 */
function parseWavPeaks(buf: Buffer): ParsedWavPeaks | null {
  if (buf.length < 44) return null
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null

  let fmt: { audioFormat: number; channels: number; sampleRate: number; bits: number } | null = null
  let data: { offset: number; size: number } | null = null
  let pos = 12
  while (pos + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', pos, pos + 4)
    const chunkSize = buf.readUInt32LE(pos + 4)
    const body = pos + 8
    if (chunkId === 'fmt ' && chunkSize >= 16) {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      }
    } else if (chunkId === 'data') {
      data = { offset: body, size: Math.min(chunkSize, buf.length - body) }
    }
    if (chunkSize === 0) break // varnost: neobvezno skorjano (rf64 itd.)
    pos = body + chunkSize + (chunkSize % 2)
  }
  if (!fmt || !data || fmt.channels < 1 || fmt.sampleRate <= 0) return null
  // PCM (1) ali extensible (0xFFFE) z 16-bitnimi vzorci
  if ((fmt.audioFormat !== 1 && fmt.audioFormat !== 0xfffe) || fmt.bits !== 16) return null

  const bytesPerFrame = (fmt.bits / 8) * fmt.channels
  const frames = Math.floor(data.size / bytesPerFrame)
  if (frames <= 0) return null
  const durationSec = frames / fmt.sampleRate
  const bucketCount = Math.max(8, Math.round(durationSec * PEAKS_PER_SECOND))
  const framesPerBucket = frames / bucketCount

  const rms: number[] = []
  for (let b = 0; b < bucketCount; b += 1) {
    const startFrame = Math.floor(b * framesPerBucket)
    const endFrame = Math.min(frames, Math.floor((b + 1) * framesPerBucket))
    let sumSq = 0
    let count = 0
    for (let f = startFrame; f < endFrame; f += 1) {
      const frameOffset = data.offset + f * bytesPerFrame
      for (let c = 0; c < fmt.channels; c += 1) {
        const sample = buf.readInt16LE(frameOffset + c * 2) / 32768
        sumSq += sample * sample
        count += 1
      }
    }
    rms.push(count > 0 ? Math.sqrt(sumSq / count) : 0)
  }
  return { durationSec: Math.round(durationSec * 1000) / 1000, rms }
}

interface CacheEntry {
  audioPath: string
  durationSec: number
  rms: number[]
}

interface CacheFile {
  v: 1
  entries: Record<string, CacheEntry>
}

interface PeaksLine {
  id: string
  durationSec: number
  preDelayMs: number
  peaks: number[]
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const episode = await db.episode.findUnique({
      where: { id },
      include: { lines: true },
    })
    if (!episode) {
      return NextResponse.json({ error: 'Epizoda ne obstaja' }, { status: 404 })
    }
    /*
     * serializeEpisode izračuna tudi preDelayMs (kontekstne pavze / prekrivni
     * vzkliki) z ISTO deterministično matematiko kot predvajalnik in izvozi →
     * mini-map je poravnan z urnikom brez podvojevanja logike.
     */
    const serialized = serializeEpisode(episode)
    const audioLines = serialized.lines.filter((line) => line.audioPath)
    if (audioLines.length === 0) {
      return NextResponse.json({ lines: [] as PeaksLine[] })
    }

    // Keš: per-vrstica {audioPath, durationSec, rms} — spremenjena audioPath → preračun.
    const cachePath = path.join(AUDIO_DIR, `peaks_${id}.json`)
    let entries: Record<string, CacheEntry> = {}
    try {
      const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as CacheFile
      if (parsed?.v === 1 && parsed.entries) entries = parsed.entries
    } catch {
      // ni keša / pokvarjen → začni znova
    }

    let cacheChanged = false
    const computed: PeaksLine[] = []
    for (const line of audioLines) {
      const audioPath = line.audioPath as string
      const preDelayMs = line.preDelayMs ?? 0
      const cached = entries[line.id]
      if (cached && cached.audioPath === audioPath && Array.isArray(cached.rms) && cached.rms.length > 0) {
        computed.push({ id: line.id, durationSec: cached.durationSec, preDelayMs, peaks: cached.rms })
        continue
      }
      try {
        const file = path.join(AUDIO_DIR, path.basename(audioPath))
        const parsed = parseWavPeaks(fs.readFileSync(file))
        if (parsed && parsed.rms.length > 0) {
          const entry: CacheEntry = {
            audioPath,
            durationSec: parsed.durationSec,
            rms: parsed.rms.map((v) => Math.round(v * 1000) / 1000),
          }
          entries[line.id] = entry
          cacheChanged = true
          computed.push({ id: line.id, durationSec: entry.durationSec, preDelayMs, peaks: entry.rms })
          continue
        }
      } catch {
        // datoteka ne obstaja / se piše → brez vrhov tokrat (NE keširamo)
      }
      computed.push({ id: line.id, durationSec: 0, preDelayMs, peaks: [] })
    }

    if (cacheChanged) {
      try {
        fs.writeFileSync(cachePath, JSON.stringify({ v: 1, entries } satisfies CacheFile))
      } catch {
        // keš ni kritičen — samo brez njega ob naslednji zahtevi
      }
    }

    // Globalna normalizacija (0..1) prek najglasnejšega vedra cepe epizode.
    const globalMax = Math.max(1e-6, ...computed.flatMap((line) => line.peaks))
    const responseLines: PeaksLine[] = computed.map((line) => ({
      id: line.id,
      durationSec: line.durationSec,
      preDelayMs: line.preDelayMs,
      peaks: line.peaks.map((v) => Math.round((v / globalMax) * 1000) / 1000),
    }))

    return NextResponse.json({ lines: responseLines })
  } catch (error) {
    console.error('[api/episodes/[id]/peaks GET]', error)
    return NextResponse.json(
      { error: 'Peaks niso uspeli' },
      { status: 500 },
    )
  }
}
