import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { db } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Naključni, neugljiv žeton povezave (16 znakov base64url).
 * Ustvari se enkrat in ostane STABILEN — izklop delitve le skrije epizodo,
 * ponoven vklop uporabi isti žeton (povezava se ne spremeni).
 */
function newShareToken(): string {
  return crypto.randomBytes(12).toString('base64url')
}

/** Trenutno stanje delitve epizode (brez stranskih učinkov). */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const episode = await db.episode.findUnique({
      where: { id },
      select: { shareToken: true, sharedAt: true },
    })
    if (!episode) {
      return NextResponse.json({ error: 'Epizoda ne obstaja' }, { status: 404 })
    }
    return NextResponse.json({
      shareToken: episode.shareToken,
      sharedAt: episode.sharedAt,
    })
  } catch (error) {
    console.error('[api/episodes/:id/share GET]', error)
    return NextResponse.json({ error: 'Napaka pri branju stanja delitve' }, { status: 500 })
  }
}

/**
 * Vklop/izklop javne delitve (Task 45).
 *  - { enabled: true }  → ustvari žeton (če ga še ni) + sharedAt = zdaj
 *  - { enabled: false } → sharedAt = null (povezava preneha delovati)
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const body = (await req.json().catch(() => null)) as { enabled?: boolean } | null
    const enabled = body?.enabled
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'Manjka polje "enabled"' }, { status: 400 })
    }

    const existing = await db.episode.findUnique({
      where: { id },
      select: { shareToken: true, title: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Epizoda ne obstaja' }, { status: 404 })
    }

    const shareToken = existing.shareToken ?? newShareToken()
    const updated = await db.episode.update({
      where: { id },
      data: { shareToken, sharedAt: enabled ? new Date() : null },
      select: { shareToken: true, sharedAt: true },
    })

    console.log(
      `[delitev] "${existing.title}" → ${enabled ? 'VKLOPENA' : 'IZKLOPENA'} (žeton ${shareToken})`,
    )
    return NextResponse.json({
      shareToken: updated.shareToken,
      sharedAt: updated.sharedAt,
      url: `/?deli=${updated.shareToken}`,
    })
  } catch (error) {
    console.error('[api/episodes/:id/share POST]', error)
    return NextResponse.json({ error: 'Nastavitev delitve ni uspela' }, { status: 500 })
  }
}
