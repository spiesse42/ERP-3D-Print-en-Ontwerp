// Regels bewerken + live berekening (stap 4). Herbruikbaar: Proefberekening
// nu, dossiers/offertes/werkbonnen in stap 5. De berekening zelf gebeurt
// ALTIJD in de backend (POST /api/bereken): één rekenmotor, geen kopie hier.
import { useEffect, useRef, useState } from 'react';
import { api, BASE } from '../lib/api.js';
import Icoon from '../schil/Icoon.jsx';
import NieuwArtikelDialoog from './NieuwArtikelDialoog.jsx';
import Kostenopbouw, { Prijsopbouw } from './Kostenopbouw.jsx';
import { euro, naarInvoer, aantal as fmtAantal } from '../lib/formaat.js';
import { verklein } from '../lib/afbeelding.js';
import { useOmgeving } from '../schil/Omgeving.jsx';

export const TYPES = [['printen', 'Printen'], ['ontwerp', 'Ontwerp'], ['aanpassing', 'Aanpassing'], ['artikel', 'Artikel / dienst'], ['extra', 'Extra kost'], ['korting', 'Korting']];
let teller = 0;
export const nieuweRegel = (type = 'printen') => ({
  sleutel: `r${++teller}`, type, omschrijving: '',
  printer_id: '', tijd_u: '', tijd_m: '', aantal: '1', voorbereiding_min: '', nabewerking_min: '', materialen: [{ keuze: '', gram: '' }],
  minuten: '', tarief: '', artikel_id: '', bedrag: '', per_stuk: false, handmatig_bedrag: '', afbeelding: '',
  slicer_bijlage_id: null, slicer_plaat: null, slicer_bestandsnaam: '', per_plaat: '', korting: {},
});

// 15-10: kortingen — per post { waarde, soort: 'pct' | 'eur' }; in het formulier
// als tekst, naar de API als getal (lege posten vallen weg).
const kortingNaarApi = k => {
  const uit = {};
  for (const [post, x] of Object.entries(k || {})) { const w = nr(x?.waarde); if (w !== null && Number(w) > 0) uit[post] = { waarde: w, soort: x.soort === 'eur' ? 'eur' : 'pct' }; }
  return Object.keys(uit).length ? uit : null;
};
const kortingVanApi = k => Object.fromEntries(Object.entries(k || {}).map(([post, x]) => [post, { waarde: alsInvoer(x.waarde), soort: x.soort }]));

// 06-10: printregel "per stuk" — tijd en gram per stuk, voorbereiding per
// plaat, nabewerking per stuk. De API/rekenmotor krijgt altijd TOTALEN.
const getalVan = v => { const n = Number(String(v ?? '').trim().replace(',', '.')); return String(v ?? '').trim() === '' || !Number.isFinite(n) ? null : n; };
export const platen = r => { const n = getalVan(r.aantal) ?? 1, pp = getalVan(r.per_plaat); return pp > 0 ? Math.max(1, Math.ceil(n / pp - 1e-9)) : 1; };
const r4 = v => Math.round(v * 10000) / 10000;

const nr = v => (String(v ?? '').trim() === '' ? null : String(v).replace(',', '.'));
// Formulier → regel voor de API (id's; de backend zoekt prijzen op).
export function naarApi(r) {
  const basis = { ...(r.id ? { id: r.id } : {}), type: r.type, omschrijving: r.omschrijving, handmatig_bedrag: r.type === 'korting' ? null : nr(r.handmatig_bedrag), korting: kortingNaarApi(r.korting) };
  if (r.type === 'printen') {
    const u = Number(nr(r.tijd_u) ?? 0), m = Number(nr(r.tijd_m) ?? 0);
    // per stuk: × aantal (nabewerking ook), voorbereiding × platen
    const n = r.per_stuk ? (getalVan(r.aantal) ?? 1) : 1, pl = r.per_stuk ? platen(r) : 1;
    const maal = (v, f) => { const x = nr(v); return x === null || f === 1 ? x : r4(Number(x) * f); };
    return { ...basis, afbeelding: r.afbeelding || null, slicer_bijlage_id: r.slicer_bijlage_id || null, slicer_plaat: r.slicer_bijlage_id ? r.slicer_plaat || null : null, printer_id: r.printer_id || null, aantal: nr(r.aantal) ?? 1, tijd_min: r4((u * 60 + m) * n), artikel_id: r.artikel_id || null,
      per_stuk: !!r.per_stuk, per_plaat: nr(r.per_plaat), plaat_van: r.plaat_van || null,
      voorbereiding_min: maal(r.voorbereiding_min, pl), nabewerking_min: maal(r.nabewerking_min, n),
      materialen: r.materialen.filter(x => x.keuze).map(x => {
        const [soort, id] = x.keuze.split(':');
        return { [soort === 'a' ? 'artikel_id' : 'filament_type_id']: Number(id), gram: n === 1 ? (nr(x.gram) ?? 0) : r4(Number(nr(x.gram) ?? 0) * n) };
      }) };
  }
  if (r.type === 'ontwerp' || r.type === 'aanpassing') return { ...basis, minuten: nr(r.minuten) ?? 0, tarief: nr(r.tarief) };
  if (r.type === 'artikel') return { ...basis, artikel_id: r.artikel_id || null, aantal: nr(r.aantal) ?? 1 };
  if (r.type === 'extra') return { ...basis, bedrag: nr(r.bedrag) ?? 0, per_stuk: r.per_stuk, aantal: nr(r.aantal) ?? 1 };
  return basis;
}

// Bewaarde regel (API-vorm, bv. uit een dossier) → formulier van de editor.
const alsInvoer = v => (v == null ? '' : String(v).replace('.', ','));
const tijdVelden = t => { const u = Math.floor(t / 60), m = Math.round((t - u * 60) * 100) / 100; return { tijd_u: u ? String(u) : '', tijd_m: m ? alsInvoer(m) : '' }; };
// Per stuk aan/uit: de ingevulde waarden omrekenen zodat het totaal gelijk blijft.
function wisselPerStuk(r, aan) {
  const n = getalVan(r.aantal) ?? 1, pl = platen(r);
  const f = aan ? 1 / n : n, fp = aan ? 1 / pl : pl;
  const om = (v, x) => { const g = getalVan(v); return g === null ? v : alsInvoer(r4(g * x)); };
  const t = ((getalVan(r.tijd_u) ?? 0) * 60 + (getalVan(r.tijd_m) ?? 0)) * f;
  return { per_stuk: aan, ...tijdVelden(t), voorbereiding_min: om(r.voorbereiding_min, fp), nabewerking_min: om(r.nabewerking_min, f),
    materialen: r.materialen.map(m => ({ ...m, gram: om(m.gram, f) })) };
}
// Nieuwe printregel(s) volgens het printprofiel van een product (knop "Uit product").
// 21-10: een product uit meerdere platen → één printregel per plaat; enkel de
// laatste boekt het eindproduct in voorraad, de andere onthouden plaat_van.
const platenVan = p => (!p ? [] : Array.isArray(p.platen) && p.platen.length ? p.platen : [p]);
export const regelsUitProduct = (a, eindproducten) => {
  const lijst = platenVan(a.profiel || {});
  return lijst.map((_, k) => { const r = nieuweRegel('printen'); return { ...r, ...uitProfiel(r, a, eindproducten, k) }; });
};
export const regelUitProduct = (a, eindproducten) => regelsUitProduct(a, eindproducten)[0];
// Printprofiel (plaat k) van een product → velden (per stuk) van de regel.
function uitProfiel(r, a, _eindproducten, k = 0) {
  const lijst = platenVan(a.profiel || {});
  const p = lijst[k] || {};
  const meer = lijst.length > 1, laatste = k === lijst.length - 1;
  return { per_stuk: true, per_plaat: alsInvoer(p.per_plaat), ...tijdVelden(Number(p.tijd_min) || 0),
    omschrijving: meer ? `${a.naam} — plaat ${k + 1}/${lijst.length}${p.naam ? ` (${p.naam})` : ''}` : r.omschrijving || a.naam,
    printer_id: p.printer_id ? String(p.printer_id) : r.printer_id,
    voorbereiding_min: alsInvoer(p.voorbereiding_min), nabewerking_min: alsInvoer(p.nabewerking_min),
    // 30-10: ook in een klantdossier onthouden de andere platen plaat_van (zitten in de productprijs)
    ...(laatste ? { artikel_id: String(a.id), plaat_van: null } : { artikel_id: '', plaat_van: meer ? a.id : null }),
    materialen: (p.materialen || []).length ? p.materialen.map(m => ({ keuze: m.artikel_id ? `a:${m.artikel_id}` : `p:${m.filament_type_id}`, gram: alsInvoer(m.gram) })) : [{ keuze: '', gram: '' }] };
}
export function vanApi(r) {
  const f = { ...nieuweRegel(r.type), id: r.id ?? undefined, omschrijving: r.omschrijving || '', handmatig_bedrag: alsInvoer(r.handmatig_bedrag), korting: kortingVanApi(r.korting) };
  if (r.id) f.sleutel = `r${r.id}`;
  if (r.type === 'printen') {
    // per stuk bewaard als totalen: terugdelen door aantal (en platen)
    const n = r.per_stuk ? (Number(r.aantal) || 1) : 1;
    const pl = r.per_stuk ? platen({ aantal: r.aantal, per_plaat: r.per_plaat }) : 1;
    const deel = (v, f) => (v == null ? '' : alsInvoer(r4(Number(v) / f)));
    Object.assign(f, { afbeelding: r.afbeelding || '', slicer_bijlage_id: r.slicer_bijlage_id ?? null, slicer_plaat: r.slicer_plaat ?? null, slicer_bestandsnaam: r.slicer_bestandsnaam || '', printer_id: alsInvoer(r.printer_id), artikel_id: alsInvoer(r.artikel_id), plaat_van: r.plaat_van ?? null, aantal: alsInvoer(r.aantal ?? 1),
      ...tijdVelden((Number(r.tijd_min) || 0) / n), per_stuk: !!r.per_stuk, per_plaat: alsInvoer(r.per_plaat),
      voorbereiding_min: deel(r.voorbereiding_min, pl), nabewerking_min: deel(r.nabewerking_min, n),
      materialen: (r.materialen || []).length
        ? r.materialen.map(x => ({ keuze: x.artikel_id ? `a:${x.artikel_id}` : `p:${x.filament_type_id}`, gram: deel(x.gram, n) }))
        : [{ keuze: '', gram: '' }] });
  } else if (r.type === 'ontwerp' || r.type === 'aanpassing') {
    Object.assign(f, { minuten: alsInvoer(r.minuten), tarief: alsInvoer(r.tarief) });
  } else if (r.type === 'artikel') {
    Object.assign(f, { artikel_id: alsInvoer(r.artikel_id), aantal: alsInvoer(r.aantal ?? 1) });
  } else if (r.type === 'extra') {
    Object.assign(f, { bedrag: alsInvoer(r.bedrag), per_stuk: !!r.per_stuk, aantal: alsInvoer(r.aantal ?? 1) });
  }
  return f;
}

// Live berekening, 300 ms na de laatste wijziging.
// filamentInkoop (04-10): familie & vrienden, filament aan inkoopprijs
// onderdelen (24-10): die van een product meerekenen (niet in een voorraaddossier)
// klantId (29-10): prijsafspraken van die klant
export function useBerekening(regels, stand = 'schatting', filamentInkoop = false, onderdelen = true, klantId = null) {
  const [uitkomst, setUitkomst] = useState(null);
  const [fout, setFout] = useState(null);
  const volg = useRef(0);
  // zonder afbeelding: telt niet voor de prijs en maakt elke aanvraag zwaar
  const sleutel = JSON.stringify(regels.map(r => { const { afbeelding: _a, slicer_bijlage_id: _s, slicer_plaat: _p, ...x } = naarApi(r); return x; }));
  useEffect(() => {
    const mijn = ++volg.current;
    const klok = setTimeout(async () => {
      try {
        const b = await api.post('/bereken', { regels: JSON.parse(sleutel), stand, filament_inkoop: !!filamentInkoop, onderdelen, klant_id: klantId || null });
        if (mijn === volg.current) { setUitkomst(b); setFout(null); }
      } catch (e) { if (mijn === volg.current) setFout(e.message); }
    }, 300);
    return () => clearTimeout(klok);
  }, [sleutel, stand, filamentInkoop, onderdelen, klantId]);
  return { uitkomst, fout };
}

// 08-10: productiekost (intern, schatting): wat de print JOU kost + winst
const pctVan = (w, t) => (t > 0 ? ` (${fmtAantal(Math.round(w / t * 1000) / 10)} %)` : '');
// 15-10: korting in % of € (één veld + keuze)
function KortingVeld({ label, titel, k, onZet }) {
  const w = k?.waarde ?? '', soort = k?.soort || 'pct';
  return (
    <label title={titel}>{label}
      <span className="samen">
        <input className="inp num" inputMode="decimal" placeholder="0" value={w} onChange={e => onZet({ waarde: e.target.value, soort })} />
        <select className="inp" aria-label={`${label}: % of €`} value={soort} onChange={e => onZet({ waarde: w, soort: e.target.value })} style={{ width: 'auto', minWidth: 58, flex: '0 0 auto' }}>
          <option value="pct">%</option><option value="eur">€</option>
        </select>
      </span>
    </label>
  );
}

function KostRegel({ k, bedrag, alleenKost = false }) {
  const r = v => euro(Math.round(v * 100) / 100);
  return (
    <div className="kostregel" style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: '0 12px', color: 'var(--pos)' }}>
      <span>productiekost {r(k.kost)}{k.per_stuk !== k.kost ? ` (${r(k.per_stuk)}/stuk)` : ''}: filament {r(k.filament)} · stroom {r(k.energie)} · machine {r(k.machine)} · BMCU {r(k.bmcu)}</span>
      <span>+ arbeid {r(k.arbeid)}</span>
      {k.onderdelen > 0 && <span>+ onderdelen {r(k.onderdelen)}</span>}
      {!alleenKost && <span>winst {r(k.winst)}{pctVan(k.winst, bedrag)} · na arbeid {r(k.winst_na_arbeid)}</span>}
      {k.onvolledig && <span>ontbreekt: {k.ontbreekt.join(', ')}</span>}
    </div>
  );
}

const e2 = v => euro(Math.round(v * 100) / 100);
function Detail({ b, type, alleenKost = false }) {
  if (!b) return null;
  if (b.fout) return <div className="regelfout"><Icoon naam="let" maat={14} /> {b.fout}</div>;
  const d = b.detail || {};
  // 23-10: voorraad → geen verkoopprijs, enkel wat het printen kost
  if (alleenKost) {
    return (
      <div className="regeldetail sub">
        {type === 'printen' && <span>{fmtAantal(Math.round(d.uren * 100) / 100)} u</span>}
        {b.kost && <KostRegel k={b.kost} alleenKost />}
      </div>
    );
  }
  const delen = type === 'printen'
    ? [[d.materialen?.some(m => m.prijs_bron === 'inkoop') ? 'materiaal (inkoopprijs)' : 'materiaal', d.materiaal], ...(d.onderdelen ? [[`onderdelen (${(d.onderdelen_lijst || []).map(o => `${fmtAantal(o.aantal)} × ${o.naam}`).join(', ')})`, d.onderdelen]] : []), ['energie', d.energie], ['machine', d.machine], ['arbeid', d.arbeid], ['BMCU/AMS', d.bmcu], ...(d.winst ? [['winst printuren', d.winst]] : [])]
    : [];
  return (
    <div className="regeldetail sub">
      {delen.map(([l, w]) => <span key={l}>{l} {euro(Math.round(w * 100) / 100)}</span>)}
      {type === 'printen' && <span>{fmtAantal(Math.round(d.uren * 100) / 100)} u{d.energie_bron === 'gemeten' ? ' · energie gemeten' : ''}</span>}
      {b.korting?.totaal > 0 && <span className="badge b-info" title="Korting op deze regel">korting {e2(b.korting.totaal)}{b.korting.materiaal > 0 ? ` · filament ${e2(b.korting.materiaal)}` : ''}{b.korting.printuren > 0 ? ` · printuren ${e2(b.korting.printuren)}` : ''}{b.korting.regel > 0 ? ` · regel ${e2(b.korting.regel)}` : ''}</span>}
      {b.handmatig && <span className="badge b-info">{b.afspraak != null ? `prijsafspraak ${euro(b.afspraak)}/stuk` : b.productprijs != null ? (b.productprijs > 0 ? `verkoopprijs product ${euro(b.productprijs)}/stuk` : 'in de prijs van het product') : 'handmatig'} (berekend {euro(Math.round(b.natuurlijk_eindbedrag * 100) / 100)})</span>}
      {b.per_stuk != null && type !== 'korting' && <span>per stuk {euro(b.per_stuk)}</span>}
      {b.oud != null && Math.abs(b.oud - b.eindbedrag) >= 0.01 && <span className="oudprijs" title="Wat de oude berekening (getrapte marge) voor deze regel vroeg">oude berekening {euro(b.oud)} ({b.eindbedrag > b.oud ? '+' : ''}{euro(Math.round((b.eindbedrag - b.oud) * 100) / 100)})</span>}
      {b.kost && <KostRegel k={b.kost} bedrag={b.eindbedrag} />}
    </div>
  );
}

const NIEUW = '__nieuw';

// Samenvatting van een printregel per stuk / per plaat: wat er in totaal geprint wordt.
function Totaal({ r }) {
  const a = naarApi(r);
  const t = Number(a.tijd_min) || 0, u = Math.floor(t / 60), m = Math.round(t - u * 60);
  const g = a.materialen.reduce((s, x) => s + Number(x.gram || 0), 0);
  const pl = platen(r);
  return <div className="sub" style={{ gridColumn: '1/-1' }}>Totaal: {fmtAantal(Number(a.aantal))} stuks · {u ? `${u} u ` : ''}{m} min · {fmtAantal(Math.round(g * 10) / 10)} g{pl > 1 ? ` · ${pl} platen (één printopdracht per plaat)` : ''}</div>;
}

// herkomst: voor de historiek van een nieuw artikel ('proefberekening', later 'dossier').
// onArtikelGemaakt: laat de ouder de artikellijst herladen (await), zodat het nieuwe artikel in de keuzelijst staat.
// alleenLezen: bv. een afgerekend dossier — alles zichtbaar, niets te wijzigen.
// eindproducten: enkel bij een dossier "Eigen product" — zelf geprinte
// artikelen waar de goede stuks van een printregel naartoe gaan (stap 6c).
// alleenKost (23-10): dossier "Voorraad" — geen verkoopprijs, korting of eindbedrag, enkel de productiekost.
// productKeuze (24-10): enkel bij een klantdossier — het product van een
// printregel; zijn onderdelen (sleutelring…) tellen mee in prijs en levering.
export default function RegelEditor({ regels, onWijzig, uitkomst, printers, filamenten, prijsgroepen, artikelen, tarieven, herkomst, onArtikelGemaakt, alleenLezen = false, eindproducten = null, producten = null, alleenKost = false, productKeuze = null, onProfielBewaard = null }) {
  const actueel = useRef(regels);
  actueel.current = regels;
  const { melding, bevestig } = useOmgeving();
  const [nieuwVoor, setNieuwVoor] = useState(null);
  // 24-10: deze printregel bewaren als printprofiel van het product
  async function naarProfiel(r) {
    const a = (productKeuze || eindproducten || []).find(x => String(x.id) === String(r.artikel_id));
    if (!a) return;
    const heeft = (producten || []).some(p => p.id === a.id);
    if (!await bevestig({ titel: 'Printprofiel van het product', tekst: `De printtijd, het filament, de printer en de stuks per plaat van deze regel worden het printprofiel van "${a.weergave}" (per stuk)${r.slicer_bijlage_id ? ', met het slicerbestand erbij' : ''}.${heeft ? ' Het huidige profiel wordt vervangen.' : ''}`, bevestigLabel: heeft ? 'Profiel vervangen' : 'Profiel bewaren' })) return;
    try {
      await api.post(`/productie/printprofiel/${a.id}/uit-regel`, { regel: naarApi(r) });
      melding(`Printprofiel van "${a.weergave}" bewaard. Volgende keer: "Uit product".`);
      onProfielBewaard?.();
    } catch (e) { melding(e.message, 'fout'); }
  }   // sleutel van de regel die een nieuw artikel krijgt
  const [open, setOpen] = useState({});   // 15-10: regels waar de kortingvelden open staan
  const zet = (i, w) => onWijzig(regels.map((r, j) => (j === i ? { ...r, ...w } : r)));
  async function artikelGemaakt(id) {
    if (onArtikelGemaakt) await onArtikelGemaakt(id);
    // de regel opzoeken op sleutel: intussen kan de lijst veranderd zijn
    onWijzig(actueel.current.map(r => (r.sleutel === nieuwVoor ? { ...r, artikel_id: String(id) } : r)));
    setNieuwVoor(null);
  }
  async function kiesAfbeelding(sleutel, bestand) {
    if (!bestand) return;
    try {
      const a = await verklein(bestand);
      onWijzig(actueel.current.map(r => (r.sleutel === sleutel ? { ...r, afbeelding: a } : r)));
    } catch (e) { melding(e.message, 'fout'); }
  }
  const zetMat = (i, k, w) => zet(i, { materialen: regels[i].materialen.map((m, j) => (j === k ? { ...m, ...w } : m)) });
  const t = tarieven || {};
  return (
    <fieldset className="regeleditor" disabled={alleenLezen}>
      {regels.length === 0 && <div className="leeg" style={{ padding: '18px 8px' }}><b>Nog geen regels.</b>Voeg hieronder een regel toe.</div>}
      {regels.map((r, i) => {
        const b = uitkomst?.regels?.[i]?._berekend;
        return (
          <div className="regel" key={r.sleutel}>
            <div className="regel-kop">
              <select className="inp regeltype" aria-label={`Soort regel ${i + 1}`} value={r.type} onChange={e => zet(i, { type: e.target.value, artikel_id: '' })}>
                {TYPES.map(([w, l]) => <option key={w} value={w}>{l}</option>)}
              </select>
              <input className="inp" aria-label={`Omschrijving regel ${i + 1}`} placeholder="Omschrijving (bv. Sleutelhanger hond)" value={r.omschrijving} onChange={e => zet(i, { omschrijving: e.target.value })} />
              <b className="num eind" title={alleenKost ? 'Geschatte productiekost' : undefined}>{!b || b.fout ? '—' : alleenKost ? (b.kost ? <>{e2(b.kost.kost)} <span className="sub" style={{ fontWeight: 400 }}>kost</span></> : '—') : euro(b.eindbedrag)}</b>
              <button type="button" className="btn ghost" aria-label={`Regel ${i + 1} weghalen`} onClick={() => onWijzig(regels.filter((_, j) => j !== i))}><Icoon naam="kruis" maat={14} /></button>
            </div>
            <div className="regel-velden">
              {r.type === 'printen' && <>
                {producten?.length > 0 && <label>Uit product<select className="inp" value="" onChange={e => { const a = producten.find(x => String(x.id) === e.target.value); if (!a) return; const n = platenVan(a.profiel).length; if (n <= 1) { zet(i, uitProfiel(r, a, eindproducten)); return; }
                  const extra = regelsUitProduct(a, eindproducten); onWijzig([...regels.slice(0, i), { ...r, ...uitProfiel(r, a, eindproducten, 0) }, ...extra.slice(1), ...regels.slice(i + 1)]); }}>
                  <option value="">Printprofiel kiezen…</option>
                  {producten.map(a => <option key={a.id} value={a.id}>{a.naam}</option>)}
                </select></label>}
                <label>Printer<select className="inp" value={r.printer_id} onChange={e => zet(i, { printer_id: e.target.value })}>
                  <option value="">Kies…</option>
                  {(printers || []).map(p => <option key={p.id} value={p.id}>{p.naam}{p.machine_per_uur == null ? ' (tarief ontbreekt)' : ''}</option>)}
                </select></label>
                <label>{r.per_stuk ? 'Printtijd per stuk' : 'Printtijd'}<span className="samen"><input className="inp num" inputMode="numeric" aria-label="Uren" placeholder="u" value={r.tijd_u} onChange={e => zet(i, { tijd_u: e.target.value })} /><input className="inp num" inputMode="numeric" aria-label="Minuten" placeholder="min" value={r.tijd_m} onChange={e => zet(i, { tijd_m: e.target.value })} /></span></label>
                <label>{r.per_stuk ? 'Aantal stuks' : 'Stuks op de print'}<input className="inp num" inputMode="numeric" value={r.aantal} onChange={e => zet(i, { aantal: e.target.value })} /></label>
                <label className="vinkje" title="Tijd en gram van één stuk invullen; het ERP rekent × het aantal"><input type="checkbox" checked={!!r.per_stuk} onChange={e => zet(i, wisselPerStuk(r, e.target.checked))} /> per stuk</label>
                <label title="Hoeveel stuks er op één plaat passen: één printopdracht per plaat">Stuks per plaat<input className="inp num" inputMode="numeric" placeholder="alle" value={r.per_plaat} onChange={e => zet(i, { per_plaat: e.target.value })} /></label>
                <label>{r.per_stuk ? 'Voorbereiding per plaat (min)' : 'Voorbereiding (min)'}<input className="inp num" inputMode="numeric" placeholder={naarInvoer(t.voorbereiding_min)} value={r.voorbereiding_min} onChange={e => zet(i, { voorbereiding_min: e.target.value })} /></label>
                <label>{r.per_stuk ? 'Nabewerking per stuk (min)' : 'Nabewerking (min)'}<input className="inp num" inputMode="numeric" placeholder={r.per_stuk && t.nabewerking_min != null ? `std. ${naarInvoer(t.nabewerking_min)} in totaal` : naarInvoer(t.nabewerking_min)} value={r.nabewerking_min} onChange={e => zet(i, { nabewerking_min: e.target.value })} /></label>
                {eindproducten && <label>Naar voorraad als<select className="inp" value={r.artikel_id} onChange={e => zet(i, { artikel_id: e.target.value })}>
                  <option value="">— niet naar voorraad —</option>
                  {eindproducten.map(a => <option key={a.id} value={a.id}>{a.weergave}</option>)}
                </select></label>}
                {productKeuze && <label title="Het product dat je print: de prijs is zijn verkoopprijs, zijn onderdelen per stuk (bv. sleutelring) gaan bij de levering uit voorraad. Een andere plaat van een product uit meerdere platen zit in die prijs (€ 0).">Product<select className="inp" value={r.artikel_id || (r.plaat_van ? `p:${r.plaat_van}` : '')}
                  onChange={e => { const v = e.target.value; zet(i, v.startsWith('p:') ? { artikel_id: '', plaat_van: Number(v.slice(2)) } : { artikel_id: v, plaat_van: null }); }}>
                  <option value="">— geen —</option>
                  {productKeuze.map(a => <option key={a.id} value={a.id}>{a.weergave}</option>)}
                  {/* enkel producten waarvan het printprofiel meerdere platen heeft */}
                  {(m => m.length > 0 && <optgroup label="Andere plaat van (zit in de productprijs)">
                    {m.map(a => <option key={`p${a.id}`} value={`p:${a.id}`}>plaat van {a.weergave}</option>)}
                  </optgroup>)(productKeuze.filter(a => String(a.id) === String(r.plaat_van) || platenVan(producten?.find(x => x.id === a.id)?.profiel).length > 1))}
                </select></label>}
                {(productKeuze || eindproducten) && r.artikel_id && !alleenLezen && (
                  <button type="button" className="linkish" style={{ alignSelf: 'end', marginBottom: 6 }} title="Tijd, filament, printer en stuks per plaat van deze regel als printprofiel (per stuk) bij het product bewaren" onClick={() => naarProfiel(r)}>Als printprofiel van het product bewaren</button>
                )}
                <div className="materialen">
                  {r.materialen.map((m, k) => (
                    <div className="materiaal" key={k}>
                      <select className="inp" aria-label={`Filament ${k + 1}`} value={m.keuze} onChange={e => zetMat(i, k, { keuze: e.target.value })}>
                        <option value="">Filament kiezen…</option>
                        <optgroup label="Filament (merk · type · kleur)">{(filamenten || []).map(f => <option key={`a${f.id}`} value={`a:${f.id}`}>{f.weergave}</option>)}</optgroup>
                        <optgroup label="Enkel prijsgroep (merk · type)">{(prijsgroepen || []).map(g => <option key={`p${g.id}`} value={`p:${g.id}`}>{g.merk} {g.materiaal}</option>)}</optgroup>
                      </select>
                      <span className="unit"><input className="inp num" inputMode="decimal" aria-label={`Gewicht filament ${k + 1}`} placeholder={r.per_stuk ? 'g/stuk' : 'gram'} value={m.gram} onChange={e => zetMat(i, k, { gram: e.target.value })} /><span>g</span></span>
                      {r.materialen.length > 1 && <button type="button" className="btn ghost" aria-label="Kleur weghalen" onClick={() => zet(i, { materialen: r.materialen.filter((_, j) => j !== k) })}><Icoon naam="kruis" maat={12} /></button>}
                    </div>
                  ))}
                  <button type="button" className="linkish" onClick={() => zet(i, { materialen: [...r.materialen, { keuze: '', gram: '' }] })}>+ kleur (multicolor)</button>
                </div>
                {(r.per_stuk || platen(r) > 1) && <Totaal r={r} />}
                {(r.slicer_bijlage_id || r.slicer_wacht) && (
                  <div className="regel-slicer sub">
                    <Icoon naam="lagen" maat={14} />
                    {r.slicer_bijlage_id
                      ? <a href={`${BASE}/bijlagen/bestand/${r.slicer_bijlage_id}`} title="Slicerbestand downloaden (openen in Bambu Studio)">{r.slicer_bestandsnaam || 'Slicerbestand'}</a>
                      : <span>{r.slicer_bestandsnaam || 'Slicerbestand'} (wordt bewaard bij het opslaan)</span>}
                    {r.slicer_plaat && <span>· plaat {r.slicer_plaat}</span>}
                    {!alleenLezen && <button type="button" className="btn ghost" aria-label={`Slicerbestand loskoppelen van regel ${i + 1}`} title="Loskoppelen (het bestand blijft in Bijlagen)" onClick={() => zet(i, { slicer_bijlage_id: null, slicer_plaat: null, slicer_bestandsnaam: '', slicer_wacht: false })}><Icoon naam="kruis" maat={12} /></button>}
                  </div>
                )}
                <div className="regel-afb" title="Komt op de offerte en de werkbon">
                  {r.afbeelding ? <>
                    <img src={r.afbeelding} alt={`Afbeelding regel ${i + 1}`} />
                    <button type="button" className="btn ghost" aria-label={`Afbeelding van regel ${i + 1} weghalen`} onClick={() => zet(i, { afbeelding: '' })}><Icoon naam="kruis" maat={12} /></button>
                  </> : (
                    <label className="linkish">+ afbeelding (op offerte)
                      <input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp" onChange={e => { kiesAfbeelding(r.sleutel, e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                  )}
                </div>
              </>}
              {(r.type === 'ontwerp' || r.type === 'aanpassing') && <>
                <label>Minuten<input className="inp num" inputMode="numeric" value={r.minuten} onChange={e => zet(i, { minuten: e.target.value })} /></label>
                <label>Tarief (€/u)<input className="inp num" inputMode="decimal" placeholder={naarInvoer(r.type === 'ontwerp' ? t.ontwerp_tarief : t.nabewerking_tarief)} value={r.tarief} onChange={e => zet(i, { tarief: e.target.value })} /></label>
              </>}
              {r.type === 'artikel' && <>
                <label className="breed">Artikel / dienst<select className="inp" value={r.artikel_id} onChange={e => (e.target.value === NIEUW ? setNieuwVoor(r.sleutel) : zet(i, { artikel_id: e.target.value }))}>
                  <option value="">Kies…</option>
                  {(artikelen || []).map(a => <option key={a.id} value={a.id}>{a.weergave} · {euro(a.verkoopprijs)}{a.vaste_prijs ? ' (doorgerekend)' : ''}</option>)}
                  <option value={NIEUW}>+ Nieuw artikel of dienst…</option>
                </select></label>
                <label>Aantal<input className="inp num" inputMode="decimal" value={r.aantal} onChange={e => zet(i, { aantal: e.target.value })} /></label>
              </>}
              {r.type === 'extra' && <>
                <label>Bedrag (€)<input className="inp num" inputMode="decimal" value={r.bedrag} onChange={e => zet(i, { bedrag: e.target.value })} /></label>
                <label className="vinkje"><input type="checkbox" checked={r.per_stuk} onChange={e => zet(i, { per_stuk: e.target.checked })} /> per stuk</label>
                {r.per_stuk && <label>Aantal<input className="inp num" inputMode="numeric" value={r.aantal} onChange={e => zet(i, { aantal: e.target.value })} /></label>}
              </>}
              {r.type === 'korting' && <>
                <KortingVeld label="Korting op het totaal" k={r.korting?.totaal} onZet={x => zet(i, { korting: { totaal: x } })} />
                <span className="sub" style={{ alignSelf: 'center', flex: '1 1 320px' }}>op alle andere regels samen (niet op vaste prijzen zoals verzending); komt als aparte regel op offerte, werkbon en factuur</span>
              </>}
              {r.type !== 'korting' && !alleenKost && <label>Eindbedrag aanpassen<input className="inp num" inputMode="decimal" placeholder="berekend" value={r.handmatig_bedrag} onChange={e => zet(i, { handmatig_bedrag: e.target.value })} /></label>}
              {alleenKost ? null : r.type !== 'korting' && (open[r.sleutel] || Object.values(r.korting || {}).some(x => x?.waarde)) ? <>
                {r.type === 'printen' && <KortingVeld label="Korting filament" k={r.korting?.materiaal} onZet={x => zet(i, { korting: { ...r.korting, materiaal: x } })} />}
                {r.type === 'printen' && <KortingVeld label="Korting printuren" titel="Op stroom, machine en winst per printuur" k={r.korting?.printuren} onZet={x => zet(i, { korting: { ...r.korting, printuren: x } })} />}
                <KortingVeld label="Korting hele regel" k={r.korting?.regel} onZet={x => zet(i, { korting: { ...r.korting, regel: x } })} />
              </> : r.type !== 'korting' && !alleenLezen && <button type="button" className="linkish" style={{ alignSelf: 'end' }} onClick={() => setOpen(o => ({ ...o, [r.sleutel]: true }))}>+ korting</button>}
            </div>
            <Detail b={b} type={r.type} alleenKost={alleenKost} />
          </div>
        );
      })}
      {nieuwVoor && <NieuwArtikelDialoog herkomst={herkomst} onSluit={() => setNieuwVoor(null)} onGemaakt={artikelGemaakt} />}
    </fieldset>
  );
}

export function Totalen({ uitkomst, gemeten = null, alleenKost = false }) {
  if (!uitkomst) return null;
  const u = uitkomst;
  const k = u.productiekost;
  const r = v => euro(Math.round(v * 100) / 100);
  // 23-10: dossier "Voorraad": geen prijs, totaal of winst — enkel de productiekost
  if (alleenKost) {
    return (<>
      <div className="totalen">
        <div><span>Totale printtijd</span><span className="num">{fmtAantal(Math.round(u.totale_tijd_u * 100) / 100)} u</span></div>
        <div className="groot"><span>Productiekost (schatting){k?.onvolledig ? ' — onvolledig' : ''}</span><span className="num">{k ? r(k.kost) : '—'}</span></div>
        {k && <div className="intern"><span>+ arbeid (je eigen tijd)</span><span className="num">{r(k.arbeid)}</span></div>}
        {gemeten && <div className="intern"><span>Gemeten ({gemeten.voltooid} van {gemeten.totaal} opdrachten voltooid){gemeten.onvolledig ? ' — onvolledig' : ''}</span><span className="num">{r(gemeten.kost)} + arbeid {r(gemeten.arbeid)}</span></div>}
        {!u.volledig && <div className="regelfout">Niet volledig: {u.fouten.length} regel(s) kunnen niet berekend worden (zie hierboven).</div>}
      </div>
      {k?.opbouw && <Kostenopbouw titel="Productiekost: schatting en meting" open verschil={!!gemeten?.opbouw} kolommen={[
        { titel: 'Schatting (alle regels)', o: k.opbouw },
        ...(gemeten?.opbouw ? [{ titel: `Schatting voltooide (${gemeten.voltooid}/${gemeten.totaal})`, o: gemeten.schatting_voltooid }, { titel: 'Gemeten voltooide', o: gemeten.opbouw }] : []),
      ]} />}
      <p className="note" style={{ fontSize: 12 }}>Voorraad: de stuks gaan bij het bevestigen in voorraad aan de gemeten productiekost per stuk. De verkoopprijs staat bij het artikel (en in de webshop).</p>
    </>);
  }
  return (<>
    <div className="totalen">
      <div><span>Totale printtijd</span><span className="num">{fmtAantal(Math.round(u.totale_tijd_u * 100) / 100)} u</span></div>
      {u.model === 'printuur'
        ? <div><span>Rekenmodel</span><span className="num">winst per printuur</span></div>
        : <>
          <div><span>Marge (klein/groot volgens printtijd)</span><span className="num">{fmtAantal(u.marge_pct)} %</span></div>
          <div><span>Kost waar marge op komt</span><span className="num">{euro(Math.round(u.kost_met_marge * 100) / 100)}</span></div>
        </>}
      <div><span>Zonder marge (materiaal, artikelen, handmatig)</span><span className="num">{euro(Math.round(u.zonder_marge * 100) / 100)}</span></div>
      {u.vast > 0 && <div><span>Doorgerekende kosten (buiten btw-grondslag)</span><span className="num">{euro(Math.round(u.vast * 100) / 100)}</span></div>}
      <div><span>Btw-grondslag</span><span className="num">{euro(u.btw_grondslag)}</span></div>
      <div className="groot"><span>Totaal</span><span className="num">{euro(u.totaal)}</span></div>
      {u.oud && Math.abs(u.oud.totaal - u.totaal) >= 0.01 && <div className="intern oud"><span>Oude berekening (getrapte marge)</span><span className="num">{euro(u.oud.totaal)} → {u.totaal > u.oud.totaal ? '+' : ''}{euro(Math.round((u.totaal - u.oud.totaal) * 100) / 100)}</span></div>}
      {k && <>
        <div className="intern" title="Intern, komt niet op offerte of werkbon"><span>Productiekost printwerk (schatting){k.onvolledig ? ' — onvolledig' : ''}</span><span className="num">{r(k.kost)} + arbeid {r(k.arbeid)}</span></div>
        {gemeten && <div className="intern"><span>Productiekost gemeten ({gemeten.voltooid} van {gemeten.totaal} opdrachten voltooid){gemeten.onvolledig ? ' — onvolledig' : ''}</span><span className="num">{r(gemeten.kost)} + arbeid {r(gemeten.arbeid)}</span></div>}
        <div className="intern"><span>Winst op printwerk (schatting)</span><span className="num">{r(k.winst)}{pctVan(k.winst, k.bedrag)} · na arbeid {r(k.winst_na_arbeid)}</span></div>
      </>}
      {!u.volledig && <div className="regelfout">Niet volledig: {u.fouten.length} regel(s) kunnen niet berekend worden (zie hierboven).</div>}
    </div>
      {u.prijsopbouw && u.regels.length > 0 && <Prijsopbouw p={u.prijsopbouw} k={k} totaal={u.totaal} />}
      {k?.opbouw && <Kostenopbouw titel="Productiekost: schatting en meting" open={!!gemeten?.opbouw} verschil={!!gemeten?.opbouw} kolommen={[
        { titel: 'Schatting (alle regels)', o: k.opbouw },
        ...(gemeten?.opbouw ? [{ titel: `Schatting voltooide (${gemeten.voltooid}/${gemeten.totaal})`, o: gemeten.schatting_voltooid }, { titel: 'Gemeten voltooide', o: gemeten.opbouw }] : []),
      ]} />}
      {gemeten?.opbouw && <p className="note" style={{ fontSize: 12 }}>Gemeten = de bevestigde printopdrachten: echte printtijd en kWh van alle runs (ook mislukte), filament volgens de regel. Rood = duurder dan geschat. De schatting van de nog open opdrachten zit enkel in de eerste kolom.</p>}
  </>);
}
