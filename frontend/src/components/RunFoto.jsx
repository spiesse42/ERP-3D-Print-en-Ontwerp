import { useState } from 'react';
import { BASE } from '../lib/api.js';

// Foto van een printrun (11-10): voorbeeldafbeelding van de print of een
// camerabeeld na het einde. Klik = groot, klik ernaast of Esc = weg.
export default function RunFoto({ run, maat = 40 }) {
  const [groot, setGroot] = useState(false);
  if (!run?.foto) return maat > 60 ? null : <span className="sub">—</span>;
  const src = `${BASE}/productie/runs/${run.id}/foto`;
  return (
    <>
      <button type="button" className="fotoknop" title="Foto groter tonen" onClick={e => { e.stopPropagation(); setGroot(true); }} onKeyDown={e => e.stopPropagation()}>
        <img src={src} alt="" loading="lazy" style={{ width: maat, height: maat, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
      </button>
      {groot && (
        <div role="dialog" aria-label="Foto van de run" tabIndex={-1} onClick={e => { e.stopPropagation(); setGroot(false); }} onKeyDown={e => { if (e.key === 'Escape') setGroot(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <figure style={{ margin: 0, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <img src={src} alt="Foto van de run" style={{ maxWidth: 'min(90vw, 900px)', maxHeight: '80vh', borderRadius: 8, background: '#fff' }} />
            {run.bestand && <figcaption className="mono" style={{ color: '#fff', marginTop: 8 }}>{run.bestand}</figcaption>}
          </figure>
        </div>
      )}
    </>
  );
}
