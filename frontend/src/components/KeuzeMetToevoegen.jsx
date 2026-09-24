import { useState } from 'react';
import { useOmgeving } from '../schil/Omgeving.jsx';

// Keuzelijst met "+ nieuw toevoegen" erin (merk, type, later ook kleur).
// Op moduleniveau, niet genest: anders verliest het invoerveld de focus bij
// elke toetsaanslag.
// Zonder `label` (bv. in een tabelregel) geef je `ariaLabel` mee.
export default function KeuzeMetToevoegen({ id, label, ariaLabel, waarde, opties, onKies, onNieuw, watLabel, leegLabel = 'Kies…' }) {
  const [toevoegen, setToevoegen] = useState(false);
  const [nieuweNaam, setNieuweNaam] = useState('');
  const [bezig, setBezig] = useState(false);
  const { melding } = useOmgeving();

  async function bevestigNieuw() {
    const naam = nieuweNaam.trim();
    if (!naam) return;
    setBezig(true);
    try {
      const nieuw = await onNieuw(naam);
      onKies(String(nieuw.id));
      setToevoegen(false);
      setNieuweNaam('');
    } catch (e) {
      melding(e.message, 'fout');
    } finally {
      setBezig(false);
    }
  }

  return (
    <div>
      {label && <label htmlFor={id}>{label}</label>}
      {toevoegen ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input id={id} className="inp" aria-label={label ? undefined : `Nieuwe ${watLabel}`} value={nieuweNaam} onChange={e => setNieuweNaam(e.target.value)} placeholder={`Nieuwe ${watLabel}`} autoFocus
            onKeyDown={e => { if (e.key === 'Enter') bevestigNieuw(); if (e.key === 'Escape') setToevoegen(false); }} />
          <button className="btn primary" type="button" onClick={bevestigNieuw} disabled={bezig || !nieuweNaam.trim()}>Toevoegen</button>
          <button className="btn" type="button" onClick={() => { setToevoegen(false); setNieuweNaam(''); }} disabled={bezig}>Annuleren</button>
        </div>
      ) : (
        <select id={id} className="inp" value={waarde} aria-label={label ? undefined : ariaLabel}
          onChange={e => (e.target.value === '__nieuw__' ? setToevoegen(true) : onKies(e.target.value))}>
          <option value="">{leegLabel}</option>
          {opties.map(o => <option key={o.id} value={o.id}>{o.naam}</option>)}
          <option value="__nieuw__">+ Nieuwe {watLabel} toevoegen</option>
        </select>
      )}
    </div>
  );
}
