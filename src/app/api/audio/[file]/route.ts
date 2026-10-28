import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { AUDIO_DIR, ensureGapFile } from '@/lib/podcast-ai'
import { rangeResponse } from '@/lib/http-range'

type Ctx = { params: Promise<{ file: string }> }

const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/
/**
 * Room tone med vrsticami (Task 49): predvajalnik zahteva `gap_<s>.wav` ŽE MED
 * PREDVAJANJEM, datoteke pa do zdaj nastale samo ob izvozu MP3 → 404 + tiha
 * pavza. Sedaj jih ta ruta generira OB ZAHTEVU (isti room tone kot izvoz).
 * Dovoljen razpon: 10 ms … 30 s (napačne/absurdne dolžine ostanejo 404).
 */
const GAP_PATTERN = /^gap_(\d+\.\d{1,2})\.wav$/
const GAP_MIN_SECONDS = 0.01
const GAP_MAX_SECONDS = 30

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { file } = await ctx.params

    if (!SAFE_FILENAME.test(file) || file.includes('..')) {
      return NextResponse.json({ error: 'Neveljavno ime datoteke' }, { status: 400 })
    }

    let filePath = path.join(AUDIO_DIR, file)
    if (!fs.existsSync(filePath)) {
      const gapMatch = GAP_PATTERN.exec(file)
      if (gapMatch) {
        const seconds = Number(gapMatch[1])
        if (seconds >= GAP_MIN_SECONDS && seconds <= GAP_MAX_SECONDS) {
          try {
            filePath = await ensureGapFile(seconds)
          } catch (err) {
            console.error('[api/audio/:file GET] generacija room tona:', err)
          }
        }
      }
    }

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: 'Datoteka ne obstaja' }, { status: 404 })
    }

    const buffer = fs.readFileSync(filePath)
    const contentType = file.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav'
    /* Range (Task 57): pravi 206 za seek/nadaljevanje, 200 za celoto. */
    return rangeResponse(req, buffer, contentType, 'public, max-age=31536000, immutable')
  } catch (error) {
    console.error('[api/audio/:file GET]', error)
    return NextResponse.json({ error: 'Napaka pri branju zvoka' }, { status: 500 })
  }
}
