import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';

// Nieuwe mail, beantwoorden of doorsturen (30-09). Adressen: vrij in te
// typen, met voorstellen uit de klanten en leveranciers. Bijlagen: eigen
// bestanden en (bij doorsturen) die van het oorspronkelijke bericht.
// Gekoppeld aan een dossier of klant: de mail komt in de historiek.
const grootte = n => (n > 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);

export default function Opstellen({ start, onSluit, onVerstuurd }) {
  const { melding, bevestig } = useOmgeving();
  const [f, setF] = useState({ aan: start.aan || '', cc: start.cc || '', bcc: '', onderwerp: start.onderwerp || '', tekst: start.tekst || '' });
  const [metCc, setMetCc] = useState(!!start.cc);
  const [door, setDoor] = useState(new Set((start.bijlagen || []).map(a => a.index)));
  const [bestanden, setBestanden] = useState([]);
  const [adressen, setAdressen] = useState([]);
  const [koppel, setKoppel] = useState(start.entiteit && start.entiteit_id ? `${start.entiteit}:${start.entiteit_id}` : '');
  const [bezig, setBezig] = useState(false);
  const tekstRef = useRef(null);
  const zet = (k, v) => setF(x => ({ ...x, [k]: v }));
  useEffect(() => {
    Promise.all([api.get('/klanten').catch(() => []), api.get('/leveranciers').catch(() => [])]).then(([k, l]) => setAdressen([
      ...k.filter(x => x.email).map(x => ({ adres: x.email, naam: x.type === 'zakelijk' && x.bedrijfsnaam ? x.bedrijfsnaam : [x.voornaam, x.naam].filter(Boolean).join(' ') })),
      ...l.filter(x => x.email).map(x => ({ adres: x.email, naam: x.naam })),
    ]));
  }, []);
  // cursor bovenaan bij beantwoorden (boven de aanhaling)
  useEffect(() => { if (start.soort !== 'nieuw' && tekstRef.current) { tekstRef.current.focus(); tekstRef.current.setSelectionRange(0, 0); tekstRef.current.scrollTop = 0; } }, [start.soort]);
  const gewijzigd = f.aan !== (start.aan || '') || f.onderwerp !== (start.onderwerp || '') || f.tekst !== (start.tekst || '') || bestanden.length > 0;
  async function sluit() {
    if (gewijzigd && !await bevestig({ titel: 'Mail niet versturen?', tekst: 'Je mail is nog niet verstuurd. Weggooien, of bewaar ze eerst als concept.', bevestigLabel: 'Weggooien', annuleerLabel: 'Terug', gevaarlijk: true })) return;
    onSluit();
  }
  function formulier() {
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => fd.append(k, v));
    if (start.antwoord_map && start.antwoord_uid) { fd.append('antwoord_map', start.antwoord_map); fd.append('antwoord_uid', String(start.antwoord_uid)); fd.append('soort', start.soort); }
    if (start.soort === 'doorsturen') fd.append('doorsturen_bijlagen', JSON.stringify([...door]));
    const [entiteit, id] = koppel.split(':');
    if (entiteit && id) { fd.append('entiteit', entiteit); fd.append('entiteit_id', id); }
    bestanden.forEach(b => fd.append('bestanden', b, b.name));
    return fd;
  }
  async function verstuur() {
    setBezig(true);
    try { await api.upload('/mail/versturen', formulier()); melding('Mail verstuurd.'); onVerstuurd(); }
    catch (e) { melding(e.message, 'fout'); setBezig(false); }
  }
  async function concept() {
    setBezig(true);
    try { const r = await api.upload('/mail/concept', formulier()); melding(`Bewaard in ${r.map || 'Concepten'}.`); onVerstuurd(); }
    catch (e) { melding(e.message, 'fout'); setBezig(false); }
  }
  const totaal = bestanden.reduce((n, b) => n + b.size, 0) + (start.bijlagen || []).filter(a => door.has(a.index)).reduce((n, a) => n + a.grootte, 0);
  const koppelOpties = [
    ...(start.erp?.klanten || []).flatMap(k => [[`klant:${k.id}`, `Klant ${k.naam}`], ...k.dossiers.map(d => [`dossier:${d.id}`, `Dossier ${d.nummer} · ${d.titel}`])]),
  ];
  const titel = start.soort === 'antwoord' ? 'Beantwoorden' : start.soort === 'doorsturen' ? 'Doorsturen' : 'Nieuwe mail';
  return (
    <Dialoog titel={titel} breed onSluit={sluit}
      voet={<>
        <button type="button" className="btn ghost" disabled={bezig} onClick={concept}>Als concept bewaren</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={sluit}>Annuleren</button>
        <button type="button" className="btn primary" disabled={bezig || !f.aan.trim() || totaal > 25 * 1048576} onClick={verstuur}>{bezig ? 'Bezig…' : 'Versturen'}</button>
      </>}>
      <datalist id="mb-adressen">{adressen.map(a => <option key={a.adres} value={a.adres}>{a.naam}</option>)}</datalist>
      <div className="mb-opstel">
        <label htmlFor="mb-aan">Aan</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="mb-aan" className="inp" list="mb-adressen" autoFocus={start.soort !== 'antwoord'} placeholder="naam@voorbeeld.be (meerdere: komma)" value={f.aan} onChange={e => zet('aan', e.target.value)} />
          {!metCc && <button type="button" className="linkish" onClick={() => setMetCc(true)}>Cc/Bcc</button>}
        </div>
        {metCc && <><label htmlFor="mb-cc">Cc</label><input id="mb-cc" className="inp" list="mb-adressen" value={f.cc} onChange={e => zet('cc', e.target.value)} />
          <label htmlFor="mb-bcc">Bcc</label><input id="mb-bcc" className="inp" list="mb-adressen" value={f.bcc} onChange={e => zet('bcc', e.target.value)} /></>}
        <label htmlFor="mb-ond">Onderwerp</label>
        <input id="mb-ond" className="inp" value={f.onderwerp} onChange={e => zet('onderwerp', e.target.value)} />
        <label htmlFor="mb-tekst" className="sr-only">Bericht</label>
      </div>
      <textarea id="mb-tekst" ref={tekstRef} className="inp mb-tekst" rows={14} value={f.tekst} onChange={e => zet('tekst', e.target.value)} />
      <div className="mb-opstel-bijlagen">
        {(start.bijlagen || []).map(a => (
          <label key={a.index} className="keuze"><input type="checkbox" checked={door.has(a.index)} onChange={() => setDoor(s => { const n = new Set(s); if (n.has(a.index)) n.delete(a.index); else n.add(a.index); return n; })} /> 📎 {a.naam} <span className="sub">{grootte(a.grootte)}</span></label>
        ))}
        {bestanden.map((b, i) => (
          <span key={`${b.name}-${i}`} className="keuze">📎 {b.name} <span className="sub">{grootte(b.size)}</span> <button type="button" className="linkish" onClick={() => setBestanden(l => l.filter((_, j) => j !== i))}>weg</button></span>
        ))}
        <label className="btn ghost klein" style={{ cursor: 'pointer' }}>+ Bijlage<input type="file" multiple className="sr-only" onChange={e => { setBestanden(l => [...l, ...e.target.files]); e.target.value = ''; }} /></label>
        {totaal > 25 * 1048576 && <span className="waarschuwing">Samen meer dan 25 MB: te groot om te mailen.</span>}
      </div>
      {koppelOpties.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <label className="lbl" htmlFor="mb-koppel">In de historiek van</label>
          <select id="mb-koppel" className="inp" value={koppel} onChange={e => setKoppel(e.target.value)}>
            <option value="">Niet bijhouden</option>
            {koppelOpties.map(([w, l]) => <option key={w} value={w}>{l}</option>)}
          </select>
        </div>
      )}
      <p className="sub" style={{ marginBottom: 0 }}>Verstuurd vanaf je eigen adres; een kopie komt in "Verzonden" van je mailbox.</p>
    </Dialoog>
  );
}
