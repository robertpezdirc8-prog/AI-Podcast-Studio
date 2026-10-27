/**
 * Profesionalne skriptne šablone (Task 40 + Task 43) — 100 % brez AI modelov.
 *
 * Sedem celotnih radijskih skript s poklicno dramaturgijo (privzeti govorci
 * Rok + Petra = privzeti glasovni cikel rok/petra):
 *  1. NOVIČARSKA ODDAJA — vodniki → trije sklopi → zaključek (news desk)
 *  2. INTERVJU — gost v studiu: uvod → sklopi → hitra vprašanja → CTA
 *  3. RAZISKOVALNA ZGODBA — dokumentarni tok: kavelj → sledi → preobrat
 *  4. KULTURNI POGOVOR — lahkoten dialog z argumenti in zaključkom
 *  5. DEBATA — teza/proteza: pravila → argumenti → odgovori → zadnji stavki
 *  6. TOP 5 SEZNAM — odštevanje od 5 do 1 s presenečenjem na koncu
 *  7. IZOBRAŽEVALNA RAZLAGA — problem → kako deluje → kaj to pomeni za vas
 *
 * Dramaturška pravila, upoštevana v vsaki šabloni (jih preverja tudi
 * dramaturški pregled v script-analysis.ts):
 *  - prva vrstica = kavelj (hook), druga = vodniki (agenda)
 *  - poglavja z naslovi (`##`) → ID3 žigi, glasbena podlaga, shorts
 *  - prehodi med poglavji z napovedjo (cliffhanger), ne z »hm, kaj pa zdaj«
 *  - povratni kanali (backchannel) namerno redki — samo na mejnikih
 *  - zadnja vrstica = poziv k dejanju (CTA) + napoved naslednje epizode
 */

export interface ScriptTemplate {
  id: string;
  /** kratko ime v meniju */
  name: string;
  /** ena vrstica opisa (kakšna je oblika) */
  desc: string;
  /** predlagan naslov epizode */
  title: string;
  /** celotna skripta v obliki razčlenjevalnika (Ime: besedilo + ## Poglavje) */
  script: string;
}

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    id: 'novice',
    name: 'Novičarska oddaja',
    desc: 'vodniki · 3 sklopi · zaključek',
    title: 'Tedenski pregled: tri zgodbe, ki so premaknile meje',
    script: `Rok: Dober večer! To je Tedenski pregled — petnajst minut najpomembnejšega, brez trpanja in brez šuma.
Petra: V današnji oddaji: kako novi zakon o delu na daljavo spreminja pravila igre, zakaj je slovenska e-mobilnost končno stekla, in knjiga, ki je dobila pet tiskanj v enem letu.
Rok: Trije sklopi, lepo po vrsti — k dejstvom. Začniva!

## Delo na daljavo
Petra: Državni zbor je potrdil zakon, ki delodajalcem po koncu delovnega časa omejuje doseganje zaposlenih.
Rok: V praksi pomeni enostavno stvar: po osmih brez telefona, razen v izjemah, ki jih zakon natančno našteva.
Petra: Sindikati govorijo o največjem koraku za pravice delavcev v zadnjem desetletju. Gospodarstvo opozarja na birokracijo.
Rok: In kdo ima prav? Skromen odgovor: resnico bo pokazala praksa — sproti jo bova spremljala.

## E-mobilnost
Rok: Številke za zadnje leto so jasne: vsako tretje novoregistrirano osebno vozilo je električno ali vtični hibrid.
Petra: To je podvojitev v dveh letih. Razlog ni samo tehnologija — je omrežje hitrih polnilnic, ki je končno gosto.
Rok: Najbolj zanimiv podatek pa je, da kar polovica nakupov ni v Ljubljani. Mobilnost se je raznesla po vsej državi.
Petra: Še en znak, da so napovedi o »petih letih« vsakič preveč previdne.

## Knjižni fenomen
Petra: In na koncu knjiga, o kateri vsi govorijo. Pet tiskanj v enem letu pri slovenskem založniku — to se ne zgodi.
Rok: Formula uspeha je preprosta: lokalna zgodba, univerzalna tema. Beremo o sebi, in to je edini žanr, ki nikoli ne gre iz mode.
Petra: Najbolj presenetljivo: knjigo kupujejo mladi. Papir je zdržal.
Rok: Torej: zakon bo pokazal učinek, tržišče e-avte, bralci papir. Čas bo potrdil številke.

## Zaključek
Petra: To je bilo za današnji Tedenski pregled. Dejstva imate, zaključki so vaši.
Rok: Če vam je oddaja všeč, jo delite z enim človekom, ki mora slišati drugo novico. Naslednjič: ali bo štiridnevni delovni teden res prišel v Slovenijo?
Petra: Prisluhnite nam čez teden. Do takrat — bodite nazaj, kjer ste bili, samo brez službenega telefona po osmih.`,
  },
  {
    id: 'intervju',
    name: 'Intervju',
    desc: 'gost v studiu · sklopi · hitra vprašanja',
    title: 'V studiu: sto panjev in ena čebela, ki je vse spremenila',
    script: `Rok: Dobrodošli v studiu! Moja gostinja je Petra, ki je po desetih letih v pisarni začela čebelarsko kmetijo — danes jih ima sto.
Petra: Hvala za povablico. Priznam takoj: sto panjev ni bil načrt, je nezgoda, ki je zrastla iz enega.

## Od ene do sto
Rok: Kako človek sploh pride do prvega panja?
Petra: Kot večina — s pomočjo. Moj oče je imel tri panje ob hiši in mi jih je prepustil s pogojem, da jih ne bom prodala.
Rok: In prvo leto?
Petra: Katastrofa. Oseminštirideset pikov in ena odločitev: ali bom obupala ali se naučila. Izbrala sem drugo.
Rok: In danes? Koliko pikov na sezono?
Petra: Nič. Ko znaš, pika ni nič.

## Posel, ki je zrastel mimo načrta
Rok: Sto panjev je že obrat. Kdaj je hobi postal podjetje?
Petra: Ko sem prvič razprodala med na tržnici v dveh urah. Takrat sem spoznala, da to ni več samo navdušenje, ampak odgovornost.
Rok: Kaj je bilo najtežje?
Petra: Ceniti svoje delo. Prvi dve leti sem med prodajala preveč poceni, ker sem se sramovala cene. Potem sem si vzela ceno.
Rok: To slišim od vseh malih pridelovalcev — najtežja cena je ta, ki si jo postaviš sam.

## Hitra vprašanja
Rok: Hitra vprašanja, kratki odgovori. Ajda ali lipa?
Petra: Lipa.
Rok: Med v čaju ali na kruhu?
Petra: Na kruhu. Vedno.
Rok: Najboljša ura na čebelnjaku?
Petra: Pet zjutraj, ko vse brumi. Samo čebele in ti.
Rok: En nasvet za tistega, ki razmišlja o prvem panju?
Petra: Ne začni z desetimi. Začni z enim in se pridruži društvu.

## Zaključek
Rok: Petra, hvala za pogovor — od pikov do cen. Vse skupaj je ena lekcija: potrpežljivost.
Petra: Hvala meni. In spomnite: čebele ne hitijo, pa vse pride.
Rok: Če vam je bil pogovor všeč, nam pustite oceno in sporočite, koga bi videli v studiu naslednjič. Se slišimo!`,
  },
  {
    id: 'zgodba',
    name: 'Raziskovalna zgodba',
    desc: 'dokumentarni tok · kavelj · preobrat',
    title: 'Skrivnost črnega jezera: kaj je dvignilo vodo',
    script: `Petra: Pred natanko štiridesetimi leti se je jezero pod zaselkom Rjavi Kot zvečer dvignilo — in nikoli več ni padlo na starem nivoju.
Rok: Domačini so govorili o straži. Geologi pa o tem, kar je danes učbeniški primer premikanja podtalja. To je zgodba o tem, kdo je imel prav.

## Prva sled
Petra: Vse se je začelo z dnevnikom lokalnega poštarja. Trinajst let je vsak petek zapisal višino vode na isti kamni.
Rok: Tako je nastala najdaljša zasebna serija meritev v državi — brez naročila, brez instrumentov, samo s svinčnikom in radovednostjo.
Petra: In prav njegov dnevnik je pokazal, da se je dvig začel tri mesece pred potresom, ki ga nihče ni povezoval.
Rok: Naključje? Do lanskega leta bi rekli da.

## Preobrat
Rok: Nato je prišel doktorski študent, ki je dnevnik digitaliziral in primerjal s satelitskimi posnetki.
Petra: In našel vzorec: podzemna voda se je premikala po prelomu, ki ni bil na nobenem zemljevidu.
Rok: Danes na tistem mestu stoji merilna postaja. Na tablici ni imena inštituta, ampak ime poštarja.
Petra: Kar nas pripelje do najbolj zanimivega dela te zgodbe: koliko podobnih dnevnikov še leži v predalih po Sloveniji?

## Kaj ostaja
Rok: Jezero je danes naravni rezervat in ena izmed redkih v Evropi, ki raste.
Petra: Domačini še vedno pravijo, da je kriva straža. Znanost pravi prelom. Morda sta oba prava — ime ni pomembno, pomembno je, da je voda našla pot.
Rok: Če tudi vi poznate zgodbo, ki je nihče ne spremlja — nam jo napišite. Naslednjo zgodbo izberemo iz vaših sporočil.
Petra: In ne pozabite: najboljše raziskave se začnejo z zvezkom, ne z laboratorijem.`,
  },
  {
    id: 'kultura',
    name: 'Kulturni pogovor',
    desc: 'lahkoten dialog · argumenti · zaključek',
    title: 'Knjiga, ki jo vsi imajo, a je nihče ne prebere',
    script: `Rok: Vprašanje za današnjo oddajo: katera knjiga je v vaši polici — in je bila tam od leta 2013?
Petra: Ah, vem kam greš. Vsaka polica ima en takšen del: kupljena v zagonu, odprta na deseti strani, potem miruje.
Rok: In moj predlog za danes: ne obsojamo, ampak razumemo. Zakaj se to zgodi vsem?

## Fenomen
Petra: Prvi razlog je psihološki. Knjigo v polici držimo kot obljubo o sebi — o bralcu, ki ga bomo postali, ko bomo imeli čas.
Rok: Torej ne kupujemo knjige, ampak različico sebe. To je tudi razlog, zakaj nakupa knjige nikoli ne obžalujemo, branja pa včasih.
Petra: Točno tako. Še drugi razlog je praktičen: knjiga ne poteče. Stane manj kot kinovstopnico in čaka, dokler ne prideš.
Rok: In zato ob njej vsakič občutimo tisto malo slabe vesti, ko mimo gremo.

## Zakaj deluje vseeno
Rok: Zdaj pa obrambna teza: polica, polna knjig, ni neuspeh, ampak signal.
Petra: Soglašam. Pisatelji pravijo, da je knjižna polica bolj kot arhiv podobna vrtu — nekaj zraste zdaj, nekaj čaka naslednjo sezono.
Rok: In znanost je na njihovi strani: knjige, ki jih imamo in jih NE beremo, vseeno vplivajo na nas — obkrožajo nas z naslovi.
Petra: Torej: obsojanje ni potrebno. Polica deluje.

## Zaključek
Rok: Nasvet za konec: izberite eno knjigo s police, odprite na strani triindvajset in berite pet minut. Samo toliko.
Petra: Pet minut je vse, kar je potrebno. Ostalo se začne samo.
Rok: Če vas je ta oddaja prepričala, da ena knjiga vrneš v življenje — nam pustite oceno in nas delite z bralcem, ki ga poznate. Se beremo!`,
  },
  {
    id: 'debata',
    name: 'Debata',
    desc: 'teza/proteza · argumenti · odgovori',
    title: 'Debata: naj javni prevoz postane brezplačen?',
    script: `Rok: Vprašanje današnje debate: naj javni avtobusi v mestu postane brezplačni? Petra zagovarja da, jaz sem proti — na koncu odločite vi.
Petra: Pravila so preprosta: trije argumenti na stran, po vrsti, nato odgovori druga stran, na koncu po en stavek za vsakega.

## Argumenti za
Petra: Prvi argument: brezplačen prevoz ni darilo, ampak infrastruktura. Cesto, ki jo urejamo iz davkov, nihče ne bi poceni prodajal voznikom.
Petra: Drugi: vsak euro v prevoz vrne tri — manj zamašenih cest, manj onesnaženja, hitrejše dostave. To ni ideologija, to je račun.
Petra: Tretji: cena vozovnice odganja ravno tiste, ki jih prevoz najbolj potrebuje — starejše, študente, male plače.
Rok: Trije argumenti, vsi iz istega peresa — zdaj pa druga stran.

## Argumenti proti
Rok: Brezplačno ne obstaja. Ko z vozovnic izgubimo milijone, jih pokrijeta davki in kultura — denar ni izginil, spremenil je naslovnika.
Rok: Drugi argument: brezplačne avtobuse bodo uporabili tudi tisti, ki bi plačali — denar odide od vzdrževanja, kjer je najbolj potreben.
Rok: Tretji: če je prevoz brezplačen, kdo odgovarja, da bo še kvaliteten? Cena je tudi ocena vrednosti storitve.
Petra: In moj odgovor na vse: Tallinn in Luksemburg sta to že dokazala — številke obstajajo, samo prebrati jih je potrebno.

## Zaključek
Rok: Moj zadnji stavek: prevoz plačajmo transparentno — z vozovnico, ki jo vidi potnik, ne z davkom, ki ga ne.
Petra: Moj: mesto, ki svoje prebivalce ovira pri gibanju, plačuje svoj račun — samo v drugi valuti.
Rok: Koga prepričava? Glasujte v sporočilih in nam povejte, kateri argument je bil odločilen — naslednjo debato pripraviva na vašo temo.`,
  },
  {
    id: 'top5',
    name: 'Top 5 seznam',
    desc: 'odštevanje 5→1 · presenečenje · CTA',
    title: 'Pet izumov, ki so jih razglasili za brezvredne',
    script: `Rok: Pet izumov, ki so jih razglasili za brezvredne — in vsak je spremenil svet. Štejemo navzdol, od petega do prvega.
Petra: Zgodba je poučna v obeh smerih: sodbe se obrestujejo, tudi napačne. Začniva.

## Od petega do tretjega
Rok: Peto mesto: telefonski odzivnik. Izumitelj ga je ponudil telekomunam, ki so rekle, da nihče ne bo poslušal sporočil stroja. Danes jih posluša cel planet.
Petra: Četrto: elektronska knjiga. Založniki so jo deset let držali kot uro napake, potem je prišel čitač z zaslonom in knjiga je začela živeti v žepu.
Rok: Tretje: Bluetooth. Industrija ga je označila za brezvezno igračo in zavrnila licenco. Danes vodi po vseh domovih.

## Od drugega do prvega
Petra: Drugo: e-pošta na telefonu. Analitiki so trdili, da nihče ne bo tipkal na napravi, ki se tiče v žepu. Pol stoletja kasneje je to standard.
Rok: In prvo mesto: GPS. Obrambni krogi so ga zavračali kot zaprto vojaško orodje, saj naj bi civilna uporaba onesnažila signale. Danes se po njem vozi taksist, kmet in vaš poštar.

## Zaključek
Petra: Skupna točka vseh petih: sodba je bila hitra, a napačna — sodeč po prvi uporabi, ne po vrednosti izuma.
Rok: Naslednjič, ko slišite, da je nekaj brezvredno — spomnite se te petorice. Če poznate izum, ki so ga odložili v predal, nam pišite — petorko naslednjič sestaviva iz vaših predlogov.`,
  },
  {
    id: 'razlaga',
    name: 'Izobraževalna razlaga',
    desc: 'problem · kako deluje · za vas',
    title: 'Kako deluje dvostopenjska cena elektrike',
    script: `Petra: Vaš račun za elektriko je dvignjen, cena pa ne: kriv je dvostopenjski tečaj. V šestih minutah razloživa, kako deluje — in kje lahko prihranite.
Rok: Nič formul brez razlage, obljubljeno. Trije deli, po vrsti: problem, stroj, vaša kuhinja.

## Problem
Petra: Večina ljudi gleda le končno ceno kilovatne ure. A račun ni samo cena — je cena krat čas porabe.
Rok: Če vaša pralnica teče ob večernem vrhu, plačujete povsem drug izdelek kot sosed z enako količino elektrike.

## Kako deluje
Rok: Dvostopenjski tečaj pomeni enostavno stvar: dan ima poceni in drago okno. Osnovni tečaj velja čez dan, vrh pa zjutraj in zvečer, ko vsi hkrati prižgemo.
Petra: Omrežje mora uravnovesiti proizvodnjo in porabo v vsakem trenutku — vrhovi so najdražja ura proizvodnje, zato najdražje plačate tudi vi.
Rok: In najbolj zanimivo: vrh ni neizmeren, je napovedljiv. Vsak delovni dan med sedmimi in devetimi zvečer — to ni statistika, to je urnik.

## Kaj to pomeni za vas
Petra: Praktično: pomik pralnega stroja na noč je najcenejši premik, ki ga lahko naredite. Brez naložbe, samo z urnikom.
Rok: Kotel, polnilec avta in pomivalni stroj skupaj pomenijo tretjino računa — in vse tri lahko poganjate ob poceni oknu.
Petra: Če želite sami izračunati svoj premik, nam pišite — pripraviva podaljšek o pametnih vtičnicah, ki urnik poganjajo same.`,
  },
];
