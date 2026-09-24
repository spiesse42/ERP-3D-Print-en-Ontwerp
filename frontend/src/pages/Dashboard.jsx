import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';

// De 5 bedrijfspijlers — zie claude/erp-v2-roadmap.md / het dashboard-mockup-
// overleg. Klanten (Fase 0) en Voorraad (Fase 1, eerste stuk) zijn gebouwd;
// de rest komt online per fase en is tot dan een uitgeschakelde tegel i.p.v.
// een dode link.
const PIJLERS = [
  { key: 'productie',  chip: '🖨', warn: false, naam: 'Productie',  klaar: false, status: 'Komt in Fase 1' },
  { key: 'verkoop',    chip: '📄', warn: false, naam: 'Verkoop',    klaar: false, status: 'Komt in Fase 2' },
  { key: 'klanten',    chip: '👤', warn: false, naam: 'Klanten',    klaar: true,  to: '/klanten' },
  { key: 'voorraad',   chip: '🧵', warn: false, naam: 'Voorraad',   klaar: false, status: 'Wordt herbouwd (stap 3)' },
  { key: 'financieel', chip: '💶', warn: false, naam: 'Financieel', klaar: false, status: 'Komt in Fase 3' },
];

export default function Dashboard() {
  const navigate = useNavigate();
  const [aantalKlanten, setAantalKlanten] = useState(null);

  useEffect(() => {
    api.get('/klanten').then(rows => setAantalKlanten(rows.length)).catch(() => setAantalKlanten(0));
    // Voorraad: tijdelijk geen teller. De oude "te bestellen"-routes zijn weg
    // sinds het nieuwe basisschema (stap 1) en komen terug in stap 3.
  }, []);

  const pijlers = PIJLERS;

  const statusVoor = (p) => {
    if (p.key === 'klanten') {
      if (aantalKlanten === null) return '…';
      return aantalKlanten === 0 ? 'Nog geen klanten' : `${aantalKlanten} klant${aantalKlanten === 1 ? '' : 'en'}`;
    }
    return p.status;
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
            ERP 3D Print &amp; Ontwerp — stap 1: nieuw basisschema
          </div>
        </div>
      </div>

      <div className="tag-row">
        {pijlers.map(p => (
          <button
            key={p.key}
            className="tag"
            type="button"
            disabled={!p.klaar}
            onClick={() => p.klaar && navigate(p.to)}
            title={p.klaar ? undefined : 'Nog niet gebouwd — zie de roadmap'}
          >
            <div className="top">
              <div className={`chip${p.warn ? ' warn' : ''}`}>{p.chip}</div>
              <div className="name">{p.naam}</div>
            </div>
            <div className="status">
              {p.klaar ? <strong>{statusVoor(p)}</strong> : statusVoor(p)}
            </div>
          </button>
        ))}
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <div className="section-title" style={{ margin: '0 0 10px' }}>Waar staan we</div>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
          Dit is het nieuwe pakket, stap voor stap opgebouwd naast het huidige — zie
          de herziene roadmap in het project. Stap 1: nieuw basisschema. Klanten en
          Instellingen werken; Voorraad wordt herbouwd in stap 3. Dit scherm krijgt
          in stap 2 de nieuwe Odoo-achtige schil.
        </p>
      </div>
    </div>
  );
}
