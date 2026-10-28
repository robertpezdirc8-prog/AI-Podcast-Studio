import { NextRequest, NextResponse } from 'next/server'

/**
 * Enoten odgovor na zahtevke Z `Range` (Task 57) za zvočne rute.
 *
 * Zakaj: obe zvočni ruti sta razglasili `Accept-Ranges: bytes`, a sta VEDNO
 * vrnili celotno datoteko (200). Brskalnik ob vsakem iskanju (seek) in
 * podkstne aplikacije ob nadaljevanju prenosa znova prejele vse od začetka.
 * Zdaj: pravi 206 z `Content-Range`, 416 za nemogoče razpone, 200 brez
 * `Range` ali pri nepravilnem zogljivem nizu (RFC 7233: ignoriraj).
 *
 * Podprti so enojni razponi: `bytes=N-`, `bytes=N-M`, `bytes=-N` (zadnjih N).
 * Večrazponske zahtevke (`bytes=0-1,5-6`) ignoriramo → 200 celota.
 */
export function rangeResponse(
  req: NextRequest,
  buffer: Buffer,
  contentType: string,
  cacheControl: string,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  const size = buffer.length
  const base: Record<string, string> = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
    ...extraHeaders,
  }

  const raw = req.headers.get('range')
  if (!raw) {
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: { ...base, 'Content-Length': String(size) },
    })
  }

  /* En sam razpon; vse druge oblike (več razponov, druga enota) → 200 celota. */
  const match = /^bytes=(\d*)-(\d*)$/.exec(raw.trim())
  if (!match) {
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: { ...base, 'Content-Length': String(size) },
    })
  }

  const [, startRaw, endRaw] = match

  /* Nemogoč razpon (začetek čez konec / prazna priponka) → 416 z obstoječo velikostjo. */
  if (startRaw === '' && endRaw === '') {
    return new NextResponse(null, {
      status: 416,
      headers: { ...base, 'Content-Range': `bytes */${size}` },
    })
  }

  let start: number
  let end: number

  if (startRaw === '') {
    /* `bytes=-N` — zadnjih N bajtov; N = 0 je nemogoče. */
    const suffix = Number(endRaw)
    if (suffix <= 0 || size === 0) {
      return new NextResponse(null, {
        status: 416,
        headers: { ...base, 'Content-Range': `bytes */${size}` },
      })
    }
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(startRaw)
    if (start >= size) {
      return new NextResponse(null, {
        status: 416,
        headers: { ...base, 'Content-Range': `bytes */${size}` },
      })
    }
    end = endRaw === '' ? size - 1 : Math.min(Number(endRaw), size - 1)
  }

  const slice = buffer.subarray(start, end + 1)
  return new NextResponse(new Uint8Array(slice), {
    status: 206,
    headers: {
      ...base,
      'Content-Length': String(slice.length),
      'Content-Range': `bytes ${start}-${end}/${size}`,
    },
  })
}
