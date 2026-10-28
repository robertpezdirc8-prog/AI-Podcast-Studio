import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import { db } from '@/lib/db'
import { EXPORT_PREFIX, exportEpisodeMp3Locked } from '@/lib/podcast-ai'

// Podcasting 2.0 (Podcast Index namespace): transcript, chapters, person.
const RSS_XMLNS = 'xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:podcast="https://podcastindex.org/namespace/1.0"'

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function rfc822(date: Date): string {
  return date.toUTCString()
}

/** Imena gostiteljev iz hostsJson (ScriptHost[]) — varno pri pokvarjenem JSON. */
function parseHostNames(hostsJson: string): string[] {
  try {
    const parsed: unknown = JSON.parse(hostsJson)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((h) => String((h as { name?: unknown })?.name ?? '').trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Pravi podcast RSS feed (iTunes oznake + enclosures + Podcasting 2.0).
 * MP3 datoteke se izvozijo lenobno ob prvi zahtevi.
 */
export async function GET(req: NextRequest) {
  try {
    const forwardedProto = req.headers.get('x-forwarded-proto')
    const forwardedHost = req.headers.get('x-forwarded-host')
    const proto = forwardedProto ?? req.nextUrl.protocol.replace(':', '')
    const host = forwardedHost ?? req.headers.get('host') ?? req.nextUrl.host
    const base = `${proto}://${host}`

    const episodes = await db.episode.findMany({
      orderBy: { createdAt: 'desc' },
      include: { lines: true },
    })

    const items: string[] = []
    let channelImageHref = '' // prvi na voljo ovitek (kanal)
    for (const episode of episodes) {
      const lines = episode.lines.slice().sort((a, b) => a.idx - b.idx)
      const ready = lines.length > 0 && lines.every((l) => l.audioPath)
      if (!ready) continue

      let enclosure = ''
      let durationTag = ''
      try {
        const exported = await exportEpisodeMp3Locked(episode.id, lines)
        const stat = await fs.promises.stat(exported.filePath)
        const audioUrl = `${base}/api/audio/${EXPORT_PREFIX}${episode.id}.mp3`
        enclosure = `<enclosure url="${escapeXml(audioUrl)}" length="${stat.size}" type="audio/mpeg" />`
        if (exported.durationMs > 0) {
          durationTag = `<itunes:duration>${Math.round(exported.durationMs / 1000)}</itunes:duration>`
        }
      } catch {
        continue // brez zvoka ne moremo ponuditi enclosure-a
      }

      const transcript = lines
        .map(
          (l) =>
            `<p><strong>${escapeXml(l.speaker)}${l.emotion ? ` (${escapeXml(l.emotion)})` : ''}${l.chapter ? ` — ${escapeXml(l.chapter)}` : ''}:</strong> ${escapeXml(l.text)}</p>`,
        )
        .join('')

      // Show notes (povzetek + poudarki), če obstajajo
      let notesHtml = ''
      let summaryText = episode.topic
      try {
        if (episode.summaryJson) {
          const parsed = JSON.parse(episode.summaryJson) as { summary?: unknown; takeaways?: unknown }
          const summary = String(parsed.summary ?? '')
          const takeaways = Array.isArray(parsed.takeaways) ? parsed.takeaways.map(String) : []
          if (summary) {
            summaryText = summary
            const listHtml = takeaways.length
              ? `<h3>Poudarki</h3><ul>${takeaways.map((t) => `<li>${escapeXml(t)}</li>`).join('')}</ul>`
              : ''
            notesHtml = `<h3>Povzetek</h3><p>${escapeXml(summary)}</p>${listHtml}`
          }
        }
      } catch {
        // brez show notes
      }

      // Episode art (Task 34): Apple Podcasts prikaže itunes:image kot
      // naslovnico epizode v katalogu in predvajalniku.
      const itemImage = episode.coverPath
        ? `<itunes:image href="${escapeXml(`${base}${episode.coverPath}`)}" />`
        : ''
      if (!channelImageHref && episode.coverPath) channelImageHref = `${base}${episode.coverPath}`

      // Podcasting 2.0 (Raziskava R1): podnapisi/transkript + poglavja + ljudje.
      //   transcript — časovno vezana VTT (rel="captions") in SRT ter goli TXT;
      //   chapters   — Podcasting 2.0 JSON (application/json+chapters);
      //   person     — gostitelji iz hostsJson (role="host").
      const lang = episode.language || 'sl'
      const epBase = `${base}/api/episodes/${episode.id}`
      const podcastTags = [
        `<podcast:transcript url="${escapeXml(`${epBase}/vtt`)}" type="text/vtt" rel="captions" language="${escapeXml(lang)}" />`,
        `<podcast:transcript url="${escapeXml(`${epBase}/srt`)}" type="application/x-subrip" rel="captions" language="${escapeXml(lang)}" />`,
        `<podcast:transcript url="${escapeXml(`${epBase}/transcript`)}" type="text/plain" language="${escapeXml(lang)}" />`,
        `<podcast:chapters url="${escapeXml(`${epBase}/chapters?format=json`)}" type="application/json+chapters" />`,
        ...parseHostNames(episode.hostsJson).map(
          (name) => `<podcast:person role="host">${escapeXml(name)}</podcast:person>`,
        ),
      ]

      items.push(
        [
          '<item>',
          `<title>${escapeXml(episode.title)}</title>`,
          `<guid isPermaLink="false">${escapeXml(episode.id)}</guid>`,
          `<pubDate>${rfc822(episode.createdAt)}</pubDate>`,
          `<description>${escapeXml(summaryText)}</description>`,
          `<itunes:author>AI Podcast Studio</itunes:author>`,
          `<itunes:summary>${escapeXml(summaryText)}</itunes:summary>`,
          itemImage,
          durationTag,
          `<content:encoded><![CDATA[${notesHtml}${transcript}]]></content:encoded>`,
          enclosure,
          ...podcastTags,
          '</item>',
        ]
          .filter(Boolean)
          .join(''),
      )
    }

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<rss version="2.0" ${RSS_XMLNS}>`,
      '<channel>',
      `<title>AI Podcast Studio</title>`,
      `<link>${escapeXml(base)}</link>`,
      `<language>sl</language>`,
      `<description>Podcasti, ki jih piše in posnema umetna inteligencija — pogovorna slovenščina, pravi slovenski glasovi.</description>`,
      `<itunes:author>AI Podcast Studio</itunes:author>`,
      `<itunes:owner><itunes:name>AI Podcast Studio</itunes:name></itunes:owner>`,
      `<itunes:category text="Technology" />`,
      ...(channelImageHref ? [`<itunes:image href="${escapeXml(channelImageHref)}" />`] : []),
      ...items,
      '</channel>',
      '</rss>',
    ].join('\n')

    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[api/rss GET]', error)
    return NextResponse.json({ error: 'RSS ni uspel' }, { status: 500 })
  }
}
