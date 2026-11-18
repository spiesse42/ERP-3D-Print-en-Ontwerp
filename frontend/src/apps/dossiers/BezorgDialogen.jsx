import { useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { Dialoog, useOmgeving } from '../../schil/Omgeving.jsx';
import Icoon from '../../schil/Icoon.jsx';

// 18-11: digitaal ontwerp (dossier met enkel ontwerp/aanpassing). Afrekenen
// kan pas als het bestand bezorgd is: mailen vanuit het ERP, of met de hand
// aanduiden (WeTransfer, WhatsApp, USB-stick…).
const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' });
const MAX = 18 * 1024 * 1024;
const mb = n => `${(n / 1048576).toFixed(1).replace('.', ',')} MB`;
// modelbestanden staan standaard aangevinkt (geen foto's of PDF's)
const isModel = b => /^(model\/|application\/(zip|vnd\.autodesk)|text\/x-gcode)/.test(b.mimetype || '');

export function BezorgdDialoog({ onSluit, onBevestig }) {
  const [f, setF] = useState({ datum: vandaag(), hoe: '' });
  return (
    <Dialoog titel="Bestand bezorgd" onSluit={onSluit}
      voet={<><button type="button" className="btn" onClick={onSluit}>Annuleren</button><button type="button" className="btn primary" onClick={() => onBevestig(f)}>Bezorgd</button></>}>
      <p className="note" style={{ marginTop: 0 }}>Het bestand is al bij de klant (niet via het ERP gemaild). Daarna kan je afrekenen.</p>
      <div className="fgrid">
        <div><label htmlFor="bz-datum">Bezorgd op</label><input id="bz-datum" type="date" className="inp" max={vandaag()} value={f.datum} onChange={e => setF(x => ({ ...x, datum: e.target.value }))} /></div>
        <div><label htmlFor="bz-hoe">Hoe (optioneel)</label><input id="bz-hoe" className="inp" maxLength={200} placeholder="bv. via WeTransfer" value={f.hoe} onChange={e => setF(x => ({ ...x, hoe: e.target.value }))} autoFocus /></div>
      </div>
    </Dialoog>
  );
}

export function BestandMailDialoog({ dossier: d, bedrijf, onSluit, onVerstuur }) {
  const { melding } = useOmgeving();
  const { data, herlaad } = useData(`/bijlagen/dossier/${d.id}`);
  const lijst = data || [];
  const [gekozen, setGekozen] = useState(null);   // null = standaard (modelbestanden)
  const keuze = gekozen ?? lijst.filter(isModel).map(b => b.id);
  const naam = d.klant_gegevens?.voornaam || (d.klant_gegevens?.type === 'zakelijk' ? '' : d.klant_gegevens?.naam) || '';
  const [f, setF] = useState({ aan: d.klant_gegevens?.email || '', onderwerp: `Je ontwerp: ${d.titel || d.nummer}`,
    tekst: `Beste${naam ? ` ${naam}` : ''},\n\nIn bijlage vind je het digitale bestand van "${d.titel || d.nummer}".\n\nMet vriendelijke groeten,\n${bedrijf || ''}`.trim() });
  const [bezig, setBezig] = useState(false);
  const invoer = useRef(null);
  const totaal = lijst.filter(b => keuze.includes(b.id)).reduce((n, b) => n + (b.grootte || 0), 0);
  const wissel = id => setGekozen(keuze.includes(id) ? keuze.filter(x => x !== id) : [...keuze, id]);
  async function laadOp(bestand) {
    if (!bestand) return;
    setBezig(true);
    try {
      const fd = new FormData(); fd.append('bestand', bestand);
      const b = await api.upload(`/bijlagen/dossier/${d.id}`, fd);
      await herlaad(); setGekozen([...keuze, b.id]);
    } catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); if (invoer.current) invoer.current.value = ''; }
  }
  async function ok() { setBezig(true); try { await onVerstuur({ ...f, bijlagen: keuze }); } finally { setBezig(false); } }
  const teGroot = totaal > MAX;
  return (
    <Dialoog titel="Bestand mailen" onSluit={onSluit} breed
      voet={<>
        <button type="button" className="btn" onClick={onSluit}>Annuleren</button>
        <button type="button" className="btn primary" disabled={bezig || !f.aan.trim() || !keuze.length || teGroot} onClick={ok}>{bezig ? 'Bezig…' : 'Versturen'}</button>
      </>}>
      <div className="fgrid">
        <div style={{ gridColumn: '1/-1' }}><label htmlFor="bm-aan">Aan</label><input id="bm-aan" type="email" className="inp" value={f.aan} onChange={e => setF(x => ({ ...x, aan: e.target.value }))} /></div>
        <div style={{ gridColumn: '1/-1' }}><label htmlFor="bm-ond">Onderwerp</label><input id="bm-ond" className="inp" value={f.onderwerp} onChange={e => setF(x => ({ ...x, onderwerp: e.target.value }))} /></div>
        <div style={{ gridColumn: '1/-1' }}><label htmlFor="bm-tekst">Bericht</label><textarea id="bm-tekst" className="inp" rows={6} value={f.tekst} onChange={e => setF(x => ({ ...x, tekst: e.target.value }))} /></div>
      </div>
      <div className="lbl" style={{ marginTop: 10 }}>Bestanden om mee te sturen</div>
      {lijst.length === 0 && <p className="sub" style={{ margin: '2px 0 6px' }}>Nog geen bestanden in dit dossier.</p>}
      <div className="vinkjes" style={{ flexDirection: 'column', gap: 2, marginTop: 2 }}>
        {lijst.map(b => (
          <label key={b.id} className="vinkje"><input type="checkbox" checked={keuze.includes(b.id)} onChange={() => wissel(b.id)} />
            {b.bestandsnaam} <span className="sub">{mb(b.grootte || 0)}</span></label>
        ))}
      </div>
      <label className="btn ghost" htmlFor="bm-bestand" style={{ marginTop: 6 }}><Icoon naam="plus" maat={14} /> Bestand toevoegen</label>
      <input ref={invoer} id="bm-bestand" type="file" className="sr-only" accept=".3mf,.stl,.step,.stp,.obj,.f3d,.zip,.gcode,application/pdf,image/*" disabled={bezig}
        onChange={e => laadOp(e.target.files?.[0])} />
      <p className={`note${teGroot ? ' fout' : ''}`} style={{ marginBottom: 0 }}>
        {teGroot ? `Samen ${mb(totaal)}: te groot om te mailen (max. 18 MB). Stuur het via WeTransfer en kies dan "Bestand bezorgd".`
          : `${keuze.length} bestand${keuze.length === 1 ? '' : 'en'} (${mb(totaal)}). Gelukt = het bestand staat als bezorgd en je kan afrekenen.`}
      </p>
    </Dialoog>
  );
}
