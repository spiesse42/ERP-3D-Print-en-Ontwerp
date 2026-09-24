// Historiek onderaan een formulier: notities + gebeurtenissen, nieuwste eerst.
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useData } from './useData.js';
import { useOmgeving } from './Omgeving.jsx';
import Icoon from './Icoon.jsx';

const SOORT = {
  notitie:      { titel: 'Notitie',     icoon: 'bericht', klasse: 'a' },
  aangemaakt:   { titel: 'Aangemaakt',  icoon: 'plus',    klasse: 'p' },
  gewijzigd:    { titel: 'Gewijzigd',   icoon: 'pen',     klasse: '' },
  gearchiveerd: { titel: 'Gearchiveerd', icoon: 'archief', klasse: 'c' },
  hersteld:     { titel: 'Hersteld uit archief', icoon: 'herstel', klasse: 'p' },
  voorraad:     { titel: 'Voorraad',    icoon: 'spoel',   klasse: '' },
  status:       { titel: 'Status',      icoon: 'vink',    klasse: 'p' },
};

// SQLite bewaart datetime('now') in UTC zonder tijdzone: expliciet als UTC lezen.
function alsDatum(t) { return new Date(String(t).replace(' ', 'T') + 'Z'); }
function dagLabel(d) {
  const vandaag = new Date(); const gisteren = new Date(); gisteren.setDate(vandaag.getDate() - 1);
  const zelfde = (a, b) => a.toDateString() === b.toDateString();
  if (zelfde(d, vandaag)) return 'Vandaag';
  if (zelfde(d, gisteren)) return 'Gisteren';
  return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function Historiek({ entiteit, id, versie }) {
  const { data, laden, herlaad } = useData(id ? `/historiek/${entiteit}/${id}?v=${versie || 0}` : null);
  const [tekst, setTekst] = useState('');
  const [bezig, setBezig] = useState(false);
  const { melding } = useOmgeving();

  async function bewaarNotitie() {
    if (!tekst.trim()) return;
    setBezig(true);
    try {
      await api.post(`/historiek/${entiteit}/${id}`, { tekst });
      setTekst('');
      await herlaad();
    } catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); }
  }

  let vorigeDag = null;
  return (
    <section className="chatter" aria-label="Historiek">
      <h3>Historiek</h3>
      <div className="compose">
        <label className="sr-only" htmlFor="notitie">Notitie</label>
        <textarea id="notitie" className="inp" rows={2} placeholder="Notitie toevoegen…" value={tekst}
          onChange={e => setTekst(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) bewaarNotitie(); }} />
        <button type="button" className="btn" disabled={bezig || !tekst.trim()} onClick={bewaarNotitie}>Opslaan</button>
      </div>
      <div className="note">Ctrl+Enter om snel op te slaan.</div>
      {laden && !data ? <div className="note" style={{ marginTop: 12 }}>Laden…</div> : (data || []).map(g => {
        const d = alsDatum(g.tijdstip);
        const dag = dagLabel(d);
        const toonDag = dag !== vorigeDag; vorigeDag = dag;
        const s = SOORT[g.soort] || SOORT.gewijzigd;
        return (
          <div key={g.id}>
            {toonDag && <div className="day">{dag}</div>}
            <div className="ev">
              <span className={`dot ${s.klasse}`}><Icoon naam={s.icoon} maat={14} /></span>
              <div>
                <div className="top"><b>{s.titel}</b> · {d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}</div>
                {g.tekst && <div className="txt">{g.tekst}</div>}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
