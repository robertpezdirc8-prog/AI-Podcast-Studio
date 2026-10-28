import { NextRequest, NextResponse } from 'next/server'
import { VOICE_IDS, isVoiceId, ttsToFile } from '@/lib/podcast-ai'

const PREVIEW_TEXTS: Record<string, string> = {
  rok: 'Živjo, jaz sem Rok! Naravni moški glas iz Ljubljane — z mano bo podcast zvenel kot iz pravega studia.',
  petra: 'Živjo, jaz sem Petra! Sem naravni ženski glas — vesela sem, da lahko vodiva podcast skupaj!',
  artur:
    'Živjo, jaz sem Artur! Moj glas prihaja prav iz slovenskega studia. Dajva narediva ful dober podcast!',
  jakob:
    'Živjo, jaz sem Jakob! Tisti višji in energičen glas — ful sem navdušen, dajva se v to takoj!',
  matjaz:
    'Živjo, jaz sem Matjaž. Mirni in umirjeni ton — to je moja niša. Vsaka stvar dobi svoj čas.',
  srecko:
    'Živjo, jaz sem Srečko! Gost sem vam iz Hrvaške — ajme, ful sem razposajen! Dajva narediva dober podcast!',
  en: "Hey! This is my voice on the AI Podcast Studio. Let's record an awesome episode together!",
}

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

    const filename = `preview_${voice}.wav`
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
