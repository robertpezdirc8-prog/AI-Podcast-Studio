import type { Metadata } from 'next';
import { HomeShell } from '@/components/studio/home-shell';
import { db } from '@/lib/db';

type PageProps = {
  searchParams: Promise<{ deli?: string }>;
};

/** isti format kot javni žeton v /api/share/[token] — zavrnitev brez DB klica */
const SAFE_TOKEN = /^[A-Za-z0-9_-]{10,40}$/;

/** Opis skrajšan na varno dolžino za predogled povezave (~2 vrstici). */
function cap(text: string, max = 180): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Dinamični metadata za javne delitvene povezave (Task 56): ko kdorkoli
 * odpre `/?deli=<žeton>` v messengerju ali socialnem omrežju, predogled
 * pokaže NASLOV EPIZODE, opis in OVITEK (namesto splošnega bannera app).
 * Za deljene povezave je metapodatek noindex — žetoni so pol-javni.
 */
export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { deli } = await searchParams;
  if (!deli) return {};
  if (!SAFE_TOKEN.test(deli)) {
    return { title: 'Povezava ne deluje · AI Podcast Studio', robots: { index: false, follow: false } };
  }

  /* Lahek posnetek — brez vrstic/timeline (to dela šele API za poslušalca). */
  const episode = await db.episode.findFirst({
    where: { shareToken: deli, sharedAt: { not: null } },
    select: { title: true, topic: true, coverPath: true, hostsJson: true },
  });

  if (!episode) {
    return { title: 'Povezava ne deluje · AI Podcast Studio', robots: { index: false, follow: false } };
  }

  let hosts: string[] = [];
  try {
    const parsed = JSON.parse(episode.hostsJson) as { name?: string }[];
    if (Array.isArray(parsed)) {
      hosts = parsed
        .map((h) => String(h?.name ?? '').trim())
        .filter((name) => name.length > 0);
    }
  } catch {
    hosts = [];
  }

  const title = `${episode.title} · AI Podcast Studio`;
  const baseDescription =
    episode.topic.trim() !== episode.title.trim() && episode.topic.trim().length > 0
      ? episode.topic
      : hosts.length > 0
        ? /* brez sklanjanja imen ( instrumental je nemogoč sklepati) */
          `Poslušaj epizodo — v pogovoru: ${hosts.join(' · ')} (AI Podcast Studio).`
        : 'Poslušaj epizodo — AI Podcast Studio.';
  const image = episode.coverPath || '/og.png';

  return {
    title,
    description: cap(baseDescription),
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description: cap(baseDescription),
      images: [image],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: cap(baseDescription),
      images: [image],
    },
  };
}

export default function Page() {
  return <HomeShell />;
}
