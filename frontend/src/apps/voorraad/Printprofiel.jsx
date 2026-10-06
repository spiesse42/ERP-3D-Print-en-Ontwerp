import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import Icoon from '../../schil/Icoon.jsx';
import { aantal as fmtAantal, euro } from '../../lib/formaat.js';

// Printprofiel van een vast product (06-10): tijd en gram PER STUK, stuks
// per plaat, printer, voorbereiding per plaat, nabewerking per stuk. Wordt
// gebruikt door "Uit product" in de regels van een dossier en door
// Bijprinten (één printopdracht per plaat).
const alsInvoer = v => (v == null ? '' : String(v).replace('.', ','));
const nr = v => (String(v ?? '').trim() === '' ? null : String(v).trim().replace(',', '.'));
const leeg = { printer_id: '', tijd_u: '', tijd_m: '', per_plaat: '', voorbereiding_min: '', nabewerking_min: '', materialen: [{ keuze: '', gram: '' }] };
function naarForm(p) {
  if (!p) return leeg;
  const t = Number(p.tijd_min) || 0, u = Math.floor(t / 60), m = Math.round((t - u * 60) * 100) / 100;
  return { printer_id: p.printer_id ? String(p.printer_id) : '', tijd_u: u ? String(u) : '', tijd_m: m ? alsInvoer(m) : '', per_plaat: alsInvoer(p.per_plaat),
    voorbereiding_min: alsInvoer(p.voorbereiding_min), nabewerking_min: alsInvoer(p.nabewerking_min),
    materialen: p.materialen?.length ? p.materialen.map(x => ({ keuze: x.artikel_id ? `a:${x.artikel_id}` : `p:${x.filament_type_id}`, gram: alsInvoer(x.gram) })) : leeg.materialen };
}
function naarBody(f) {
  return { printer_id: f.printer_id || null, tijd_min: Number(nr(f.tijd_u) ?? 0) * 60 + Number(nr(f.tijd_m) ?? 0), per_plaat: nr(f.per_plaat),
    voorbereiding_min: nr(f.voorbereiding_min), nabewerking_min: nr(f.nabewerking_min),
    materialen: f.materialen.filter(m => m.keuze).map(m => { const [s, id] = m.keuze.split(':'); return { [s === 'a' ? 'artikel_id' : 'filament_type_id']: Number(id), gram: nr(m.gram) ?? 0 }; }) };
}

export default function Printprofiel({ id, gewicht = null, onBijprinten }) {
  const { melding, bevestig } = useOmgeving();
  const { data, herlaad } = useData(`/productie/printprofiel/${id}`);
  const { data: printers } = useData('/printers');
  const { data: artikelen } = useData('/voorraad/artikelen');
  const { data: groepen } = useData('/filament/types');
  const { data: kost, herlaad: herlaadKost } = useData(`/producten/${id}/kost`);
  const [f, setF] = useState(leeg);
  const [bezig, setBezig] = useState(false);
  useEffect(() => { if (data) setF(naarForm(data.profiel)); }, [data]);
  const zet = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const zetMat = (k, w) => setF(x => ({ ...x, materialen: x.materialen.map((m, j) => (j === k ? { ...m, ...w } : m)) }));
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
  const b = naarBody(f);
  const gram = b.materialen.reduce((s, m) => s + Number(m.gram || 0), 0);
  const filamenten = (artikelen || []).filter(a => a.type === 'filament');
  return (
    <>
      <p className="note" style={{ marginTop: 0 }}>Vul de printtijd en het gewicht van <b>één stuk</b> in (bv. uit Bambu Studio: tijd en gram van de plaat ÷ aantal stuks op de plaat). In een dossier kies je dan bij een printregel "Uit product" en vul je enkel het aantal in; Bijprinten maakt meteen één printopdracht per plaat.</p>
      <div className="fgrid">
        <div><label htmlFor="pp-printer">Printer</label>
          <select id="pp-printer" className="inp" value={f.printer_id} onChange={zet('printer_id')}>
            <option value="">— geen voorkeur —</option>
            {(printers || []).filter(p => p.actief).map(p => <option key={p.id} value={p.id}>{p.naam}</option>)}
          </select></div>
        <div><label htmlFor="pp-u">Printtijd per stuk</label>
          <span className="samen" style={{ display: 'flex', gap: 6 }}><input id="pp-u" className="inp num" inputMode="numeric" placeholder="u" aria-label="Uren per stuk" value={f.tijd_u} onChange={zet('tijd_u')} /><input className="inp num" inputMode="decimal" placeholder="min" aria-label="Minuten per stuk" value={f.tijd_m} onChange={zet('tijd_m')} /></span></div>
        <div><label htmlFor="pp-plaat">Stuks per plaat</label><input id="pp-plaat" className="inp num" inputMode="numeric" placeholder="bv. 8" value={f.per_plaat} onChange={zet('per_plaat')} /></div>
        <div><label htmlFor="pp-voorb">Voorbereiding per plaat (min)</label><input id="pp-voorb" className="inp num" inputMode="decimal" placeholder="standaard" value={f.voorbereiding_min} onChange={zet('voorbereiding_min')} /></div>
        <div><label htmlFor="pp-nab">Nabewerking per stuk (min)</label><input id="pp-nab" className="inp num" inputMode="decimal" placeholder="standaard" value={f.nabewerking_min} onChange={zet('nabewerking_min')} /></div>
      </div>
      <div className="materialen" style={{ marginTop: 10 }}>
        <span className="lbl">Filament per stuk</span>
        {f.materialen.map((m, k) => (
          <div className="materiaal" key={k} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <select className="inp" aria-label={`Filament ${k + 1}`} value={m.keuze} onChange={e => zetMat(k, { keuze: e.target.value })}>
              <option value="">Filament kiezen…</option>
              <optgroup label="Filament (merk · type · kleur)">{filamenten.map(a => <option key={`a${a.id}`} value={`a:${a.id}`}>{a.weergave}</option>)}</optgroup>
              <optgroup label="Enkel prijsgroep (kleur kies je per dossier)">{(groepen || []).map(g => <option key={`p${g.id}`} value={`p:${g.id}`}>{g.merk} {g.materiaal}</option>)}</optgroup>
            </select>
            <span className="unit"><input className="inp num" inputMode="decimal" aria-label={`Gram per stuk filament ${k + 1}`} placeholder="g/stuk" value={m.gram} onChange={e => zetMat(k, { gram: e.target.value })} /><span>g</span></span>
            {f.materialen.length > 1 && <button type="button" className="btn ghost" aria-label="Kleur weghalen" onClick={() => setF(x => ({ ...x, materialen: x.materialen.filter((_, j) => j !== k) }))}><Icoon naam="kruis" maat={12} /></button>}
          </div>
        ))}
        <button type="button" className="linkish" onClick={() => setF(x => ({ ...x, materialen: [...x.materialen, { keuze: '', gram: '' }] }))}>+ kleur (multicolor)</button>
      </div>
      {gewicht != null && <p className="sub">Gewicht volgens de webshop: {fmtAantal(gewicht)} g per stuk (zonder steunmateriaal en afval).</p>}
      {kost?.profiel && <p className="sub">Geschatte kost per stuk: <b>{euro(kost.schatting.kost)}</b> (filament {euro(kost.schatting.filament)}, stroom {euro(kost.schatting.energie)}, machine {euro(kost.schatting.machine)}, BMCU {euro(kost.schatting.bmcu)}{kost.schatting.onderdelen ? `, onderdelen ${euro(kost.schatting.onderdelen)}` : ''}) + arbeid {euro(kost.schatting.arbeid)}{kost.schatting.onvolledig ? ` · ontbreekt: ${kost.schatting.ontbreekt.join(', ')}` : ''}{kost.gemeten ? ` · gemeten: ${euro(kost.gemeten.kost)} (${fmtAantal(kost.gemeten.stuks)} stuks)` : ''}</p>}
      {b.per_plaat && (b.tijd_min > 0 || gram > 0) && <p className="sub">Volle plaat: {b.per_plaat} stuks · {Math.floor(b.tijd_min * b.per_plaat / 60)} u {Math.round(b.tijd_min * b.per_plaat % 60)} min · {fmtAantal(Math.round(gram * b.per_plaat * 10) / 10)} g</p>}
      <div className="tabacties" style={{ marginTop: 12 }}>
        <button type="button" className="btn primary" disabled={bezig || !vuil} onClick={() => bewaar(b)}>Profiel bewaren</button>
        {data.profiel && <button type="button" className="btn" disabled={bezig || vuil} onClick={onBijprinten}>Bijprinten…</button>}
        {data.profiel && <button type="button" className="btn ghost" disabled={bezig} onClick={wis}>Wissen</button>}
      </div>
    </>
  );
}
