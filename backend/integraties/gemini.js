// ═══════════════════════════════════════════════════════════════════════
// GEMINI — een aankoopfactuur of bonnetje uitlezen (stap 3c)
// ═══════════════════════════════════════════════════════════════════════
// Sleutel en model via de add-on-configuratie (omgevingsvariabelen), nooit
// in de databank: GEMINI_API_KEY, GEMINI_MODEL (standaard gemini-3.6-flash,
// het model dat op 23-09 op dell-test werkte).
//
// Gemini LEEST enkel en STELT VOOR. Het koppelen aan leveranciers en
// artikelen gebeurt daarna in het ERP zelf (domein/factuurherkenning.js),
// met wat het ERP onthouden heeft (productcodes per leverancier).
//
// De instructie is afgestemd op echte facturen (24-09): AC products (0% btw,
// SKU in de omschrijving, verzending als regel "Standard"), Bambu Lab EU
// (prijzen incl. btw, kleur in "Variant: Donkergroen (11501)"), Joybuy
// (korting per regel, meerdere pagina's, Engelse kleurnamen, "Freight").

export const GEMINI_MODEL = () => (process.env.GEMINI_MODEL || '').trim() || 'gemini-3.6-flash';

// Reservemodellen (optie 3, 24-09): blijft het hoofdmodel na de herhalingen
// overbelast, dan probeert het ERP deze modellen, in volgorde.
// GEMINI_MODEL_RESERVE = "model-a,model-b" (eigen lijst) of "geen" (uit).
// Standaard: de nieuwste Flash en de lichtere Flash-Lite (volgens de release
// notes van Google in september 2026). Het hoofdmodel zelf wordt overgeslagen.
export const STANDAARD_RESERVE = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
export function reserveModellen() {
  const w = (process.env.GEMINI_MODEL_RESERVE || '').trim();
  if (w.toLowerCase() === 'geen') return [];
  const lijst = w ? w.split(',').map(x => x.trim()).filter(Boolean) : STANDAARD_RESERVE;
  return [...new Set(lijst)].filter(m => m !== GEMINI_MODEL());
}
export const geminiIngesteld = () => !!(process.env.GEMINI_API_KEY || '').trim();

export function maakInstructie({ merken, materialen, kleuren, categorieen }) {
  return `Je leest een aankoopdocument voor 3D Plezier, een klein 3D-printbedrijf in België: een factuur, een kassabonnetje
of een BESTELBEVESTIGING van een webshop (bestelbon, e-mail "Bedankt voor uw bestelling").
3D Plezier / David Spiesschaert is altijd de KLANT, nooit de leverancier. De leverancier is de verkoper (bij een webshop: de webshop, bv. Joybuy).

Geef terug:
- documentsoort: "factuur" (factuur/invoice met factuurnummer), "bonnetje" (kassaticket) of "bestelbon" (bestelbevestiging zonder factuurnummer)
- leverancier: naam (de verkopende winkel of firma, zonder rechtsvorm-ruis als "B.V." mag blijven), btw_nummer (van de verkoper), website (indien vermeld)
- factuurnummer: het factuurnummer (NIET het ordernummer). Leeg bij een bestelbon.
- bestelnummer: het bestel-/ordernummer van de webshop (Bestelnummer, Ordernummer, Order number, Order #), anders leeg
- datum: factuurdatum (bij een bestelbon: de besteldatum) als JJJJ-MM-DD. Europese datums zijn DAG/MAAND/JAAR (21/09/2026 = 2026-09-21; "21 sep 2026" = 2026-09-21).
- totaal_incl_btw: het totaal dat betaald werd/moet worden, incl. btw
- regels: ELKE regel van het document, over alle pagina's heen, in volgorde.

Per regel:
- soort: "filament" (een rol 3D-printfilament), "artikel" (een ander fysiek product: onderdelen, gereedschap, magneten, ringen, …) of "kost" (verzending/freight/shipping/"Standard", administratiekost, …)
- omschrijving: de productomschrijving zoals op de factuur, zonder marketingtekst (max. 120 tekens)
- productcode: SKU / artikelnummer / productcode van de leverancier indien vermeld (bv. "A01-G7-1.75-1000-SPLFREE"), anders leeg
- aantal: het aantal (rollen, stuks); in een bestelmail staat dat vaak achteraan als "x2"
- prijs_per_eenheid: de ECHT BETAALDE prijs per eenheid INCL. BTW, NA korting.
  Staat er een subtotaal per regel incl. btw, gebruik dan: subtotaal ÷ aantal.
  Toont de factuur enkel prijzen excl. btw, reken dan om met het btw-tarief van die regel.
  Een kost die door korting € 0 wordt, geef je met prijs 0.
  Een bestelbon zonder prijzen: laat prijs_per_eenheid en regeltotaal leeg (niet 0).
- regeltotaal: het bedrag van die regel incl. btw, na korting
Enkel bij soort "filament" (vul merk, materiaal en kleur voor ELKE filamentregel in, ook als de regels op elkaar lijken; de kleur staat vaak achteraan, na " - "):
- merk: kies EXACT uit deze lijst als het past: ${merken.join(', ') || '(leeg)'}. Anders de merknaam zoals op de factuur. Een huismerkwinkel (bv. Bambu Lab store) = dat merk. "JOYBUY x ANYCUBIC" = AnyCubic.
- materiaal: kies EXACT uit deze lijst als het past: ${materialen.join(', ') || '(leeg)'}. "PLA Basic"/"PLA-Basic" = PLA. Anders de naam zoals op de factuur.
- kleur: vertaal naar het Nederlands en kies EXACT uit deze lijst als het past: ${kleuren.join(', ') || '(leeg)'} (bv. Black = Zwart, Charcoal = Zwart, Dark Blue = Blauw, Felgroen/Donkergroen = Groen tenzij er een preciezere kleur in de lijst staat). Past geen enkele, geef dan de Nederlandse kleurnaam (bv. "Cyaan", "Textuurgrijs").
- kleur_hex: een passende kleurcode (#RRGGBB) voor die kleur
Enkel bij soort "artikel":
- naam_voorstel: een korte, duidelijke Nederlandse naam voor ons artikel (bv. "Sleutelring 25 mm")
- categorie_voorstel: kies EXACT uit: ${categorieen.join(', ') || '(leeg)'}, of laat leeg

Laat een veld leeg als het niet duidelijk op het document staat. Gok niet.`;
}

export const SCHEMA = {
  type: 'OBJECT',
  properties: {
    leverancier: { type: 'OBJECT', properties: { naam: { type: 'STRING' }, btw_nummer: { type: 'STRING' }, website: { type: 'STRING' } } },
    documentsoort: { type: 'STRING', enum: ['factuur', 'bonnetje', 'bestelbon'] },
    factuurnummer: { type: 'STRING' },
    bestelnummer: { type: 'STRING' },
    datum: { type: 'STRING' },
    totaal_incl_btw: { type: 'NUMBER' },
    regels: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          soort: { type: 'STRING', enum: ['filament', 'artikel', 'kost'] },
          omschrijving: { type: 'STRING' },
          productcode: { type: 'STRING' },
          aantal: { type: 'NUMBER' },
          prijs_per_eenheid: { type: 'NUMBER' },
          regeltotaal: { type: 'NUMBER' },
          merk: { type: 'STRING' },
          materiaal: { type: 'STRING' },
          kleur: { type: 'STRING' },
          kleur_hex: { type: 'STRING' },
          naam_voorstel: { type: 'STRING' },
          categorie_voorstel: { type: 'STRING' },
        },
        required: ['soort', 'omschrijving', 'aantal'],
      },
    },
  },
  required: ['regels'],
};

// ── De oproep, met herhaling bij tijdelijke fouten (wens 24-09) ──────────
// 503 "overbelast", 429 "te veel vragen" en andere 5xx zijn meestal na
// enkele seconden voorbij: tot 3 keer opnieuw proberen (na 2, 5 en 10 s).
// Andere fouten (verkeerde sleutel, onbekend model, …) meteen melden, in
// begrijpelijke taal. De technische tekst van Google komt enkel in de log.
export const WACHTTIJDEN = [2000, 5000, 10000];
const TIJDELIJK = new Set([429, 500, 502, 503, 504]);

export class GeminiFout extends Error {
  constructor(boodschap, { status = null, tijdelijk = false } = {}) { super(boodschap); this.status = status; this.tijdelijk = tijdelijk; }
}

export function vertaalFout(status, tekst = '', model = GEMINI_MODEL()) {
  const t = String(tekst);
  if (status === 503 || status === 500 || status === 502 || status === 504) {
    return new GeminiFout('Gemini is even overbelast (fout bij Google, niet in het ERP). Probeer het over een paar minuten opnieuw.', { status, tijdelijk: true });
  }
  if (status === 429) {
    return new GeminiFout('Gemini weigert tijdelijk: te veel vragen of je gratis limiet is bereikt. Probeer het later opnieuw.', { status, tijdelijk: true });
  }
  if (/API_KEY_INVALID|API key not valid/i.test(t) || status === 401) {
    return new GeminiFout('De Gemini-sleutel is ongeldig. Kijk GEMINI_API_KEY na in de add-on-configuratie.', { status });
  }
  if (status === 403) return new GeminiFout('Gemini weigert de toegang met deze sleutel (403). Kijk de sleutel en de rechten na in Google AI Studio.', { status });
  if (status === 404) return new GeminiFout(`Het Gemini-model "${model}" bestaat niet (meer). Stel een ander model in via GEMINI_MODEL.`, { status });
  if (status === 400) return new GeminiFout('Gemini kon dit bestand niet verwerken (400). Probeer een andere PDF of een scherpere foto.', { status });
  return new GeminiFout(`Gemini gaf een onverwachte fout (${status}). Probeer het opnieuw.`, { status });
}

const slaap = ms => new Promise(r => setTimeout(r, ms));

// Eén poging. fetchFn is vervangbaar in de tests.
async function eenPoging({ buffer, mimetype, tekst, instructie, sleutel, fetchFn, model }) {
  // 25-09: ook geplakte tekst (bv. een bestelmail) i.p.v. een bestand
  const document = tekst != null
    ? { text: `DOCUMENT (tekst, bv. uit een e-mail):\n${String(tekst).slice(0, 60000)}` }
    : { inline_data: { mime_type: mimetype, data: buffer.toString('base64') } };
  const stop = new AbortController();
  const klok = setTimeout(() => stop.abort(), 90_000);
  try {
    let res;
    try {
      res = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        // sleutel in een header, niet in de URL (komt dan niet in logs terecht)
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': sleutel },
        body: JSON.stringify({
          contents: [{ parts: [{ text: instructie }, document] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
        }),
        signal: stop.signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw new GeminiFout('Gemini antwoordde niet binnen 90 seconden. Probeer het opnieuw.');
      // geen verbinding (internet, DNS, …): ook tijdelijk
      throw new GeminiFout('Geen verbinding met Gemini. Kijk de internetverbinding na en probeer opnieuw.', { tijdelijk: true });
    }
    if (!res.ok) {
      const t = (await res.text().catch(() => '')).slice(0, 500);
      if (process.env.NODE_ENV !== 'test') console.warn(`Gemini ${model} ${res.status}: ${t}`);
      throw vertaalFout(res.status, t, model);
    }
    const data = await res.json();
    const tekst = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
    if (!tekst) throw new GeminiFout('Gemini gaf geen bruikbaar antwoord terug. Probeer het opnieuw.');
    try { return JSON.parse(tekst); } catch { throw new GeminiFout('Het antwoord van Gemini kon niet gelezen worden. Probeer het opnieuw.'); }
  } finally { clearTimeout(klok); }
}

// Eén model, met herhalingen bij tijdelijke fouten.
async function metHerhaling(args, model, { fetchFn, wachttijden, wacht, sleutel }) {
  for (let poging = 0; ; poging++) {
    try {
      return await eenPoging({ ...args, sleutel, fetchFn, model });
    } catch (e) {
      if (!(e instanceof GeminiFout) || !e.tijdelijk || poging >= wachttijden.length) { e.pogingen = poging + 1; throw e; }
      await wacht(wachttijden[poging]);
    }
  }
}

// Hoofdmodel (4 pogingen: meteen, na 2, 5 en 10 s), daarna elk reservemodel
// (2 pogingen: meteen en na 2 s). Een reservemodel dat niet (meer) bestaat,
// wordt overgeslagen. Een fout die niet tijdelijk is (bv. ongeldige sleutel)
// stopt meteen. Geeft { data, model } terug: welk model de factuur las.
export async function roepGeminiAan(args, { fetchFn = fetch, wachttijden = WACHTTIJDEN, wacht = slaap, reserves = reserveModellen() } = {}) {
  const sleutel = (process.env.GEMINI_API_KEY || '').trim();
  if (!sleutel) throw new GeminiFout('De Gemini-sleutel is niet ingesteld (GEMINI_API_KEY in de add-on-configuratie).');
  const modellen = [GEMINI_MODEL(), ...reserves];
  let laatste = null;
  let pogingen = 0;
  for (const [i, model] of modellen.entries()) {
    try {
      const data = await metHerhaling(args, model, { fetchFn, wachttijden: i === 0 ? wachttijden : wachttijden.slice(0, 1), wacht, sleutel });
      return { data, model };
    } catch (e) {
      pogingen += e.pogingen || 1;
      const doorgaan = e instanceof GeminiFout && (e.tijdelijk || (i > 0 && e.status === 404));
      if (!doorgaan) throw e;
      if (!e.tijdelijk && laatste) continue;   // onbekend reservemodel: vorige (overbelast-)fout bewaren
      laatste = e;
    }
  }
  if (laatste?.tijdelijk && pogingen > 1) {
    laatste.message += ` (${pogingen} pogingen met ${modellen.length === 1 ? 'het model' : `${modellen.length} modellen`})`;
  }
  throw laatste;
}

const echteGemini = async args => {
  const { data, model } = await roepGeminiAan(args);
  return { ...data, _model: model };
};


// Vervangbaar in de tests (geen echte oproep, geen sleutel nodig):
// - backendtests: vervangLezer(fn)
// - doorklik-test in de browser: omgevingsvariabele GEMINI_NEP = pad naar
//   een JSON-bestand { "<bestandsnaam>": <antwoord> }. Nooit instellen in de add-on.
async function nepGemini({ bestandsnaam, tekst }) {
  const fs = await import('node:fs');
  const alle = JSON.parse(fs.readFileSync(process.env.GEMINI_NEP, 'utf8'));
  // geplakte tekst: sleutel "tekst:<stukje dat in de tekst voorkomt>"
  if (tekst != null) {
    const k = Object.keys(alle).find(x => x.startsWith('tekst:') && String(tekst).includes(x.slice(6)));
    if (!k) throw new Error('Geen nep-antwoord voor deze tekst');
    return alle[k];
  }
  if (!alle[bestandsnaam]) throw new Error(`Geen nep-antwoord voor ${bestandsnaam}`);
  return alle[bestandsnaam];
}
let lezer = process.env.GEMINI_NEP ? nepGemini : echteGemini;
export function vervangLezer(fn) { lezer = fn || (process.env.GEMINI_NEP ? nepGemini : echteGemini); }
export function leesFactuurMetGemini(args) { return lezer(args); }
