import { NextRequest, NextResponse } from 'next/server'
import { VOICE_IDS, isVoiceId, ttsToFile } from '@/lib/podcast-ai'

const PREVIEW_TEXTS: Record<string, string> = {
  rok: 'Živjo, jaz sem Rok. Naravni moški glas iz Ljubljane — z mano bo podcast zvenel kot iz pravega studia.',
  petra: 'Živjo, jaz sem Petra. Naravni ženski glas — vodiva podcast, ki bo poslušalcem všeč.',
  artur:
    'Živjo, jaz sem Artur. Moj glas prihaja prav iz slovenskega studia. Narediva res dober podcast.',
  jakob:
    'Živjo, jaz sem Jakob. Tisti višji in energičen glas — dajva se v to takoj!',
  matjaz:
    'Živjo, jaz sem Matjaž. Mirni in umirjeni ton — to je moja niša. Vsaka stvar dobi svoj čas.',
  srecko:
    'Živjo, jaz sem Srečko, gost vam sem iz Hrvaške. Dajva narediva dober podcast.',
  en: "Hey, this is my voice on the AI Podcast Studio. Let's record a great episode together.",
}

// Predogledi se keširajo na disku — po spremembi besedil invalidiramo stare verzije.
const PREVIEW_CACHE_VERSION = 'v2'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { voice?: unknown }
    const voice = typeof body.voice === 'string' ? body.voice : ''

    if (!isVoiceId(voice)) {
      return NextResponse.json(
        { error: `Neznan glas. Dovoljeni: ${VOICE_IDS.join(', ')}` },
        { status: 400 },
      )
    }

    const filename = `preview_${voice}_${PREVIEW_CACHE_VERSION}.wav`
    await ttsToFile(PREVIEW_TEXTS[voice] ?? PREVIEW_TEXTS.artur, voice, 1.0, filename)

    return NextResponse.json({ audioPath: `/api/audio/${filename}` })
  } catch (error) {
    console.error('[api/tts-preview POST]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Predoglas ni uspel' },
      { status: 500 },
    )
  }
}
