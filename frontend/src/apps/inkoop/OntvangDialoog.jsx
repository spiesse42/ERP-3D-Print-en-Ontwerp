import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import { aantal, naarInvoer, uitInvoer, vandaag } from '../../lib/formaat.js';

// Ontvangen: per openstaande regel het aantal dat nu binnen is (standaard:
// alles wat nog openstaat). Bij een plaatshouder kies je het merk; bestaat de
// prijsgroep merk + type nog niet, dan vul je meteen een verkoopprijs/kg in.
export default function OntvangDialoog({ aankoop, onSluit, onKlaar }) {
  const { melding } = useOmgeving();
  const { data: merken } = useData('/filament/merken');
  const { data: groepen } = useData('/filament/types');
  const open = aankoop.regels.filter(r => r.openstaand > 0);
  const [lijnen, setLijnen] = useState(() => Object.fromEntries(open.map(r => [r.id, { aantal: naarInvoer(r.openstaand), merk_id: '', prijs_kg: '' }])));
  const [kop, setKop] = useState({ datum: vandaag(), locatie: '' });
  const [bezig, setBezig] = useState(false);
  const zet = (id, k) => e => setLijnen(l => ({ ...l, [id]: { ...l[id], [k]: e.target.value } }));
  const groepBestaat = (r, merk) => (groepen || []).some(g => String(g.merk_id) === String(merk) && g.materiaal_id === r.plaatshouder_materiaal_id);

  const problemen = open.map(r => {
    const l = lijnen[r.id]; const n = uitInvoer(l.aantal);
    if (n === null || n === 0) return null;
    if (Number.isNaN(n) || n < 0) return `${r.weergave}: ongeldig aantal`;
    if (n > r.openstaand + 1e-9) return `${r.weergave}: maximaal ${aantal(r.openstaand)}`;
    if (r.soort === 'plaatshouder') {
      if (!l.merk_id) return `${r.weergave}: kies het merk`;
      if (groepen && !groepBestaat(r, l.merk_id)) { const p = uitInvoer(l.prijs_kg); if (p === null || Number.isNaN(p) || p < 0) return `${r.weergave}: vul de verkoopprijs per kg in`; }
    }
    return null;
  }).filter(Boolean);
  const iets = open.some(r => uitInvoer(lijnen[r.id].aantal) > 0);

  async function bewaar() {
    setBezig(true);
    try {
      const a = await api.post(`/inkoop/aankopen/${aankoop.id}/ontvangen`, {
        datum: kop.datum, locatie: kop.locatie,
        lijnen: open.map(r => ({ regel_id: r.id, aantal: uitInvoer(lijnen[r.id].aantal) ?? 0,
          merk_id: lijnen[r.id].merk_id || undefined, nieuwe_prijs_per_kg: uitInvoer(lijnen[r.id].prijs_kg) ?? undefined })),
      });
      melding(a.status === 'ontvangen' ? 'Alles ontvangen en in voorraad geboekt.' : 'Deels ontvangen en in voorraad geboekt.');
      onKlaar();
    } catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); }
  }

  return (
    <Dialoog breed titel={`Ontvangen · ${aankoop.nummer}`} onSluit={onSluit}
      voet={<>
        <button type="button" className="btn" onClick={onSluit}>Annuleren</button>
        <button type="button" className="btn primary" disabled={bezig || !iets || problemen.length > 0} onClick={bewaar}>In voorraad boeken</button>
      </>}>
      <div className="ontvang">
        {open.map(r => {
          const l = lijnen[r.id];
          return (
            <div className="orij" key={r.id}>
              <div className="wat">
                <b>{r.weergave}</b>
                <span className="sub">besteld {aantal(r.aantal)}{r.ontvangen > 0 ? ` · al ontvangen ${aantal(r.ontvangen)}` : ''} · open {aantal(r.openstaand)}</span>
                {r.soort === 'plaatshouder' && (
                  <div className="merkkeuze">
                    <select className="inp" aria-label={`Merk voor ${r.weergave}`} value={l.merk_id} onChange={zet(r.id, 'merk_id')}>
                      <option value="">Kies het merk…</option>
                      {(merken || []).map(m => <option key={m.id} value={m.id}>{m.naam}</option>)}
                    </select>
                    {l.merk_id && groepen && !groepBestaat(r, l.merk_id) && (
                      <div className="unit">
                        <input className="inp num" inputMode="decimal" aria-label="Verkoopprijs per kg (nieuwe prijsgroep)" placeholder="verkoopprijs" value={l.prijs_kg} onChange={zet(r.id, 'prijs_kg')} />
                        <span>€/kg · nieuwe prijsgroep</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="unit">
                <input className="inp num" inputMode="decimal" aria-label={`Nu ontvangen: ${r.weergave}`} value={l.aantal} onChange={zet(r.id, 'aantal')} />
                <span>{r.eenheid || (r.soort === 'plaatshouder' ? 'rollen' : '')}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="fgrid" style={{ marginTop: 12 }}>
        <div><label htmlFor="o-datum">Ontvangen op</label><input id="o-datum" type="date" className="inp" value={kop.datum} onChange={e => setKop(k => ({ ...k, datum: e.target.value }))} /></div>
        <div><label htmlFor="o-loc">Locatie</label><input id="o-loc" className="inp" value={kop.locatie} onChange={e => setKop(k => ({ ...k, locatie: e.target.value }))} placeholder="optioneel" /></div>
      </div>
      {problemen.length > 0 && <p className="note" style={{ color: 'var(--crit)', marginBottom: 0 }}>{problemen[0]}</p>}
      <p className="note" style={{ marginBottom: 0 }}>Zet 0 bij wat (nog) niet binnen is. Elke regel wordt een voorraadpartij aan de prijs van de regel (incl. btw).</p>
    </Dialoog>
  );
}
