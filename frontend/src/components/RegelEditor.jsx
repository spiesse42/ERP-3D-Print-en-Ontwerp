// Regels bewerken + live berekening (stap 4). Herbruikbaar: Proefberekening
// nu, dossiers/offertes/werkbonnen in stap 5. De berekening zelf gebeurt
// ALTIJD in de backend (POST /api/bereken): één rekenmotor, geen kopie hier.
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import Icoon from '../schil/Icoon.jsx';
import NieuwArtikelDialoog from './NieuwArtikelDialoog.jsx';
import { euro, naarInvoer, aantal as fmtAantal } from '../lib/formaat.js';

export const TYPES = [['printen', 'Printen'], ['ontwerp', 'Ontwerp'], ['aanpassing', 'Aanpassing'], ['artikel', 'Artikel / dienst'], ['extra', 'Extra kost']];
let teller = 0;
export const nieuweRegel = (type = 'printen') => ({
  sleutel: `r${++teller}`, type, omschrijving: '',
  printer_id: '', tijd_u: '', tijd_m: '', aantal: '1', voorbereiding_min: '', nabewerking_min: '', materialen: [{ keuze: '', gram: '' }],
  minuten: '', tarief: '', artikel_id: '', bedrag: '', per_stuk: false, handmatig_bedrag: '',
});

const nr = v => (String(v ?? '').trim() === '' ? null : String(v).replace(',', '.'));
// Formulier → regel voor de API (id's; de backend zoekt prijzen op).
export function naarApi(r) {
  const basis = { ...(r.id ? { id: r.id } : {}), type: r.type, omschrijving: r.omschrijving, handmatig_bedrag: nr(r.handmatig_bedrag) };
  if (r.type === 'printen') {
    const u = Number(nr(r.tijd_u) ?? 0), m = Number(nr(r.tijd_m) ?? 0);
    return { ...basis, printer_id: r.printer_id || null, aantal: nr(r.aantal) ?? 1, tijd_min: u * 60 + m, artikel_id: r.artikel_id || null,
      voorbereiding_min: nr(r.voorbereiding_min), nabewerking_min: nr(r.nabewerking_min),
      materialen: r.materialen.filter(x => x.keuze).map(x => {
        const [soort, id] = x.keuze.split(':');
        return { [soort === 'a' ? 'artikel_id' : 'filament_type_id']: Number(id), gram: nr(x.gram) ?? 0 };
      }) };
  }
  if (r.type === 'ontwerp' || r.type === 'aanpassing') return { ...basis, minuten: nr(r.minuten) ?? 0, tarief: nr(r.tarief) };
  if (r.type === 'artikel') return { ...basis, artikel_id: r.artikel_id || null, aantal: nr(r.aantal) ?? 1 };
  if (r.type === 'extra') return { ...basis, bedrag: nr(r.bedrag) ?? 0, per_stuk: r.per_stuk, aantal: nr(r.aantal) ?? 1 };
  return basis;
}

// Bewaarde regel (API-vorm, bv. uit een dossier) → formulier van de editor.
const alsInvoer = v => (v == null ? '' : String(v).replace('.', ','));
export function vanApi(r) {
  const f = { ...nieuweRegel(r.type), id: r.id ?? undefined, omschrijving: r.omschrijving || '', handmatig_bedrag: alsInvoer(r.handmatig_bedrag) };
  if (r.id) f.sleutel = `r${r.id}`;
  if (r.type === 'printen') {
    const t = Number(r.tijd_min) || 0;
    const u = Math.floor(t / 60), m = Math.round((t - u * 60) * 100) / 100;
    Object.assign(f, { printer_id: alsInvoer(r.printer_id), artikel_id: alsInvoer(r.artikel_id), aantal: alsInvoer(r.aantal ?? 1), tijd_u: u ? String(u) : '', tijd_m: m ? alsInvoer(m) : '',
      voorbereiding_min: alsInvoer(r.voorbereiding_min), nabewerking_min: alsInvoer(r.nabewerking_min),
      materialen: (r.materialen || []).length
        ? r.materialen.map(x => ({ keuze: x.artikel_id ? `a:${x.artikel_id}` : `p:${x.filament_type_id}`, gram: alsInvoer(x.gram) }))
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
export function useBerekening(regels, stand = 'schatting') {
  const [uitkomst, setUitkomst] = useState(null);
  const [fout, setFout] = useState(null);
  const volg = useRef(0);
  const sleutel = JSON.stringify(regels.map(naarApi));
  useEffect(() => {
    const mijn = ++volg.current;
    const klok = setTimeout(async () => {
      try {
        const b = await api.post('/bereken', { regels: JSON.parse(sleutel), stand });
        if (mijn === volg.current) { setUitkomst(b); setFout(null); }
      } catch (e) { if (mijn === volg.current) setFout(e.message); }
    }, 300);
    return () => clearTimeout(klok);
  }, [sleutel, stand]);
  return { uitkomst, fout };
}

function Detail({ b, type }) {
  if (!b) return null;
  if (b.fout) return <div className="regelfout"><Icoon naam="let" maat={14} /> {b.fout}</div>;
  const d = b.detail || {};
  const delen = type === 'printen'
    ? [['materiaal', d.materiaal], ['energie', d.energie], ['machine', d.machine], ['arbeid', d.arbeid], ['BMCU/AMS', d.bmcu]]
    : [];
  return (
    <div className="regeldetail sub">
      {delen.map(([l, w]) => <span key={l}>{l} {euro(Math.round(w * 100) / 100)}</span>)}
      {type === 'printen' && <span>{fmtAantal(Math.round(d.uren * 100) / 100)} u{d.energie_bron === 'gemeten' ? ' · energie gemeten' : ''}</span>}
      {b.handmatig && <span className="badge b-info">handmatig (berekend {euro(Math.round(b.natuurlijk_eindbedrag * 100) / 100)})</span>}
      {b.per_stuk != null && <span>per stuk {euro(b.per_stuk)}</span>}
    </div>
  );
}

const NIEUW = '__nieuw';

// herkomst: voor de historiek van een nieuw artikel ('proefberekening', later 'dossier').
// onArtikelGemaakt: laat de ouder de artikellijst herladen (await), zodat het nieuwe artikel in de keuzelijst staat.
// alleenLezen: bv. een afgerekend dossier — alles zichtbaar, niets te wijzigen.
// eindproducten: enkel bij een dossier "Eigen product" — zelf geprinte
// artikelen waar de goede stuks van een printregel naartoe gaan (stap 6c).
export default function RegelEditor({ regels, onWijzig, uitkomst, printers, filamenten, prijsgroepen, artikelen, tarieven, herkomst, onArtikelGemaakt, alleenLezen = false, eindproducten = null }) {
  const actueel = useRef(regels);
  actueel.current = regels;
  const [nieuwVoor, setNieuwVoor] = useState(null);   // sleutel van de regel die een nieuw artikel krijgt
  const zet = (i, w) => onWijzig(regels.map((r, j) => (j === i ? { ...r, ...w } : r)));
  async function artikelGemaakt(id) {
    if (onArtikelGemaakt) await onArtikelGemaakt(id);
    // de regel opzoeken op sleutel: intussen kan de lijst veranderd zijn
    onWijzig(actueel.current.map(r => (r.sleutel === nieuwVoor ? { ...r, artikel_id: String(id) } : r)));
    setNieuwVoor(null);
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
              <b className="num eind">{b && !b.fout ? euro(b.eindbedrag) : '—'}</b>
              <button type="button" className="btn ghost" aria-label={`Regel ${i + 1} weghalen`} onClick={() => onWijzig(regels.filter((_, j) => j !== i))}><Icoon naam="kruis" maat={14} /></button>
            </div>
            <div className="regel-velden">
              {r.type === 'printen' && <>
                <label>Printer<select className="inp" value={r.printer_id} onChange={e => zet(i, { printer_id: e.target.value })}>
                  <option value="">Kies…</option>
                  {(printers || []).map(p => <option key={p.id} value={p.id}>{p.naam}{p.machine_per_uur == null ? ' (tarief ontbreekt)' : ''}</option>)}
                </select></label>
                <label>Printtijd<span className="samen"><input className="inp num" inputMode="numeric" aria-label="Uren" placeholder="u" value={r.tijd_u} onChange={e => zet(i, { tijd_u: e.target.value })} /><input className="inp num" inputMode="numeric" aria-label="Minuten" placeholder="min" value={r.tijd_m} onChange={e => zet(i, { tijd_m: e.target.value })} /></span></label>
                <label>Stuks op de print<input className="inp num" inputMode="numeric" value={r.aantal} onChange={e => zet(i, { aantal: e.target.value })} /></label>
                <label>Voorbereiding (min)<input className="inp num" inputMode="numeric" placeholder={naarInvoer(t.voorbereiding_min)} value={r.voorbereiding_min} onChange={e => zet(i, { voorbereiding_min: e.target.value })} /></label>
                <label>Nabewerking (min)<input className="inp num" inputMode="numeric" placeholder={naarInvoer(t.nabewerking_min)} value={r.nabewerking_min} onChange={e => zet(i, { nabewerking_min: e.target.value })} /></label>
                {eindproducten && <label>Naar voorraad als<select className="inp" value={r.artikel_id} onChange={e => zet(i, { artikel_id: e.target.value })}>
                  <option value="">— niet naar voorraad —</option>
                  {eindproducten.map(a => <option key={a.id} value={a.id}>{a.weergave}</option>)}
                </select></label>}
                <div className="materialen">
                  {r.materialen.map((m, k) => (
                    <div className="materiaal" key={k}>
                      <select className="inp" aria-label={`Filament ${k + 1}`} value={m.keuze} onChange={e => zetMat(i, k, { keuze: e.target.value })}>
                        <option value="">Filament kiezen…</option>
                        <optgroup label="Filament (merk · type · kleur)">{(filamenten || []).map(f => <option key={`a${f.id}`} value={`a:${f.id}`}>{f.weergave}</option>)}</optgroup>
                        <optgroup label="Enkel prijsgroep (merk · type)">{(prijsgroepen || []).map(g => <option key={`p${g.id}`} value={`p:${g.id}`}>{g.merk} {g.materiaal}</option>)}</optgroup>
                      </select>
                      <span className="unit"><input className="inp num" inputMode="decimal" aria-label={`Gewicht filament ${k + 1}`} placeholder="gram" value={m.gram} onChange={e => zetMat(i, k, { gram: e.target.value })} /><span>g</span></span>
                      {r.materialen.length > 1 && <button type="button" className="btn ghost" aria-label="Kleur weghalen" onClick={() => zet(i, { materialen: r.materialen.filter((_, j) => j !== k) })}><Icoon naam="kruis" maat={12} /></button>}
                    </div>
                  ))}
                  <button type="button" className="linkish" onClick={() => zet(i, { materialen: [...r.materialen, { keuze: '', gram: '' }] })}>+ kleur (multicolor)</button>
                </div>
              </>}
              {(r.type === 'ontwerp' || r.type === 'aanpassing') && <>
                <label>Minuten<input className="inp num" inputMode="numeric" value={r.minuten} onChange={e => zet(i, { minuten: e.target.value })} /></label>
                <label>Tarief (€/u)<input className="inp num" inputMode="decimal" placeholder={naarInvoer(r.type === 'ontwerp' ? t.ontwerp_tarief : t.nabewerking_tarief)} value={r.tarief} onChange={e => zet(i, { tarief: e.target.value })} /></label>
              </>}
              {r.type === 'artikel' && <>
                <label className="breed">Artikel / dienst<select className="inp" value={r.artikel_id} onChange={e => (e.target.value === NIEUW ? setNieuwVoor(r.sleutel) : zet(i, { artikel_id: e.target.value }))}>
                  <option value="">Kies…</option>
                  {(artikelen || []).map(a => <option key={a.id} value={a.id}>{a.weergave} · {euro(a.verkoopprijs)}{a.vaste_prijs ? ' (vaste prijs)' : ''}</option>)}
                  <option value={NIEUW}>+ Nieuw artikel of dienst…</option>
                </select></label>
                <label>Aantal<input className="inp num" inputMode="decimal" value={r.aantal} onChange={e => zet(i, { aantal: e.target.value })} /></label>
              </>}
              {r.type === 'extra' && <>
                <label>Bedrag (€)<input className="inp num" inputMode="decimal" value={r.bedrag} onChange={e => zet(i, { bedrag: e.target.value })} /></label>
                <label className="vinkje"><input type="checkbox" checked={r.per_stuk} onChange={e => zet(i, { per_stuk: e.target.checked })} /> per stuk</label>
                {r.per_stuk && <label>Aantal<input className="inp num" inputMode="numeric" value={r.aantal} onChange={e => zet(i, { aantal: e.target.value })} /></label>}
              </>}
              <label>Eindbedrag aanpassen<input className="inp num" inputMode="decimal" placeholder="berekend" value={r.handmatig_bedrag} onChange={e => zet(i, { handmatig_bedrag: e.target.value })} /></label>
            </div>
            <Detail b={b} type={r.type} />
          </div>
        );
      })}
      {nieuwVoor && <NieuwArtikelDialoog herkomst={herkomst} onSluit={() => setNieuwVoor(null)} onGemaakt={artikelGemaakt} />}
    </fieldset>
  );
}

export function Totalen({ uitkomst }) {
  if (!uitkomst) return null;
  const u = uitkomst;
  return (
    <div className="totalen">
      <div><span>Totale printtijd</span><span className="num">{fmtAantal(Math.round(u.totale_tijd_u * 100) / 100)} u</span></div>
      <div><span>Marge (klein/groot volgens printtijd)</span><span className="num">{fmtAantal(u.marge_pct)} %</span></div>
      <div><span>Kost waar marge op komt</span><span className="num">{euro(Math.round(u.kost_met_marge * 100) / 100)}</span></div>
      <div><span>Zonder marge (materiaal, artikelen, handmatig)</span><span className="num">{euro(Math.round(u.zonder_marge * 100) / 100)}</span></div>
      {u.vast > 0 && <div><span>Vaste prijs (buiten btw-grondslag)</span><span className="num">{euro(Math.round(u.vast * 100) / 100)}</span></div>}
      <div><span>Btw-grondslag</span><span className="num">{euro(u.btw_grondslag)}</span></div>
      <div className="groot"><span>Totaal</span><span className="num">{euro(u.totaal)}</span></div>
      {!u.volledig && <div className="regelfout">Niet volledig: {u.fouten.length} regel(s) kunnen niet berekend worden (zie hierboven).</div>}
    </div>
  );
}
