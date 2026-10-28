import fs from 'fs'
import path from 'path'
import { spawn, execFile as execFileCb } from 'child_process'
import { promisify } from 'util'
import { db } from '@/lib/db'
import { speakerPanMapFor } from '@/lib/podcast-pan'
import type { Episode, Line } from '@prisma/client'

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const AUDIO_DIR = path.join(process.cwd(), 'db', 'audio')

const PIPER_BIN = path.join(process.cwd(), 'piper', 'piper', 'piper')
const VOICES_DIR = path.join(process.cwd(), 'db', 'voices')

export const VOICE_IDS = ['rok', 'petra', 'artur', 'jakob', 'matjaz', 'srecko'] as const

export type VoiceId = (typeof VOICE_IDS)[number]

/*
 * GLASOVI — raziskava (spletni viri, HF API, uradni Piper VOICES.md, sherpa-onnx seznam):
 * - Rok (sl-SI-RokNeural) in Petra (sl-SI-PetraNeural) sta Microsoftova NEURALNA slovenska
 *   glasova (isti, ki jih ponujajo Azure TTS in brezplačne spletne strani kot ttsfree.com).
 *   Dostopa se jih BREZPLAČNO prek Edge TTS protokola (python edge-tts), brez API ključa.
 *   Kvaliteta je bistveno bolj naravna od Piperja.
 * - Artur (sl_SI-artur-medium) je EDINI pravi slovenski ODPRTOKODNI LOKALNI TTS glas
 *   (korpus ppisljar/artur_studio_tts — pravi slovenski studijski govor, CC-BY-4.0).
 *   Služi kot ZASILNI glas, če Edge TTS ni dosegljiv (brez povezave).
 * - Jakob in Matjaž sta derivata Roka z ffmpeg pitch-shiftom (±2 poltona),
 *   zato je izgovarjava še vedno prava slovenščina — samo ton je drugačen.
 *   Zasilno sta derivata Arturja z istim pitch-shiftom.
 */
const PIPER_VOICE_MODELS: Record<string, string> = {
  artur: 'sl_SI-artur-medium.onnx',
  jakob: 'sl_SI-artur-medium.onnx',
  matjaz: 'sl_SI-artur-medium.onnx',
  rok: 'sl_SI-artur-medium.onnx',
  petra: 'sl_SI-artur-medium.onnx',
  srecko: 'sl_SI-artur-medium.onnx',
}

// Pitch faktor: 1.122462 = +2 poltona (višji, energičen), 0.890899 = −2 poltona (nižji, umirjen)
const PIPER_PITCH: Record<string, number> = {
  artur: 1.0,
  jakob: 1.122462,
  matjaz: 0.890899,
  rok: 1.0,
  petra: 1.26,
  srecko: 1.0,
}

/*
 * EDGE TTS (Microsoft Neural) — primarni ponudnik za rok/petra/jakob/matjaz/srecko.
 * Sinteza poteka prek uradnega Edge "Read Aloud" protokola (brezplačno, brez ključa).
 * Zažene se lokalni python modul edge-tts (pip3 install edge-tts).
 * Če sinteza odpove (ni povezave / manjka modul), se uporabi Piper (artur) kot rezerva.
 * Srečko = hr-HR-SreckoNeural — EDINI hrvaški Edge glas (Raziskava R1: Marija je
 * zdaj mk-MK); bere slovensko besedilo z rahlim hrvaškim naglasom — popoln za "gosta".
 */
const EDGE_VOICE_MODELS: Record<string, string> = {
  rok: 'sl-SI-RokNeural',
  petra: 'sl-SI-PetraNeural',
  jakob: 'sl-SI-RokNeural',
  matjaz: 'sl-SI-RokNeural',
  srecko: 'hr-HR-SreckoNeural',
}

/*
 * NATIVNI Edge pitch (raziskava: edge-tts README, Azure prosody):
 * pitch se spremeni MED nevronske sinteze (v Azure vocoderju) — prozodija,
 * oblika spektra in trajanje ostanejo naravni, BREZ kovinskih artefaktov,
 * ki jih za seboj pusti ffmpeg asetrate/atempo premik (to je bil vzrok
 * "trdega" zvoka Jakoba/Matjaža). ±12 Hz ≈ ±2 poltona pri moškem glasu.
 */
const EDGE_PITCH_HZ: Record<string, string> = {
  rok: '+0Hz',
  petra: '+0Hz',
  jakob: '+12Hz',
  matjaz: '-12Hz',
  srecko: '+0Hz',
}

// Edge TTS izhaja MP3 24 kHz mono
const EDGE_SAMPLE_RATE = 24000

// Zasilni z-ai glasovi, če lokalna sinteza odpove
const PIPER_TO_ZAI: Record<string, string> = {
  artur: 'jam',
  jakob: 'jam',
  matjaz: 'jam',
  rok: 'jam',
  petra: 'jam',
  srecko: 'jam',
}

export const STYLE_IDS = ['interview', 'debate', 'storytelling', 'education'] as const
export const LANGUAGE_IDS = ['sl', 'en'] as const

export const STYLE_LABELS: Record<string, string> = {
  interview: 'interview show in the style of a curious journalist talking to an expert',
  debate: 'friendly debate show where two hosts argue opposing views with humor',
  storytelling: 'narrative storytelling show where two narrators bring a story to life',
  education: 'educational show where a moderator explains a topic with vivid examples',
}

export interface ScriptHost {
  name: string
  voice: string
  speed: number
}

export interface ScriptLine {
  speaker: string
  voice: string
  speed: number
  emotion: string | null
  text: string
  chapter: string | null
}

export interface ShowNotes {
  summary: string
  takeaways: string[]
}

/* Dolžine epizod (raziskava: NotebookLM length control, Conch length slider) */
export const LENGTH_IDS = ['short', 'medium', 'long'] as const

export const LENGTH_SPECS: Record<
  string,
  { label: string; lines: string; minutes: string; chapters: string }
> = {
  short: { label: 'Kratka', lines: '8 do 11', minutes: '1–2', chapters: 'poglavij NE uporabljaj (vse chapter = null)' },
  medium: { label: 'Srednja', lines: '12 do 16', minutes: '3–5', chapters: 'uporabi 2 poglavji' },
  long: { label: 'Dolga', lines: '18 do 26', minutes: '6–9', chapters: 'uporabi 3 do 4 poglavja' },
}

function languageSpec(language: string): string {
  return language === 'en'
    ? `English — but 100% NATURAL CONVERSATIONAL English, exactly how real podcast hosts talk. Never formal, never translated-sounding.`
    : `Slovenščina — ampak 100% NARAVNA POGOVORNA SLOVENŠČINA, točno tako, kot govorita dva Slovenca v pravem slovenskem podcastu. Nikoli uradno, nikoli knjižno-novinarsko, nikoli kot prevod iz angleščine.`
}

export interface PodcastScript {
  title: string
  hosts: ScriptHost[]
  lines: ScriptLine[]
}

/* ------------------------------------------------------------------ */
/* ZAI singleton                                                       */
/* ------------------------------------------------------------------ */

let zaiPromise: Promise<Awaited<ReturnType<typeof createZai>>> | null = null

function createZai() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ZAI = require('z-ai-web-dev-sdk').default as {
    create: () => Promise<{
      chat: { completions: { create: (args: unknown) => Promise<{ choices: { message?: { content?: string } }[] }> } }
      audio: {
        tts: {
          create: (args: {
            input: string
            voice: string
            speed: number
            response_format: string
            stream: boolean
          }) => Promise<Response>
        }
      }
      functions: {
        invoke: (name: string, args: Record<string, unknown>) => Promise<{
          data?: { html?: string; title?: string }
        }>
      }
      images: {
        generations: {
          create: (args: { prompt: string; size: string }) => Promise<{ data?: { base64?: string }[] }>
        }
      }
    }>
  }
  return ZAI.create()
}

export async function getZai() {
  if (!zaiPromise) {
    zaiPromise = createZai()
  }
  return zaiPromise
}

/* ------------------------------------------------------------------ */
/* LLM script generation                                               */
/* ------------------------------------------------------------------ */

function extractJson(raw: string): string | null {
  const cleaned = raw.replace(/```json/gi, '```').trim()
  const fenced = cleaned.match(/```([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : cleaned
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return candidate.slice(start, end + 1)
}

/**
 * Odpusten JSON parse: LLM včasih prikrajši izhod (manjka `]` ali `}`
 * ali je niz odprt na koncu). Poskusa normalen parse, nato zapre
 * odprti niz in oklepaje v enakem vrstnem redu.
 */
function lenientJsonParse(input: string): unknown {
  try {
    return JSON.parse(input)
  } catch {
    // nadaljuj s popravilom
  }
  let s = input.trim()
  s = s.replace(/,\s*$/, '')
  const stack: string[] = []
  let inString = false
  let escaped = false
  for (const ch of s) {
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') stack.pop()
  }
  if (inString) s += '"'
  for (const open of stack.reverse()) s += open === '{' ? '}' : ']'
  return JSON.parse(s)
}

export function isVoiceId(v: unknown): v is VoiceId {
  return typeof v === 'string' && (VOICE_IDS as readonly string[]).includes(v)
}

function clampSpeed(n: unknown, fallback = 1.0): number {
  const num = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(num)) return fallback
  return Math.min(2.0, Math.max(0.5, Math.round(num * 100) / 100))
}

function cleanSpokenText(raw: string): string {
  return raw
    .replace(/[*_#`~]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^["'\u201c\u201e]+|["'\u201d\u201c]+$/g, '')
    .trim()
}

export async function generatePodcastScript(opts: {
  topic: string
  style: string
  language: string
  length?: string
  focus?: string
  withGuest?: boolean
  sourceContent?: string
}): Promise<PodcastScript> {
  const zai = await getZai()
  const langSpec = languageSpec(opts.language)
  const styleSpec = STYLE_LABELS[opts.style] ?? STYLE_LABELS.interview
  const lengthSpec = LENGTH_SPECS[opts.length ?? 'medium'] ?? LENGTH_SPECS.medium
  const withGuest = opts.withGuest === true
  const castSpec = withGuest ? 'dva voditelja + gost iz Hrvaške (Srečko)' : 'dva voditelja'
  const focusSpec = opts.focus?.trim()
    ? `DODATNA NAVODILA POSLUŠALCA (obvezno upoštevaj pri tonu, fokusu in vsebini): "${opts.focus.trim().slice(0, 2000)}".`
    : ''
  const sourceSpec = opts.sourceContent?.trim()
    ? `VIR (najpomembnejša podlaga za vsebino — izlušči iz njega ključne podatke, številke in primere, nato pa jih predstavi v svojem pogovornem tonu; nikoli ne beri dobesedno): "${opts.sourceContent.trim().slice(0, 12000)}".`
    : ''

  const system = [
    'You are a world-class podcast showrunner and scriptwriter.',
    `You write tight, entertaining podcast scripts for ${castSpec} that sound EXACTLY like real people talking — spontaneous, funny, with natural rhythm.`,
    `CRITICAL: ${withGuest ? 'the speakers COLLABORATE — hosts and the guest constantly react to each other' : 'the two hosts COLLABORATE — they constantly react to each other'}, answer questions, build on each other\'s points, use each other\'s names and short backchannel reactions. NEVER write two monologues pasted one after another.`,
    'You NEVER sound like a newsreader, a textbook, or a translation.',
    'Respond with VALID JSON ONLY. No markdown, no code fences, no commentary.',
  ].join(' ')

  const user = [
    `Napiši podcast scenarij (${lengthSpec.label.toLowerCase()} oddaja, ~${lengthSpec.minutes} minut).`,
    `Tema: "${opts.topic}".`,
    `Format oddaje: ${styleSpec}.`,
    `Jezik: ${langSpec}.`,
    ...(focusSpec ? [focusSpec] : []),
    ...(sourceSpec ? [sourceSpec] : []),
    ``,
    `PRAVILA ZA VIR:`,
    sourceSpec
      ? `- Vsebina MORA temeljiti na viru zgoraj — uporabi njegove konkretne podatke, ampak povej kot lastna opažanja v pogovoru.`
      : `- Če imaš polno svobodo, dodaj 2–3 presenetljive konkretne informacje o temi.`,
    ``,
    `PRAVILA DIALOGA — SODELOVANJE (NAJPOMEMBNEJŠA PRAVILA!):`,
    `- To je POGOVOR ${withGuest ? 'TREH ljudi v studiu (2 voditelja + gost), ' : 'dveh ljudi v studiu, '}NE izmenjava monologov. Vsaka vrstica (razen prve v epizodi in prve v novem poglavju) se MORA neposredno ODZVATI na prejšnjo vrstico: odgovoriti na vprašanje, potrditi, izpodbijati, dopolniti ali se nanjo sklicati.`,
    `- Če vrstica vsebuje vprašanje, mora NASLEDNJA vrstica biti odgovor nanj — najprej odgovor, šele nato nov podatek ali obratno vprašanje.`,
    `- Vsaj vsake 3–4 vrstice se ${withGuest ? 'udeleženci' : 'govorca'} naslovita po imenu ali se sklicujeta drug na drugega: "kot si pravkar povedal", "glede tistega, kar si omenil", "točno to sem hotel reči".`,
    `- VEČINA vrstic naj ima 1–2 stavka (do ~170 znakov). Če je treba razložiti kaj daljšega, RAZDELITE razlago na izmenjave — drugi vmes vpraša, dvomi ali dopolni.`,
    `- Če je vrstica vseeno dolga (do 260 znakov), jo sestavi iz DVEH polovic z naravno mejo okoli sredine (kratek stavek, nato nadaljevanje prek "in/pa/ker/ampak/ki" ali vejice) — govorcu omogoči naraven vdih na polovici povedi.`,
    `- Nikoli ne daj istemu govorcu dveh dolgih vrstic zapored. Če mora nadaljevati, naj druga oseba vmes vstavi kratko vprašanje ali reakcijo.`,
    `- Vsakih ~3–5 vrstic dodaj SAMOSTOJNO vrstico-reakcijo drugega ${withGuest ? 'udeleženca' : 'voditelja'} (backchannel, 1–5 besed, vedno s končnim ločilom): "Mhm.", "Res?", "Aha, glej to!", "Vau!", "Točno tako.", "Ne morem verjeti!", "Ma daj!" — pravi poslušalci vzklikajo povprečno 3–4-krat na minuto (raziskava dialognih korpusov: >40 % izmenjav).`,
    `- Vsaj 3 reakcije naj bodo ČISTI KRAJŠI vzklik brez nadaljevanja (samo "Mhm." / "Res?" / "Vau!" / "Ma daj!") — takšna vrstica se v predvajalniku naravno PREKRije s prejšnjo povedjo, kar zveni kot resničen pogovor. Ostale reakcije naj se pričnejo s vzklikom, nato nadaljujejo z vprašanjem ali dopolnilom.`,
    `- Vzkliki naj bodo PESTRI: nikoli dva enaka zaporedoma. Generični priklopniki ("Mhm.", "Aha.", "Ja.") pomenijo "nadaljuj, poslušam", specifični ("Vau!", "Res?", "Ne morem verjeti!") pa presenečenje nad vsebino.`,
    `- Dopusti prijazen naval/dopolnitev: en konča misel, drug takoj priklopi ("Ja, in še najboljše je…", "— točno, in zato je…").`,
    `- NE ponavljaj dobesedno tega, kar je drugi pravkar rekel, razen kratkega sklica nanj.`,
    `- emotion naj odraža vlogo vrstice: vprašanje → "radovedno", šok reakcija → "šokiran", strinjanje/val → "navdušeno", razlaga → null ali "mirno".`,
    ``,
    `PRAVILA ZA JEZIK:`,
    `- Piši točno tako, kot ljudje RES govorijo: kratke, žive, energične stavke.`,
    `- Preizkusi vsako vrstico na glas — če zveni kot novica, učbenik ali prevod, jo prepiši pogovorneje.`,
    `- Vgradi naravne pogovorne besede in vmesnike: ja, no, pač, ful, res, veš, glej, poslušaj, okej, super, kr neki, dasi, v glavnem, predstavljaj si, sej veš.`,
    `- Voditelja se naslavljata po imenu in se tikata.`,
    `- Pozdrav naj bo sproščen in topel (npr. "Živjo, dobrodošel nazaj!"), NE "Pozdravljeni, poslušalci".`,
    `- Reakcije naj bodo pristne: "Res? Ne morem verjeti!", "To pa ni hudo!", "Ful noro!", "Ma daj!", "Sej veš kaj je najboljše?"`,
    `- Piši pravilno (brez chat okrajšav kot "nč", "kva", "tm") — mora se lepo brati na glas.`,
    `- Slovnica mora biti pravilna (sklanjanje, časovanje) — pogovoren je STIL, ne slovnične napake.`,
    `- Za ritem uporabi INTERPUNKCIJO: pomišljaj (—) = hitra pavza sred povedi, tripike (…) = premislek, vejice = dih. TTS to spoštuje.`,
    `- Naslov naj bo privlačen in pogovoren, kot YouTube naslov.`,
    ``,
    `Struktura in tehnična pravila:`,
    withGuest
      ? `- Točno 3 udeleženci: 2 voditelja z domačimi imeni (za slovenščino npr. Rok, Matej, Luka + Petra, Maja, Nina) + 1 gost iz Hrvaške z imenom Srečko. Srečko govori čisto slovensko, njegov RAHEL hrvaški naglas pa je ZAŽELEN pridih — vmes lahko vrže 1–2 hrvaška vzklika ("Ajme!", "Ma daj…").`
      : `- Točno 2 voditelja z domačimi imeni, ki ustrezajo jeziku (za slovenščino npr. moška: Rok, Matej, Luka, Anže, Miha, Tomaž; ženska: Petra, Maja, Nina, Anja, Urška, Tjaša).`,
    `- ${lengthSpec.lines} dialogskih vrstic skupaj.`,
    `- Poglavja: ${lengthSpec.chapters}. Vrstici, ki ODPIRA novo poglavje, nastavi chapter = kratek privlačen naslov poglavja (2–5 besed, brez številk), vsem drugim vrsticam chapter = null.`,
    `- Vsaka vrstica največ 260 znakov, govorjena beseda (brez seznamov, markdowna, emojijev in oklepajev).`,
    `- Struktura: močan uvod, ki takoj pritegne, 2 do 3 presenetljiva konkretna fakta, živahna izmenjava replik, topel in zabaven zaključek z napovedjo naslednje teme.`,
    `- Vsakemu udeležencu dodeli RAZLIČEN glas s tega seznama: rok, petra, artur, jakob, matjaz, srecko.`,
    `- rok = naravni moški glas, petra = naravni ženski glas, artur = temeljni moški ton, jakob = višji in energičen, matjaz = nižji in umirjen, srecko = moški glas z rahlim hrvaškim naglasom. Izberi glasove, ki ustrezajo značajem udeležencev.`,
    withGuest
      ? `- Pri gostu: voditelja = moško-ženski duo (rok + petra), gost Srečko = srecko. Gostova dramaturgija: voditelja ga predstavitiva v uvodu, ima ~20–30 % vseh vrstic (nikoli ne prevlada), prinese perspektivo "od zunaj" (primerjave z Hrvaško, poimenja iz svojih izkušenj), v vsakem poglavju vsaj enkrat spregovori, voditelja ga naslovita po imenu in mu zastavita vprašanji.`
      : `- Najboljša kombinacija je moško-ženski duo (rok + petra) — kot v pravih slovenskih podcastih. Imeni naj bodo primerna glasovoma (npr. Rok/Matej/Luka + Petra/Maja/Nina).`,
    `- Hitrost govora med 0.9 in 1.1.`,
    `- emotion: ena kratka pogovorna beseda za način govora (npr. navdušeno, radovedno, šokiran, smeje se, pretirano, zamišljeno) ali null.`,
    `- Vsak line.speaker MORA biti eno od imen ${withGuest ? 'udeležencev (tudi Srečko za gostove vrstice)' : 'voditeljev'}, line.voice/speed pa kopirata njegov glas/hitrost.`,
    ``,
    `PRIMER ŽELJENEGA POGOVORNEGA TONA (samo za okus, ne kopiraj vsebine) — opazi, kako si vsaka replika ODGOVARJA na prejšnjo:`,
    `~ "Živjo, dobrodošli nazaj! Danes pa imava ful dobro temo, res ti bo všeč."`,
    `~ "Dajno, povej že! Koliko pa to sploh stane?"`,
    `~ "Manj kot tri evre, Petra. Tri! Za vse, kar ti pravkar naštevam."`,
    `~ "Ne morem verjeti! Ja, ampak — omenil si samo elektrono, kaj pa vzdrževanje?"`,
    `~ "Aha, glej to! To pa nisem vedel. In kaj se je potem zgodilo?"`,
    ``,
    `JSON oblika točno takšna:`,
    `{"title": string, "hosts": [{"name": string, "voice": string, "speed": number}, {"name": string, "voice": string, "speed": number}${withGuest ? ', {"name": "Srečko", "voice": "srecko", "speed": number}' : ''}], "lines": [{"speaker": string, "voice": string, "speed": number, "emotion": string | null, "text": string, "chapter": string | null}]}`,
    `Pomembno: polje "chapter" MORA biti prisotno v VSAKI vrstici (niz naslova ali null).`,
  ].join('\n')

  let lastError: unknown = null

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: system },
          { role: 'user', content: attempt === 0 ? user : `${user}\n\nPONOVITEV — POPRAVI: 1) odgovori SAMO z JSON objektom, brez razlage; 2) med vrsticami dodaj vsaj 3 vrstice, ki so SAMO kratek vzklik brez nadaljevanja (npr. "Mhm.", "Res?", "Vau!", "Ma daj!") — takšna vrstica se v predvajalniku prekrije s prejšnjo povedjo; ostale reakcije naj se le pričnejo z vzklikom.` },
        ],
        thinking: { type: 'disabled' },
      })

      const raw = completion.choices?.[0]?.message?.content ?? ''
      const jsonStr = extractJson(raw)
      if (!jsonStr) throw new Error('No JSON found in LLM response')

      const parsed = lenientJsonParse(jsonStr) as Record<string, unknown>
      const rawHosts = Array.isArray(parsed.hosts) ? parsed.hosts : []
      const rawLines = Array.isArray(parsed.lines) ? parsed.lines : []

      if (rawHosts.length < 2 || rawLines.length < 6) {
        throw new Error('Script shape invalid: not enough hosts or lines')
      }

      /*
       * GOST (Task 64): kadar je zahtevan, poskusi 1 in 2 jasno zahtevata 3
       * udeležence — pri ZADNJEM poskusu pa sprejmemo tudi 2 (graciozna
       * degradacija, kot pri gostoti backchannelov).
       */
      const wantHosts = withGuest ? 3 : 2
      if (withGuest && attempt < 2 && rawHosts.length < 3) {
        throw new Error('Script shape invalid: guest missing (need 3 speakers)')
      }

      // --- repair & normalize hosts ---------------------------------
      const usedVoices = new Set<string>()
      const hosts: ScriptHost[] = rawHosts.slice(0, wantHosts).map((h, i) => {
        const obj = (h ?? {}) as Record<string, unknown>
        let voice = isVoiceId(obj.voice) ? obj.voice : VOICE_IDS[i % VOICE_IDS.length]
        while (usedVoices.has(voice)) {
          const next = VOICE_IDS.find((v) => !usedVoices.has(v))
          voice = next ?? voice
        }
        usedVoices.add(voice)
        const name = cleanSpokenText(String(obj.name ?? `Voditelj ${i + 1}`)).slice(0, 40) || `Voditelj ${i + 1}`
        return { name, voice, speed: clampSpeed(obj.speed, 1.0) }
      })

      // --- repair & normalize lines ---------------------------------
      const byName = new Map(hosts.map((h) => [h.name.toLowerCase(), h]))
      const lines: ScriptLine[] = []
      for (const l of rawLines) {
        const obj = (l ?? {}) as Record<string, unknown>
        const text = cleanSpokenText(String(obj.text ?? ''))
        if (!text) continue
        const speakerKey = String(obj.speaker ?? '').toLowerCase().trim()
        const host = byName.get(speakerKey) ?? hosts[lines.length % hosts.length]
        const chapterRaw = obj.chapter ? cleanSpokenText(String(obj.chapter)).slice(0, 60) : ''
        lines.push({
          speaker: host.name,
          voice: host.voice,
          speed: host.speed,
          emotion: obj.emotion ? cleanSpokenText(String(obj.emotion)).slice(0, 24) : null,
          text: text.slice(0, 900),
          chapter: chapterRaw || null,
        })
        if (lines.length >= 30) break
      }

      if (lines.length < 6) throw new Error('Script has too few usable lines')

      /*
       * GARANCIJA ČISTIH BACKCHANNELOV (Task 24): LLM rada vzklik spoji z
       * nadaljevanjem ("Mhm. Kako je to možno?") — takšne vrstice se prekrijejo
       * le ~60 %, čisti vzkliki pa VEDNO. Če je čistih vzklikov < 2, vzklik
       * DETERMINISTIČNO odrežemo v samostojno vrstico (isti govorec najprej
       * vzklikne, nato nadaljuje — naravno). Pogoji: menjava govorca (drugače
       * prekrivanje ni mogoče), brez oznake poglavja, ostanek dovolj dolg in
       * ni sam čisti vzklik. Največ 2 konverziji — minimalen poseg.
       */
      const bcConverted = new Set<ScriptLine>()
      let pureBc = lines.filter((l) => isBackchannelText(l.text)).length
      for (let i = 1; i < lines.length && pureBc < 2; i += 1) {
        const l = lines[i]
        const prev = lines[i - 1]
        if (l.chapter || l.speaker === prev.speaker || bcConverted.has(l)) continue
        const first = l.text.split(/(?<=[!?.])\s/, 1)[0] ?? ''
        const rest = l.text.slice(first.length).trim()
        if (isBackchannelText(first) && rest.length >= 12 && !isBackchannelText(rest)) {
          bcConverted.add(l)
          lines.splice(i, 0, { ...l, text: first })
          lines[i + 1] = { ...lines[i + 1], text: rest }
          pureBc += 1
          i += 1 // preskoči novo vstavljeni vzklik
        }
      }

      /*
       * VALIDACIJA GOSTOTE BACKCHANNELOV (Task 24): čisti samostojni vzkliki so
       * edine vrstice, ki se prekrijejo VEDNO (100 %) — brez njih dialog kljub
       * pravilom drsi nazaj v izmenjavo monologov. Če jih je še vedno premalo in
       * imamo še poskuse, ponovimo z eksplizitnim popravkom; pri ZADNJEM poskusu
       * sprejmemo tudi redkejše vzklike (graciozna degradacija).
       */
      if (attempt < 2 && pureBc < 2) {
        throw new Error(`Backchannel density too low (${pureBc}/2 standalone reactions)`)
      }

      // Fallback: če LLM ni dal poglavij, jih določi ločen klic (long/medium)
      const chapterCount = opts.length === 'long' ? 4 : opts.length === 'medium' ? 2 : 0
      const hasChapters = lines.some((l) => l.chapter)
      if (!hasChapters && chapterCount > 0) {
        try {
          const chapters = await generateChapterTitles(lines, chapterCount)
          for (const c of chapters) {
            if (c.idx > 0 && c.idx < lines.length && !lines[c.idx].chapter) {
              lines[c.idx].chapter = c.title
            }
          }
        } catch (err) {
          console.error('[podcast-ai] chapter fallback failed (nadaljujem brez):', err)
        }
      }

      const title =
        cleanSpokenText(String(parsed.title ?? '')).slice(0, 90) || opts.topic.slice(0, 90)

      return { title, hosts, lines }
    } catch (err) {
      lastError = err
      await sleep(1200 * (attempt + 1))
    }
  }

  throw new Error(
    `Script generation failed after 3 attempts: ${lastError instanceof Error ? lastError.message : 'unknown'}`,
  )
}

/** Fallback: LLM razdeli obstoječ transkript v poglavja (naslovi + začetni idx). */
async function generateChapterTitles(
  lines: { text: string }[],
  count: number,
): Promise<{ idx: number; title: string }[]> {
  const zai = await getZai()
  const numbered = lines.map((l, i) => `${i + 1}. ${l.text}`).join('\n').slice(0, 8000)

  const system = 'You are a podcast editor. Respond with VALID JSON ONLY. No markdown, no commentary.'
  const user = [
    `Transkript podkast epizode (številčene vrstice):`,
    numbered,
    ``,
    `Razdeli transkript v točno ${count} poglavij po tematskih prelomih.`,
    `Za vsako poglavje vrni idx = številka PRVE vrstice poglavja (1-based) in kratek privlačen naslov (2–5 besed, pogovorno).`,
    `Prvo poglavje mora začeti vrstica 1.`,
    ``,
    `JSON točno: {"chapters": [{"idx": number, "title": string}]}`,
  ].join('\n')

  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: system },
          { role: 'user', content: user },
        ],
        thinking: { type: 'disabled' },
      })
      const raw = completion.choices?.[0]?.message?.content ?? ''
      const jsonStr = extractJson(raw)
      if (!jsonStr) throw new Error('No JSON in chapters response')
      const parsed = lenientJsonParse(jsonStr) as { chapters?: unknown }
      const rawChapters = Array.isArray(parsed.chapters) ? parsed.chapters : []
      const out: { idx: number; title: string }[] = []
      for (const c of rawChapters) {
        const obj = (c ?? {}) as Record<string, unknown>
        const idx = Math.max(1, Math.min(lines.length, Math.round(Number(obj.idx) || 0)))
        const title = cleanSpokenText(String(obj.title ?? '')).slice(0, 60)
        if (title && !out.some((o) => o.idx === idx)) out.push({ idx, title })
      }
      if (out.length === 0) throw new Error('Chapters shape invalid')
      return out.map((c) => ({ idx: c.idx - 1, title: c.title })) // 1-based → 0-based
    } catch (err) {
      lastError = err
      await sleep(800 * (attempt + 1))
    }
  }
  throw new Error(`Chapters generation failed: ${lastError instanceof Error ? lastError.message : 'unknown'}`)
}

/* ------------------------------------------------------------------ */
/* Viri (URL → besedilo), show notes, interaktivno vprašanje           */
/* ------------------------------------------------------------------ */

/** Pridobi vsebino spletne strani (page_reader) in očisti HTML → govorljivo besedilo. */
export async function fetchSourceContent(url: string): Promise<string> {
  const cleanUrl = url.trim()
  if (!/^https?:\/\/.+/i.test(cleanUrl)) throw new Error('Neveljaven URL')
  const zai = await getZai()
  const res = (await zai.functions.invoke('page_reader', { url: cleanUrl })) as {
    data?: { html?: string; title?: string }
  }
  const text = String(res?.data?.html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length < 200) throw new Error('Strani ni bilo mogoče prebrati (premalo besedila)')
  return text.slice(0, 12000)
}

/** Show notes: povzetek + poudarki (Podsqueeze/Jellypod stil). */
export async function generateShowNotes(opts: {
  title: string
  topic: string
  language: string
  lines: { speaker: string; text: string }[]
}): Promise<ShowNotes> {
  const zai = await getZai()
  const transcript = opts.lines
    .map((l) => `${l.speaker}: ${l.text}`)
    .join('\n')
    .slice(0, 8000)

  const system = 'You are a world-class podcast editor. Respond with VALID JSON ONLY. No markdown, no commentary.'
  const user =
    opts.language === 'en'
      ? [
          `Write show notes for the podcast episode "${opts.title}" (topic: ${opts.topic}).`,
          ``,
          `Transcript:`,
          transcript,
          ``,
          `JSON exactly: {"summary": string, "takeaways": string[]}`,
          `summary: 2–3 conversational sentences on why this episode is worth a listen.`,
          `takeaways: 3–5 short punchy key takeaways, each ≤ 120 characters, no bullets inside.`,
        ].join('\n')
      : [
          `Napiši show notes za podkast epizodo "${opts.title}" (tema: ${opts.topic}).`,
          ``,
          `Transkript:`,
          transcript,
          ``,
          `JSON točno: {"summary": string, "takeaways": string[]}`,
          `summary: 2–3 pogovorni stavki, zakaj je epizoda vredna poslušanja.`,
          `takeaways: 3–5 kratkih konkretnih poudarkov, vsak do 120 znakov, brez oznak za sezname.`,
        ].join('\n')

  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: system },
          { role: 'user', content: user },
        ],
        thinking: { type: 'disabled' },
      })
      const raw = completion.choices?.[0]?.message?.content ?? ''
      const jsonStr = extractJson(raw)
      if (!jsonStr) throw new Error('No JSON in show notes response')
      const parsed = lenientJsonParse(jsonStr) as Record<string, unknown>

      const summary =
        cleanSpokenText(String(parsed.summary ?? parsed.description ?? parsed.povzetek ?? '')).slice(0, 600)

      // takeaways: lahko pride kot array, kot EN dolg string ali array z enim dolgim stringom
      const rawTakeaways: unknown[] = Array.isArray(parsed.takeaways)
        ? (parsed.takeaways as unknown[])
        : Array.isArray(parsed.highlights)
          ? (parsed.highlights as unknown[])
          : typeof parsed.takeaways === 'string'
            ? [parsed.takeaways]
            : []

      let takeaways = rawTakeaways
        .map((t) => cleanSpokenText(String(typeof t === 'object' && t !== null ? String((t as { text?: unknown }).text ?? '') : t)))
        .map((t) => t.replace(/^[•\-–*\d.)\s]+/, '').trim())
        .filter(Boolean)

      // Če je vse v enem nizu, razdeli na povedi
      if (takeaways.length === 1 && takeaways[0].length > 140) {
        takeaways = takeaways[0]
          .split(/(?<=[.!?])\s+/)
          .map((s) => s.trim())
          .filter(Boolean)
      }

      takeaways = takeaways
        .map((t) => t.slice(0, 140))
        .filter((t) => t.length > 8)
        .slice(0, 5)

      if (!summary || takeaways.length === 0) throw new Error('Show notes shape invalid')
      return { summary, takeaways }
    } catch (err) {
      lastError = err
      await sleep(800 * (attempt + 1))
    }
  }
  throw new Error(`Show notes generation failed: ${lastError instanceof Error ? lastError.message : 'unknown'}`)
}

/** Interaktivni način (NotebookLM style): vprašanje poslušalca → nadaljevalne vrstice. */
export async function generateAskResponse(opts: {
  episodeTitle: string
  hosts: ScriptHost[]
  question: string
  language: string
}): Promise<ScriptLine[]> {
  const zai = await getZai()
  const langSpec = languageSpec(opts.language)
  const hostsSpec = opts.hosts
    .map((h) => `- ${h.name}: glas "${h.voice}", hitrost ${h.speed}`)
    .join('\n')
  const safeQuestion = opts.question.trim().slice(0, 500)

  const system = 'You are a world-class podcast showrunner. You continue live podcast conversations naturally. Respond with VALID JSON ONLY. No markdown, no commentary.'
  const user = [
    `Oddaja: "${opts.episodeTitle}".`,
    `Jezik: ${langSpec}.`,
    `Voditelja:`,
    hostsSpec,
    ``,
    `Poslušalec pravkar poslal vprašanje v oddajo: "${safeQuestion}"`,
    ``,
    `Napiši 3 do 5 pogovornih nadaljevalnih vrstic:`,
    `- Prvi voditelj na kratko prebere/parafrazira vprašanje ("Imava pa vprašanje od poslušalca …"),`,
    `- drugi odgovori z konkretno, zanimivo vsebino (brez izmišljevanja neobstoječih številk),`,
    `- če je vprašanje v angleščini, voditelja vprašanje pogovorno prevedita v jezik oddaje,`,
    `- živahen dialog z reakcijami, topel mikro-zaključek.`,
    `- Ne ponavljaj prejšnje vsebine, ne pozdravlja znova.`,
    `- Vsaka vrstica največ 260 znakov, chapter pri vseh = null.`,
    ``,
    `JSON točno: {"lines": [{"speaker": string, "voice": string, "speed": number, "emotion": string | null, "text": string, "chapter": null}]}`,
  ].join('\n')

  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'assistant', content: system },
          { role: 'user', content: user },
        ],
        thinking: { type: 'disabled' },
      })
      const raw = completion.choices?.[0]?.message?.content ?? ''
      const jsonStr = extractJson(raw)
      if (!jsonStr) throw new Error('No JSON in ask response')
      const parsed = lenientJsonParse(jsonStr) as { lines?: unknown }
      const rawLines = Array.isArray(parsed.lines) ? parsed.lines : []
      const byName = new Map(opts.hosts.map((h) => [h.name.toLowerCase(), h]))
      const out: ScriptLine[] = []
      for (const l of rawLines) {
        const obj = (l ?? {}) as Record<string, unknown>
        const text = cleanSpokenText(String(obj.text ?? ''))
        if (!text) continue
        const host = byName.get(String(obj.speaker ?? '').toLowerCase().trim()) ?? opts.hosts[out.length % 2]
        out.push({
          speaker: host.name,
          voice: host.voice,
          speed: host.speed,
          emotion: obj.emotion ? cleanSpokenText(String(obj.emotion)).slice(0, 24) : null,
          text: text.slice(0, 900),
          chapter: null,
        })
        if (out.length >= 6) break
      }
      if (out.length < 2) throw new Error('Ask response has too few lines')
      return out
    } catch (err) {
      lastError = err
      await sleep(1200 * (attempt + 1))
    }
  }
  throw new Error(`Ask response failed after 3 attempts: ${lastError instanceof Error ? lastError.message : 'unknown'}`)
}

/* ------------------------------------------------------------------ */
/* TTS                                                                 */
/* ------------------------------------------------------------------ */

function splitTextIntoChunks(text: string, maxLength = 950): string[] {
  if (text.length <= maxLength) return [text]
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text]
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if ((current + sentence).length <= maxLength) {
      current += sentence
    } else {
      if (current) chunks.push(current.trim())
      current = sentence.length > maxLength ? sentence.slice(0, maxLength) : sentence
    }
  }
  if (current) chunks.push(current.trim())
  return chunks
}

function findDataChunkPos(buf: Buffer): { pos: number; size: number } | null {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return null
  let offset = 12
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    if (chunkId === 'data') {
      return { pos: offset + 8, size: Math.min(chunkSize, buf.length - offset - 8) }
    }
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  return null
}

export function wavDurationMs(buf: Buffer): number {
  try {
    const data = findDataChunkPos(buf)
    if (!data) return 0
    const channels = buf.readUInt16LE(22) || 1
    const sampleRate = buf.readUInt32LE(24) || 24000
    const bitsPerSample = buf.readUInt16LE(34) || 16
    const byteRate = (sampleRate * channels * bitsPerSample) / 8
    if (byteRate <= 0) return 0
    return Math.round((data.size / byteRate) * 1000)
  } catch {
    return 0
  }
}

/**
 * Hitro branje trajanja WAV brez nalaganja cele datoteke: prebere le prvih 2 KB
 * (glava RIFF/fmt/data) in zaupa velikosti podatkovnega bloka iz glave.
 * Uporabno za povzetke knjižnice (skupno trajanje epizode).
 */
export function wavDurationMsFast(filePath: string): number {
  try {
    const fd = fs.openSync(filePath, 'r')
    try {
      const buf = Buffer.alloc(2048)
      const read = fs.readSync(fd, buf, 0, 2048, 0)
      const view = buf.subarray(0, read)
      if (view.length < 44 || view.toString('ascii', 0, 4) !== 'RIFF') return 0
      const channels = view.readUInt16LE(22) || 1
      const sampleRate = view.readUInt32LE(24) || 24000
      const bitsPerSample = view.readUInt16LE(34) || 16
      const byteRate = (sampleRate * channels * bitsPerSample) / 8
      if (byteRate <= 0) return 0
      let offset = 12
      while (offset + 8 <= view.length) {
        const chunkId = view.toString('ascii', offset, offset + 4)
        const chunkSize = view.readUInt32LE(offset + 4)
        if (chunkId === 'data') {
          // Zaupaj glavi; varnostno omeji na realno velikost datoteke.
          const dataSize = Math.min(chunkSize, fs.fstatSync(fd).size - offset - 8)
          if (dataSize <= 0) return 0
          return Math.round((dataSize / byteRate) * 1000)
        }
        offset += 8 + chunkSize + (chunkSize % 2)
      }
      return 0
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return 0
  }
}

function concatWav(buffers: Buffer[]): Buffer {
  const first = buffers[0]
  const firstData = findDataChunkPos(first)
  if (!firstData) return Buffer.concat(buffers)

  const pcmParts: Buffer[] = [first.subarray(firstData.pos, firstData.pos + firstData.size)]
  for (let i = 1; i < buffers.length; i++) {
    const d = findDataChunkPos(buffers[i])
    if (d) pcmParts.push(buffers[i].subarray(d.pos, d.pos + d.size))
  }
  const pcm = Buffer.concat(pcmParts)
  const header = Buffer.from(first.subarray(0, firstData.pos))
  const dataSize = pcm.length

  header.writeUInt32LE(36 + dataSize, 4) // RIFF chunk size
  const dataPos = firstData.pos - 8
  header.writeUInt32LE(dataSize, dataPos + 4)

  return Buffer.concat([header, pcm])
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ttsCreateWithRetry(
  zai: Awaited<ReturnType<typeof createZai>>,
  args: {
    input: string
    voice: string
    speed: number
    response_format: string
    stream: boolean
  },
  maxAttempts = 8,
): Promise<Response> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await zai.audio.tts.create(args)
    } catch (err) {
      lastError = err
      const msg = err instanceof Error ? err.message : String(err)
      const rateLimited = msg.includes('429') || msg.toLowerCase().includes('too many requests')
      if (!rateLimited || attempt === maxAttempts - 1) throw err
      // 429 ima lahko minutno okno → eksponentni odlog, omejen na 20 s
      await sleep(Math.min(20000, 2000 * Math.pow(2, attempt)))
    }
  }
  throw lastError
}

const execFile = promisify(execFileCb)

function readWavSampleRate(filePath: string): number {
  const header = Buffer.alloc(44)
  const fd = fs.openSync(filePath, 'r')
  try {
    fs.readSync(fd, header, 0, 44, 0)
    return header.readUInt32LE(24) || 24000
  } finally {
    fs.closeSync(fd)
  }
}

/*
 * Govorna obdelava — "topel studio" veriga (raziskava: Podigy de-essing, Sage Audio EQ,
 * ffmpeg loudnorm two-pass):
 *   - asetrate/atempo → opcijski pitch (dolžina ohranjena),
 *   - LINEARNI (dvoprehodni) loudnorm → statično ojačenje na −16 LUFS brez "pumpanja",
 *     ki ga dinamični loudnorm na kratkih odsekih povzroča (trd/neraven zvok),
 *   - deesser → mehča ostre "s/z" (3–10 kHz),
 *   - equalizer 3 kHz −2 dB + treble −1.8 dB → rez "kislosti" in digitalne ostrine,
 *   - equalizer 210 Hz +1.3 dB → subtilna telesna toplota,
 *   - acompressor (blago koleno) → subtilno zgosti dinamiko (premočno stiskanje
 *     na kratkih odsekih zveni "stisnjeno/trdo"),
 *   - ODREŽE vgrajeno tišino na robovih (Edge servis doda ~0,2 s na začetek in
 *     ~0,6–1,0 s na konec vsake sinteze — to je bil GLAVNI vzrok dolgih,
 *     zaporu podobnih pavz med govorci!),
 *   - afade in/out + mikropad → odstrani klike na prehodih.
 * Sprejme katerikoli vhod, ki ga ffmpeg prepozna (WAV, MP3 — Edge izhod je MP3).
 */

// Minimalec na koncu vrstice — dejansko pavzo določa izvoz (kontekstne GAP pavze),
// robna tišina pa je iz vrstic ODREZANA na naravno mikroobrobo.
const LINE_PAD_SECONDS = 0.06

interface LoudnessMeasurement {
  i: number
  tp: number
  lra: number
  thresh: number
  offset: number
}

/** 1. prehod: izmeri glasnost vhoda za linearni loudnorm (statično ojačenje, brez pumpanja). */
async function measureLoudness(inputPath: string): Promise<LoudnessMeasurement | null> {
  try {
    const { stderr } = await execFile(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostats',
        '-v',
        'info',
        '-i',
        inputPath,
        '-af',
        'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
        '-f',
        'null',
        '-',
      ],
      { timeout: 60_000 },
    )
    const start = stderr.indexOf('{')
    const end = stderr.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    const parsed = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>
    const i = Number(parsed.input_i)
    const tp = Number(parsed.input_tp)
    const lra = Number(parsed.input_lra)
    const thresh = Number(parsed.input_thresh)
    const offset = Number(parsed.target_offset)
    if (!Number.isFinite(i) || i <= -70) return null // tišina / neuporabna meritev
    return {
      i,
      tp: Number.isFinite(tp) ? tp : -1.5,
      lra: Number.isFinite(lra) ? lra : 7,
      thresh: Number.isFinite(thresh) ? thresh : -70,
      offset: Number.isFinite(offset) ? offset : 0,
    }
  } catch {
    return null
  }
}

async function polishAudioToWav(
  inputPath: string,
  outputPath: string,
  inSampleRate: number,
  pitch: number,
  /** Dodatno ojačenje PO loudnorm-u/limiterju (dB) — mikrorazlike med takei. */
  postGainDb: number = 0,
): Promise<void> {
  const measured = await measureLoudness(inputPath)

  const chain: string[] = []
  if (pitch !== 1.0) {
    chain.push(`asetrate=${(inSampleRate * pitch).toFixed(3)}`)
    chain.push(`aresample=${inSampleRate}`)
    chain.push(`atempo=${(1 / pitch).toFixed(6)}`)
  }
  if (measured) {
    // Linearni (statični) loudnorm — brez dinamičnega pumpanja
    chain.push(
      `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${measured.i.toFixed(2)}:measured_TP=${measured.tp.toFixed(2)}:measured_LRA=${measured.lra.toFixed(2)}:measured_thresh=${measured.thresh.toFixed(2)}:offset=${measured.offset.toFixed(2)}:linear=true`,
    )
  } else {
    chain.push('loudnorm=I=-16:TP=-1.5:LRA=11')
  }
  chain.push('highpass=f=75')
  chain.push('deesser=i=0.35:m=0.55:f=0.5')
  chain.push('equalizer=f=3000:width_type=q:w=1.4:g=-2')
  chain.push('treble=g=-1.8:f=8500')
  chain.push('equalizer=f=210:width_type=q:w=0.9:g=1.3')
  // Blaga kompresija (raziskava: premočno stiskanje kratkih TTS odsekov = "trd" zvok)
  chain.push('acompressor=threshold=-18dB:ratio=1.8:attack=30:release=400:knee=8:makeup=1.5')
  // Mehki limitor — kompresorjev makeup lahko potisne vrhove nad 0 dBFS (trdo klipanje!);
  // limitor na −1,5 dBFS jih gladko zavije (brez klipanja = brez trdote)
  chain.push('alimiter=limit=0.84:level=disabled:attack=5:release=60')
  // PostGain ŠELE PO loudnorm-u/limiterju (loudnorm sicer izenači razlike) —
  // uporablja se za mikrorazlike glasnosti med backchannel takei
  if (postGainDb !== 0) chain.push(`volume=${postGainDb.toFixed(2)}dB`)
  chain.push(`aresample=${inSampleRate}`)
  // ODREŽI vgrajeno tišino na robovih (Edge doda ~0,2 s na začetku in ~0,6–1,0 s
  // na koncu; ohranimo le naravno mikroobrobo 0,05/0,09 s — nato izvoz doda
  // kontekstno pavzo: menjava govorca / isti govorec / poglavje)
  chain.push('silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.05')
  chain.push('areverse')
  chain.push('silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.09')
  chain.push('areverse')
  // Klik-odstranjevanje: kratek fade-in + fade-out na koncu (prek areverse trika)
  chain.push('afade=t=in:st=0:d=0.015')
  chain.push('areverse')
  chain.push('afade=t=in:st=0:d=0.07')
  chain.push('areverse')
  // Mikropavza (dejansko pavzo med vrsticami določa izvoz)
  chain.push(`apad=pad_dur=${LINE_PAD_SECONDS.toFixed(2)}`)
  /*
   * ROOM TONE PODLOGA (raziskava: Medium/EZ, r/aitubers — "dodaj zelo subtilen
   * room tone pri −50…−60 dB pod govor"; videomaker — ambience match lepi
   * ločene posnetke v isti prostor): rožnati šum ~38 dB pod govorom (−16 LUFS)
   * prekrije tudi mikropavze in robove → tišina med govorci NI digitalna nič.
   * Pavzne datoteke (ensureGapFile) imajo ENAK nivo → ambijens teče neprekinjeno
   * skozi celotno epizodo (v predvajalniku in izvozu).
   */
  const bedSeed = Math.floor(Math.random() * 1e6)
  await execFile('ffmpeg', [
    '-y',
    '-v',
    'error',
    '-i',
    inputPath,
    '-f',
    'lavfi',
    '-i',
    `anoisesrc=color=pink:r=${inSampleRate}:amplitude=1:seed=${bedSeed}`,
    '-filter_complex',
    `[0:a]${chain.join(',')}[voice];[1:a]volume=0.0121[bed];[voice][bed]amix=inputs=2:duration=first:normalize=0[out]`,
    '-map',
    '[out]',
    '-ar',
    String(inSampleRate),
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    // Izhodna pot je lahko začasna brez .wav končnice → eksplicitno določi format
    '-f',
    'wav',
    outputPath,
  ])
}

async function polishWav(filePath: string, pitch: number): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.polish.wav`
  await polishAudioToWav(filePath, tmpPath, readWavSampleRate(filePath), pitch)
  fs.renameSync(tmpPath, filePath)
}

function runPiper(text: string, modelPath: string, lengthScale: number, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '--model', modelPath,
      '--output_file', outPath,
      '--length_scale', String(lengthScale),
    ]
    const proc = spawn(PIPER_BIN, args, { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (d) => {
      stderr += String(d)
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
        resolve()
      } else {
        reject(new Error(`piper exit ${code}: ${stderr.slice(-200)}`))
      }
    })
    proc.stdin?.write(text)
    proc.stdin?.end()
  })
}

async function piperSynthesize(
  text: string,
  voice: string,
  speed: number,
  outPath: string,
): Promise<void> {
  const modelFile = PIPER_VOICE_MODELS[voice]
  if (!modelFile) throw new Error(`Ni Piper modela za glas ${voice}`)
  const modelPath = path.join(VOICES_DIR, modelFile)
  // Piper length_scale ∝ 1/tempo: dodajamo isti osnovni tempo kot Edge
  // (BASE_RATE_PCT → ×1,05), da je fallback tempa skladen z glavno potjo.
  const lengthScale = Math.min(2, Math.max(0.5, 1 / (clampSpeed(speed) * (1 + BASE_RATE_PCT / 100))))

  const pitch = PIPER_PITCH[voice] ?? 1.0

  const chunks = splitTextIntoChunks(text, 800)
  if (chunks.length === 1) {
    await runPiper(chunks[0], modelPath, lengthScale, outPath)
    await polishWav(outPath, pitch)
    return
  }

  const parts: Buffer[] = []
  const tmpBase = `${outPath}.p${process.pid}`
  try {
    for (let i = 0; i < chunks.length; i++) {
      const tmp = `${tmpBase}_${i}.wav`
      await runPiper(chunks[i], modelPath, lengthScale, tmp)
      parts.push(fs.readFileSync(tmp))
    }
    fs.writeFileSync(outPath, concatWav(parts))
    await polishWav(outPath, pitch)
  } finally {
    for (let i = 0; i < chunks.length; i++) {
      const tmp = `${tmpBase}_${i}.wav`
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
      } catch {
        // ignore
      }
    }
  }
}

/*
 * EDGE TTS sinteza (Microsoft Neural glasovi Rok/Petra — brezplačno, brez ključa).
 * Izhod je MP3 24 kHz → takoj pretvorimo v WAV z "studio" obdelavo (loudnorm,
 * filtri) in opcijskim pitch-shiftom v enem ffmpeg prehodu.
 */
/*
 * PROSODA PO VLOGI VRSTICE — raziskave turn-takinga (Ward & Tsukahara 2020):
 * odgovarjajoči govorec pri vprašanju dvigne ton (naravni povpraševalni nagib),
 * pri kratkih reakcijah pa pospeši. Brez tega zveni vsak "turn" kot izolirana
 * izjava = uporabnikov občutek "govori za sebe, ne sodeluje".
 */
function prosodyBoostForText(text: string): { rateDelta: number; pitchDelta: number } {
  const t = text.trim()
  if (isBackchannelText(t)) return { rateDelta: 6, pitchDelta: 4 }
  if (t.endsWith('?')) return { rateDelta: 2, pitchDelta: 3 }
  return { rateDelta: 0, pitchDelta: 0 }
}

/* ------------------------------------------------------------------ */
/* MIKROVARIACIJA PONOVLJENIH REAKCIJ (backchannel takei)              */
/* ------------------------------------------------------------------ */

/*
 * Edge TTS je determinističen — trije enaki "Mhm." v epizodi bi bili trije
 * IDENTIČNI takei (takoj slišno strojno, kot copy-paste). Raziskava (Task 24:
 * Böttcher 2025 — poslušalci dajejo povratne signale ~3,6×/min; UTEP dialogni
 * korpusi — backchanneli se razlikujejo po višini, hitrosti in glasnosti).
 * Rešitev: vsak backchannel dobi enega iz 5 "takeov" (hitro-višje /
 * umirjeno-tišeje / nižje-premišljeno / živahno-glasneje / privzet),
 * deterministično po (pot vrstice + besedilo) → ista vrstica = isti take
 * (reproducibilno), ponovljeni vzkliki pa zvenijo človeško različno.
 * Glasnost = postGain PO loudnorm-u (loudnorm bi sicer izenačil razlike).
 */
const BACKCHANNEL_TAKES: { rateDelta: number; pitchDelta: number; gainDb: number }[] = [
  { rateDelta: 6, pitchDelta: 4, gainDb: 0 },    // privzet energični vzklik
  { rateDelta: 10, pitchDelta: 7, gainDb: -0.5 }, // hitro in višje — navdušeno
  { rateDelta: 3, pitchDelta: 0, gainDb: -2 },    // umirjeno in tišeje — soglašanje
  { rateDelta: 7, pitchDelta: -3, gainDb: -1.5 }, // nižje, premišljeno "mhm"
  { rateDelta: 12, pitchDelta: 5, gainDb: 0.5 },  // zelo kratko, živahno
]

/** Determinističen djb2 hash (positiven uint32) — skupen takeovom in jitterju. */
export function djb2Hash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h
}

function backchannelTakeFor(
  text: string,
  key: string,
): { rateDelta: number; pitchDelta: number; gainDb: number } {
  return BACKCHANNEL_TAKES[djb2Hash(`${key}|${text.trim().toLowerCase()}`) % BACKCHANNEL_TAKES.length]
}

/*
 * NIVO VZKLIKA "POD" GLAVNIM GOVOROM (Task 31): v prekrivanju mora biti vzklik
 * jasno SLIŠEN, a očitno sekundarni. Raziskava: dubbing konvencija
 * (octavia.lunartech.ai — "a prioritized speaker sits louder than one left in
 * the bed"; prekrivni govor ostane slišen na NIZKEM nivoju pod prioritizirano
 * linijo), descript.com — naravnih prekrivanj ne odstranjujemo, ampak jih
 * uravnotežimo (crosstalk brez uravnoteženja = "dva enako glasna govorca").
 * Čisti vzkliki (isBackchannelText) torej dobijo PO loudnorm-u dodatno −3 dB
 * (skupaj s takeom −5,0…−2,5 dB pod glavnim govorom) → poslušalec "kima pod"
 * govorom z lastne strani (pan Task 28), namesto da bi glasna reakcija
 * konkurirala povedi. Razširjeni kandidati ("Res? Povej več!") ostanejo na
 * polnem nivoju — njihova glavnina je vsebina, prekriva se le prvi stavek.
 */
const BC_UNDER_DB = -3

/* ------------------------------------------------------------------ */
/* OSNOVNI TEMPO ARTIKULACIJE (audit proti profesionalnim merjenjem)   */
/* ------------------------------------------------------------------ */

/*
 * TEMPO AUDIT (Task 33, scripts/tempo-audit.ts) — merjenje našega korpusa
 * (10 epizod, ~130 vrstic, realna WAV trajanja + silencedetect) proti
 * Tivadar 2017 / Toporišič / Roach:
 *   - ČISTA artikulacija (brez notranjih tišin): 5,73 zlog/s → na SPODNJI
 *     meji profesionalnega razpona 5,7–7,7 (TV/radio voditelji, Roach: večina
 *     govorcev 5–6; Toporišič/Tivadar: slovenski medijski standard 5–6)
 *   - SR (govorna hitrost s pavzami): 4,2 zlog/s → rahlo pod ad-lib
 *     standardom 4,4–5,6 (Tivadar, TV voditelji v dialogu)
 *   - AR/SR (delež pavz): 1,36 → zgornja meja profesionalnega 1,17–1,37
 *     → struktura pavz je pravilna (Edge sam vdaja 26,7 % notranjih tišin),
 *     POPRAVLJA se le absolutni nivo artikulacije.
 * Rešitev: enoten osnovni tempo +5 % na vsebinske vrstice → čista AR ~6,0
 * (sredina razpona), SR ~4,4 (v standardu), AR/SR ~1,30 (sredina).
 * Vzkliki (takeovi) ostanejo izključeni — njihova hitrost je kalibrirana
 * posebej; relativna dramaturgija loka (uvod hitreje, zaključek počasneje)
 * ostane čez osnovo. Pavze NAMERNO nespremenjene (razmerje je že v razponu).
 */
const BASE_RATE_PCT = 5

/* ------------------------------------------------------------------ */
/* MIKRO-JITTER TEMPA PO VRSTICI (±2 %)                                */
/* ------------------------------------------------------------------ */

/*
 * Raziskava (soniox.com — "ritem je točka, kjer se sintetični govor najpogosteje
 * izda"; r/aitubers — enakoma hitrost vseh odsekov zveni kot GPS): vsaka
 * vrstica dobi svoj SUBTILEN nivo tempa iz 5 (−2…+2 %).
 *
 * DETERMINISTIČNO po (pot brez procesno-specifične pripone + besedilo) →
 * ista vrstica = isti jitter (reproducibilno), različne vrstice = različen
 * ritem. HROŠČ (Task 29): prej je bila vrednost izračunana iz dolžine poti +
 * 5. znaka — poti vseh vrstic imajo enako dolžino in isto predpono → vrednost
 * je bila KONSTANTA za vse vrstice v runi (nič prave variabilnosti).
 */
export function rateJitterPctFor(text: string, key: string): number {
  return (djb2Hash(`${key}|${text.trim().toLowerCase()}`) % 5) - 2
}

/* ------------------------------------------------------------------ */
/* ENERGIJSKI LOK EPIZODE (dramaturgija pozicije)                      */
/* ------------------------------------------------------------------ */

/*
 * Raziskava (Task 27: podigy.co — tridelna struktura "hook → glavnina →
 * zaključek"; hivecast.fm — uvod odloča o retenciji v prvih ~30 s; Pacific
 * Content — zaključek se "zapakira": počasneje, nižje, tišeje). Sinteza torej
 * dobi SUBTILNE DELTE po poziciji vrstice v epizodi:
 *   - uvod (prvih ~12 % vrstic): rahlo hitreje in višje — vstopna energija
 *   - glavnina: nevtralno (prosodni boosti po vlogi vrstice ostanejo glavni)
 *   - zaključek (zadnjih ~15 %): počasneje, nižje, tišeje — občutek zaključka
 * Vrednosti so namerno majhne, da ne tekmujejo z vzkliki (ti imajo takeove).
 */
export interface EpisodeArcDelta {
  rateDelta: number
  pitchDelta: number
  gainDb: number
}

const ARC_NEUTRAL: EpisodeArcDelta = { rateDelta: 0, pitchDelta: 0, gainDb: 0 }

export function episodeArcFor(index: number, total: number): EpisodeArcDelta {
  if (total <= 1) return ARC_NEUTRAL
  const p = Math.min(1, Math.max(0, index / (total - 1)))
  if (p < 0.12) return { rateDelta: 2, pitchDelta: 1, gainDb: 0 }
  if (p > 0.85) return { rateDelta: -3, pitchDelta: -2, gainDb: -0.8 }
  return ARC_NEUTRAL
}

/* ------------------------------------------------------------------ */
/* DVODELNE VRSTICE Z VMESNIM DIHOM                                    */
/* ------------------------------------------------------------------ */

interface MidSplit {
  first: string
  second: string
  /** Pavza med deloma (ms) — brez robov, ki jih dodata odrez. */
  gapMs: number
  /** Tihi vmesni vdih pri stavčni meji (multiplikator); null = čista pavza. */
  breathGain: number | null
  variant: number
}

const MID_SPLIT_MIN_CHARS = 110
const MID_SPLIT_MAX_CHARS = 320
const MID_SPLIT_PART_MIN = 40

/*
 * Raziskava (Task 21/22): naravni govorci pri daljših povedih VEDNO vdihnejo
 * na meji stavka; Edge TTS v enem klicu ne generira dihov → dolge vrstice
 * zvenijo "brez zraka" in preveč zglajeno. Rešitev: vrstico ≥ 110 znakov
 * razdelimo na NAJBOLJŠEM kandidatu blizu sredine (stavčna meja > veznik >
 * vejica), vsak del sintetiziramo posebej in sestavimo s pavzo + tihi vdih.
 * Deterministično po besedilu → ista vrstica = isti take (reproducibilno).
 */
export function splitLineForBreath(text: string): MidSplit | null {
  const s = text.trim()
  if (s.length < MID_SPLIT_MIN_CHARS || s.length > MID_SPLIT_MAX_CHARS) return null

  type Cand = { cut: number; kind: 'sentence' | 'comma' | 'conj' }
  const cands: Cand[] = []
  // Stavčne meje: ločilo + presledek (ločilo ostane v prvem delu)
  for (const m of s.matchAll(/[.!?…]["'»”)]?(?=\s)/g)) {
    if (m.index === undefined) continue
    cands.push({ cut: m.index + m[0].length, kind: 'sentence' })
  }
  // Vezniki na začetku odvisnega/novega stavka (brez vejice)
  for (const m of s.matchAll(/\s(?:in|pa|ker|ampak|toda|vendar|ki|saj|ko|če|kjer|zato|ali)\s/gi)) {
    if (m.index === undefined) continue
    cands.push({ cut: m.index + 1, kind: 'conj' })
  }
  // Vejice (podrejeni/vstavljeni stavek)
  for (const m of s.matchAll(/,(?=\s)/g)) {
    if (m.index === undefined) continue
    cands.push({ cut: m.index + 1, kind: 'comma' })
  }

  const mid = s.length / 2
  const h =
    (s.length * 2654435761 +
      (s.charCodeAt(0) || 7) * 40503 +
      (s.charCodeAt(s.length - 1) || 11) * 7919) >>>
    0
  const jitter = ((h % 3) - 1) * 20 // ±20 ms (anti-metronom)

  let best: Cand | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const c of cands) {
    const p1 = s.slice(0, c.cut).trim()
    const p2 = s.slice(c.cut).trim()
    if (p1.length < MID_SPLIT_PART_MIN || p2.length < MID_SPLIT_PART_MIN) continue
    if (p1.endsWith(':')) continue // uvaja naštevanje — dih tu zveni napačno
    // Bonus za naravnost meje (nižji score = boljša)
    const bonus = c.kind === 'sentence' ? 30 : c.kind === 'conj' ? 10 : 0
    const score = Math.abs(c.cut - mid) - bonus
    if (score < bestScore) {
      bestScore = score
      best = c
    }
  }
  if (!best) return null

  const first = s.slice(0, best.cut).trim()
  const second = s.slice(best.cut).trim()
  if (best.kind === 'sentence') {
    // Stavčna meja: daljša pavza + tih vdih (skupaj ≈ 0,4 s z robovi)
    return {
      first,
      second,
      gapMs: 170 + jitter,
      breathGain: 0.55 + (h % 3) * 0.1,
      variant: h % 3,
    }
  }
  // Vejica/veznik: kratka pavza brez diha (≈ 0,23 s z robovi)
  return { first, second, gapMs: 95 + jitter / 2, breathGain: null, variant: h % 3 }
}

export async function edgeSynthesize(
  text: string,
  voice: string,
  speed: number,
  outPath: string,
  arc: EpisodeArcDelta = ARC_NEUTRAL,
): Promise<void> {
  const azureVoice = EDGE_VOICE_MODELS[voice]
  if (!azureVoice) throw new Error(`Ni Edge modela za glas ${voice}`)

  const mp3Path = `${outPath}.${process.pid}.edge.mp3`
  try {
    // Mikrovariacija ponovljenih reakcij (takei) — glej BACKCHANNEL_TAKES.
    // Ključ brez procesno-specifične pripone → ista vrstica = isti take vedno.
    const synthKey = outPath.replace(/\.\d+\.tmp$/, '')
    const bcTake = isBackchannelText(text) ? backchannelTakeFor(text, synthKey) : null
    // Vzklik zveni POD glavnim govorom (take + −3 dB) — glej BC_UNDER_DB zgoraj.
    const bcGainDb = bcTake ? bcTake.gainDb + BC_UNDER_DB : 0
    /*
     * PRAVI MIKRO-JITTER TEMPA ±2 % (Task 29): determinističen po (pot +
     * besedilo) → vsaka vrstica svoj ritem. Vzkliki jega NE dobijo — njihovi
     * takeovi že variirajo rate za 3–12 % (jitter bi bil šum na tem).
     */
    const jitterPct = bcTake ? 0 : rateJitterPctFor(text, synthKey)
    // Prosodni boost po vlogi vrstice (vprašanje / reakcija) — glej zgoraj
    const boost = bcTake ?? prosodyBoostForText(text)
    /*
     * Energijski lok epizode (uvod/zaključek) velja za vsebinske vrstice;
     * vzkliki ostanejo na svojih takeovih (lok ne bi smel upočasniti "Vau!"),
     * dvodelne vrstice pa podedujejo iste parametre za oba dela (brez preskoka).
     */
    const arcEff = bcTake ? ARC_NEUTRAL : arc
    const ratePct = Math.max(
      -30,
      Math.min(
        40,
        Math.round((clampSpeed(speed) - 1) * 100) +
          (bcTake ? 0 : BASE_RATE_PCT) +
          jitterPct +
          boost.rateDelta +
          arcEff.rateDelta,
      ),
    )
    const basePitch =
      parseInt((EDGE_PITCH_HZ[voice] ?? '+0Hz').replace(/[^-+\d]/g, ''), 10) || 0
    const pitchHzNum = basePitch + boost.pitchDelta + arcEff.pitchDelta

    // `=vrednost` oblika je OBVEZNA: argparse vrednost z minus (npr. -12Hz)
    // sicer tretira kot zastavo in sinteza razpade
    const runEdge = async (partText: string, partMp3: string): Promise<void> => {
      const args = [
        '-m', 'edge_tts',
        '--voice', azureVoice,
        '--text', partText,
        `--rate=${ratePct >= 0 ? '+' : ''}${ratePct}%`,
      ]
      // Nativni nevronski pitch (brez asetrate artefaktov)
      if (pitchHzNum !== 0) args.push(`--pitch=${pitchHzNum > 0 ? '+' : ''}${pitchHzNum}Hz`)
      args.push('--write-media', partMp3)
      await execFile('python3', args, { timeout: 90_000, maxBuffer: 16 * 1024 * 1024 })
      if (!fs.existsSync(partMp3) || fs.statSync(partMp3).size < 1000) {
        throw new Error('Edge TTS je vrnil prazen izhod')
      }
    }

    /*
     * DVODELNE VRSTICE (vmesni dih): dolga poved → 2 sintezi + sestava s pavzo.
     * Prosodni parametri (rate/pitch) so ENAKI za oba dela (izračunani na celem
     * besedilu) → brez tonalnega preskoka; pri napaki pademo na enodelno sintezo.
     */
    const split = splitLineForBreath(text)
    if (split) {
      try {
        await synthTwoParts(split, azureVoice, ratePct, pitchHzNum, outPath, arcEff.gainDb)
        console.log(
          `[tts] dvodelna vrstica: ${split.first.length}+${split.second.length} znakov, pavza ${split.gapMs.toFixed(0)} ms${split.breathGain !== null ? ' + vdih' : ''}`,
        )
        return
      } catch (err) {
        console.error(
          '[tts] dvodelna sinteza ni uspela, sintetiziram vrstico v enem kosu:',
          err instanceof Error ? err.message : err,
        )
      }
    }

    await runEdge(text, mp3Path)
    // Pitch je že rešen v nevronski sintezi (--pitch) → obdelava brez premika
    await polishAudioToWav(
      mp3Path,
      outPath,
      EDGE_SAMPLE_RATE,
      1.0,
      bcGainDb + arcEff.gainDb,
    )
    if (bcTake) {
      console.log(
        `[tts] backchannel take: rate ${ratePct} %, pitch ${pitchHzNum} Hz, glasnost ${bcGainDb >= 0 ? '+' : ''}${bcGainDb.toFixed(1)} dB (take ${bcTake.gainDb >= 0 ? '+' : ''}${bcTake.gainDb.toFixed(1)} + pod-govor ${BC_UNDER_DB})`,
      )
    } else if (arcEff.rateDelta !== 0 || arcEff.pitchDelta !== 0 || arcEff.gainDb !== 0) {
      console.log(
        `[tts] energijski lok: rate ${ratePct} % (osnovni tempo ${BASE_RATE_PCT > 0 ? '+' : ''}${BASE_RATE_PCT} %), pitch ${pitchHzNum} Hz${arcEff.gainDb !== 0 ? `, glasnost ${arcEff.gainDb.toFixed(1)} dB` : ''}`,
      )
    } else {
      console.log(
        `[tts] tempo vrstice: rate ${ratePct} % (osnovni ${BASE_RATE_PCT > 0 ? '+' : ''}${BASE_RATE_PCT} % + jitter ${jitterPct > 0 ? '+' : ''}${jitterPct})`,
      )
    }
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1000) {
      throw new Error('Edge WAV pretvorba je izpraznila izhod')
    }
  } finally {
    try {
      if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path)
    } catch {
      // ignore
    }
  }
}

/*
 * Sestava dveh delov vrstice: [del1][pavza (+ tihi vdih pri stavčni meji)][del2].
 * Robove VSAKEGA dela odrežemo (Edge doda ~0,2 s začetek / 0,6–1,0 s konec —
 * enak odrez kot pri celih vrsticah), nato standardna obdelava (loudnorm,
 * filtri) doda room tone bed TUDI čez vmesno pavzo → ambijens ostane kontinuiran.
 */
async function synthTwoParts(
  split: MidSplit,
  azureVoice: string,
  ratePct: number,
  pitchHzNum: number,
  outPath: string,
  postGainDb = 0,
): Promise<void> {
  const pid = process.pid
  const p1 = `${outPath}.${pid}.mid1.mp3`
  const p2 = `${outPath}.${pid}.mid2.mp3`
  const raw = `${outPath}.${pid}.mid.wav`
  try {
    for (const [partText, partPath] of [
      [split.first, p1],
      [split.second, p2],
    ] as const) {
      const args = [
        '-m', 'edge_tts',
        '--voice', azureVoice,
        '--text', partText,
        `--rate=${ratePct >= 0 ? '+' : ''}${ratePct}%`,
      ]
      if (pitchHzNum !== 0) args.push(`--pitch=${pitchHzNum > 0 ? '+' : ''}${pitchHzNum}Hz`)
      args.push('--write-media', partPath)
      await execFile('python3', args, { timeout: 90_000, maxBuffer: 16 * 1024 * 1024 })
      if (!fs.existsSync(partPath) || fs.statSync(partPath).size < 1000) {
        throw new Error('Edge TTS je vrnil prazen izhod (del vrstice)')
      }
    }

    // Odrez robov per del (isto kot v polishAudioToWav — glej razlage tam)
    const TRIM =
      'silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.05,' +
      'areverse,' +
      'silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.09,' +
      'areverse'

    const inputs: string[] = [
      '-i', p1,
      '-f', 'lavfi', '-t', (split.gapMs / 1000).toFixed(3), '-i', 'anullsrc=r=24000:cl=mono',
    ]
    const chains: string[] = [
      `[0:a]aresample=24000,${TRIM}[c0]`,
      '[1:a]aresample=24000[c1]',
    ]
    let n = 2
    if (split.breathGain !== null) {
      const breathPath = await ensureBreathFile('quick', split.variant)
      inputs.push('-i', breathPath)
      chains.push(`[2:a]aresample=24000,volume=${split.breathGain.toFixed(2)}[c2]`)
      n = 3
    }
    inputs.push('-i', p2)
    chains.push(`[${n}:a]aresample=24000,${TRIM}[c${n}]`)
    const labels = Array.from({ length: n + 1 }, (_, i) => `[c${i}]`).join('')
    chains.push(`${labels}concat=n=${n + 1}:v=0:a=1[out]`)

    await execFile('ffmpeg', [
      '-y', '-v', 'error',
      ...inputs,
      '-filter_complex', chains.join(';'),
      '-map', '[out]',
      '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'wav',
      raw,
    ])
    await polishAudioToWav(raw, outPath, EDGE_SAMPLE_RATE, 1.0, postGainDb)
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1000) {
      throw new Error('Edge WAV pretvorba je izpraznila izhod')
    }
  } finally {
    for (const f of [p1, p2, raw]) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f)
      } catch {
        // ignore
      }
    }
  }
}

/*
 * VDIH PRED VRSTICO (raziskava Task 21: vstavljanje dihov je UVELJAVLJENA tehnika
 * naravnosti TTS — "a widely adopted strategy is to detect breath sounds in speech
 * data and insert them"; NotebookLM mimizira "natural breathing and pauses").
 * Vrstica se začne s skoraj neslišnim vdihom (~-30 dBFS) namesto s sterilnim
 * skokom iz tišine → občutek žive osebe, ne sinteze. 3 varijante (anti-metronom)
 * × 2 vrsti: full (navadna poved, 0,15 s) in quick (reakcija, 0,07 s).
 */
async function ensureBreathFile(kind: 'full' | 'quick', variant: number): Promise<string> {
  const dur = kind === 'full' ? 0.15 : 0.07
  const file = `breath_${kind}_${variant}.wav`
  const outPath = path.join(AUDIO_DIR, file)
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) return outPath
  fs.mkdirSync(AUDIO_DIR, { recursive: true })
  const fadeOutSt = kind === 'full' ? 0.09 : 0.04
  await execFile('ffmpeg', [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', `anoisesrc=color=pink:r=24000:amplitude=0.9:seed=${1000 + variant * 77}`,
    '-t', String(dur),
    '-af', [
      `highpass=f=${300 + variant * 70}`,
      `lowpass=f=${2300 + variant * 250}`,
      'afade=t=in:st=0:d=0.05',
      `afade=t=out:st=${fadeOutSt}:d=${Math.max(0.02, dur - fadeOutSt)}`,
      'volume=0.055',
      'apad=pad_dur=0.02',
    ].join(','),
    '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le',
    outPath,
  ])
  return outPath
}

/** Doda vdih pred začetek vrstice (full = navadna poved, quick = hitra reakcija). */
async function addBreathPreRoll(filePath: string, seedKey: string, text: string): Promise<void> {
  const t = text.trim()
  const reactive = isBackchannelText(t) || REACTION_START_RE.test(t) || t.endsWith('?')
  const kind = reactive ? 'quick' : 'full'
  const h =
    (seedKey.length * 2654435761 +
      (seedKey.charCodeAt(0) || 7) * 40503 +
      (seedKey.charCodeAt(seedKey.length - 1) || 11) * 7919) >>> 0
  const variant = h % 3
  const gain = (0.8 + (h % 5) * 0.1).toFixed(2) // 0,8–1,2 × (anti-metronom)
  const breathPath = await ensureBreathFile(kind, variant)
  const tmp = `${filePath}.${process.pid}.breath.wav`
  await execFile('ffmpeg', [
    '-y', '-v', 'error',
    '-i', breathPath, '-i', filePath,
    '-filter_complex', `[0:a]volume=${gain}[b];[b][1:a]concat=n=2:v=0:a=1[out]`,
    '-map', '[out]', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le',
    tmp,
  ])
  fs.renameSync(tmp, filePath)
}

/** Skupna finalizacija sinteze: preimenuj tmp → cilj, dodaj vdih pred govor. */
async function finalizeSynth(tmpPath: string, filePath: string, text: string): Promise<void> {
  fs.renameSync(tmpPath, filePath)
  try {
    await addBreathPreRoll(filePath, path.basename(filePath), text)
  } catch (err) {
    console.error(
      '[tts] vdih ni uspel (vrstica ostane brez njega):',
      err instanceof Error ? err.message : err,
    )
  }
}

export async function ttsToFile(
  text: string,
  voice: string,
  speed: number,
  filename: string,
  arc: EpisodeArcDelta = ARC_NEUTRAL,
): Promise<{ filePath: string; durationMs: number }> {
  fs.mkdirSync(AUDIO_DIR, { recursive: true })
  const filePath = path.join(AUDIO_DIR, filename)
  const tmpPath = `${filePath}.${process.pid}.tmp`

  // Primarni ponudnik: Edge TTS (Microsoft Neural — Rok/Petra, najbolj naravna slovenščina)
  if (EDGE_VOICE_MODELS[voice]) {
    try {
      await edgeSynthesize(text, voice, speed, tmpPath, arc)
      await finalizeSynth(tmpPath, filePath, text)
      return { filePath, durationMs: wavDurationMs(fs.readFileSync(filePath)) }
    } catch (err) {
      console.error(`[tts] Edge sinteza za ${voice} ni uspela, poskušam Piper rezervo:`, err)
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
      } catch {
        // ignore
      }
    }
  }

  // Rezerva: lokalni Piper nevronska sinteza (prava slovenščina, brez povezave)
  if (PIPER_VOICE_MODELS[voice]) {
    try {
      await piperSynthesize(text, voice, speed, tmpPath)
      await finalizeSynth(tmpPath, filePath, text)
      return { filePath, durationMs: wavDurationMs(fs.readFileSync(filePath)) }
    } catch (err) {
      console.error('[tts] Piper sinteza ni uspela, uporabljam z-ai zasilni glas:', err)
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
      } catch {
        // ignore
      }
    }
  }

  // Zasilni ponudnik: z-ai TTS
  const zai = await getZai()
  const safeVoice = PIPER_TO_ZAI[voice] ?? 'tongtong'
  const safeSpeed = clampSpeed(speed)
  const chunks = splitTextIntoChunks(text)

  const buffers: Buffer[] = []
  for (const chunk of chunks) {
    const response = await ttsCreateWithRetry(zai, {
      input: chunk,
      voice: safeVoice,
      speed: safeSpeed,
      response_format: 'wav',
      stream: false,
    })
    const arrayBuffer = await response.arrayBuffer()
    buffers.push(Buffer.from(new Uint8Array(arrayBuffer)))
  }

  const buffer = buffers.length === 1 ? buffers[0] : concatWav(buffers)
  fs.writeFileSync(tmpPath, buffer)
  await finalizeSynth(tmpPath, filePath, text)

  return { filePath, durationMs: wavDurationMs(fs.readFileSync(filePath)) }
}

/* ------------------------------------------------------------------ */
/* MP3 export (celotna epizoda v eni datoteki)                         */
/* ------------------------------------------------------------------ */

export const EXPORT_PREFIX = 'export_'
/*
 * KONTEKSTNE PAVZE MED VRSTICAMI (raziskava: Stivers 2009 PNAS, Levinson 2015 —
 * naravna menjava govorca v pogovoru je ~200 ms; MagicHub dialogni korpusi —
 * >40 % naravnega dialoga ima prekrivanje/backchannele). Robna tišina je iz
 * vrstic ODREZANA (~0,05 s vhod / ~0,15 s izhod); emocija in mikrojitter
 * prilagodita osnovno pavzo — glej gapSecondsFor spodaj.
 */
const GAP_TURN_SECONDS = 0.1
const GAP_SAME_SECONDS = 0.02
const GAP_CHAPTER_SECONDS = 0.42
const JINGLE_INTRO_FILE = 'jingle_intro.wav'
const JINGLE_OUTRO_FILE = 'jingle_outro.wav'

export interface GapLineInfo {
  speaker?: string | null
  chapter?: string | null
  emotion?: string | null
  text?: string | null
}

/** Deterministični mini-hash za jiter (isti seed → isti rezultat v vseh izvozih). */
function seedHash(seed: number): number {
  return ((seed + 1) * 2654435761) >>> 0
}

/** V teku: generiranje iste gap datoteke poteka samo ENKRAT (npr. izvoz +
 * predvajalnik hkrati zahtevata `gap_0.42.wav` — obe čakata isti obljubi). */
const gapInFlight = new Map<string, Promise<string>>()

/** Keširana tišina podane dolžine (ime = `gap_<s>.wav`, sprememba → nov keš).
 * Pisarna piše v enolično ZAČASNO datoteko in jo ATOMSKO preimenuje — vzporedni
 * zahtevki nikoli ne preberejo polovično zapisane datoteke. */
export function ensureGapFile(seconds: number): Promise<string> {
  const file = `gap_${seconds.toFixed(2)}.wav`
  const inFlight = gapInFlight.get(file)
  if (inFlight) return inFlight
  const promise = generateGapFile(seconds, file).finally(() => {
    gapInFlight.delete(file)
  })
  gapInFlight.set(file, promise)
  return promise
}

async function generateGapFile(seconds: number, file: string): Promise<string> {
  const outPath = path.join(AUDIO_DIR, file)
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1000) {
    fs.mkdirSync(AUDIO_DIR, { recursive: true })
    // Pavza NI digitalna nič — enak room tone kot vrstice (raziskava: room tone
    // −50…−60 dB pod govor "lepi" ločene posnetke v isti prostor — ambience match)
    const tmpPath = path.join(AUDIO_DIR, `.${file}.${process.pid}.${Date.now()}.tmp`)
    try {
      await execFile('ffmpeg', [
        '-y',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=24000:cl=mono',
        '-f',
        'lavfi',
        '-i',
        `anoisesrc=color=pink:r=24000:amplitude=1:seed=${Math.floor(Math.random() * 1e6)}`,
        '-t',
        String(seconds),
        '-filter_complex',
        '[1:a]volume=0.0121[bed];[0:a][bed]amix=inputs=2:duration=first:normalize=0[out]',
        '-map',
        '[out]',
        '-ar',
        '24000',
        '-ac',
        '1',
        '-c:a',
        'pcm_s16le',
        // Zacasna datoteka nima standardne koncnice → format EKSPPLICITNO
        '-f',
        'wav',
        tmpPath,
      ])
      fs.renameSync(tmpPath, outPath) // atomsko — bralci vidijo samo celo datoteko
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    }
  }
  return outPath
}

/*
 * PAVZE PO EMOCIJI: vznemirjeni govorci odgovarjajo HITREJE, premišljeni
 * počasneje (dialogni korpusi). Osnovne vrednosti (datoteka) + robovi ~0,20 s:
 *   - vznemirjen (navdušeno/šokiran/smeje…): 0,06 s ≈ 0,26 s skupaj (nagel odgovor)
 *   - nevtralna menjava govorca:            0,10 s ≈ 0,30 s skupaj
 *   - premišljen (zamišljeno/mirno…):       0,14 s ≈ 0,34 s skupaj
 *   - isti govorec:                         0,02 s ≈ 0,22 s skupaj
 *   - novo poglavje:                        0,42 s ≈ 0,62 s skupaj
 * Plus MIKROJITTER (determinističen po paru) — brez njega je ritem metronomsko
 * mehanski, kar je bilo del občutka "kot v zaporu".
 */
const EXCITED_EMOTIONS = new Set([
  'navdušeno', 'navduseno', 'šokiran', 'sokiran', 'pretirano', 'smeje se',
  'smeje', 'razjarjen', 'razburjen', 'zagreto', 'presenečeno', 'osebno',
])
const CALM_EMOTIONS = new Set([
  'zamišljeno', 'zamisljeno', 'mirno', 'resno', 'utrujeno', 'pogrešeno',
])

/*
 * REAKTIVNI ZAČETKI: vrstica, ki se priklaplja na pogovor ("Ja, ampak…",
 * "Glej…", "Res?", "Mhm."), naj se zasliši TAKOJ po drugem — prav to daje
 * občutek sodelovanja namesto izmenjave monologov.
 */
const REACTION_START_RE =
  /^(mhm|mm-hm|mm|aha|ah|res|točno|tocno|ja|no|glej|poslušaj|poslusaj|vau|va|uf|uh|ful|super|dajno|daj|okej|okay|sej|vazi|ne|predstavljaj|ne morem)\b/i

/*
 * VPRAŠALNICE VSEBINSKIH VPRAŠANJ: "Petra, veš kaj je najboljše?" je prenos
 * poteze z vsebino, ne reakcija poslušalca. Vzkliki ("Res?", "Kaj?!") so
 * POLARNI (ja/ne/čustvo) — vsebinsko vprašanje pa vsebuje vprašalnico.
 */
const WH_QUESTION_RE =
  /\b(kaj|kje|kdaj|zakaj|kako|koliko|katera|kateri|katero|katerim|katerih|kdo|kam|čemu|ali)\b/i

/**
 * Kratka samostojna reakcija (backchannel): ≤ 5 besed in ≤ 34 znakov s končno
 * ložilo.
 *
 * IZJEME (Task 32 — takrat je vrstica VSEBINA, ne vzklik):
 *  - vodilno vprašanje z vprašalnico (≥ 3 besede, konča se z '?'):
 *    "Petra, veš kaj je najboljše?" — prej je po krivo dobila take vzklika,
 *    nivo "pod govorom" (−3 dB) in prekrivanje; zdaj dobi vprašalni prosodni
 *    boost (rate +2 %/pitch +3 Hz) in polno glasnost. "Res?" (1 beseda) in
 *    "Kaj, Rok? Povej!" (se konča z '!') ostanejo pravi vzkliki.
 *  - naslovljeni prenos poteze (≥ 4 besede, začne se z "Ime,"):
 *    "Rok, povej nam več." — navodilo drugemu gostitelju. "Petra?!" (brez
 *    vejice) ostane vzklik.
 */
export function isBackchannelText(t: string): boolean {
  const s = t.trim()
  if (!s || s.length > 34) return false
  const words = s.split(/\s+/).length
  if (words > 5) return false
  if (!/[!?.]$/.test(s)) return false
  if (words >= 3 && s.endsWith('?') && WH_QUESTION_RE.test(s)) return false
  if (words >= 4 && /^[A-ZČŠŽ][a-zčšž]{1,15},/.test(s)) return false
  return true
}

/**
 * Pavza med dvema vrsticama glede na kontekst (poglavje > emocija > menjava
 * govorca > isti govorec) + determinističen mikrojitter po paru vrstic.
 */
export function gapSecondsFor(prev: GapLineInfo | null, next: GapLineInfo, seed = 0): number {
  const jitter = (base: number, step: number): number => {
    const slot = seedHash(seed) % 3
    return Math.max(0.01, Math.round((base + (slot - 1) * step) * 100) / 100)
  }
  if (next.chapter && next.chapter !== (prev?.chapter ?? null)) return GAP_CHAPTER_SECONDS
  if (prev?.speaker && next.speaker && prev.speaker !== next.speaker) {
    const em = (next.emotion ?? '').toLowerCase()
    const t = (next.text ?? '').trim()
    // Reaktivni priklop (backchannel / "ja, ampak…") = NAJHITREJŠI odziv:
    // poslušalec takoj zasliši, da drugi GOSTITELJ sodeluje, ne monologira
    const reactive =
      isBackchannelText(t) || REACTION_START_RE.test(t) || t.endsWith('?')
    const base = reactive
      ? 0.04
      : EXCITED_EMOTIONS.has(em)
        ? 0.06
        : CALM_EMOTIONS.has(em)
          ? 0.14
          : GAP_TURN_SECONDS
    return jitter(base, 0.02)
  }
  return jitter(GAP_SAME_SECONDS, 0.01)
}

/*
 * PREKRIVANJE BACKCHANNELOV (dialogni korpusi: kratke reakcije poslušalca se v
 * naravnem pogovoru pogosto začnejo PRED koncem drugega govorca — "Resno?!"
 * pade NAD zadnji zlog prejšnje povedi). Kandidat: vrstica, katere PRVI stavek
 * je čista reakcija (≤5 besed — "Res?", "Aha, glej to!", "Ne morem verjeti!"),
 * skupaj do 12 besed / 90 znakov. Čisti backchanneli se prekrijejo VEDNO,
 * razširjeni kandidati ~60 % (deterministično po paru — naravna variabilnost).
 * Pogoji: prejšnja vrstica dovolj dolga (≥1,2 s — sicer bi bilo prekrivanje
 * zmeda mikro-vzklikov) in ni menjave poglavja (poglavje ima svojo 0,42 s
 * pavzo). Negativna vrednost = vrstica se začne |x| sekund PRED koncem.
 */
export function isOverlapCandidate(t: string): boolean {
  const s = t.trim()
  if (!s || s.length > 90) return false
  if (s.split(/\s+/).length > 12) return false
  const first = s.split(/(?<=[!?.])\s/, 1)[0] ?? ''
  return isBackchannelText(first)
}

export function overlapSecondsFor(
  prev: GapLineInfo | null,
  next: GapLineInfo,
  seed = 0,
  prevDurMs: number | null = null,
): number {
  if (!prev || !prev.speaker || !next.speaker) return 0
  if (prev.speaker === next.speaker) return 0
  if (next.chapter && next.chapter !== prev.chapter) return 0
  const t = (next.text ?? '').trim()
  if (isBackchannelText(t)) {
    // čisti backchannel ("Mhm.", "Res?") → vedno prekrivanje
  } else if (isOverlapCandidate(t)) {
    if (seedHash(seed) % 5 >= 3) return 0 // ~60 % kandidatov se prekrije
  } else {
    return 0
  }
  if (prevDurMs !== null && prevDurMs < 1200) return 0
  const slot = seedHash(seed) % 3
  return 0.12 + slot * 0.03 // { 0.12, 0.15, 0.18 }
}

export interface EpisodeExport {
  filePath: string
  bytes: number
  durationMs: number
}

/*
 * MASTERING IZVOZA (raziskava Task 21: Apple Podcasts/Spotify 2026 standard —
 * -16 LUFS stereo / -19 LUFS mono, true peak ≤ -1 dBTP; Auphonic privzeto -16 LUFS).
 * Mono izvoz → cilj -19 LUFS (enakovredna percepcija). Dvoprehodni loudnorm v
 * LINEARNEM načinu (brez "dihanja" dinamičnega načina) + IZREDNO rahel "room"
 * (zgodnji odmevi 5,5 %/3,5 %, 24/42 ms) — zlepi vrstice v ENAK prostor
 * (ambience match). Namerno BREZ Adobe/Descript-style destruktivnega enhancementa:
 * na čistem TTS zvoku daje "digitizirane" artefakte (reddit: "robotic and distorted").
 */
const EXPORT_LUFS = -19
const EXPORT_TP = -1.5
const EXPORT_ROOM = 'aecho=1:1:24|42:0.055|0.035' // enotni gain (suha pot ×1) — samo mokri odmevi dodani

/** Dvoprehodni loudnorm + rahel room: meritev z ISTO verigo → linear normaliziraj. */
async function masterExportMp3(rawPath: string, outPath: string, wavIntermediate = false): Promise<void> {
  const measureChain = `${EXPORT_ROOM},loudnorm=I=${EXPORT_LUFS}:TP=${EXPORT_TP}:LRA=11:print_format=json`
  let report = ''
  try {
    const res = await execFile(
      'ffmpeg',
      [
        '-hide_banner', '-nostats', '-i', rawPath,
        '-af', measureChain,
        '-f', 'null', '-',
      ],
      { maxBuffer: 4 * 1024 * 1024 },
    )
    report = res.stderr ?? ''
  } catch (err) {
    report = String((err as { stdout?: string; stderr?: string }).stderr ?? '')
  }
  const num = (k: string): number | null => {
    const r = new RegExp(`"input_${k}"\\s*:\\s*"?(-?[\\d.]+)"?`).exec(report)
    return r ? Number(r[1]) : null
  }
  const i = num('i')
  const tp = num('tp')
  const lra = num('lra')
  const th = num('thresh')
  const measuredOk =
    i !== null && tp !== null && lra !== null && th !== null && i > -70 && i < 0
  const loudnorm = measuredOk
    ? `loudnorm=I=${EXPORT_LUFS}:TP=${EXPORT_TP}:LRA=11:measured_I=${i}:measured_TP=${tp}:measured_LRA=${lra}:measured_thresh=${th}:linear=true`
    : `loudnorm=I=${EXPORT_LUFS}:TP=${EXPORT_TP}:LRA=11`
  await execFile('ffmpeg', [
    '-y', '-v', 'error',
    '-i', rawPath,
    '-af', `${EXPORT_ROOM},${loudnorm},alimiter=limit=0.84:level=disabled:attack=5:release=60`,
    '-ar', '24000', '-ac', '2',
    // WAV vmesni izhod = glasbena mešanica sledi brez ponovnega mp3 kodiranja
    ...(wavIntermediate ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'libmp3lame', '-q:a', '4']),
    outPath,
  ])
}

/**
 * GLASBENA MEŠANICA NA MASTERIRAN GOVOR (Task 37): podlaga = Aadd9 pad na
 * poglavitnih prelomih, udušen z sidechaincompress (stranska veriga = govor).
 * Vhod je že masteriran WAV (govor −19 LUFS) → absolutna raven podlage je
 * stabilna (MUSIC_BED_LEVEL množitelj), ducking −15 dB pod govorom, v pavzi
 * se sprosti nazaj. Izhod = končni MP3 (ena samo kodiranje).
 */
async function mixMusicIntoMaster(
  masterWavPath: string,
  outPath: string,
  chapterStarts: ChapterMarker[],
  musicBedPath: string,
): Promise<void> {
  const args: string[] = ['-y', '-v', 'error', '-i', masterWavPath]
  const parts: string[] = []
  const musicLabels: string[] = []
  chapterStarts.forEach((ch, i) => {
    args.push('-i', musicBedPath)
    const delayMs = Math.max(0, ch.startMs - MUSIC_BED_LEAD_MS)
    parts.push(
      `[${i + 1}:a]pan=stereo|c0=c0|c1=c0,adelay=${delayMs}:all=1[m${i}]`,
    )
    musicLabels.push(`[m${i}]`)
  })
  const filter =
    `${parts.join(';')};` +
    `${musicLabels.join('')}amix=inputs=${musicLabels.length}:duration=longest:normalize=0,` +
    `volume=${MUSIC_BED_LEVEL}[music];` +
    `[music][0:a]${MUSIC_DUCK_FILTER}[duck];` +
    `[0:a][duck]amix=inputs=2:duration=first:normalize=0,aresample=24000[out]`
  args.push(
    '-filter_complex',
    filter,
    '-map', '[out]',
    '-ar', '24000', '-ac', '2', '-c:a', 'libmp3lame', '-q:a', '4',
    outPath,
  )
  await execFile('ffmpeg', args, { maxBuffer: 8 * 1024 * 1024, timeout: 300_000 })
}

export function exportPathFor(episodeId: string, withJingle = false): string {
  // "m" = era glasbene podlage (Task 37) → samodejna invalidacija starih kešev
  const suffix = withJingle ? '_jm' : ''
  return path.join(AUDIO_DIR, `${EXPORT_PREFIX}${episodeId}${suffix}.mp3`)
}

/*
 * VGRAJENA ZNAČKE + POGAVLJA (Task 32): ID3v2.3 CHAP/CTOC poglavja in
 * title/artist/album značke — Apple Podcasts, Overcast in Pocket Casts jih
 * berejo NARAVNO (brez stranskih datotek). Lokalno dokazano: ffmpeg mp3
 * muxer zapiše CHAP okvire z `-id3v2_version 3 -map_chapters`
 * (ffprobe -show_chapters jih prebere). Remux je `-codec copy` → mastered
 * zvok ostane BIT-VRTEN; ob napaki samo logiramo (izvoz brez poglavij je
 * še vedno veljaven).
 */
async function embedMp3Metadata(
  mp3Path: string,
  meta: {
    title?: string
    artist?: string
    chapters?: { title: string; startMs: number }[]
    durationMs?: number
    imagePath?: string | null
  },
): Promise<void> {
  const hasChapters = !!meta.chapters && meta.chapters.length > 0
  const hasImage = Boolean(meta.imagePath && fs.existsSync(meta.imagePath))
  if (!meta.title && !meta.artist && !hasChapters && !hasImage) return
  const lines: string[] = [';FFMETADATA1']
  if (meta.title) lines.push(`title=${escapeFfmetadata(meta.title)}`)
  if (meta.artist) lines.push(`artist=${escapeFfmetadata(meta.artist)}`)
  if (meta.title || meta.artist) lines.push('album=AI Podcast Studio')
  if (hasChapters) {
    // `hasChapters` ne zoži meta.chapters (boolean) — `?? []` je varno, ker
    // hasChapters zagotavlja nepraznost.
    const sorted = [...(meta.chapters ?? [])].sort((a, b) => a.startMs - b.startMs)
    const totalMs = meta.durationMs && meta.durationMs > 0 ? Math.round(meta.durationMs) : 0
    for (let i = 0; i < sorted.length; i += 1) {
      const start = Math.max(0, Math.round(sorted[i].startMs))
      const end =
        i + 1 < sorted.length
          ? Math.max(start + 1, Math.round(sorted[i + 1].startMs))
          : Math.max(start + 1, totalMs > start ? totalMs : start + 1)
      if (end <= start) continue
      lines.push(
        '[CHAPTER]',
        'TIMEBASE=1/1000',
        `START=${start}`,
        `END=${end}`,
        `title=${escapeFfmetadata(sorted[i].title)}`,
      )
    }
  }
  const metaPath = `${mp3Path}.${process.pid}.meta.txt`
  const tmpPath = `${mp3Path}.${process.pid}.tag.mp3`
  try {
    fs.writeFileSync(metaPath, `${lines.join('\n')}\n`)
    /*
     * ALBUM ART (Task 34): ovitek kot dodatni vhod — mp3 muxer ga zapiše kot
     * ID3v2.3 APIC okvir (attached picture), ki ga Apple Podcasts, Overcast,
     * Pocket Casts in VLC prikažejo kot naslovnico epizode. Standardni recept:
     * `-map 0:a -map 2:v -c copy -disposition:v attached_pic` (PNG copy brez
     * rekodiranja). Ovitek je 100 % izbirčen — ob napaki ostane izvod veljaven.
     */
    const ffArgs = [
      '-y', '-v', 'error',
      '-i', mp3Path, '-i', metaPath,
      ...(hasImage ? ['-i', meta.imagePath as string] : []),
      '-map', '0:a',
      ...(hasImage ? ['-map', '2:v'] : []),
      '-map_metadata', '1', '-map_chapters', '1',
      '-codec', 'copy',
      ...(hasImage
        ? ['-disposition:v', 'attached_pic',
           '-metadata:s:v', 'title=Album cover',
           '-metadata:s:v', 'comment=Cover (front)']
        : []),
      '-id3v2_version', '3',
      tmpPath,
    ]
    await execFile('ffmpeg', ffArgs, { maxBuffer: 4 * 1024 * 1024 })
    fs.renameSync(tmpPath, mp3Path)
  } catch (err) {
    console.error(
      '[export] ID3 značke/poglavja niso zapisana (izvod ostaje veljaven):',
      err instanceof Error ? err.message : err,
    )
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    } catch {
      // ignore
    }
  } finally {
    try {
      if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath)
    } catch {
      // ignore
    }
  }
}

/**
 * Sinteza uvodne/zaključne radijske sting-melodije (Wondercraft stil produkcije)
 * z ffmpeg — 100 % lokalno in brezplačno. Datoteki se keširata v AUDIO_DIR.
 * Uvod: vzhajajoči A-dur arpeggio (A3–C#4–E4–A4) s tremolom.
 * Zaključek: padajoči arpeggio z dolgim fade-out.
 */
export async function ensureJingle(kind: 'intro' | 'outro'): Promise<string> {
  fs.mkdirSync(AUDIO_DIR, { recursive: true })
  const outPath = path.join(AUDIO_DIR, kind === 'intro' ? JINGLE_INTRO_FILE : JINGLE_OUTRO_FILE)
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 20000) return outPath

  if (kind === 'intro') {
    // 2,2 s: štiri sine toni s odloženimi vstopi, mehak tremolo + fade-out
    await execFile('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=220:duration=2.2',
      '-f', 'lavfi', '-i', 'sine=frequency=277.183:duration=2.2',
      '-f', 'lavfi', '-i', 'sine=frequency=329.628:duration=2.2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2.2',
      '-filter_complex',
      '[0:a]adelay=0:all=1,volume=0.95[n0];' +
        '[1:a]adelay=150:all=1,volume=0.85[n1];' +
        '[2:a]adelay=300:all=1,volume=0.85[n2];' +
        '[3:a]adelay=450:all=1,volume=0.75[n3];' +
        '[n0][n1][n2][n3]amix=inputs=4:normalize=0,' +
        'tremolo=f=5.5:d=0.22,' +
        'afade=t=in:d=0.04,afade=t=out:st=1.55:d=0.65,' +
        'volume=0.55,aresample=24000[out]',
      '-map', '[out]', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le',
      outPath,
    ])
  } else {
    // 3,0 s: padajoči arpeggio A4–E4–A3 z dolgim izdihom
    await execFile('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3.0',
      '-f', 'lavfi', '-i', 'sine=frequency=329.628:duration=3.0',
      '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3.0',
      '-filter_complex',
      '[0:a]adelay=0:all=1,volume=0.8[n0];' +
        '[1:a]adelay=280:all=1,volume=0.85[n1];' +
        '[2:a]adelay=560:all=1,volume=0.9[n2];' +
        '[n0][n1][n2]amix=inputs=3:normalize=0,' +
        'tremolo=f=4.5:d=0.18,' +
        'afade=t=in:d=0.04,afade=t=out:st=1.3:d=1.7,' +
        'volume=0.5,aresample=24000[out]',
      '-map', '[out]', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le',
      outPath,
    ])
  }
  return outPath
}

/** Odstrani predvajano MP3 izvoženo datoteko (invalidacija po spremembi vrstic). */
export function removeEpisodeExport(episodeId: string): void {
  try {
    for (const withJingle of [false, true]) {
      const p = exportPathFor(episodeId, withJingle)
      if (fs.existsSync(p)) fs.unlinkSync(p)
    }
    // Tudi video audiogram je zastarel
    const video = videoPathFor(episodeId)
    if (fs.existsSync(video)) fs.unlinkSync(video)
  } catch {
    // ignore
  }
}

/**
 * Združi vrstice z naravnimi KONTEKSTNIMI pavzami v en MP3 (keširan po epizodi):
 * menjava govorca ≈0,3 s, isti govorec ≈0,22 s, novo poglavje ≈0,62 s.
 * Z withJingle doda uvodno in zaključno radijsko melodijo.
 */

/** Rahel amplitudni pan gostiteljev — skupni vir resnice (glej podcast-pan.ts). */
export { HOST_PAN, speakerPanMapFor } from '@/lib/podcast-pan'

/**
 * Linearni pan zakon s KONSTANTNO mono vsoto: gl=1−p/2, gr=1+p/2 → gl+gr=2.
 * VHOD JE MONO: obe izhodni kanali hranita iz istega vhodnega kanala c0
 * (referenca na vhodni "c1" bi bila TISINA — mono vhod nima 2. kanala;
 * ujeto s testom scripts/test-pan.ts še pred prvim produkciskim izvozom).
 */
function panFilterFor(p: number): string {
  if (p === 0) return 'pan=stereo|c0=c0|c1=c0'
  const gl = (1 - p / 2).toFixed(3)
  const gr = (1 + p / 2).toFixed(3)
  return `pan=stereo|c0=${gl}*c0|c1=${gr}*c0`
}

export async function exportEpisodeMp3(
  episodeId: string,
  lines: (GapLineInfo & { audioPath: string | null })[],
  opts: { withJingle?: boolean; title?: string; artist?: string; coverPath?: string | null } = {},
): Promise<EpisodeExport> {
  const withJingle = Boolean(opts.withJingle)
  fs.mkdirSync(AUDIO_DIR, { recursive: true })
  const outPath = exportPathFor(episodeId, withJingle)

  // Keš: obstoječ izvoz je veljaven (rute ga invalidirajo ob spremembi)
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
    const bytes = fs.statSync(outPath).size
    return { filePath: outPath, bytes, durationMs: await probeMediaDurationMs(outPath) }
  }

  // Vrstice z obstoječim zvokom (par z metapodatki — indeks ostane usklajen)
  const items: { line: GapLineInfo; file: string }[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const p = lines[i].audioPath
      ? path.join(AUDIO_DIR, path.basename(lines[i].audioPath as string))
      : null
    if (p && fs.existsSync(p)) items.push({ line: lines[i], file: p })
  }
  if (items.length === 0) throw new Error('Ni zvoka za izvoz')

  // Vhodne datoteke morajo imeti enake parametre — nenormalne pretvorimo
  // (24 kHz = cevovod; stare 22,05 kHz datoteke se le še PONATI dvignejo)
  const normalized: string[] = []
  const tmpNorm: string[] = []
  for (const it of items) {
    const f = it.file
    const rate = f.toLowerCase().endsWith('.wav') ? readWavSampleRate(f) : 24000
    if (rate === 24000) {
      normalized.push(f)
      continue
    }
    const tmp = `${f}.${process.pid}.norm.wav`
    await execFile('ffmpeg', ['-y', '-v', 'error', '-i', f, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', tmp])
    normalized.push(tmp)
    tmpNorm.push(tmp)
  }

  // Uvodna/zaključna melodija (sintetizirana lokalno z ffmpeg, keširana)
  let introPath: string | null = null
  let outroPath: string | null = null
  if (withJingle) {
    try {
      introPath = await ensureJingle('intro')
      outroPath = await ensureJingle('outro')
    } catch (err) {
      console.error('[export] jingle sinteza ni uspela, izvažam brez melodije:', err)
      introPath = null
      outroPath = null
    }
  }

  /*
   * Sestava z ENOTNIM grafom (adelay + amix) namesto concat demuxerja:
   * podpira PREKRIVANJA backchannelov (negativni offset = vzklik se začne
   * pred koncem prejšnje vrstice — "Resno?!" nad zadnjim zlogom) IN
   * KONTINUIRAN room tone (ena rožnato-šumska plast čez celotno trajanje —
   * ambience match, Task 19/21).
   */
  const rawPath = `${outPath}.${process.pid}.raw.wav`

  // ── Časovnica: offset vsake vhodne datoteke (ms) — ISTA matematika kot
  // serializeEpisode (predvajalnik), computeExportChapters in SRT ──
  const offsetsMs: number[] = []
  const dursMs: number[] = []
  let cursor = 0
  if (introPath) cursor += JINGLE_INTRO_MS + GAP_TURN_SECONDS * 1000
  for (let i = 0; i < normalized.length; i += 1) {
    const dur = wavDurationMsFast(normalized[i])
    let startMs: number
    if (i === 0) {
      startMs = cursor
    } else {
      // Seed = indeks PREJŠNJE avdio vrstice (usklajeno v vseh porabnikih)
      const ov = overlapSecondsFor(items[i - 1].line, items[i].line, i - 1, dursMs[i - 1])
      const gapSec = ov > 0 ? -ov : gapSecondsFor(items[i - 1].line, items[i].line, i - 1)
      startMs = cursor + gapSec * 1000
    }
    offsetsMs.push(Math.max(0, Math.round(startMs)))
    dursMs.push(dur)
    cursor = Math.max(cursor, startMs + dur)
  }
  let outroOffsetMs = -1
  if (outroPath) {
    cursor += GAP_TURN_SECONDS * 1000
    outroOffsetMs = Math.round(cursor)
    cursor += JINGLE_OUTRO_MS
  }

  /*
   * POGLAVITVENI PRELOMI (isti pravila kot ID3 žigi spodaj): začetek poglavja
   * = offset odpiralne vrstice; tja gre glasbena podlaga (1,3 s prej → ~4,3 s
   * čez prvo vrstico). Računamo PRED grafom, ker žigi in podlaga delita vir.
   */
  const chapterStarts: ChapterMarker[] = []
  {
    const seen = new Set<string>()
    for (let i = 0; i < items.length; i += 1) {
      const ch = (items[i].line.chapter ?? '').trim()
      if (!ch || seen.has(ch) || offsetsMs[i] <= 0) continue
      seen.add(ch)
      chapterStarts.push({ title: ch, startMs: offsetsMs[i] })
    }
  }
  // Glasbena podlaga — samo produkcijska varianta (z melodijo); fail-soft
  let musicBedPath: string | null = null
  if (withJingle && chapterStarts.length > 0) {
    try {
      musicBedPath = await ensureTransitionMusicBed()
    } catch (err) {
      console.error('[export] glasbena podlaga ni uspela, izvažam brez nje:', err)
      musicBedPath = null
    }
  }

  /*
   * STEREO UMESTITEV GOVORCEV (raziskava Task 27: r/podcasting — rahel pan
   * različnih govorcev je standardna praksa; Sound on Sound — amplitudni pan
   * brez zakasnitev je 100 % mono-varen, ker se faze ne premaknejo; edini
   * učinek v mono je manjša raven, ki jo loudnorm v masteringu že vrne).
   * Prvi govorec = levo, drugi = desno, ostali sredinsko — ISTI govorec ima
   * ISTO stran v vseh izvozih (epizoda + izrezki poglavij).
   * Linearni pan zakon z KONSTANTNO mono vsoto: gl=1−p/2, gr=1+p/2 →
   * gl+gr = 2,0 = enako kot dvojno-mono izhod prej → nič kazen v mono.
   */
  const speakerPan = speakerPanMapFor(items.map((it) => it.line))

  // ── ffmpeg graf: [uvod] + vrstice (pan + adelay) + [zaključek] + room tone ──
  const args: string[] = ['-y', '-v', 'error']
  const parts: string[] = []
  const mixLabels: string[] = []
  let inputIdx = 0
  const addDelayed = (file: string, delayMs: number, pan = 0) => {
    args.push('-i', file)
    parts.push(`[${inputIdx}:a]${panFilterFor(pan)},adelay=${delayMs}:all=1[a${inputIdx}]`)
    mixLabels.push(`[a${inputIdx}]`)
    inputIdx += 1
  }
  if (introPath) addDelayed(introPath, 0)
  for (let i = 0; i < normalized.length; i += 1) {
    const sp = (items[i].line.speaker ?? '').trim()
    addDelayed(normalized[i], offsetsMs[i], speakerPan.get(sp) ?? 0)
  }
  if (outroPath && outroOffsetMs >= 0) addDelayed(outroPath, outroOffsetMs)
  // Room tone: ena plast rožnatega šuma čez celoten izvoz (determinističen seed)
  const bedSeed = seedHash(items.length) % 1000000
  const totalSec = Math.ceil(cursor / 1000) + 1
  args.push(
    '-f',
    'lavfi',
    '-i',
    `anoisesrc=color=pink:r=24000:amplitude=1:d=${totalSec}:seed=${bedSeed}`,
  )
  parts.push(`[${inputIdx}:a]pan=stereo|c0=c0|c1=c1,volume=0.0121[bed]`)
  mixLabels.push('[bed]')
  const filter =
    `${parts.join(';')};` +
    `${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=longest:normalize=0,` +
    `atrim=0:${(cursor / 1000).toFixed(3)},aresample=24000[out]`
  args.push(
    '-filter_complex',
    filter,
    '-map',
    '[out]',
    '-ar',
    '24000',
    '-ac',
    '2',
    '-c:a',
    'pcm_s16le',
    rawPath,
  )

  try {
    await execFile('ffmpeg', args, { maxBuffer: 8 * 1024 * 1024, timeout: 300_000 })
  } finally {
    for (const tmp of tmpNorm) {
      try {
        fs.unlinkSync(tmp)
      } catch {
        // ignore
      }
    }
  }

  /*
   * MASTERING → GLASBA → MP3 (Task 37, pomembno zaporedje!):
   * 1) mastering (loudnorm −19 LUFS) teče SAMO na govoru — tonalna/sustajena
   *    glasba bi dvignila LRA meritve in loudnorm spravila v dinamični način
   *    (izmerjeno −22 LUFS namesto −19).
   * 2) glasbena podlaga se zmeša NA masteriran govor na absolutni ravni
   *    (sidechaincompress: govor kot stranska veriga) — raven podlage je
   *    izrazito neodvisna od loudnorm ojačenja, ducking pa vidi DEJANSKO
   *    končno raven govora (radio praksa: glasba vedno za masteringom).
   * 3) ena MP3 kodiranje na koncu (brez ponovnega mp3 → mp3).
   */
  if (musicBedPath) {
    const masterWav = `${outPath}.${process.pid}.master.wav`
    try {
      await masterExportMp3(rawPath, masterWav, true)
      await mixMusicIntoMaster(masterWav, outPath, chapterStarts, musicBedPath)
    } finally {
      try {
        fs.unlinkSync(masterWav)
      } catch {
        // ignore
      }
    }
  } else {
    // Mastering (dvoprehodni loudnorm -19 LUFS + rahel room) — glej zgoraj
    await masterExportMp3(rawPath, outPath)
  }
  try {
    fs.unlinkSync(rawPath)
  } catch {
    // ignore
  }

  /*
   * POGAVLJA NA IZVOZNI ČASOVNICI (Task 32): začetek poglavja = offset njegove
   * odpiralne vrstice (offsetsMs — ista matematika kot SRT/predvajalnik),
   * zato so vgrajena ID3 poglavja točna za OBE varianti (z/brez melodijo).
   * "Uvod" je obvezen prvi žig @ 0 (Apple standard); dodatni žigi samo za
   * NOVA imena poglavij s startom > 0 (isto poglavje čez več vrstic = en žig).
   * chapterStarts je isti seznam, ki ga je porabila glasbena podlaga (Task 37).
   */
  const chapterMarkers: { title: string; startMs: number }[] = [
    { title: 'Uvod', startMs: 0 },
    ...chapterStarts,
  ]
  // Ovitek na disku (coverPath je javna pot "/api/cover/<dat>")
  const coverDisk = opts.coverPath
    ? path.join(COVER_DIR, path.basename(opts.coverPath))
    : null
  await embedMp3Metadata(outPath, {
    title: opts.title,
    artist: opts.artist,
    chapters: chapterMarkers,
    durationMs: cursor,
    imagePath: coverDisk,
  })

  const bytes = fs.statSync(outPath).size
  return { filePath: outPath, bytes, durationMs: await probeMediaDurationMs(outPath) }
}

async function probeMediaDurationMs(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFile('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      filePath,
    ])
    const seconds = Number.parseFloat(stdout.trim())
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0
  } catch {
    return 0
  }
}

// Zaklep na proces: istočasni izvozi iste epizode si delijo eno opravilo
const exportLocks = new Map<string, Promise<EpisodeExport>>()

export function exportEpisodeMp3Locked(
  episodeId: string,
  lines: (GapLineInfo & { audioPath: string | null })[],
  /* Izpeljan iz exportEpisodeMp3 — podvojen tip je bil BREZ coverPath (3 tsc napake). */
  opts: Parameters<typeof exportEpisodeMp3>[2] = {},
): Promise<EpisodeExport> {
  const key = `${episodeId}:${opts.withJingle ? 'j' : 's'}`
  const existing = exportLocks.get(key)
  if (existing) return existing
  const task = exportEpisodeMp3(episodeId, lines, opts).finally(() => {
    exportLocks.delete(key)
  })
  exportLocks.set(key, task)
  return task
}

/* ------------------------------------------------------------------ */
/* Audiogram video izvoz (Headliner/Wavve stil) + besedilni izvozi      */
/* ------------------------------------------------------------------ */

export const VIDEO_PREFIX = 'video_'
const VIDEO_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
const JINGLE_INTRO_MS = 2200 // trajanje sintetizirane uvodne melodije
const JINGLE_OUTRO_MS = 3000 // trajanje sintetizirane zaključne melodije
const VIDEO_CHUNK_SECONDS = 12 // delčki = majhen pomnilnik na ffmpeg klic (peskovniške omejitve)

/*
 * GLASBENA PODLAGA PRELOKOV (Task 37): determinističen Aadd9 pad (ffmpeg sine,
 * keširan) pod poglavitnimi prelomi — vstopi 1,3 s PRED začetkom poglavja
 * (prekrije zadnji zlog prejšnje vrstice + poglavjsno pavzo) in tihi ~4,3 s
 * nad prvo vrstico novega poglavja. DUCKING: sidechaincompress z GOVOROM kot
 * stransko verigo — pod govorom se usede ≈15 dB nižje (razmerje 8:1), v pavzi
 * pa "za dihe" nazaj na polno raven (masteriran room tone je pod pragom 0,012
 * → pavza NE sproži duckinga). Samo produkcijska varianta (z melodijo); brez
 * poglavij / ob napaki sinteze = izvoz brez podlage (fail-soft, kot jingle).
 */
const MUSIC_BED_FILE = 'music_bed_transition.wav'
const MUSIC_BED_MS = 5600 // trajanje padа (fade-in 0,5 s, fade-out 1,6 s)
const MUSIC_BED_LEAD_MS = 1300 // vstop podlage PRED začetkom poglavja
// Množitelj NA MASTERIRAN govor: bed RMS −32,5 dBFS → ≈ −26 dBFS sam v pavzi
// (≈ 6 LU pod govorom); po duckingu ≈ −41 dBFS (≈ 19 LU pod govorom)
const MUSIC_BED_LEVEL = 2.2
const MUSIC_DUCK_FILTER =
  'sidechaincompress=threshold=0.012:ratio=8:attack=20:release=650:makeup=1'

/** Deterministična glasbena podlaga prelokov (Aadd9 pad) — keširana datoteka. */
async function ensureTransitionMusicBed(): Promise<string> {
  fs.mkdirSync(AUDIO_DIR, { recursive: true })
  const outPath = path.join(AUDIO_DIR, MUSIC_BED_FILE)
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 20000) return outPath
  const dur = (MUSIC_BED_MS / 1000).toFixed(2)
  const fadeOutStart = ((MUSIC_BED_MS - 1600) / 1000).toFixed(2)
  // Aadd9: A2/E3/A3/B3/C#4/E4 — odloženi vstopi ×90 ms, bas najmočnejši
  const tones = [
    { f: 110, d: 0, v: 0.5 },
    { f: 164.81, d: 90, v: 0.45 },
    { f: 220, d: 180, v: 0.42 },
    { f: 246.94, d: 270, v: 0.35 },
    { f: 277.18, d: 360, v: 0.38 },
    { f: 329.63, d: 450, v: 0.3 },
  ]
  const args: string[] = ['-y', '-v', 'error']
  for (const t of tones) {
    args.push('-f', 'lavfi', '-i', `sine=frequency=${t.f}:duration=${dur}`)
  }
  const chain = tones
    .map((t, i) => `[${i}:a]adelay=${t.d}:all=1,volume=${t.v}[n${i}]`)
    .join(';')
  const labels = tones.map((_, i) => `[n${i}]`).join('')
  args.push(
    '-filter_complex',
    `${chain};${labels}amix=inputs=${tones.length}:normalize=0,` +
      'tremolo=f=3.2:d=0.3,lowpass=f=2600,' +
      `afade=t=in:d=0.5,afade=t=out:st=${fadeOutStart}:d=1.6,` +
      'volume=0.38,aresample=24000[out]',
    '-map', '[out]', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le',
    outPath,
  )
  await execFile('ffmpeg', args, { maxBuffer: 8 * 1024 * 1024, timeout: 120_000 })
  return outPath
}

export interface ChapterMarker {
  title: string
  startMs: number
}

export function videoPathFor(episodeId: string): string {
  return path.join(AUDIO_DIR, `${VIDEO_PREFIX}${episodeId}.mp4`)
}

/** Varno ovije pot za ffmpeg seznam/filter (enojni narekovaji). */
function qPath(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`
}

function escapeFfmetadata(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/=/g, '\\=')
    .replace(/;/g, '\\;')
    .replace(/#/g, '\\#')
    .replace(/\n/g, '\\n')
}

/** Zlomi besedilo na največ maxLines vrstic po ~maxChars znakih (za drawtext). */
function wrapTextLines(text: string, maxChars: number, maxLines: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  for (const rawWord of words) {
    const w = rawWord.length > maxChars ? `${rawWord.slice(0, maxChars - 1)}…` : rawWord
    const last = lines[lines.length - 1] ?? ''
    if (lines.length === 0 || `${last} ${w}`.length > maxChars) lines.push(w)
    else lines[lines.length - 1] = `${last} ${w}`
  }
  if (lines.length <= maxLines) return lines.join('\n') || '…'
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]
  if (last.length > maxChars - 1) last = last.slice(0, maxChars - 2)
  kept[maxLines - 1] = `${last.replace(/\s+\S*$/, '')}…`
  return kept.join('\n')
}

/** Zlomi naslov na največ 2 vrstici po ~24 znakih (za drawtext v videu). */
function wrapTitleLines(title: string): string {
  return wrapTextLines(title, 24, 2)
}

interface VideoLayout {
  size: number
  waveW: number
  waveH: number
  yWave: number
  fsTitle: number
  fsLabel: number
  fsHosts: number
  yTitle: number
  yLabel: number
  yHosts: number
  lineSpacing: number
}

function videoLayout(size: number): VideoLayout {
  const waveH = Math.round(size * 0.236)
  return {
    size,
    waveW: size - 60,
    waveH,
    yWave: size - waveH - Math.round(size * 0.083),
    fsTitle: Math.round(size * 0.061),
    fsLabel: Math.round(size * 0.031),
    fsHosts: Math.round(size * 0.036),
    yTitle: Math.round(size * 0.2),
    yLabel: Math.round(size * 0.075),
    yHosts: Math.round(size * 0.46),
    lineSpacing: Math.round(size * 0.017),
  }
}

function videoFilterGraph(layout: VideoLayout, titlePath: string, hostsPath: string | null, coverPath: string | null): string {
  const L = layout
  const S = L.size
  // Valovni obrazec narišemo BEL, nato prebarvamo v jantarno — obvoz za
  // ffmpeg 7.1 hroščem, ki pri določenih velikostih izgubi R kanal direktno.
  const wave =
    `[0:a]showwaves=s=${L.waveW}x${L.waveH}:mode=cline:colors=0xffffff:rate=12,` +
    `format=yuv420p,colorchannelmixer=rr=0.983:gg=0.749:bb=0.141[wave]`
  const bg = coverPath
    ? `[1:v]scale=${S}:${S}:force_original_aspect_ratio=increase,crop=${S}:${S},drawbox=c=black@0.45:t=fill[bg]`
    : `color=c=0x09090b:s=${S}x${S}:r=12[bg]`
  const title =
    `drawtext=fontfile=${VIDEO_FONT}:textfile=${qPath(titlePath)}:fontcolor=white:fontsize=${L.fsTitle}` +
    `:x=(w-text_w)/2:y=${L.yTitle}:line_spacing=${L.lineSpacing}:shadowcolor=black@0.6:shadowx=2:shadowy=2`
  const label =
    `drawtext=fontfile=${VIDEO_FONT}:text='AI PODCAST STUDIO':fontcolor=0xf59e0b:fontsize=${L.fsLabel}` +
    `:x=(w-text_w)/2:y=${L.yLabel}:shadowcolor=black@0.6:shadowx=1:shadowy=1`
  const hosts = hostsPath
    ? `,drawtext=fontfile=${VIDEO_FONT}:textfile=${qPath(hostsPath)}:fontcolor=0xd4d4d8:fontsize=${L.fsHosts}` +
      `:x=(w-text_w)/2:y=${L.yHosts}:shadowcolor=black@0.6:shadowx=1:shadowy=1`
    : ''
  return `${wave};${bg};[bg][wave]overlay=x=30:y=${L.yWave},${title},${label}${hosts},format=yuv420p[v]`
}

/**
 * Zakodira en video deček (privzeto 720×720 @12fps, libx264).
 * Peskovniški watchdog včasih uniči večje/novejše kodirnike — zato
 * dežurni shemi: ponovni poskus z ultrafast, nato 480×480.
 */
async function encodeVideoChunk(args: {
  audioPath: string
  ss: number
  t: number
  titlePath: string
  hostsPath: string | null
  coverPath: string | null
  outPath: string
}): Promise<void> {
  const attempts: { size: number; preset: string; crf: string }[] = [
    { size: 720, preset: 'veryfast', crf: '25' },
    { size: 720, preset: 'ultrafast', crf: '26' },
    { size: 480, preset: 'ultrafast', crf: '27' },
  ]
  let lastErr: unknown = null
  for (const a of attempts) {
    try {
      const layout = videoLayout(a.size)
      const graph = videoFilterGraph(layout, args.titlePath, args.hostsPath, args.coverPath)
      await execFile('ffmpeg', [
        '-y',
        '-v',
        'error',
        '-ss',
        String(args.ss),
        '-t',
        String(args.t),
        '-i',
        args.audioPath,
        ...(args.coverPath ? ['-loop', '1', '-i', args.coverPath] : []),
        '-filter_complex',
        graph,
        '-map',
        '[v]',
        '-map',
        '0:a',
        '-c:v',
        'libx264',
        '-preset',
        a.preset,
        '-crf',
        a.crf,
        '-x264-params',
        'rc-lookahead=0:sync-lookahead=0',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-shortest',
        args.outPath,
      ])
      if (fs.existsSync(args.outPath) && fs.statSync(args.outPath).size > 1000) return
      lastErr = new Error('deleček je prazen')
    } catch (err) {
      lastErr = err
      try {
        if (fs.existsSync(args.outPath)) fs.unlinkSync(args.outPath)
      } catch {
        // ignore
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('zakodiranje videa ni uspelo')
}

/**
 * Izvozi epizodo kot audiogram MP4 (1080-stil kvadrat, animirani valovni obrazec,
 * uvodna melodija, vdelana poglavja) — 100 % lokalno z ffmpeg, keširano.
 * Zvok je MP3 izvoz z melodijo (opts.audioExport.filePath).
 */
export async function exportEpisodeVideo(
  episodeId: string,
  opts: {
    title: string
    hostsLabel?: string | null
    coverPath?: string | null
    chapters?: ChapterMarker[]
    audioExport: EpisodeExport
  },
): Promise<EpisodeExport> {
  const outPath = videoPathFor(episodeId)
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
    return { filePath: outPath, bytes: fs.statSync(outPath).size, durationMs: await probeMediaDurationMs(outPath) }
  }

  fs.mkdirSync(AUDIO_DIR, { recursive: true })
  const pid = process.pid
  const titlePath = path.join(AUDIO_DIR, `${VIDEO_PREFIX}${episodeId}.${pid}.title.txt`)
  const hostsPath = opts.hostsLabel
    ? path.join(AUDIO_DIR, `${VIDEO_PREFIX}${episodeId}.${pid}.hosts.txt`)
    : null
  const concatListPath = `${outPath}.${pid}.list.txt`
  const metaPath = `${outPath}.${pid}.meta.txt`
  const concatTmp = `${outPath}.${pid}.concat.mp4`
  const chunkPaths: string[] = []

  const durationMs = opts.audioExport.durationMs || (await probeMediaDurationMs(opts.audioExport.filePath))
  const totalSec = Math.max(1, durationMs / 1000)
  const chunkCount = Math.max(1, Math.ceil(totalSec / VIDEO_CHUNK_SECONDS))

  try {
    fs.writeFileSync(titlePath, wrapTitleLines(opts.title) + '\n')
    if (hostsPath) fs.writeFileSync(hostsPath, (opts.hostsLabel || '').slice(0, 60) + '\n')

    // 1) dežurni zakodiranje po delčkih (majhen pomnilnik na klic)
    for (let i = 0; i < chunkCount; i += 1) {
      const ss = i * VIDEO_CHUNK_SECONDS
      const t = Math.min(VIDEO_CHUNK_SECONDS, totalSec - ss)
      const chunkPath = `${outPath}.${pid}.c${i}.mp4`
      chunkPaths.push(chunkPath)
      await encodeVideoChunk({
        audioPath: opts.audioExport.filePath,
        ss,
        t,
        titlePath,
        hostsPath,
        coverPath: opts.coverPath || null,
        outPath: chunkPath,
      })
    }

    // 2) stakni dežurne (brez prekodiranja)
    const list = chunkPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n'
    fs.writeFileSync(concatListPath, list)
    await execFile('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', concatTmp])

    // 3) vdelaj naslov + poglavja (QuickTime chapter track — deluje v VLC/mpv/iOS)
    const meta: string[] = [';FFMETADATA1', `title=${escapeFfmetadata(opts.title)}`, 'artist=AI Podcast Studio']
    const chapters = (opts.chapters ?? []).filter((c) => c.title.trim().length > 0)
    if (chapters.length > 0) {
      for (let i = 0; i < chapters.length; i += 1) {
        const start = Math.max(0, Math.min(chapters[i].startMs, durationMs))
        const end = i + 1 < chapters.length ? chapters[i + 1].startMs : durationMs
        if (end <= start) continue
        meta.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(start)}`, `END=${Math.round(end)}`, `title=${escapeFfmetadata(chapters[i].title)}`)
      }
    }
    fs.writeFileSync(metaPath, meta.join('\n') + '\n')
    await execFile('ffmpeg', ['-y', '-v', 'error', '-i', concatTmp, '-i', metaPath, '-map', '0', '-map_metadata', '1', '-c', 'copy', '-movflags', '+faststart', outPath])

    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1000) {
      throw new Error('video izvoz je prazen')
    }
  } finally {
    for (const p of [...chunkPaths, concatListPath, metaPath, concatTmp, titlePath, ...(hostsPath ? [hostsPath] : [])]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p)
      } catch {
        // ignore
      }
    }
  }

  return { filePath: outPath, bytes: fs.statSync(outPath).size, durationMs: await probeMediaDurationMs(outPath) }
}

const exportVideoLocks = new Map<string, Promise<EpisodeExport>>()

/** Zaklenjena verzija exportEpisodeVideo (istočasni klici si delijo opravilo). */
export function exportEpisodeVideoLocked(
  episodeId: string,
  opts: Parameters<typeof exportEpisodeVideo>[1],
): Promise<EpisodeExport> {
  const existing = exportVideoLocks.get(episodeId)
  if (existing) return existing
  const task = exportEpisodeVideo(episodeId, opts).finally(() => {
    exportVideoLocks.delete(episodeId)
  })
  exportVideoLocks.set(episodeId, task)
  return task
}

/* ------------------------------------------------------------------ */
/* Izrezki (clips): citatni MP4 9:16 za socialna omrežja + MP3         */
/* ------------------------------------------------------------------ */

const CLIP_PREFIX = 'clip_'
const CLIP_MP3_PREFIX = 'clipmp3_'
const RANGE_MP3_PREFIX = 'rangemp3_'
const RANGE_VIDEO_PREFIX = 'rangevideo_'

export function clipVideoPathFor(lineId: string): string {
  return path.join(AUDIO_DIR, `${CLIP_PREFIX}${lineId}.mp4`)
}

export function clipMp3PathFor(lineId: string): string {
  return path.join(AUDIO_DIR, `${CLIP_MP3_PREFIX}${lineId}.mp3`)
}

export function rangeMp3PathFor(key: string): string {
  return path.join(AUDIO_DIR, `${RANGE_MP3_PREFIX}${key}.mp3`)
}

/** Pot keširanega poglavjskega SHORTS videa (MP4 9:16 s podnapisi). */
export function rangeVideoPathFor(key: string): string {
  return path.join(AUDIO_DIR, `${RANGE_VIDEO_PREFIX}${key}.mp4`)
}

/** Izbrši citatni video izrezka (invalidacija po urejanju/regeneraciji vrstice). */
export function removeLineClip(lineId: string): void {
  try {
    const video = clipVideoPathFor(lineId)
    if (fs.existsSync(video)) fs.unlinkSync(video)
    const mp3 = clipMp3PathFor(lineId)
    if (fs.existsSync(mp3)) fs.unlinkSync(mp3)
  } catch {
    // ignore
  }
}

/** Izbrši vse izrezke vrstic epizode (ob brisanju epizode). */
export function removeEpisodeLineClips(lineIds: string[]): void {
  for (const id of lineIds) removeLineClip(id)
}

/*
 * Izbrši vse kešane IZREZKE POGRAVIJ epizode (rangemp3_<id>:<i>.mp3 in
 * rangevideo_<id>:<i>.mp4). Ključ keša (<epizoda>:<index>) ne vsebuje vsebine
 * vrstic, zato mora vsaka sprememba sestave poglavij (vstavitev, brisanje,
 * premik, urejanje besedila) keš počistiti — sicer izrezek poglavja ostane
 * star tudi, ko se epizoda spremeni.
 */
export function removeEpisodeRangeClips(episodeId: string): void {
  try {
    for (const file of fs.readdirSync(AUDIO_DIR)) {
      if (
        file.startsWith(`${RANGE_MP3_PREFIX}${episodeId}:`) ||
        file.startsWith(`${RANGE_VIDEO_PREFIX}${episodeId}:`)
      ) {
        try {
          fs.unlinkSync(path.join(AUDIO_DIR, file))
        } catch {
          // ignore — posamezna datoteka ne sme ustaviti čiščenja
        }
      }
    }
  } catch {
    // ignore — map AUDIO_DIR morda še ne obstaja
  }
}

/** Graf citatnega izrezka 9:16 (TikTok/Reels/Shorts): velik citat + govorec + val. */
function quoteClipFilterGraph(args: {
  w: number
  h: number
  quotePath: string
  speakerPath: string
  coverPath: string | null
}): string {
  const { w, h } = args
  const waveH = Math.round(w * 0.236)
  const waveW = w - 60
  const yWave = h - waveH - Math.round(h * 0.09)
  const fsLabel = Math.round(w * 0.036)
  const yLabel = Math.round(h * 0.07)
  const fsQuote = Math.round(w * 0.055)
  const yQuote = Math.round(h * 0.16)
  const lineSpacing = Math.round(w * 0.025)
  const fsSpeaker = Math.round(w * 0.044)
  const ySpeaker = Math.round(h * 0.53)
  const wave =
    `[0:a]showwaves=s=${waveW}x${waveH}:mode=cline:colors=0xffffff:rate=12,` +
    `format=yuv420p,colorchannelmixer=rr=0.983:gg=0.749:bb=0.141[wave]`
  const bg = args.coverPath
    ? `[1:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},drawbox=c=black@0.5:t=fill[bg]`
    : `color=c=0x09090b:s=${w}x${h}:r=12[bg]`
  return (
    `${wave};${bg};[bg][wave]overlay=x=30:y=${yWave},` +
    `drawtext=fontfile=${VIDEO_FONT}:text='AI PODCAST STUDIO':fontcolor=0xf59e0b:fontsize=${fsLabel}` +
    `:x=(w-text_w)/2:y=${yLabel},` +
    `drawtext=fontfile=${VIDEO_FONT}:textfile=${qPath(args.quotePath)}:fontcolor=white:fontsize=${fsQuote}` +
    `:x=(w-text_w)/2:y=${yQuote}:line_spacing=${lineSpacing}:shadowcolor=black@0.6:shadowx=2:shadowy=2,` +
    `drawtext=fontfile=${VIDEO_FONT}:textfile=${qPath(args.speakerPath)}:fontcolor=0xfbbf24:fontsize=${fsSpeaker}` +
    `:x=(w-text_w)/2:y=${ySpeaker}:shadowcolor=black@0.6:shadowx=1:shadowy=1,` +
    `format=yuv420p[v]`
  )
}

/** Zakodira deležek citatnega izrezka s 3-stopnjskim fallbackom (sandbox watchdog). */
async function encodeQuoteClipChunk(args: {
  audioPath: string
  ss: number
  t: number
  quotePath: string
  speakerPath: string
  coverPath: string | null
  outPath: string
}): Promise<void> {
  const attempts: { w: number; h: number; preset: string; crf: string }[] = [
    { w: 720, h: 1280, preset: 'veryfast', crf: '25' },
    { w: 720, h: 1280, preset: 'ultrafast', crf: '26' },
    { w: 480, h: 854, preset: 'ultrafast', crf: '27' },
  ]
  let lastErr: unknown = null
  for (const a of attempts) {
    try {
      const graph = quoteClipFilterGraph({
        w: a.w,
        h: a.h,
        quotePath: args.quotePath,
        speakerPath: args.speakerPath,
        coverPath: args.coverPath,
      })
      await execFile('ffmpeg', [
        '-y',
        '-v',
        'error',
        '-ss',
        String(args.ss),
        '-t',
        String(args.t),
        '-i',
        args.audioPath,
        ...(args.coverPath ? ['-loop', '1', '-i', args.coverPath] : []),
        '-filter_complex',
        graph,
        '-map',
        '[v]',
        '-map',
        '0:a',
        '-c:v',
        'libx264',
        '-preset',
        a.preset,
        '-crf',
        a.crf,
        '-x264-params',
        'rc-lookahead=0:sync-lookahead=0',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-shortest',
        args.outPath,
      ])
      if (fs.existsSync(args.outPath) && fs.statSync(args.outPath).size > 1000) return
      lastErr = new Error('deleček je prazen')
    } catch (err) {
      lastErr = err
      try {
        if (fs.existsSync(args.outPath)) fs.unlinkSync(args.outPath)
      } catch {
        // ignore
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('zakodiranje izrezka ni uspelo')
}

/**
 * Citatni izrezek vrstice kot vertikalni MP4 (9:16, TikTok/Reels/Shorts stil):
 * velik citat, govorec, valovni obrazec, opcijsko ovitek epizode kot podlaga.
 * 100 % lokalno z ffmpeg, keširano po vrstici.
 */
export async function exportLineClipVideo(
  lineId: string,
  opts: { text: string; speaker: string; audioPath: string; coverPath?: string | null },
): Promise<{ filePath: string; bytes: number; durationMs: number }> {
  const outPath = clipVideoPathFor(lineId)
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
    return { filePath: outPath, bytes: fs.statSync(outPath).size, durationMs: await probeMediaDurationMs(outPath) }
  }

  const sourcePath = path.join(AUDIO_DIR, path.basename(opts.audioPath))
  if (!fs.existsSync(sourcePath)) throw new Error('Vrstica nima zvoka')

  fs.mkdirSync(AUDIO_DIR, { recursive: true })
  const pid = process.pid
  const quotePath = path.join(AUDIO_DIR, `${CLIP_PREFIX}${lineId}.${pid}.quote.txt`)
  const speakerPath = path.join(AUDIO_DIR, `${CLIP_PREFIX}${lineId}.${pid}.speaker.txt`)
  const concatListPath = `${outPath}.${pid}.list.txt`
  const concatTmp = `${outPath}.${pid}.concat.mp4`
  const chunkPaths: string[] = []

  const durationMs = await probeMediaDurationMs(sourcePath)
  const totalSec = Math.max(1, durationMs / 1000)
  const chunkCount = Math.max(1, Math.ceil(totalSec / VIDEO_CHUNK_SECONDS))

  try {
    fs.writeFileSync(quotePath, wrapTextLines(opts.text, 26, 6) + '\n')
    fs.writeFileSync(speakerPath, `— ${opts.speaker}`.slice(0, 50) + '\n')

    for (let i = 0; i < chunkCount; i += 1) {
      const ss = i * VIDEO_CHUNK_SECONDS
      const t = Math.min(VIDEO_CHUNK_SECONDS, totalSec - ss)
      const chunkPath = `${outPath}.${pid}.c${i}.mp4`
      chunkPaths.push(chunkPath)
      await encodeQuoteClipChunk({
        audioPath: sourcePath,
        ss,
        t,
        quotePath,
        speakerPath,
        coverPath: opts.coverPath || null,
        outPath: chunkPath,
      })
    }

    const list = chunkPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n'
    fs.writeFileSync(concatListPath, list)
    await execFile('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', '-movflags', '+faststart', outPath])

    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1000) {
      throw new Error('izrezek je prazen')
    }
  } finally {
    for (const p of [...chunkPaths, concatListPath, concatTmp, quotePath, speakerPath]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p)
      } catch {
        // ignore
      }
    }
  }

  return { filePath: outPath, bytes: fs.statSync(outPath).size, durationMs: await probeMediaDurationMs(outPath) }
}

/** Izrezek vrstice kot MP3 (keširan; invalidacija prek removeLineClip). */
export async function exportLineClipMp3(lineId: string, audioPath: string): Promise<{ filePath: string; bytes: number }> {
  const outPath = clipMp3PathFor(lineId)
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
    return { filePath: outPath, bytes: fs.statSync(outPath).size }
  }
  const sourcePath = path.join(AUDIO_DIR, path.basename(audioPath))
  if (!fs.existsSync(sourcePath)) throw new Error('Vrstica nima zvoka')
  fs.mkdirSync(AUDIO_DIR, { recursive: true })
  await execFile('ffmpeg', ['-y', '-v', 'error', '-i', sourcePath, '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-q:a', '4', outPath])
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 500) throw new Error('izrezek MP3 je prazen')
  return { filePath: outPath, bytes: fs.statSync(outPath).size }
}

/**
 * Izrezek poglavja kot MP3: vrstice poglavja (od prve z naslovom do naslednjega
 * poglavja) z naravnimi kontekstnimi pavzami — keširan po ključu `episodeId:index`.
 */
export async function exportChapterRangeMp3(
  key: string,
  lines: (GapLineInfo & { audioPath: string | null })[],
  panBySpeaker?: Map<string, number>,
  meta?: { title?: string; artist?: string; coverPath?: string | null },
): Promise<{ filePath: string; bytes: number; durationMs: number }> {
  const outPath = rangeMp3PathFor(key)
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
    return { filePath: outPath, bytes: fs.statSync(outPath).size, durationMs: await probeMediaDurationMs(outPath) }
  }

  // Vrstice z obstoječim zvokom (par z metapodatki — indeks ostane usklajen)
  const items: { line: GapLineInfo; file: string }[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const p = lines[i].audioPath
      ? path.join(AUDIO_DIR, path.basename(lines[i].audioPath as string))
      : null
    if (p && fs.existsSync(p)) items.push({ line: lines[i], file: p })
  }
  if (items.length === 0) throw new Error('Poglavje nima zvoka')

  const pid = process.pid
  const rawPath = `${outPath}.${pid}.raw.wav`

  /*
   * Enoten graf (pan + adelay + amix) — ISTA matematika kot celoten izvoz:
   * podpira prekrivanja backchannelov, kontinuiran room tone in stereo
   * umestitev govorcev (pan po celem ZAPOREDJU epizode → ista stran kot tam).
   */
  const speakerPan = panBySpeaker ?? speakerPanMapFor(items.map((it) => it.line))
  // Časovnica vrstic (offsets) — ISTA matematika kot podnapisi v shorts MP4
  const { offsetsMs, dursMs, totalMs: cursor } = computeRangeTimeline(items)

  const args: string[] = ['-y', '-v', 'error']
  const parts: string[] = []
  const mixLabels: string[] = []
  for (let i = 0; i < items.length; i += 1) {
    args.push('-i', items[i].file)
    const sp = (items[i].line.speaker ?? '').trim()
    parts.push(`[${i}:a]${panFilterFor(speakerPan.get(sp) ?? 0)},adelay=${offsetsMs[i]}:all=1[a${i}]`)
    mixLabels.push(`[a${i}]`)
  }
  const bedSeed = seedHash(items.length + key.length) % 1000000
  const totalSec = Math.ceil(cursor / 1000) + 1
  args.push(
    '-f',
    'lavfi',
    '-i',
    `anoisesrc=color=pink:r=24000:amplitude=1:d=${totalSec}:seed=${bedSeed}`,
  )
  parts.push(`[${items.length}:a]pan=stereo|c0=c0|c1=c1,volume=0.0121[bed]`)
  mixLabels.push('[bed]')
  const filter =
    `${parts.join(';')};` +
    `${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=longest:normalize=0,` +
    `atrim=0:${(cursor / 1000).toFixed(3)},aresample=24000[out]`
  args.push(
    '-filter_complex',
    filter,
    '-map',
    '[out]',
    '-ar',
    '24000',
    '-ac',
    '2',
    '-c:a',
    'pcm_s16le',
    rawPath,
  )

  try {
    await execFile('ffmpeg', args, { maxBuffer: 8 * 1024 * 1024, timeout: 300_000 })
  } finally {
    // (rezervirano za začasne normalizirane datoteke)
  }

  // Mastering (isti verig kot celoten izvoz) — konsistenten zvok med izvozi
  await masterExportMp3(rawPath, outPath)
  try {
    fs.unlinkSync(rawPath)
  } catch {
    // ignore
  }
  // Značke + ovitek izrezka (title/artist/APIC) — brez poglavij (izrezek je eno poglavje)
  const clipCover = meta?.coverPath
    ? path.join(COVER_DIR, path.basename(meta.coverPath))
    : null
  await embedMp3Metadata(outPath, { title: meta?.title, artist: meta?.artist, imagePath: clipCover })

  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1000) throw new Error('izrezek poglavja je prazen')
  return { filePath: outPath, bytes: fs.statSync(outPath).size, durationMs: await probeMediaDurationMs(outPath) }
}

/**
 * Časovnica vrstic znotraj izrezka (offsets/trajanja/skupaj) — ISTA matematika
 * kot MP3 izrezek (prekrivanja backchannelov + kontekstne pavze), zato so
 * podnapisi v shorts MP4 usklajeni z zvokom do milisekunde.
 */
function computeRangeTimeline(items: { line: GapLineInfo; file: string }[]): {
  offsetsMs: number[]
  dursMs: number[]
  totalMs: number
} {
  const offsetsMs: number[] = []
  const dursMs: number[] = []
  let cursor = 0
  for (let i = 0; i < items.length; i += 1) {
    const dur = wavDurationMsFast(items[i].file)
    let startMs: number
    if (i === 0) {
      startMs = 0
    } else {
      const ov = overlapSecondsFor(items[i - 1].line, items[i].line, i - 1, dursMs[i - 1])
      const gapSec = ov > 0 ? -ov : gapSecondsFor(items[i - 1].line, items[i].line, i - 1)
      startMs = cursor + gapSec * 1000
    }
    offsetsMs.push(Math.max(0, Math.round(startMs)))
    dursMs.push(dur)
    cursor = Math.max(cursor, startMs + dur)
  }
  return { offsetsMs, dursMs, totalMs: cursor }
}

/* ------------------------------------------------------------------ */
/* SHORTS (Task 36): poglavje kot vertikalni MP4 9:16 z VŽGANIMI       */
/* podnapisi, ki sledijo govoru (OpusClip/Podsqueeze "long-to-short")   */
/* ------------------------------------------------------------------ */

/** ASS čas "H:MM:SS.CC" (centisekunde). */
function assTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 10)) // centisekunde
  const cs = total % 100
  const s = Math.floor(total / 100) % 60
  const m = Math.floor(total / 6000) % 60
  const h = Math.floor(total / 360000)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/** Escpej ASS besedila (oklepaji namesto vitičastih — override sintaksa). */
function assEscape(text: string): string {
  return text
    .replace(/[{}]/g, '')
    .replace(/\\/g, '/')
    .replace(/\r?\n/g, ' ')
    .trim()
}

/** Razdeli daljše povedi na krajše podnapisne delčke (≤ maxChars). */
function splitCaptionText(text: string, maxChars = 72): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= maxChars) return [clean]
  // povedi loči po ločilih, potem stakni do maxChars
  const sentences = clean.split(/(?<=[.!?])\s+/)
  const chunks: string[] = []
  let cur = ''
  for (const s of sentences) {
    if ((cur + ' ' + s).trim().length <= maxChars) {
      cur = (cur + ' ' + s).trim()
      continue
    }
    if (cur) chunks.push(cur)
    if (s.length <= maxChars) {
      cur = s
      continue
    }
    // zelo dolga poved: reži po besedah
    const words = s.split(' ')
    cur = ''
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > maxChars && cur) {
        chunks.push(cur)
        cur = w
      } else {
        cur = (cur + ' ' + w).trim()
      }
    }
  }
  if (cur) chunks.push(cur)
  return chunks.length > 0 ? chunks : [clean.slice(0, maxChars)]
}

/**
 * PODNAPISNI STILI SHORTS (Task 38 — raziskava: Jellypod ponuja 13 stilov,
 * OpusClip standard = belo/box/rumeno). Trije pokriti izhodiščni stili:
 * - klasika: belo + črni obroba + jantarno ime govorca (privzeti)
 * - okvir:   TikTok box — belo na pol-prosojnem črnem kvadru (BorderStyle=3,
 *            box = OutlineColour, Outline = oblazinjenje)
 * - poudarek: rumeno besedilo + debelejša obroba + senco (visok kontrast na
 *            temnem ovitku); ime govorca BELO (rumeno na rumenem = neberljivo)
 */
export type ShortsCaptionStyle = 'klasika' | 'okvir' | 'poudarek'
export const SHORTS_CAPTION_STYLES: ShortsCaptionStyle[] = ['klasika', 'okvir', 'poudarek']

const SHORTS_STYLE_LINE: Record<ShortsCaptionStyle, string> = {
  klasika:
    'Style: Shorts,DejaVu Sans,46,&H00FFFFFF,&H000000FF,&H00141414,&H96000000,1,0,0,0,100,100,0,0,1,3,1,2,40,40,300,1',
  okvir:
    'Style: Shorts,DejaVu Sans,48,&H00FFFFFF,&H000000FF,&H30000000,&H30000000,1,0,0,0,100,100,0,0,3,10,0,2,40,40,300,1',
  poudarek:
    'Style: Shorts,DejaVu Sans,50,&H0015CCFA,&H000000FF,&H00000000,&H96000000,1,0,0,0,100,100,0,0,1,4,2,2,40,40,300,1',
}

/** Barva imena govorca pri menjavi (ASS \c, BGR) — POZOR: v TS dvojne poševnice. */
const SHORTS_SPEAKER_TAG: Record<ShortsCaptionStyle, string> = {
  klasika: '\\c&H0B9EF5&',
  okvir: '\\c&H0B9EF5&',
  poudarek: '\\c&HFFFFFF&',
}

/** ASS subtitls datoteka: en dogodek na vrstico (daljše → delčki), ime govorca ob menjavi. */
function buildAssCaptions(
  items: { line: GapLineInfo; file: string }[],
  offsetsMs: number[],
  dursMs: number[],
  style: ShortsCaptionStyle = 'klasika',
): string {
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 720',
    'PlayResY: 1280',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    SHORTS_STYLE_LINE[style],
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  const events: string[] = []
  let prevSpeaker = ''
  for (let i = 0; i < items.length; i += 1) {
    const text = (items[i].line.text ?? '').trim()
    if (!text) continue
    const chunks = splitCaptionText(text)
    const start = offsetsMs[i]
    const dur = Math.max(600, dursMs[i]) // min prikaz 0,6 s
    const speaker = (items[i].line.speaker ?? '').trim()
    // skupna dolžina znakov → čas delčkov sorazmerno (bralec bere po dolžini)
    const totalChars = chunks.reduce((n, c) => n + c.length, 0)
    let cursor = start
    for (const chunk of chunks) {
      const chunkMs = Math.round((chunk.length / totalChars) * dur)
      const end = cursor + chunkMs
      // ime govorca v barvi STILA (Task 38), ko govorec MENJA — jasno, kdo govori.
      // POZOR: v TS literálu \\c in \\r (enojni \r je carriage return!)
      const speakerTag = SHORTS_SPEAKER_TAG[style]
      const prefix =
        speaker && speaker !== prevSpeaker && i > 0
          ? `{${speakerTag}}${assEscape(speaker)}:{\\r} `
          : ''
      events.push(
        `Dialogue: 0,${assTime(cursor)},${assTime(end)},Shorts,,0,0,0,,${prefix}${assEscape(chunk)}`,
      )
      cursor = end
      prevSpeaker = speaker
    }
  }
  return [...header, ...events, ''].join('\n')
}

/** Graf shorts kadra: ovitek (ali temna podlaga) + val + znamka + naslov poglavja + ASS podnapisi. */
function shortsFilterGraph(args: {
  w: number
  h: number
  assPath: string
  titlePath: string
  coverPath: string | null
}): string {
  const { w, h } = args
  const waveH = Math.round(w * 0.236)
  const waveW = w - 60
  const yWave = h - waveH - Math.round(h * 0.09)
  const fsLabel = Math.round(w * 0.036)
  const yLabel = Math.round(h * 0.055)
  const fsTitle = Math.round(w * 0.052)
  const yTitle = Math.round(h * 0.1)
  const lineSpacing = Math.round(w * 0.022)
  const wave =
    `[0:a]showwaves=s=${waveW}x${waveH}:mode=cline:colors=0xffffff:rate=12,` +
    `format=yuv420p,colorchannelmixer=rr=0.983:gg=0.749:bb=0.141[wave]`
  const bg = args.coverPath
    ? `[1:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},drawbox=c=black@0.5:t=fill[bg]`
    : `color=c=0x09090b:s=${w}x${h}:r=12[bg]`
  // ASS pot za subtitles filter: enojni navedki (filtergraph nivo 1) — dvopičje
  // v poti (ključ "<id>:<index>") sicer razbije razčlenjanje argumentov filtra
  const assArg = `'${args.assPath.replace(/'/g, "\\'")}'`
  return (
    `${wave};${bg};[bg][wave]overlay=x=30:y=${yWave},` +
    `drawtext=fontfile=${VIDEO_FONT}:text='AI PODCAST STUDIO':fontcolor=0xf59e0b:fontsize=${fsLabel}` +
    `:x=(w-text_w)/2:y=${yLabel}:shadowcolor=black@0.6:shadowx=1:shadowy=1,` +
    `drawtext=fontfile=${VIDEO_FONT}:textfile=${qPath(args.titlePath)}:fontcolor=white:fontsize=${fsTitle}` +
    `:x=(w-text_w)/2:y=${yTitle}:line_spacing=${lineSpacing}:shadowcolor=black@0.6:shadowx=2:shadowy=2,` +
    `subtitles=filename=${assArg},format=yuv420p[v]`
  )
}

/** Zakodira shorts MP4 s 3-stopnjskim fallbackom (isti vzorec kot citatni izrezek). */
async function encodeShortsAttempt(args: {
  audioPath: string
  assPath: string
  titlePath: string
  coverPath: string | null
  outPath: string
  title: string
  artist: string
}): Promise<void> {
  const attempts: { w: number; h: number; preset: string; crf: string }[] = [
    { w: 720, h: 1280, preset: 'veryfast', crf: '25' },
    { w: 720, h: 1280, preset: 'ultrafast', crf: '26' },
    { w: 480, h: 854, preset: 'ultrafast', crf: '27' },
  ]
  let lastErr: unknown = null
  for (const a of attempts) {
    try {
      const graph = shortsFilterGraph({
        w: a.w,
        h: a.h,
        assPath: args.assPath,
        titlePath: args.titlePath,
        coverPath: args.coverPath,
      })
      await execFile(
        'ffmpeg',
        [
          '-y', '-v', 'error',
          '-i', args.audioPath,
          ...(args.coverPath ? ['-loop', '1', '-i', args.coverPath] : []),
          '-filter_complex', graph,
          '-map', '[v]', '-map', '0:a',
          '-c:v', 'libx264',
          '-preset', a.preset,
          '-crf', a.crf,
          '-x264-params', 'rc-lookahead=0:sync-lookahead=0',
          '-c:a', 'aac', '-b:a', '128k',
          '-metadata', `title=${args.title}`,
          '-metadata', `artist=${args.artist}`,
          '-movflags', '+faststart',
          '-shortest',
          args.outPath,
        ],
        { maxBuffer: 4 * 1024 * 1024, timeout: 300_000 },
      )
      if (fs.existsSync(args.outPath) && fs.statSync(args.outPath).size > 10000) return
      lastErr = new Error('shorts video je prazen')
    } catch (err) {
      lastErr = err
      try {
        if (fs.existsSync(args.outPath)) fs.unlinkSync(args.outPath)
      } catch {
        // ignore
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('zakodiranje shorts ni uspelo')
}

const shortsLocks = new Map<string, Promise<{ filePath: string; bytes: number; durationMs: number }>>()

/**
 * Poglavjski SHORTS (Task 36/38): vertikalni MP4 9:16 s vžganimi podnapisi, ki
 * sledijo govoru (ASS/libass), ovitkom epizode kot podlago, animiranim valom
 * in naslovom poglavja — OpusClip/Podsqueeze "long-to-short" stil, 100 %
 * lokalno z ffmpeg. Zvok = mastered MP3 izrezek poglavja (isti timeline).
 * `meta.style` = podnapisni stil (klasika/okvir/poudarek) — keš ključ ga nosi,
 * zato ima vsak stil svojo datoteko.
 */
export async function exportChapterClipMp4(
  key: string,
  lines: (GapLineInfo & { audioPath: string | null })[],
  audioMp3Path: string,
  meta?: { title?: string; artist?: string; coverPath?: string | null; style?: ShortsCaptionStyle },
): Promise<{ filePath: string; bytes: number; durationMs: number }> {
  const outPath = rangeVideoPathFor(key)
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
    return { filePath: outPath, bytes: fs.statSync(outPath).size, durationMs: await probeMediaDurationMs(outPath) }
  }
  if (!fs.existsSync(audioMp3Path)) throw new Error('MP3 izrezek poglavja ne obstaja')

  // Vrstice z zvokom (isti filter kot MP3 izrezek) — časovnica iz DEJANSKIH WAV
  const items: { line: GapLineInfo; file: string }[] = []
  for (const l of lines) {
    const p = l.audioPath ? path.join(AUDIO_DIR, path.basename(l.audioPath)) : null
    if (p && fs.existsSync(p)) items.push({ line: l, file: p })
  }
  if (items.length === 0) throw new Error('Poglavje nima zvoka za podnapise')

  const { offsetsMs, dursMs } = computeRangeTimeline(items)
  const pid = process.pid
  // začasne poti BREZ dvopičja (ključ vsebuje "<id>:<index>" — filter grafi
  // ne prenašajo surovega dvopičja v imenih datotek)
  const safeKey = key.replace(/[^A-Za-z0-9_-]/g, '_')
  const assPath = path.join(AUDIO_DIR, `rangevideo_${safeKey}.${pid}.ass`)
  const titlePath = path.join(AUDIO_DIR, `rangevideo_${safeKey}.${pid}.title.txt`)
  const tmpPath = path.join(AUDIO_DIR, `rangevideo_${safeKey}.${pid}.tmp.mp4`)
  try {
    fs.writeFileSync(assPath, buildAssCaptions(items, offsetsMs, dursMs, meta?.style ?? 'klasika'))
    const title = (meta?.title ?? '').slice(0, 90)
    fs.writeFileSync(titlePath, wrapTextLines(title, 30, 3) + '\n')
    const coverDisk = meta?.coverPath
      ? path.join(COVER_DIR, path.basename(meta.coverPath))
      : null
    await encodeShortsAttempt({
      audioPath: audioMp3Path,
      assPath,
      titlePath,
      coverPath: coverDisk && fs.existsSync(coverDisk) ? coverDisk : null,
      outPath: tmpPath,
      title,
      artist: meta?.artist ?? 'AI Podcast Studio',
    })
    fs.renameSync(tmpPath, outPath)
  } finally {
    for (const p of [assPath, titlePath]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p)
      } catch {
        // ignore
      }
    }
  }
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1000) throw new Error('shorts video je prazen')
  return { filePath: outPath, bytes: fs.statSync(outPath).size, durationMs: await probeMediaDurationMs(outPath) }
}

/** Zaklenjena verzija exportChapterClipMp4 (istočasni klici si delijo opravilo). */
export function exportChapterClipMp4Locked(
  key: string,
  lines: (GapLineInfo & { audioPath: string | null })[],
  audioMp3Path: string,
  meta?: { title?: string; artist?: string; coverPath?: string | null; style?: ShortsCaptionStyle },
): Promise<{ filePath: string; bytes: number; durationMs: number }> {
  const existing = shortsLocks.get(key)
  if (existing) return existing
  const task = exportChapterClipMp4(key, lines, audioMp3Path, meta).finally(() => {
    shortsLocks.delete(key)
  })
  shortsLocks.set(key, task)
  return task
}

/* ---------------- Besedilni izvozi (YouTube poglavja, transkript) ---------------- */

function youtubeClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * Izračuna poglavja na ČASOVNI LINIJI IZVOZA (z uvodno melodijo):
 * Celotna časovnica (Task 45): žigi poglavij + skupno trajanje.
 * Uvod na 0:00, vsako poglavje na začetek svoje prve vrstice.
 * Koraka naravnost zrcali sestavljanje v exportEpisodeMp3 (kontekstne pavze
 * + PREKRIVANJA backchannelov) — `computeExportChapters` je le ožji pogled
 * na ta rezultat (deljen z javno delitveno stranjo).
 */
export function computeExportTimeline(
  lines: (GapLineInfo & { chapter: string | null; audioPath: string | null })[],
): { markers: ChapterMarker[]; totalMs: number } {
  const markers: ChapterMarker[] = [{ title: 'Uvod', startMs: 0 }]
  const seen = new Set<string>()
  let cursor = JINGLE_INTRO_MS + GAP_TURN_SECONDS * 1000
  let prev: (GapLineInfo & { chapter: string | null }) | null = null
  let prevDurMs: number | null = null
  let itemIndex = 0
  for (const line of lines) {
    if (!line.audioPath) continue
    const file = path.join(AUDIO_DIR, path.basename(line.audioPath))
    if (!fs.existsSync(file)) continue
    const dur = wavDurationMsFast(file)
    if (prev) {
      const ov = overlapSecondsFor(prev, line, itemIndex - 1, prevDurMs)
      cursor =
        ov > 0
          ? cursor - ov * 1000
          : cursor + gapSecondsFor(prev, line, itemIndex - 1) * 1000
    }
    if (line.chapter && !seen.has(line.chapter)) {
      seen.add(line.chapter)
      markers.push({ title: line.chapter, startMs: Math.max(0, Math.round(cursor)) })
    }
    cursor += dur
    prev = line
    prevDurMs = dur
    itemIndex += 1
  }
  if (itemIndex > 0) {
    // Zaključna melodija (ISTA kot izvod): 0,1 s vrtenja + 3 s outro —
    // brez tega bi značka trajanja na delitveni strani zaostala za zvokom.
    cursor += GAP_TURN_SECONDS * 1000 + JINGLE_OUTRO_MS
  }
  return { markers, totalMs: Math.max(0, Math.round(cursor)) }
}

export function computeExportChapters(
  lines: (GapLineInfo & { chapter: string | null; audioPath: string | null })[],
): ChapterMarker[] {
  return computeExportTimeline(lines).markers
}

/** YouTube opis poglavij: prvi žig mora biti 0:00, format m:ss ali h:mm:ss Naslov. */
export function buildYoutubeChaptersText(markers: ChapterMarker[]): string {
  const sorted = [...markers].sort((a, b) => a.startMs - b.startMs)
  if (sorted.length === 0 || sorted[0].startMs > 0) sorted.unshift({ title: 'Uvod', startMs: 0 })
  return sorted.map((m) => `${youtubeClock(m.startMs)} ${m.title}`).join('\n') + '\n'
}

/** Goli transkript epizode (NotebookLM/TED stil): `Govorec: besedilo` + oznake poglavij. */
export function buildTranscriptText(
  title: string,
  lines: { chapter: string | null; speaker: string; text: string }[],
): string {
  const parts: string[] = [title.trim(), '']
  for (const line of lines) {
    if (line.chapter) parts.push('', `[Poglavje: ${line.chapter}]`, '')
    parts.push(`${line.speaker}: ${line.text}`)
  }
  return parts.join('\n') + '\n'
}

/* ------------------------------------------------------------------ */
/* SRT podnapisi + AI ovitek                                           */
/* ------------------------------------------------------------------ */

function srtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const h = Math.floor(total / 3600000)
  const m = Math.floor((total % 3600000) / 60000)
  const s = Math.floor((total % 60000) / 1000)
  const msPart = total % 1000
  const pad = (n: number, len = 2) => String(n).padStart(len, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(msPart, 3)}`
}

/** WebVTT čas: enak kot SRT, le decimalna LOČKA namesto vejice (spec format). */
function vttTime(ms: number): string {
  return srtTime(ms).replace(',', '.')
}

/** En časovni podnapisni blok (SRT/VTT skupna hrbtenica). */
export interface TimedCue {
  startMs: number
  endMs: number
  text: string
}

/**
 * Skupna časovna hoja SRT/VTT (in vseh časovno vezanih izvozov): kontekstne
 * pavze + prekrivanja backchannelov, tako da podnapisi izbruhajo točko ob
 * govorniku. Brez melodije (kot SRT doslej).
 */
export function exportCueList(
  lines: (GapLineInfo & { audioPath: string | null })[],
): TimedCue[] {
  const cues: TimedCue[] = []
  let cursor = 0
  let prev: GapLineInfo | null = null
  let prevDurMs: number | null = null
  let audioIdx = 0
  for (const line of lines) {
    if (!line.audioPath) continue
    const file = path.join(AUDIO_DIR, path.basename(line.audioPath))
    if (!fs.existsSync(file)) continue
    const dur = wavDurationMsFast(file)
    if (dur <= 0) continue
    let start = cursor
    if (prev) {
      const ov = overlapSecondsFor(prev, line, audioIdx - 1, prevDurMs)
      start =
        ov > 0
          ? cursor - ov * 1000
          : cursor + gapSecondsFor(prev, line, audioIdx - 1) * 1000
    }
    cues.push({ startMs: Math.max(0, start), endMs: start + dur, text: `${line.speaker}: ${line.text}` })
    cursor = Math.max(cursor, start + dur)
    prev = line
    prevDurMs = dur
    audioIdx += 1
  }
  return cues
}

/**
 * Zgradi SRT podnapise iz vrstic. Časovni žigi sovpadajo z MP3 izvozom brez
 * melodije (?jingle=0): kontekstne pavze + prekrivanja backchannelov.
 */
export function buildSrt(
  lines: (GapLineInfo & { audioPath: string | null })[],
): string {
  const cues = exportCueList(lines)
  return (
    cues
      .map((c, i) => [String(i + 1), `${srtTime(c.startMs)} --> ${srtTime(c.endMs)}`, c.text, ''].join('\n'))
      .join('\n')
  )
}

/**
 * WebVTT podnapisi (Podcasting 2.0 `podcast:transcript type="text/vtt"`):
 * enaka časovnica kot SRT, format pa VTT (WEBVTT glava, ločka, brez številcev
 * blokov — niso obvezni). Apple/Overcast jih znajo prikazati kot captions.
 */
export function buildVtt(
  lines: (GapLineInfo & { audioPath: string | null })[],
  language = 'sl',
): string {
  const cues = exportCueList(lines)
  if (cues.length === 0) return ''
  const header = ['WEBVTT', `Kind: captions`, `Language: ${language}`, ''].join('\n')
  const body = cues
    .map((c) => [`${vttTime(c.startMs)} --> ${vttTime(c.endMs)}`, c.text, ''].join('\n'))
    .join('\n')
  return `${header}\n${body}`
}

export const COVER_DIR = path.join(process.cwd(), 'db', 'covers')

/** AI ovitek epizode (Jellypod cover art generator stil). Vrne javno pot. */
export async function generateCoverArt(
  episode: {
    id: string
    title: string
    topic: string
    style: string
  },
  opts: { force?: boolean } = {},
): Promise<string> {
  fs.mkdirSync(COVER_DIR, { recursive: true })
  const filename = `cover_${episode.id}.png`
  const outPath = path.join(COVER_DIR, filename)

  // Keš: ovitek že obstaja (razen če je zahtevana regeneracija)
  if (!opts.force && fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
    return `/api/cover/${filename}`
  }
  try {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath)
  } catch {
    // ignore
  }

  const zai = await getZai()
  const theme = (episode.topic || episode.title).replace(/["\\]/g, '').slice(0, 120)
  const prompt = [
    'Podcast episode cover art, square layout, bold retro-modern flat illustration',
    'vintage radio microphone and sound waves motif',
    'warm amber, orange and dark charcoal color palette, dramatic spotlight',
    `theme: ${theme}`,
    `show format: ${episode.style}`,
    'clean bold composition, no text, no letters, no words, high quality, detailed',
  ].join(', ')

  const response = await zai.images.generations.create({ prompt, size: '1024x1024' })
  const base64 = response.data?.[0]?.base64
  if (!base64) throw new Error('Generiranje ovitka ni vrnilo slike')

  const tmp = `${outPath}.${process.pid}.tmp`
  fs.writeFileSync(tmp, Buffer.from(base64, 'base64'))
  fs.renameSync(tmp, outPath)
  return `/api/cover/${filename}`
}

/** Odstrani ovitek (ob brisanju epizode). */
export function removeEpisodeCover(episodeId: string): void {
  try {
    const p = path.join(COVER_DIR, `cover_${episodeId}.png`)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/* Serialization helpers                                               */
/* ------------------------------------------------------------------ */

export interface HostJson {
  name: string
  voice: string
  speed: number
}

export type EpisodeWithLines = Episode & { lines: Line[] }

export function parseSummary(json: string | null): ShowNotes | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as { summary?: unknown; takeaways?: unknown }
    const summary = String(parsed.summary ?? '')
    const takeaways = Array.isArray(parsed.takeaways) ? parsed.takeaways.map(String) : []
    if (!summary) return null
    return { summary, takeaways }
  } catch {
    return null
  }
}

export function serializeEpisode(episode: EpisodeWithLines) {
  let hosts: HostJson[] = []
  try {
    const parsed = JSON.parse(episode.hostsJson) as HostJson[]
    if (Array.isArray(parsed)) hosts = parsed
  } catch {
    hosts = []
  }
  const sorted = episode.lines.slice().sort((a, b) => a.idx - b.idx)
  // Predhodne AVDICNE vrstice (seed/duracija se štejeta po njih — enako kot izvoz)
  const prevAudio: (typeof sorted) = []
  return {
    id: episode.id,
    title: episode.title,
    topic: episode.topic,
    style: episode.style,
    language: episode.language,
    status: episode.status,
    length: episode.length,
    focus: episode.focus,
    sourceType: episode.sourceType,
    sourceUrl: episode.sourceUrl,
    coverPath: episode.coverPath,
    summary: parseSummary(episode.summaryJson),
    hosts,
    createdAt: episode.createdAt,
    lines: sorted.map((l) => {
      let preDelayMs: number | undefined
      if (l.audioPath) {
        const prev = prevAudio[prevAudio.length - 1] ?? null
        const seed = prevAudio.length - 1
        if (!prev) {
          preDelayMs = 0 // prva vrstica (uvodni jingle ni del predvajalnika)
        } else {
          // ISTA logika/seed kot izvoz: backchannel se lahko PREKRIVA (negativno)
          const prevDurMs = prev.audioPath
            ? wavDurationMsFast(path.join(AUDIO_DIR, path.basename(prev.audioPath)))
            : 0
          const ov = overlapSecondsFor(prev, l, seed, prevDurMs)
          preDelayMs =
            ov > 0 ? -Math.round(ov * 1000) : Math.round(gapSecondsFor(prev, l, seed) * 1000)
        }
        prevAudio.push(l)
      }
      return {
        id: l.id,
        idx: l.idx,
        speaker: l.speaker,
        voice: l.voice,
        speed: l.speed,
        emotion: l.emotion,
        text: l.text,
        chapter: l.chapter,
        audioPath: l.audioPath,
        // Pavza PRED vrstico (ms) — NEGATIVNA = prekrivanje z vzklikom
        // (ista matematika kot MP3 izvoz → app zveni identno izvozu).
        preDelayMs,
      }
    }),
  }
}

export async function syncEpisodeStatus(episodeId: string): Promise<void> {
  const lines = await db.line.findMany({
    where: { episodeId },
    select: { audioPath: true },
  })
  const allReady = lines.length > 0 && lines.every((l) => Boolean(l.audioPath))
  const status = allReady ? 'ready' : 'script_ready'
  await db.episode.update({ where: { id: episodeId }, data: { status } })
}
