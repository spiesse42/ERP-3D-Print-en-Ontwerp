import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import Icoon from '../../schil/Icoon.jsx';
import { BevestigDialoog } from '../productie/opdracht.jsx';

// "Volgende stap" bovenaan een dossier (25-09): één zin met wat er nu moet
// gebeuren en de knop erbij. De zin komt uit de backend (volgende_stap);
// hier enkel de knop per soort. Plus de uitleg "Hoe werkt een dossier?".
export default function VolgendeStap({ d, vuil, afrekenReden, onStarten, onAfrekenen, onBetaald, onGratis, onHeropenen, naarTab, herlaad }) {
  const { melding } = useOmgeving();
  const [bevestig, setBevestig] = useState(null);
  const [uitleg, setUitleg] = useState(false);
  const [bezig, setBezig] = useState(false);
  const s = d.volgende_stap;
  if (!s) return null;
  const opdracht = id => d.productie?.regels.flatMap(r => r.opdrachten).find(o => o.id === id);
  async function koppel() {
    setBezig(true);
    try { await api.post(`/productie/runs/${s.run.id}/koppel`, { printopdracht_id: s.run.voorstel.id }); melding(`Run gekoppeld aan "${s.run.voorstel.naam}".`); await herlaad(); }
    catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  const knop = (label, onClick, { primair = true, uit = false } = {}) => (
    <button type="button" className={`btn${primair ? ' primary' : ''}`} disabled={bezig || uit || vuil} title={vuil ? 'Sla eerst je wijzigingen op.' : undefined} onClick={onClick}>{label}</button>
  );
  const KNOP = {
    regels: () => knop('Naar de regels', () => naarTab('regels'), { primair: false }),
    offerte_wacht: () => knop('Naar de offerte', () => naarTab('offertes')),
    starten: () => knop(<><Icoon naam="start" maat={14} /> Starten</>, onStarten),
    koppelen: () => (s.run.voorstel ? knop(`Koppelen aan "${s.run.voorstel.naam}"`, koppel) : knop('Naar Productie', () => naarTab('productie'))),
    bevestigen: () => knop('Bevestigen', () => setBevestig(opdracht(s.opdracht_id))),
    printer_kiezen: () => knop('Naar de regels', () => naarTab('regels')),
    herprint: () => knop('Naar Productie', () => naarTab('productie'), { primair: false }),
    bezig: () => knop('Naar Productie', () => naarTab('productie'), { primair: false }),
    wachtrij: () => knop('Naar Productie', () => naarTab('productie'), { primair: false }),
    plannen: () => knop('Naar Productie', () => naarTab('productie')),
    afrekenen: () => <>{knop('Afrekenen', onAfrekenen, { uit: !!afrekenReden })}{d.acties?.gratis && knop('Gratis geleverd', onGratis, { primair: false })}</>,
    betaling: () => knop('Betaald', onBetaald),
    geannuleerd: () => knop('Heropenen', onHeropenen, { primair: false }),
  };
  const klaar = ['afgerond', 'klaar'].includes(s.soort);
  const tips = [...(s.extra || [])];
  if (s.soort === 'starten' && afrekenReden && d.soort === 'klant') tips.push(`Afrekenen kan nog niet: ${afrekenReden}`);
  return (
    <>
      <div className={`volgende-stap${klaar ? ' ok' : ''}${s.soort === 'geannuleerd' ? ' uit' : ''}`} role="status" aria-label="Volgende stap">
        <div className="tekst">
          <span className="kop"><Icoon naam={klaar ? 'vink' : 'pijlRechts'} maat={14} /> {klaar ? 'Klaar' : 'Volgende stap'}</span>
          <span>{s.tekst}</span>
          {tips.map(t => <span key={t} className="sub">{t}</span>)}
        </div>
        <div className="knoppen">
          {KNOP[s.soort]?.()}
          <button type="button" className="btn ghost klein" onClick={() => setUitleg(true)}>Hoe werkt een dossier?</button>
        </div>
      </div>
      {bevestig && <BevestigDialoog o={bevestig} onSluit={() => setBevestig(null)} onKlaar={async () => { setBevestig(null); await herlaad(); }} />}
      {uitleg && <DossierUitleg onSluit={() => setUitleg(false)} />}
    </>
  );
}

// ── Hoe werkt een dossier? ────────────────────────────────────────────────
export function DossierUitleg({ onSluit }) {
  return (
    <Dialoog titel="Hoe werkt een dossier?" onSluit={onSluit} breed voet={<button type="button" className="btn primary" onClick={onSluit}>Begrepen</button>}>
      <div className="uitleg">
        <p style={{ marginTop: 0 }}>De balk <b>Volgende stap</b> bovenaan zegt altijd wat er nu moet gebeuren. In het kort:</p>
        <ol>
          <li><b>Regels</b> invullen: printen, ontwerp, aanpassing, artikel of extra kost. Opslaan.</li>
          <li><i>Optioneel:</i> <b>offerte</b> maken en versturen (tab Offertes). Zegt de klant ja, zet je ze op <b>aanvaard</b>: dan start alles vanzelf.</li>
          <li><b>Starten</b> (zonder offerte): het ERP maakt de werkbon en een printopdracht per printregel. Die opdrachten volgen daarna je regels.</li>
          <li><b>Printen</b>: start de print op de printer. De run verschijnt vanzelf; <b>koppel</b> hem aan de printopdracht (met één klik in het dossier).</li>
          <li><b>Bevestigen</b> als de print klaar is: hoeveel stuks zijn goed? Tijd en verbruik van de geslaagde run gaan naar de werkbon.</li>
          <li><b>Afrekenen</b>: maak de factuur of het bonnetje in Accountable en vul het nummer hier in. Een bonnetje is meteen betaald.</li>
          <li><b>Betaald</b> zetten zodra het geld binnen is (of via de Accountable-import).</li>
        </ol>
        <p><i>Optioneel:</i> <b>leveren</b> met een pakbon (tab Leveringen), de werkbon mailen of afdrukken.</p>
        <h4 className="tussenkop">Als het anders loopt</h4>
        <ul>
          <li><b>Print mislukt of zelf gestopt?</b> Koppel die run gewoon aan de opdracht. Staat hij verkeerd op "geslaagd", klik de run aan → <i>Uitkomst of starttijd corrigeren</i>. Mislukte pogingen komen niet op de werkbon, wel als kost voor jou. De herprint koppel je aan dezelfde opdracht.</li>
          <li><b>Minder goede stuks dan besteld?</b> Na het bevestigen plant het ERP het tekort vanzelf bij (gestart dossier).</li>
          <li><b>Krijgt de klant het zonder te betalen</b> (goodwill, test)? <b>Gratis geleverd</b>: geen afrekening en geen omzet, maar je kost blijft zichtbaar in Financiën → Marges.</li>
          <li><b>Gaat de opdracht helemaal niet door?</b> <b>Dossier annuleren</b>. Heropenen kan later nog.</li>
          <li><b>Printopdracht annuleren</b> stopt enkel die ene opdracht (bv. een stuk dat niet meer nodig is), niet het dossier.</li>
          <li><b>Eigen product</b> (soort "Eigen product"): geen offerte, werkbon of afrekening; de goede stuks gaan bij het bevestigen in voorraad.</li>
        </ul>
      </div>
    </Dialoog>
  );
}
