import { useEffect, useState } from 'react';
import { api, BASE } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import Icoon from '../../schil/Icoon.jsx';
import { aantal as fmtAantal, euro } from '../../lib/formaat.js';
import ProfielUitSlicer from './ProfielUitSlicer.jsx';

// Printprofiel van een vast product (06-10): tijd en gram PER STUK, stuks
// per plaat, printer, voorbereiding per plaat, nabewerking per stuk. Wordt
// gebruikt door "Uit product" in de regels van een dossier en door
// Bijprinten (één printopdracht per plaat).
const alsInvoer = v => (v == null ? '' : String(v).replace('.', ','));
const nr = v => (String(v ?? '').trim() === '' ? null : String(v).trim().replace(',', '.'));
// 21-10: een artikel kan uit meerdere platen bestaan → het formulier heeft
// altijd een lijst platen; met één plaat wordt het de vlakke vorm van vroeger.
const leegPlaat = { naam: '', printer_id: '', tijd_u: '', tijd_m: '', per_plaat: '', voorbereiding_min: '', nabewerking_min: '', slicer_plaat: null, materialen: [{ keuze: '', gram: '' }] };
const leeg = { letters: false, slicer_bijlage_id: null, platen: [leegPlaat] };
const platenVan = p => (!p ? [] : Array.isArray(p.platen) && p.platen.length ? p.platen : [p]);
function plaatNaarForm(p) {
  const t = Number(p.tijd_min) || 0, u = Math.floor(t / 60), m = Math.round((t - u * 60) * 100) / 100;
  return { naam: p.naam || '', letter: p.letter || '', printer_id: p.printer_id ? String(p.printer_id) : '', tijd_u: u ? String(u) : '', tijd_m: m ? alsInvoer(m) : '', per_plaat: alsInvoer(p.per_plaat),
    voorbereiding_min: alsInvoer(p.voorbereiding_min), nabewerking_min: alsInvoer(p.nabewerking_min), slicer_plaat: p.slicer_plaat ?? null,
    materialen: p.materialen?.length ? p.materialen.map(x => ({ keuze: x.artikel_id ? `a:${x.artikel_id}` : `p:${x.filament_type_id}`, gram: alsInvoer(x.gram) })) : leegPlaat.materialen };
}
function naarForm(p) {
  if (!p) return leeg;
  return { letters: !!p.letters, slicer_bijlage_id: p.slicer_bijlage_id ?? null, platen: platenVan(p).map(plaatNaarForm) };
}
function plaatNaarBody(f) {
  return { naam: f.naam || null, ...(f.letter ? { letter: f.letter } : {}), printer_id: f.printer_id || null, tijd_min: Number(nr(f.tijd_u) ?? 0) * 60 + Number(nr(f.tijd_m) ?? 0), per_plaat: nr(f.per_plaat),
    voorbereiding_min: nr(f.voorbereiding_min), nabewerking_min: nr(f.nabewerking_min), slicer_plaat: f.slicer_plaat,
    materialen: f.materialen.filter(m => m.keuze).map(m => { const [s, id] = m.keuze.split(':'); return { [s === 'a' ? 'artikel_id' : 'filament_type_id']: Number(id), gram: nr(m.gram) ?? 0 }; }) };
}
function naarBody(f) {
  const platen = f.platen.map(plaatNaarBody);
  if (f.letters) return { letters: true, platen, slicer_bijlage_id: f.slicer_bijlage_id };
  return platen.length === 1 ? { ...platen[0], slicer_bijlage_id: f.slicer_bijlage_id } : { platen, slicer_bijlage_id: f.slicer_bijlage_id };
}

export default function Printprofiel({ id, naam = '', gewicht = null, onBijprinten }) {
  const { melding, bevestig } = useOmgeving();
  const { data, herlaad } = useData(`/productie/printprofiel/${id}`);
  const { data: printers } = useData('/printers');
  const { data: artikelen } = useData('/voorraad/artikelen');
  const { data: groepen } = useData('/filament/types');
  const { data: kost, herlaad: herlaadKost } = useData(`/producten/${id}/kost`);
  const [f, setF] = useState(leeg);
  const [bezig, setBezig] = useState(false);
  const [slicer, setSlicer] = useState(false);
  const [nieuwBestand, setNieuwBestand] = useState(null);
  const [nr_, setNr] = useState(0);   // actieve plaat
  const { data: bijlagen } = useData(`/bijlagen/artikel/${id}`);
  useEffect(() => { if (data) { setF(naarForm(data.profiel)); setNr(0); } }, [data]);
  const i = Math.min(nr_, f.platen.length - 1);
  const pl = f.platen[i];
  const zetPl = w => setF(x => ({ ...x, platen: x.platen.map((q, j) => (j === i ? { ...q, ...w } : q)) }));
  const zet = k => e => zetPl({ [k]: e.target.value });
  const zetMat = (k, w) => zetPl({ materialen: pl.materialen.map((m, j) => (j === k ? { ...m, ...w } : m)) });
  const vuil = data && JSON.stringify(f) !== JSON.stringify(naarForm(data.profiel));
  async function bewaar(profiel) {
    setBezig(true);
    try { await api.put(`/productie/printprofiel/${id}`, { profiel }); await herlaad(); herlaadKost(); melding(profiel ? 'Printprofiel bewaard.' : 'Printprofiel gewist.'); }
    catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  async function wis() {
    if (await bevestig({ titel: 'Printprofiel wissen', tekst: 'Het profiel verdwijnt; bestaande dossiers blijven zoals ze zijn.', bevestigLabel: 'Wissen', annuleerLabel: 'Terug', gevaarlijk: true })) bewaar(null);
  }
  if (!data) return null;
  async function uitSlicer(x) {
    // 09-10: het bestand zelf als bijlage bij het artikel (koppeling bij "Profiel bewaren")
    let bijlage = null;
    if (x.bestand) {
      try {
        const fd = new FormData();
        fd.append('bestand', x.bestand);
        const b = await api.upload(`/bijlagen/artikel/${id}`, fd);
        bijlage = b.id;
        setNieuwBestand(b.bestandsnaam);
      } catch (e) { melding(`Bestand niet bewaard: ${e.message}`, 'fout'); }
    }
    // 21-10: één of meer platen uit het bestand
    const nieuw = x.platen.map(q => {
      const u = Math.floor(q.tijd_min / 60), m = Math.round((q.tijd_min - u * 60) * 100) / 100;
      return { ...leegPlaat, naam: q.naam || '', letter: q.letter || '', printer_id: q.printer_id || '', tijd_u: u ? String(u) : '', tijd_m: m ? alsInvoer(m) : '', per_plaat: q.per_plaat,
        materialen: q.materialen, slicer_plaat: bijlage ? q.plaat : null };
    });
    // 29-10: elke plaat is een letter → letterprofiel
    if (x.letters) {
      setF(v => ({ letters: true, slicer_bijlage_id: bijlage ?? v.slicer_bijlage_id, platen: nieuw }));
      setSlicer(false);
      melding(`${nieuw.length} letters overgenomen. Kijk de letters en het filament na en klik op "Profiel bewaren".`);
      return;
    }
    setF(v => (x.platen.length > 1 ? { slicer_bijlage_id: bijlage ?? v.slicer_bijlage_id, platen: nieuw }
      : { slicer_bijlage_id: bijlage ?? v.slicer_bijlage_id, platen: v.platen.map((q, j) => (j === i ? { ...q, ...nieuw[0], naam: q.naam || nieuw[0].naam, printer_id: nieuw[0].printer_id || q.printer_id } : q)) }));
    if (x.platen.length > 1) setNr(0);
    setSlicer(false);
    melding(`Overgenomen uit het slicerbestand${x.platen.length > 1 ? ` (${x.platen.length} platen)` : ''}. Kijk het filament na en klik op "Profiel bewaren".`);
  }
  const b = plaatNaarBody(pl);
  const gram = b.materialen.reduce((s, m) => s + Number(m.gram || 0), 0);
  const meer = f.platen.length > 1;
  const filamenten = (artikelen || []).filter(a => a.type === 'filament');
  return (
    <>
      <p className="note" style={{ marginTop: 0 }}>Vul de printtijd en het gewicht van <b>één stuk</b> in (bv. uit Bambu Studio: tijd en gram van de plaat ÷ aantal stuks op de plaat). In een dossier kies je dan bij een printregel "Uit product" en vul je enkel het aantal in; Bijprinten maakt meteen één printopdracht per plaat.</p>
      {f.letters ? <LetterTabel f={f} setF={setF} printers={printers} filamenten={filamenten} groepen={groepen} /> : <>
      <div className="chips" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
        {meer && f.platen.map((q, j) => <button key={j} type="button" className={`btn${j === i ? ' primary' : ''}`} onClick={() => setNr(j)}>Plaat {j + 1}{q.naam ? ` · ${q.naam}` : ''}</button>)}
        <button type="button" className="linkish" onClick={() => { setF(x => ({ ...x, platen: [...x.platen, { ...leegPlaat, printer_id: pl.printer_id }] })); setNr(f.platen.length); }}>+ plaat (dit artikel bestaat uit meerdere platen)</button>
        {meer && <button type="button" className="linkish" onClick={() => { setF(x => ({ ...x, platen: x.platen.filter((_, j) => j !== i) })); setNr(Math.max(0, i - 1)); }}>plaat {i + 1} weghalen</button>}
      </div>
      {meer && <p className="sub" style={{ marginTop: 0 }}>{f.platen.length} platen vormen samen één stuk. In een dossier wordt elke plaat een eigen printregel (en printopdracht); de laatste plaat boekt het stuk in voorraad. Tijd en gram hieronder zijn die van plaat {i + 1}.</p>}
      <div className="fgrid">
        {meer && <div><label htmlFor="pp-naam">Naam van plaat {i + 1}</label><input id="pp-naam" className="inp" placeholder="bv. voet, dak…" value={pl.naam} onChange={zet('naam')} /></div>}
        <div><label htmlFor="pp-printer">Printer</label>
          <select id="pp-printer" className="inp" value={pl.printer_id} onChange={zet('printer_id')}>
            <option value="">— geen voorkeur —</option>
            {(printers || []).filter(p => p.actief).map(p => <option key={p.id} value={p.id}>{p.naam}</option>)}
          </select></div>
        <div><label htmlFor="pp-u">Printtijd per stuk</label>
          <span className="samen" style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}><input id="pp-u" className="inp num" inputMode="numeric" placeholder="0" aria-label="Uren per stuk" value={pl.tijd_u} onChange={zet('tijd_u')} /><span className="sub">u</span><input className="inp num" inputMode="decimal" placeholder="0" aria-label="Minuten per stuk" value={pl.tijd_m} onChange={zet('tijd_m')} /><span className="sub">min</span></span></div>
        <div><label htmlFor="pp-plaat">Stuks per plaat</label><input id="pp-plaat" className="inp num" inputMode="numeric" placeholder="bv. 8" value={pl.per_plaat} onChange={zet('per_plaat')} /></div>
        <div><label htmlFor="pp-voorb">Voorbereiding per plaat (min)</label><input id="pp-voorb" className="inp num" inputMode="decimal" placeholder="standaard" value={pl.voorbereiding_min} onChange={zet('voorbereiding_min')} /></div>
        <div><label htmlFor="pp-nab">Nabewerking per stuk (min)</label><input id="pp-nab" className="inp num" inputMode="decimal" placeholder="standaard" value={pl.nabewerking_min} onChange={zet('nabewerking_min')} /></div>
      </div>
      <div className="materialen" style={{ marginTop: 10 }}>
        <span className="lbl">Filament per stuk</span>
        {pl.materialen.map((m, k) => (
          <div className="materiaal" key={k} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <select className="inp" aria-label={`Filament ${k + 1}`} value={m.keuze} onChange={e => zetMat(k, { keuze: e.target.value })}>
              <option value="">Filament kiezen…</option>
              <optgroup label="Filament (merk · type · kleur)">{filamenten.map(a => <option key={`a${a.id}`} value={`a:${a.id}`}>{a.weergave}</option>)}</optgroup>
              <optgroup label="Enkel prijsgroep (kleur kies je per dossier)">{(groepen || []).map(g => <option key={`p${g.id}`} value={`p:${g.id}`}>{g.merk} {g.materiaal}</option>)}</optgroup>
            </select>
            <span className="unit"><input className="inp num" inputMode="decimal" aria-label={`Gram per stuk filament ${k + 1}`} placeholder="g/stuk" value={m.gram} onChange={e => zetMat(k, { gram: e.target.value })} /><span>g</span></span>
            {pl.materialen.length > 1 && <button type="button" className="btn ghost" aria-label="Kleur weghalen" onClick={() => zetPl({ materialen: pl.materialen.filter((_, j) => j !== k) })}><Icoon naam="kruis" maat={12} /></button>}
          </div>
        ))}
        <button type="button" className="linkish" onClick={() => zetPl({ materialen: [...pl.materialen, { keuze: '', gram: '' }] })}>+ kleur (multicolor)</button>
      </div>
      </>}
      {gewicht != null && <p className="sub">Gewicht volgens de webshop: {fmtAantal(gewicht)} g per stuk (zonder steunmateriaal en afval).</p>}
      {f.slicer_bijlage_id && <p className="sub">Slicerbestand: <a href={`${BASE}/bijlagen/bestand/${f.slicer_bijlage_id}`} title="Downloaden (openen in Bambu Studio)">{(bijlagen || []).find(x => x.id === f.slicer_bijlage_id)?.bestandsnaam || nieuwBestand || 'slicerbestand'}</a>{pl.slicer_plaat ? ` · plaat ${pl.slicer_plaat}` : ''}{vuil ? ' (wordt gekoppeld bij "Profiel bewaren")' : ''}</p>}
      {kost?.advies && <p className="sub">Adviesprijs volgens de rekenmotor: <b>{euro(kost.advies.stuk)}</b> voor 1 stuk{kost.advies.plaat_stuk != null ? <> · <b>{euro(kost.advies.plaat_stuk)}</b> per stuk bij een volle plaat ({kost.advies.per_plaat} stuks)</> : null}. Vergelijk met je verkoopprijs (webshop: aanpassen in Sanity).</p>}
      {kost?.profiel && <p className="sub">Geschatte kost per stuk: <b>{euro(kost.schatting.kost)}</b> (filament {euro(kost.schatting.filament)}, stroom {euro(kost.schatting.energie)}, machine {euro(kost.schatting.machine)}, BMCU {euro(kost.schatting.bmcu)}{kost.schatting.onderdelen ? `, onderdelen ${euro(kost.schatting.onderdelen)}` : ''}) + arbeid {euro(kost.schatting.arbeid)}{kost.schatting.onvolledig ? ` · ontbreekt: ${kost.schatting.ontbreekt.join(', ')}` : ''}{kost.gemeten ? ` · gemeten: ${euro(kost.gemeten.kost)} (${fmtAantal(kost.gemeten.stuks)} stuks)` : ''}</p>}
      {!f.letters && b.per_plaat && (b.tijd_min > 0 || gram > 0) && <p className="sub">Volle plaat: {b.per_plaat} stuks · {Math.floor(b.tijd_min * b.per_plaat / 60)} u {Math.round(b.tijd_min * b.per_plaat % 60)} min · {fmtAantal(Math.round(gram * b.per_plaat * 10) / 10)} g</p>}
      <div className="tabacties" style={{ marginTop: 12 }}>
        <button type="button" className="btn primary" disabled={bezig || !vuil} onClick={() => bewaar(naarBody(f))}>Profiel bewaren</button>
        <button type="button" className="btn" disabled={bezig} onClick={() => setSlicer(true)}>Uit slicerbestand…</button>
        {data.profiel && <button type="button" className="btn" disabled={bezig || vuil} onClick={onBijprinten}>Bijprinten…</button>}
        {data.profiel && <button type="button" className="btn ghost" disabled={bezig} onClick={wis}>Wissen</button>}
      </div>
      {slicer && <ProfielUitSlicer naam={naam} onOvernemen={uitSlicer} onSluit={() => setSlicer(false)} />}
    </>
  );
}

// 29-10: letterprofiel (bv. bubble letters): elke plaat is één letter of
// teken. Printer, voorbereiding, nabewerking en filament (voor de kost)
// gelden voor alle letters; tijd en gram per letter komen uit het 3mf.
function LetterTabel({ f, setF, printers, filamenten, groepen }) {
  const p0 = f.platen[0] || leegPlaat;
  const zetAlle = w => setF(x => ({ ...x, platen: x.platen.map(q => ({ ...q, ...w })) }));
  const zetRij = (j, w) => setF(x => ({ ...x, platen: x.platen.map((q, k) => (k === j ? { ...q, ...w } : q)) }));
  const min = q => Number(nr(q.tijd_u) ?? 0) * 60 + Number(nr(q.tijd_m) ?? 0);
  const g = q => q.materialen.reduce((t, m) => t + Number(nr(m.gram) ?? 0), 0);
  const fil = p0.materialen?.[0]?.keuze || '';
  const n = f.platen.length || 1;
  const dubbel = new Set(f.platen.map(q => q.letter.trim().toLocaleUpperCase('nl-BE')).filter((l, i, a) => l && a.indexOf(l) !== i));
  return (
    <>
      <p className="sub" style={{ marginTop: 0 }}><b>Letterprofiel:</b> {f.platen.length} letters, gemiddeld {Math.round(f.platen.reduce((t, q) => t + min(q), 0) / n)} min en {fmtAantal(Math.round(f.platen.reduce((t, q) => t + g(q), 0) / n * 10) / 10)} g per letter. Een stuk = één letter; de kleur kies je per bestelling (dossier → "Letters toevoegen").</p>
      <div className="fgrid">
        <div><label htmlFor="lp-printer">Printer</label>
          <select id="lp-printer" className="inp" value={p0.printer_id} onChange={e => zetAlle({ printer_id: e.target.value })}>
            <option value="">— geen voorkeur —</option>
            {(printers || []).filter(p => p.actief).map(p => <option key={p.id} value={p.id}>{p.naam}</option>)}
          </select></div>
        <div><label htmlFor="lp-fil">Filament (voor de kost)</label>
          <select id="lp-fil" className="inp" value={fil} onChange={e => setF(x => ({ ...x, platen: x.platen.map(q => ({ ...q, materialen: [{ keuze: e.target.value, gram: alsInvoer(Math.round(g(q) * 100) / 100) }] })) }))}>
            <option value="">Filament kiezen…</option>
            <optgroup label="Enkel prijsgroep (kleur per bestelling)">{(groepen || []).map(x => <option key={`p${x.id}`} value={`p:${x.id}`}>{x.merk} {x.materiaal}</option>)}</optgroup>
            <optgroup label="Filament (merk · type · kleur)">{(filamenten || []).map(a => <option key={`a${a.id}`} value={`a:${a.id}`}>{a.weergave}</option>)}</optgroup>
          </select></div>
        <div><label htmlFor="lp-voorb">Voorbereiding per plaat (min)</label><input id="lp-voorb" className="inp num" inputMode="decimal" placeholder="standaard" value={p0.voorbereiding_min} onChange={e => zetAlle({ voorbereiding_min: e.target.value })} /></div>
        <div><label htmlFor="lp-nab">Nabewerking per letter (min)</label><input id="lp-nab" className="inp num" inputMode="decimal" placeholder="standaard" value={p0.nabewerking_min} onChange={e => zetAlle({ nabewerking_min: e.target.value })} /></div>
      </div>
      <div className="tabelvak" style={{ maxHeight: 360, overflowY: 'auto', marginTop: 10 }}>
        <table className="mini">
          <thead><tr><th>Letter</th><th>Plaat</th><th className="r">Tijd</th><th className="r">Gram</th><th /></tr></thead>
          <tbody>{f.platen.map((q, j) => (
            <tr key={j}>
              <td><input className={`inp${!q.letter.trim() || dubbel.has(q.letter.trim().toLocaleUpperCase('nl-BE')) ? ' let-op' : ''}`} style={{ width: 56 }} aria-label={`Letter van plaat ${q.slicer_plaat || j + 1}`} value={q.letter} onChange={e => zetRij(j, { letter: e.target.value })} /></td>
              <td className="sub">{q.slicer_plaat ? `plaat ${q.slicer_plaat}` : ''}{q.naam ? ` · ${q.naam}` : ''}</td>
              <td className="r num">{Math.round(min(q))} min</td>
              <td className="r num">{fmtAantal(Math.round(g(q) * 10) / 10)} g</td>
              <td><button type="button" className="btn klein ghost" aria-label={`Letter ${q.letter || j + 1} weghalen`} onClick={() => setF(x => ({ ...x, platen: x.platen.filter((_, k) => k !== j) }))}>×</button></td>
            </tr>))}</tbody>
        </table>
      </div>
      {dubbel.size > 0 && <p className="regelfout">Dubbele letters: {[...dubbel].join(' ')}. Elke letter mag maar één keer.</p>}
      {f.platen.some(q => !q.letter.trim()) && <p className="regelfout">Vul bij elke plaat de letter in.</p>}
    </>
  );
}
