import { useEffect, useState } from 'react';
import { APPS } from '../apps.js';
import { api } from '../lib/api.js';
import { Link } from './Schil.jsx';
import Icoon from './Icoon.jsx';

function groet() {
  const u = new Date().getHours();
  return u < 12 ? 'Goeiemorgen' : u < 18 ? 'Goeiemiddag' : 'Goeienavond';
}

export default function Startscherm() {
  const [tellers, setTellers] = useState({});
  useEffect(() => {
    // Tellers per app komen erbij zodra die app gebouwd is (stap 3, 5, 6, 7).
    api.get('/klanten').then(k => setTellers(t => ({ ...t, klanten: `${k.length} klant${k.length === 1 ? '' : 'en'}` }))).catch(() => {});
    api.get('/inkoop/aankopen').then(l => { const n = l.filter(a => a.status === 'besteld' || a.status === 'deels').length; setTellers(t => ({ ...t, inkoop: n ? `${n} onderweg` : 'niets onderweg' })); }).catch(() => {});
    api.get('/dossiers').then(l => { const n = l.filter(d => ['nieuw', 'offerte', 'akkoord', 'productie', 'klaar', 'deels', 'geleverd', 'afgerekend'].includes(d.fase)).length; setTellers(t => ({ ...t, dossiers: `${n} lopend` })); }).catch(() => {});
    // compact (vaste afspraak): enkel een teller, de volledige kaarten staan onder Productie
    api.get('/productie/live').then(l => {
      const n = l.printers.filter(p => p.run).length;
      const k = l.printers.reduce((t, p) => t + (p.te_koppelen || 0), 0);
      setTellers(t => ({ ...t, productie: k ? { tekst: `${n ? `${n} bezig · ` : ''}${k} te koppelen`, klasse: 'b-warn' } : n ? `${n} bezig` : 'niets bezig' }));
    }).catch(() => {});
    api.get('/financien/opvolging').then(o => setTellers(t => ({ ...t, financien: o.onbetaald.length ? { tekst: `${o.onbetaald.length} onbetaald`, klasse: 'b-warn' } : 'alles betaald' }))).catch(() => {});
    api.get('/controles').then(l => setTellers(t => ({ ...t, instellingen: l.length ? { tekst: `${l.length} ontbreekt`, klasse: 'b-warn' } : 'alles ingevuld' }))).catch(() => {});
    api.get('/voorraad/te-bestellen').then(l => setTellers(t => ({ ...t, voorraad: l.length ? `${l.length} te bestellen` : 'alles op peil' }))).catch(() => {});
  }, []);
  const vandaag = new Date().toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="home-wrap">
      <h1>{groet()}, Spiesse</h1>
      <p>{vandaag.charAt(0).toUpperCase() + vandaag.slice(1)}</p>
      <div className="tiles">
        {APPS.map(a => (
          <Link key={a.id} naar={`/${a.id}`} className={`tile${a.klaar ? '' : ' later'}`}>
            <span className="ic" style={{ background: a.kleur }}><Icoon naam={a.icoon} maat={30} dik={1.8} /></span>
            <span className="t">{a.naam}</span>
            {a.klaar
              ? (tellers[a.id] ? <span className={`badge ${tellers[a.id].klasse || 'b-neutral'}`}>{tellers[a.id].tekst ?? tellers[a.id]}</span> : <span className="sub">&nbsp;</span>)
              : <span className="badge b-neutral">komt in stap {a.stap}</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
