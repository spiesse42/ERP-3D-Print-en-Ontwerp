// Bijlagen bij een record (factuur-PDF, foto van een bonnetje, …):
// opladen, openen in een nieuw tabblad, verwijderen. Herbruikbaar per entiteit.
import { useRef, useState } from 'react';
import { api, BASE } from '../lib/api.js';
import { useData } from './useData.js';
import { useOmgeving } from './Omgeving.jsx';
import Icoon from './Icoon.jsx';
import { datum } from '../lib/formaat.js';

const grootte = b => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} kB`);

export default function Bijlagen({ entiteit, id, onGewijzigd }) {
  const { data, herlaad } = useData(`/bijlagen/${entiteit}/${id}`);
  const { melding, bevestig } = useOmgeving();
  const [bezig, setBezig] = useState(false);
  const invoer = useRef(null);

  async function laadOp(bestand) {
    if (!bestand) return;
    setBezig(true);
    try {
      const fd = new FormData();
      fd.append('bestand', bestand);
      await api.upload(`/bijlagen/${entiteit}/${id}`, fd);
      await herlaad(); onGewijzigd?.();
      melding('Bijlage toegevoegd.');
    } catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); if (invoer.current) invoer.current.value = ''; }
  }
  async function verwijder(b) {
    if (!await bevestig({ titel: 'Bijlage verwijderen', tekst: `${b.bestandsnaam} verwijderen?`, bevestigLabel: 'Verwijderen', gevaarlijk: true })) return;
    try { await api.delete(`/bijlagen/bestand/${b.id}`); await herlaad(); onGewijzigd?.(); melding('Bijlage verwijderd.'); }
    catch (e) { melding(e.message, 'fout'); }
  }

  return (
    <div>
      {(data || []).length > 0 && (
        <ul className="bijlagen">
          {data.map(b => (
            <li key={b.id}>
              <Icoon naam={b.mimetype === 'application/pdf' ? 'map' : 'kaarten'} maat={16} />
              <a href={`${BASE}/bijlagen/bestand/${b.id}`} target="_blank" rel="noopener noreferrer">{b.bestandsnaam}</a>
              <span className="sub">{grootte(b.grootte)} · {datum(b.aangemaakt_op)}</span>
              <button type="button" className="btn ghost" aria-label={`${b.bestandsnaam} verwijderen`} onClick={() => verwijder(b)}><Icoon naam="vuilbak" maat={14} /></button>
            </li>
          ))}
        </ul>
      )}
      <label className={`btn${bezig ? ' bezig' : ''}`} htmlFor={`bijlage-${entiteit}-${id}`}>
        <Icoon naam="plus" maat={16} /> {bezig ? 'Bezig…' : 'Bijlage toevoegen'}
      </label>
      <input ref={invoer} id={`bijlage-${entiteit}-${id}`} type="file" className="sr-only" accept="application/pdf,image/*" disabled={bezig}
        onChange={e => laadOp(e.target.files?.[0])} />
      <p className="note">PDF of foto (jpg, png, heic), max. 20 MB. Enkel voor intern gebruik.</p>
    </div>
  );
}
