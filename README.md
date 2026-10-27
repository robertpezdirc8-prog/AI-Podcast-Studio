# 🎙️ AI Podcast Studio

**Dvogostiteljski slovenski AI podcast — od skripte do predvajalnika in izvozov, vse lokalno.**

AI Podcast Studio je splet aplikacija, ki iz ene teme samostojno napiše dvogostiteljski podcast skript v slovenščini, ga sintetizira z nevronskimi glasovi, zmiksa profesionalno (mastering, stereo pan, vdih, prekrivni vzkliki), prikaže v karaoke predvajalniku in izvozi v vse podcast formate — MP3 z ID3 poglavji in ovitkom, MP4 audiogram, vertikalne **shorts z vžganimi podnapisi**, RSS feed in SRT podnapise.

---

## ✨ Funkcije

### 🧠 Generiranje
- **Dvogostiteljski skript** (LLM) — dramaturgija, poglavja, show notes, naravna izmenjava vprašanj in odgovorov
- **Lastna skripta brez AI** — lokalni razčlenjevalnik + **7 profesionalnih šablon** (novičarska oddaja, intervju, raziskovalna zgodba, kulturni pogovor, debata, top 5 seznam, izobraževalna razlaga) s poklicno radijsko dramaturgijo
- **Dramaturški pregled** — živa analiza skripte po radijskih pravilih (kavelj, vodniki, poglavja, monologi, ravnovesje govorcev, CTA zaključek) + ocena trajanja — vsi izračuni lokalni, brez AI
- **Nevronski glasovi Edge TTS** — `sl-SI-RokNeural` (moški) in `sl-SI-PetraNeural` (ženska), brezplačno, brez API ključa
- **Derivirani glasovi** — Jakob in Matjaž kot Rok s pitch-shiftom ±2 poltona (prava slovenščina, drugačen ton)
- **Lokalni zasilni TTS** — Piper (`sl_SI-artur-medium`, edini odprtokodni pravi slovenski studijski glas) če Edge ni dosegljiv

### 🎛️ Studio (karaoke urejevalnik)
- **Trojni pogled (tabi)** — Scenarij (karaoke + urejanje + iskanje) · Zapiski (show notes) · **Dramaturgija** (statistika epizode: realno trajanje, besede, poglavja, ravnovesje govorcev, 7 radijskih pregledov) — čipi poglavij in predvajalnik ostanejo vedno vidni

### 🎚️ Produkcija (miks)
- **Pavze in dramaturgija** — členki po zarezi, poglavitne pavze, mikropavze
- **Vdih** — naravni vdihi pred daljšimi mislimi
- **Prekrivni vzkliki (backchanneli)** — "Vau!", "Aha", "Ja točno tako…" pod govorom (−3 dB)
- **Stereo pan** — Rok levo, Petra desno (prava radijska postavitev)
- **Mikro-jitter** — rahla variacija tempa/obraza za ne-mehanični ritem
- **Tempo-lok** — ciljna artikulacija (≈ 5,9 zlog/s) z osnovnim tempom +5 %
- **Glasbena podlaga prelokov z duckingom** — determinističen Aadd9 pad pod poglavitnimi prelomi; `sidechaincompress` ga usede ≈15 dB pod govorom, v pavzi pa "za dihe" nazaj (radio veriga: mastering samo na govoru → glasba po masteringu na absolutni ravni)
- **Mastering** — dvoprehodni **linearni** loudnorm (brez pumpanja), highpass 75 Hz, blagi kompresor; 24 kHz cevovod

### 📺 Karaoke predvajalnik
- **ON AIR** indikator, oznaka aktivne vrstice, poglavjski čipi, valovni obrazec
- **Oblika valovanja (mini-map)** — pravi vrhovi zvoka (RMS iz WAV, keš), predvajani del jantarno, klik/vleci = skok na čas
- **Besedni karaoke** — aktivna beseda sveti, klik na besedo skoči na njen čas (100 % lokalno, sorazmerna časovnica)
- **Stereo pan debug** / premik med kanali
- Iskanje po transkriptu do trenutka, skok ±5 s, 2× hitrost, nadaljuvanje (resume), sleep timer
- **Urejanje vrstic z re-voice** — spremeni besedilo, znova sintetiziraj vrstico
- **Vprašaj voditelja** — interaktivno vprašanje sredi epizode (LLM odgovori v slogu epizode)

### 🎨 Ovitki
- **AI-generirani ovitki** 1024×1024 (keširani, en klik za regeneracijo)
- Vstavljeni kot **ID3v2.3 APIC** v MP3 izvoze in **itunes:image** v RSS (Apple Podcasts, Overcast, VLC)

### 🌍 Javna delitev
- **Javna povezava `/?deli=<žeton>`** — stran za poslušalce: ovitek, predvajalnik (drsnik, ±10 s), poglavja s klikom = skok, zapiski, prepis in prenos MP3 — brez studia, brez ID-ja epizode
- Neugljiv **16-znakovni žeton** (base64url), stabilen: izklop povezavo takoj onemogoči, ponovni vklop uporabi isti žeton
- Javni zvok je ISTI MP3 izvoz (uvodna melodija, ID3, ovitek) — samo preko žetona, prvi klic ga kešira na disku

### 📦 Izvozi
| Format | Pot | Vsebina |
|---|---|---|
| **MP3** (cela epizoda) | `/api/episodes/:id/download` | mastering + ID3v2.3 (naslov, izvajalec, **CHAP/CTOC poglavja**, **APIC ovitek**, glasbena podlaga prelokov z duckingom) |
| **MP3 izrezek poglavja** | `/api/episodes/:id/chapterclip?index=N` | mastered izrezek poglavja z APIC |
| **MP4 audiogram** | `/api/episodes/:id/video` | ovitek + animirani valovni obrazec + poglavja |
| **Shorts MP4** | `/api/episodes/:id/short?index=N&style=S` | **vertikalni 9:16 (720×1280)** z **vžganimi podnapisi, ki sledijo govoru** (ASS/libass), ovitek + val + znamka; **3 podnapisna stila**: `klasika` (belo + črni obroba, jantarno ime govorca), `okvir` (TikTok box — belo na pol-prosojnem kvadru), `poudarek` (rumeno + debelejša obroba, belo ime govorca) |
| **RSS feed** | `/api/rss` | iTunes feed (kanal + epizode, itunes:image, poglavja) |
| **SRT podnapisi** | `/api/episodes/:id/srt` | celotni transkript s časi |

Shorts podnapisna plast: delčki ≤ 72 znakov s sorazmernim časom, min prikaz 0,6 s, točne šumniki (ž/š/č), usklajeni do milisekunde z zvokom (skupna časovnica z MP3 izrezkom).

---

## 🛠️ Tehnični sklad

- **Next.js 16** (App Router) + **TypeScript 5**
- **Tailwind CSS 4** + **shadcn/ui** (New York) + Lucide ikone + framer-motion
- **Prisma** + **SQLite**
- **TTS**: `python3 edge-tts` (Edge nevronski protokol) + Piper (fallback)
- **ffmpeg** — miks, mastering, audiogrami, shorts (libass za vžgane podnapise)
- **z-ai-web-dev-sdk** — LLM za skripte, show notes, odgovore, ovitke

## 🚀 Namestitev

```bash
# 1. odvisnosti
bun install        # ali npm install

# 2. Python TTS
python3 -m pip install edge-tts

# 3. ffmpeg (sistemski paket)
#    apt install ffmpeg  /  brew install ffmpeg

# 4. okolje
cp .env.example .env   # DATABASE_URL=file:./db/custom.db

# 5. baza
bun run db:push

# 6. zagon
bun run dev            # http://localhost:3000
```

### Opcijsko: Piper zasilni glas (100 % offline)

```bash
mkdir -p piper && cd piper
# binarna distribucija: https://github.com/rhasspy/piper/releases
tar xzf piper.tar.gz
# glasovni model (Artur — pravi slovenski studijski govor, CC-BY-4.0):
# https://huggingface.co/rhasspy/piper-voices → sl/sl_SI/artur/medium/
#   postavi sl_SI-artur-medium.onnx(.json) v koren projekta
```

Brez Pipra aplikacija deluje normalno — Piper se uporabi samo, če Edge TTS ni dosegljiv.

## 🗂️ Struktura projekta

```
src/
  app/
    page.tsx                    # edini vstop (knjižnica + studio)
    api/
      episodes/                 # seznam/ustvarjanje epizod
      episodes/[id]/
        download/               # MP3 izvod (ID3 + APIC + poglavja)
        chapterclip/            # MP3 izrezek poglavja
        short/                  # Shorts MP4 (9:16, vžgani podnapisi)
        video/                  # MP4 audiogram
        srt/  transcript/  chapters/  ask/  cover/  progress/  script/
      rss/                      # iTunes feed
      cover/                    # strežba ovitkov
      lines/  audio/  tts-preview/
  lib/
    podcast-ai.ts               # jedro: LLM skripte, TTS, miks, mastering, izvozi
    podcast-client.ts           # klientski klici
  components/studio/            # karaoke predvajalnik, knjižnica, urejanje
prisma/schema.prisma            # Episode, Line, ...
db/                             # baza + generirani zvok/ovitki/izvozi (gitignored)
scripts/                        # razvojna orodja (regen audio, tempo-audit, ...)
```

## 🎬 Kako poteka izdelava epizode

1. **Tema** → LLM napiše dvogostiteljski skript s poglavji, čustvenimi oznakami in show notes
2. **Sinteza vrstica po vrstici** → Edge TTS (24 kHz), pan, pavze, vdih, backchanneli, jitter
3. **Mastering** → dvoprehodni linearni loudnorm + highpass + kompresor
4. **Karaoke studio** → poslušanje z oznako vrstice, urejanje z re-voice, vprašanja voditelju
5. **Izvozi** → MP3 / MP4 audiogram / Shorts / RSS / SRT — en klik

## 🗺️ Roadmap

- [x] Glasba pod govorom z duckingom (`ffmpeg sidechaincompress`)
- [x] Shorts MP4 z vžganimi podnapisi (9:16, ASS/libass)
- [x] 3 stili shorts podnapisov (klasika / TikTok okvir / rumeni poudarek)
- [x] Profesionalne skriptne šablone (brez AI) + besedni karaoke s klikom na besedo
- [x] Dramaturški pregled skripte (radijska pravila, ocena trajanja, ravnovesje) + 3 nove šablone
- [x] Trojni pogled studia (Scenarij/Zapiski/Dramaturgija) + dramaturgija obstoječih epizod
- [x] Oblika valovanja v predvajalniku (RMS vrhovi, klik/vleci = skok)
- [x] Javna delitvena stran epizode (`/?deli=<žeton>` — predvajalnik, poglavja, zapiski, prepis, MP3)
- [ ] Tretji gost-glas (ko Edge doda nova sl-SI glasova)

## 📄 Licenca

Zasebni projekt. Glasovni model Artur: [CC-BY-4.0](https://huggingface.co/datasets/ppisljar/artur_studio_tts) (korpus ppisljar/artur_studio_tts). Edge TTS glasovi so last Microsofta.
