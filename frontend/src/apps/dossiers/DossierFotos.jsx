import { useRef, useState } from 'react';
import { api, BASE } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import Icoon from '../../schil/Icoon.jsx';

// Foto's bovenaan een dossier (28-09): de foto-bijlagen van het dossier
// (afbeeldingen van de platen uit het slicerbestand, een voorbeeld van de
// klant, het eindresultaat). Klik = volledige foto; ✕ = verwijderen.
// HEIC tonen browsers niet: die blijven enkel in Bijlagen.
const TOONBAAR = /^image\/(png|jpe?g|webp|gif)$/;

export default function DossierFotos({ id, onGewijzigd }) {
  const { data, herlaad } = useData(`/bijlagen/dossier/${id}`);
  const { melding, bevestig } = useOmgeving();
  const [bezig, setBezig] = useState(false);
  const invoer = useRef(null);
  const fotos = (data || []).filter(b => TOONBAAR.test(b.mimetype || ''));

  async function laadOp(bestanden) {
    if (!bestanden?.length) return;
    setBezig(true);
    try {
      for (const b of bestanden) {
        const fd = new FormData();
        fd.append('bestand', b);
        await api.upload(`/bijlagen/dossier/${id}`, fd);
      }
      await herlaad(); onGewijzigd?.();
      melding(bestanden.length === 1 ? 'Foto toegevoegd.' : `${bestanden.length} foto's toegevoegd.`);
    } catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); if (invoer.current) invoer.current.value = ''; }
  }

  async function verwijder(f) {
    if (!await bevestig({ titel: 'Foto verwijderen', tekst: `${f.bestandsnaam} verwijderen uit het dossier?`, bevestigLabel: 'Verwijderen', annuleerLabel: 'Terug', gevaarlijk: true })) return;
    try { await api.delete(`/bijlagen/bestand/${f.id}`); await herlaad(); onGewijzigd?.(); melding('Foto verwijderd.'); }
    catch (e) { melding(e.message, 'fout'); }
  }

  return (
    <div className="dossier-fotos" aria-label="Foto's van het dossier">
      {fotos.map(f => (
        <div key={f.id} className="foto">
          <a href={`${BASE}/bijlagen/bestand/${f.id}`} target="_blank" rel="noopener noreferrer" title={f.bestandsnaam}>
            <img src={`${BASE}/bijlagen/bestand/${f.id}`} alt={f.bestandsnaam} loading="lazy" />
          </a>
          <button type="button" className="weg" aria-label={`Foto ${f.bestandsnaam} verwijderen`} title="Foto verwijderen" onClick={() => verwijder(f)}><Icoon naam="kruis" maat={12} /></button>
        </div>
      ))}
      <label className={`foto-erbij${bezig ? ' bezig' : ''}`} htmlFor={`foto-dossier-${id}`} title="Foto toevoegen (bv. voorbeeld van de klant of het eindresultaat)">
        <Icoon naam="plus" maat={18} /><span>{bezig ? 'Bezig…' : 'Foto'}</span>
      </label>
      <input ref={invoer} id={`foto-dossier-${id}`} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp" multiple disabled={bezig}
        onChange={e => laadOp([...(e.target.files || [])])} />
    </div>
  );
}

// Afbeeldingen (data-URI, bv. van de slicer) als foto-bijlagen bij een dossier.
export async function bewaarFotos(dossierId, fotos) {
  for (const f of fotos) {
    const fd = new FormData();
    fd.append('bestand', await (await fetch(f.afbeelding)).blob(), f.naam);
    await api.upload(`/bijlagen/dossier/${dossierId}`, fd);
  }
}

// Slicerbestand (28-09) als bijlage van het dossier → { id, bestandsnaam }.
export async function bewaarBestand(dossierId, bestand) {
  const fd = new FormData();
  fd.append('bestand', bestand, bestand.name);
  return api.upload(`/bijlagen/dossier/${dossierId}`, fd);
}
