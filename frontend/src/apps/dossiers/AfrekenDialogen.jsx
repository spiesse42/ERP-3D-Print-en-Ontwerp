import { useState } from 'react';
import { Dialoog } from '../../schil/Omgeving.jsx';
import { useData } from '../../schil/useData.js';
import { BASE } from '../../lib/api.js';
import { euro, naarInvoer, vandaag, datum as fmtDatum } from '../../lib/formaat.js';
import { klantNaam } from '../klanten/klant.js';
import { mailTekst } from './MailDialoog.jsx';

const openPdf = pad => window.open(new URL(`${BASE}${pad}`, document.baseURI).href, '_blank', 'noopener');

// Afrekening = VERWIJZING naar Accountable (domeinmodel, optie A): het ERP
// nummert zelf geen facturen of bonnetjes.
// Artikelen uit voorraad die nog niet geleverd zijn (29-09): bij afrekenen,
// bonnetje of gratis geleverd meteen leveren (pakbon), zodat de voorraad
// klopt en de kost in de marge staat. Te weinig voorraad: die regel wordt
// overgeslagen (de backend meldt het in de historiek).
// Blijft er na afrekenen iets ongeleverd? (printwerk, of artikelen als het vinkje uit staat)
const blijftOngeleverd = (dossier, leveren) => ['geen', 'deels'].includes(dossier.lever_status)
  && (dossier.leverbaar || []).some(x => x.rest > 0 && (!leveren || !x.boekt_voorraad));

// Regels gewijzigd na een aanvaarde offerte (29-09): afgerekend wordt de
// offerteprijs, dus wat erbij kwam zou niet aangerekend worden.
export function AfwijkingOfferte({ dossier }) {
  const o = dossier.wijkt_af_van_offerte && dossier.offertes?.find(x => x.aanvaard_op);
  if (!o) return null;
  return (
    <div className="waarschuwing" style={{ margin: '0 0 12px', display: 'block' }} role="alert">
      De regels wijken af van de aanvaarde offerte {o.weergave}: afgerekend wordt de <b>offerteprijs {euro(o.totaal)}</b>, niet de regels ({euro(dossier.berekening.totaal ?? 0)}).
      Kwam er iets bij? Maak eerst het antwoord op de offerte ongedaan (tab Offertes) en stuur een nieuwe versie.
    </div>
  );
}

export function VoorraadLeveren({ dossier, aan, onWijzig }) {
  const lijst = (dossier.leverbaar || []).filter(x => x.boekt_voorraad && x.rest > 0);
  if (!lijst.length) return null;
  const tekort = lijst.filter(x => (x.voorraad ?? 0) < x.rest);
  const n = v => String(v).replace('.', ',');
  return (
    <div style={{ margin: '10px 0 0' }}>
      <label className="vinkje"><input type="checkbox" checked={aan} onChange={e => onWijzig(e.target.checked)} /> Nog niet geleverde artikelen nu uit voorraad leveren (pakbon): {lijst.map(x => `${n(x.rest)} × ${x.omschrijving}`).join(', ')}</label>
      {aan && tekort.length > 0 && <div className="sub">Te weinig voorraad voor {tekort.map(x => `${x.omschrijving} (${n(x.voorraad ?? 0)} op voorraad)`).join(', ')}: die wordt overgeslagen.</div>}
    </div>
  );
}

export function AfrekenDialoog({ dossier, onSluit, onBevestig }) {
  // Standaardbedrag = bedrag van de werkbon (offerteprijs bij een aanvaarde offerte, anders volgens de metingen).
  // Nog geen werkbon: die wordt bij het afrekenen gemaakt (zonder_werkbon = wat hij zou tonen).
  const totaal = dossier.werkbon?.bedrag ?? dossier.zonder_werkbon?.bedrag ?? dossier.berekening.totaal;
  const [f, setF] = useState({ soort: 'factuur', nummer: '', datum: vandaag(), bedrag: naarInvoer(totaal), voorraad_leveren: true });
  const [bezig, setBezig] = useState(false);
  const zet = (k, w) => setF(x => ({ ...x, [k]: w }));
  async function ok() { setBezig(true); try { await onBevestig(f); } finally { setBezig(false); } }
  return (
    <Dialoog titel="Afrekenen in Accountable" onSluit={onSluit}
      voet={<>
        <button type="button" className="btn" onClick={onSluit}>Annuleren</button>
        <button type="button" className="btn primary" disabled={bezig || !f.nummer.trim()} onClick={ok}>Afgerekend</button>
      </>}>
      <p className="note" style={{ marginTop: 0 }}>Maak de {f.soort === 'factuur' ? 'factuur' : 'het bonnetje'} in Accountable (gebruik de overnamefiche) en vul hier het nummer in dat Accountable gaf. {dossier.werkbon ? ` De werkbon ${dossier.werkbon.weergave} wordt daarmee definitief.` : ' Er wordt meteen een werkbon gemaakt en definitief gezet.'}</p>
      <AfwijkingOfferte dossier={dossier} />
      {blijftOngeleverd(dossier, f.voorraad_leveren) && (
        <div className="waarschuwing" style={{ margin: '0 0 12px' }}>Nog niet alles geleverd{dossier.lever_status === 'deels' ? ' (deels geleverd)' : ''}. Afrekenen kan, bv. als de klant al betaald heeft; lever daarna verder via het tabblad Leveringen.</div>
      )}
      <div className="fgrid">
        <div style={{ gridColumn: '1/-1' }}>
          <span className="lbl">Soort</span>
          <div className="seg" role="group" aria-label="Soort afrekening">
            <button type="button" aria-pressed={f.soort === 'factuur'} onClick={() => zet('soort', 'factuur')}>Factuur</button>
            <button type="button" aria-pressed={f.soort === 'bonnetje'} onClick={() => zet('soort', 'bonnetje')}>Bonnetje</button>
          </div>
          <div className="sub" style={{ marginTop: 4 }}>{f.soort === 'bonnetje' ? 'Een bonnetje staat meteen op betaald (dagontvangsten). Liever het bonnetje door het ERP laten maken en mailen? Gebruik "Bonnetje maken".' : 'Een factuur zet je later op betaald.'}</div>
        </div>
        <div><label htmlFor="af-nr">Nummer in Accountable</label><input id="af-nr" className="inp mono" value={f.nummer} onChange={e => zet('nummer', e.target.value)} autoFocus /></div>
        <div><label htmlFor="af-datum">Datum</label><input id="af-datum" type="date" className="inp" max={vandaag()} value={f.datum} onChange={e => zet('datum', e.target.value)} /></div>
        <div><label htmlFor="af-bedrag">Bedrag</label><div className="unit"><input id="af-bedrag" className="inp num" inputMode="decimal" value={f.bedrag} onChange={e => zet('bedrag', e.target.value)} /><span>€</span></div></div>
      </div>
      <VoorraadLeveren dossier={dossier} aan={f.voorraad_leveren} onWijzig={v => zet('voorraad_leveren', v)} />
    </Dialoog>
  );
}

// ── Bonnetje door het ERP (26-09) ───────────────────────────────────────
// Het ERP maakt het bonnetje (04-10: het nummer komt uit Accountable en
// wordt hier ingevuld; facturen nummert het ERP zelf), zet het dossier op afgerekend + betaald en mailt het ALTIJD
// naar Accountable (dagontvangstenboek); naar de klant is optioneel
// (Accountable dan in cc). Het bedrag is dat van de werkbon.
// soort 'factuur' (29-09): zelfde venster, met vervaldatum, zonder "betaald",
// en een waarschuwing als de klant de factuur via Peppol moet krijgen.
export function BonnetjeDialoog({ dossier, bedrijf, soort = 'bonnetje', onSluit, onBevestig }) {
  const factuur = soort === 'factuur';
  const [dag, setDag] = useState(vandaag());
  const { data: v, fout } = useData(`/dossiers/${dossier.id}/${soort}/voorstel?datum=${dag}`);
  const k = dossier.klant_gegevens;
  const [naarKlant, setNaarKlant] = useState(false);
  const [leveren, setLeveren] = useState(true);
  const [verval, setVerval] = useState(null);   // null = volgens de betaaltermijn
  const vervaldatum = verval || v?.vervaldatum || '';
  const [mail, setMail] = useState(null);   // pas invullen zodra het nummer gekend is
  const [bezig, setBezig] = useState(false);
  const [nr, setNr] = useState('');   // bonnetje: nummer uit Accountable
  const kaalNr = nr.trim().replace(/^bonnetje\s*/i, '').trim();
  const nummer = factuur ? v?.nummer : kaalNr ? `Bonnetje ${kaalNr}` : null;
  const m = mail || { aan: k?.email || '', onderwerp: nummer ? `${nummer} – ${dossier.titel}` : '', tekst: mailTekst({ klant: k, bedrijf, wat: factuur ? 'je factuur' : 'je bonnetje', titel: dossier.titel }) };
  const zetMail = (sl, w) => setMail({ ...m, [sl]: w });
  // 30-09: een bonnetje gaat niet naar Accountable; mailen enkel als het naar de klant moet
  const mailen = factuur || naarKlant;
  const blokkeert = !v || !mailen ? null : !v.mail_ingesteld ? (factuur ? 'Mailen is nog niet ingesteld (smtp_user/smtp_pass in de add-on-configuratie). Een factuur moet naar Accountable gemaild worden.' : 'Mailen is nog niet ingesteld (smtp_user/smtp_pass in de add-on-configuratie): vink "ook naar de klant" uit.')
    : !v.pdf_mogelijk ? 'Geen Chrome, Edge of Chromium gevonden om de PDF te maken.' : null;
  const kan = v && !blokkeert && !bezig && (!naarKlant || m.aan.trim()) && (!factuur || vervaldatum >= dag) && (factuur || kaalNr);
  async function ok() {
    setBezig(true);
    try { await onBevestig({ datum: dag, ...(factuur ? { vervaldatum } : { nummer: kaalNr }), voorraad_leveren: leveren, naar_klant: naarKlant, ...(naarKlant ? { aan: m.aan, onderwerp: m.onderwerp, tekst: m.tekst } : {}) }); }
    finally { setBezig(false); }
  }
  return (
    <Dialoog titel={factuur ? 'Factuur maken' : 'Bonnetje maken'} onSluit={onSluit} breed
      voet={<>
        <button type="button" className="btn ghost" disabled={!v} onClick={() => openPdf(`/dossiers/${dossier.id}/${soort}/voorbeeld?datum=${dag}${factuur && vervaldatum ? `&vervaldatum=${vervaldatum}` : ''}${!factuur && kaalNr ? `&nummer=${encodeURIComponent(kaalNr)}` : ''}`)}>Voorbeeld (PDF)</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={onSluit}>Annuleren</button>
        <button type="button" className="btn primary" disabled={!kan} onClick={ok}>{bezig ? 'Bezig…' : factuur ? (naarKlant ? 'Maken en mailen (klant + Accountable)' : 'Maken en mailen naar Accountable') : (naarKlant ? 'Maken en mailen naar de klant' : 'Bonnetje maken')}</button>
      </>}>
      {fout && <div className="waarschuwing" style={{ margin: '0 0 12px', display: 'block' }} role="alert">{fout}</div>}
      {blokkeert && <div className="waarschuwing" style={{ margin: '0 0 12px', display: 'block' }} role="alert">{blokkeert}</div>}
      <AfwijkingOfferte dossier={dossier} />
      {factuur && v?.ontbreekt?.length > 0 && <div className="waarschuwing" style={{ margin: '0 0 12px', display: 'block' }}>Nog niet ingevuld: {v.ontbreekt.join(', ')}. Dat hoort op een factuur (Instellingen → Bedrijf, of de fiche van de klant).</div>}
      {factuur && v?.peppol_verplicht && <div className="waarschuwing" style={{ margin: '0 0 12px', display: 'block' }}>Belgische btw-plichtige klant: deze factuur moet via <b>Peppol</b>. Het ERP mailt ze naar Accountable; verstuur ze daarna vanuit Accountable via Peppol (Inkomsten → de factuur → versturen via Peppol). Mail de PDF dan niet als factuur naar de klant.</div>}
      <div className="fgrid">
        <div><label htmlFor="bn-datum">{factuur ? 'Factuurdatum' : 'Datum (ontvangen)'}</label><input id="bn-datum" type="date" className="inp" max={vandaag()} value={dag} onChange={e => setDag(e.target.value || vandaag())} /></div>
        {factuur && <div><label htmlFor="bn-verval">Vervaldatum</label><input id="bn-verval" type="date" className="inp" min={dag} value={vervaldatum} onChange={e => setVerval(e.target.value || null)} /></div>}
        {factuur
          ? <div><span className="lbl">Nummer</span><div className="mono" style={{ padding: '8px 0' }}>{v?.nummer ?? '…'}</div></div>
          : <div><label htmlFor="bn-nr">Nummer uit Accountable</label><input id="bn-nr" className="inp mono" autoFocus placeholder={v?.nummer_voorstel ? `bv. ${v.nummer_voorstel}` : 'bv. 2026-025'} value={nr} onChange={e => setNr(e.target.value)} /></div>}
        <div><span className="lbl">Bedrag</span><div className="num" style={{ padding: '8px 0' }}><b>{v ? euro(v.bedrag) : '…'}</b> <span className="sub">{factuur ? 'btw niet van toepassing' : 'btw 0 %'}</span></div></div>
      </div>
      <p className="sub" style={{ margin: '4px 0 0' }}>Het bedrag is dat van de werkbon{v?.werkbon ? ` ${v.werkbon}` : ''}{dossier.werkbon ? '' : ' (wordt nu gemaakt)'}; de werkbon wordt definitief{factuur ? '. Zet het dossier op betaald zodra het geld binnen is' : ' en het dossier staat meteen op betaald'}. Een ander bedrag nodig? Pas eerst de regels aan.</p>
      {!factuur && v && v.bedrag > v.drempel && <div className="waarschuwing" style={{ margin: '10px 0 0', display: 'block' }}>Meer dan {euro(v.drempel)}: volgens Accountable is voor zo'n verkoop mogelijk een factuur nodig in plaats van een bonnetje.</div>}
      {!factuur && k?.type === 'zakelijk' && <div className="waarschuwing" style={{ margin: '10px 0 0', display: 'block' }}>Zakelijke klant: normaal krijgt die een factuur ("Factuur maken").</div>}
      {blijftOngeleverd(dossier, leveren) && <div className="waarschuwing" style={{ margin: '10px 0 0', display: 'block' }}>Nog niet alles geleverd{dossier.lever_status === 'deels' ? ' (deels geleverd)' : ''}. Dat mag; lever daarna verder via het tabblad Leveringen.</div>}
      <VoorraadLeveren dossier={dossier} aan={leveren} onWijzig={setLeveren} />
      <p style={{ margin: '14px 0 6px' }}><span className="lbl" style={{ display: 'inline' }}>Klant: </span>{k ? <>{klantNaam(k)}{k.email ? <span className="sub"> · {k.email}</span> : null}</> : <span className="sub">geen klant gekozen (mag bij een bonnetje)</span>}</p>
      <label className="keuze" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={naarKlant} onChange={e => setNaarKlant(e.target.checked)} /> Ook naar de klant mailen
      </label>
      {naarKlant && (
        <div className="fgrid" style={{ marginTop: 8 }}>
          <div style={{ gridColumn: '1/-1' }}><label htmlFor="bn-aan">Aan</label><input id="bn-aan" type="email" className="inp" value={m.aan} onChange={e => zetMail('aan', e.target.value)} /></div>
          <div style={{ gridColumn: '1/-1' }}><label htmlFor="bn-ond">Onderwerp</label><input id="bn-ond" className="inp" value={m.onderwerp} onChange={e => zetMail('onderwerp', e.target.value)} /></div>
          <div style={{ gridColumn: '1/-1' }}><label htmlFor="bn-tekst">Bericht</label><textarea id="bn-tekst" className="inp" rows={5} value={m.tekst} onChange={e => zetMail('tekst', e.target.value)} /></div>
        </div>
      )}
      {!factuur && <p className="note" style={{ marginBottom: 0 }}>Het bonnetje gaat <b>niet</b> naar Accountable (inkomsten@ leest het in als een factuur): maak het eerst in Accountable (dagontvangsten) en vul hierboven het nummer in dat Accountable gaf. De PDF download je daarna met "Bonnetje (PDF)".</p>}
      {factuur && <p className="note" style={{ marginBottom: 0 }}>De factuur gaat altijd naar <b>{v?.accountable || 'Accountable'}</b>{naarKlant ? ' (in cc)' : ''}{v?.afzender ? <>, verstuurd vanaf <b>{v.afzender}</b></> : null}. Accountable verwerkt enkel mails vanaf je geregistreerde adres of een goedgekeurde alias; {factuur ? 'de factuur' : 'het bonnetje'} verschijnt er na enkele minuten onder "Te valideren".</p>}
    </Dialoog>
  );
}

// Bonnetje (opnieuw) mailen: naar de klant, en naar Accountable zolang dat
// nog niet gebeurd is (nooit twee keer: dat zou een dubbele inkomst geven).
export function BonnetjeMailDialoog({ dossier, bedrijf, onSluit, onVerstuur }) {
  const k = dossier.klant_gegevens;
  const factuur = dossier.afgerekend_soort === 'factuur';
  // 30-09: een bonnetje enkel naar de klant (niet naar Accountable)
  const nogNietBijAccountable = factuur && !dossier.afrekening_gemaild_op;
  const [naarAcc, setNaarAcc] = useState(nogNietBijAccountable);
  const [naarKlant, setNaarKlant] = useState(!nogNietBijAccountable);
  const [m, setM] = useState({ aan: dossier.afrekening_klant_mail || k?.email || '', onderwerp: `${dossier.afgerekend_nummer} – ${dossier.titel}`, tekst: mailTekst({ klant: k, bedrijf, wat: factuur ? 'je factuur' : 'je bonnetje', titel: dossier.titel }) });
  const [bezig, setBezig] = useState(false);
  const zet = (sl, w) => setM(x => ({ ...x, [sl]: w }));
  const kan = !bezig && (naarAcc || naarKlant) && (!naarKlant || m.aan.trim());
  async function ok() {
    setBezig(true);
    try { await onVerstuur({ naar_accountable: naarAcc, naar_klant: naarKlant, ...(naarKlant ? m : {}) }); } finally { setBezig(false); }
  }
  return (
    <Dialoog titel={`${dossier.afgerekend_nummer} mailen`} onSluit={onSluit} breed
      voet={<><button type="button" className="btn" onClick={onSluit}>Annuleren</button><button type="button" className="btn primary" disabled={!kan} onClick={ok}>{bezig ? 'Bezig…' : 'Versturen'}</button></>}>
      {!factuur ? <p className="note" style={{ marginTop: 0 }}>Het bonnetje gaat <b>niet</b> naar Accountable (inkomsten@ leest het in als een factuur): zet het zelf in Accountable (dagontvangsten).</p> : nogNietBijAccountable
        ? <div className="waarschuwing" style={{ margin: '0 0 12px', display: 'block' }}>{factuur ? 'Deze factuur' : 'Dit bonnetje'} is nog <b>niet</b> naar Accountable gemaild.</div>
        : <p className="note" style={{ marginTop: 0 }}>Al naar Accountable gemaild op {fmtDatum(dossier.afrekening_gemaild_op)}. Nog eens sturen kan niet: dat zou een dubbele inkomst geven.</p>}
      {factuur && <label className="keuze" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={naarAcc} disabled={!nogNietBijAccountable} onChange={e => setNaarAcc(e.target.checked)} /> Naar Accountable
      </label>}
      <label className="keuze" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <input type="checkbox" checked={naarKlant} onChange={e => setNaarKlant(e.target.checked)} /> Naar de klant{naarAcc && naarKlant ? ' (Accountable in cc)' : ''}
      </label>
      {naarKlant && (
        <div className="fgrid" style={{ marginTop: 8 }}>
          <div style={{ gridColumn: '1/-1' }}><label htmlFor="bm-aan">Aan</label><input id="bm-aan" type="email" className="inp" value={m.aan} onChange={e => zet('aan', e.target.value)} /></div>
          <div style={{ gridColumn: '1/-1' }}><label htmlFor="bm-ond">Onderwerp</label><input id="bm-ond" className="inp" value={m.onderwerp} onChange={e => zet('onderwerp', e.target.value)} /></div>
          <div style={{ gridColumn: '1/-1' }}><label htmlFor="bm-tekst">Bericht</label><textarea id="bm-tekst" className="inp" rows={5} value={m.tekst} onChange={e => zet('tekst', e.target.value)} /></div>
        </div>
      )}
    </Dialoog>
  );
}

// Gratis geleverd (25-09): de klant betaalt niets. Geen afrekening in
// Accountable, geen omzet; de kost blijft zichtbaar in Financiën → Marges.
export function GratisDialoog({ dossier, onSluit, onBevestig }) {
  const [d, setD] = useState(vandaag());
  const [leveren, setLeveren] = useState(true);
  const waarde = dossier.werkbon?.bedrag ?? dossier.zonder_werkbon?.bedrag ?? dossier.berekening.totaal;
  return (
    <Dialoog titel="Gratis geleverd" onSluit={onSluit}
      voet={<><button type="button" className="btn" onClick={onSluit}>Terug</button><button type="button" className="btn primary" onClick={() => onBevestig(d, leveren)}>Gratis geleverd</button></>}>
      <p className="note" style={{ marginTop: 0 }}>De klant krijgt dit zonder te betalen (bv. goodwill of een test). Er komt <b>geen</b> factuur of bonnetje in Accountable en het telt <b>niet</b> als omzet.
        Je kost blijft zichtbaar in Financiën → Marges en in het overzicht. {dossier.werkbon ? `De werkbon ${dossier.werkbon.weergave} wordt definitief.` : 'Er wordt een werkbon gemaakt en definitief gezet.'}</p>
      <AfwijkingOfferte dossier={dossier} />
      {waarde != null && <p style={{ margin: '0 0 10px' }}>Waarde volgens de werkbon: <b className="num">{euro(waarde)}</b></p>}
      <label className="lbl" htmlFor="gr-datum">Datum</label>
      <input id="gr-datum" type="date" className="inp" max={vandaag()} value={d} onChange={e => setD(e.target.value)} />
      <VoorraadLeveren dossier={dossier} aan={leveren} onWijzig={setLeveren} />
      <p className="sub" style={{ marginBottom: 0 }}>Gaat de opdracht helemaal niet door? Gebruik dan "Dossier annuleren".</p>
    </Dialoog>
  );
}

export function BetaaldDialoog({ vanaf, onSluit, onBevestig }) {
  const [d, setD] = useState(vandaag());
  return (
    <Dialoog titel="Betaald" onSluit={onSluit}
      voet={<><button type="button" className="btn" onClick={onSluit}>Annuleren</button><button type="button" className="btn primary" onClick={() => onBevestig(d)}>Betaald</button></>}>
      <label className="lbl" htmlFor="bt-datum">Betaald op</label>
      <input id="bt-datum" type="date" className="inp" min={vanaf || undefined} max={vandaag()} value={d} onChange={e => setD(e.target.value)} autoFocus />
    </Dialoog>
  );
}

function Kopieer({ tekst }) {
  const [ok, setOk] = useState(false);
  if (!tekst) return null;
  return (
    <button type="button" className="btn ghost kopieer" aria-label={`Kopieer ${tekst}`}
      onClick={async () => { try { await navigator.clipboard.writeText(String(tekst)); setOk(true); setTimeout(() => setOk(false), 1200); } catch { /* geen klembord */ } }}>
      {ok ? 'Gekopieerd' : 'Kopieer'}
    </button>
  );
}

// Overnamefiche: alles wat je in Accountable moet overtypen, met een
// kopieerknop per waarde.
export function Overnamefiche({ dossier, onSluit }) {
  const k = dossier.klant_gegevens;
  const b = dossier.overname || { regels: [], totaal: null, vast: 0 };
  const adres = k ? [[k.straat, k.huisnummer].filter(Boolean).join(' '), [k.postcode, k.gemeente].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';
  const klantRijen = k ? [
    ['Klant', klantNaam(k)], ['Adres', adres], ['Btw-nummer', k.btw_nummer], ['Peppol-ID', k.peppol_id], ['E-mail', k.email], ['Telefoon', k.gsm || k.telefoon],
  ].filter(([, v]) => v) : [];
  return (
    <Dialoog titel={`Overnamefiche ${dossier.nummer}`} onSluit={onSluit} breed
      voet={<button type="button" className="btn primary" onClick={onSluit}>Sluiten</button>}>
      <p className="note" style={{ marginTop: 0 }}>{dossier.werkbon ? `Volgens werkbon ${dossier.werkbon.weergave}${dossier.werkbon.definitief_op ? ' (definitief)' : ''}.` : 'Volgens de regels van het dossier (nog geen werkbon).'}</p>
      {k ? (
        <table className="mini overname">
          <tbody>{klantRijen.map(([l, v]) => <tr key={l}><th>{l}</th><td>{v}</td><td className="r"><Kopieer tekst={v} /></td></tr>)}</tbody>
        </table>
      ) : <p className="sub">Geen klant gekozen in dit dossier.</p>}
      <div className="tabelvak" style={{ marginTop: 14 }}>
        <table className="mini overname">
          <thead><tr><th>Omschrijving</th><th className="r">Aantal</th><th className="r">Prijs/stuk</th><th className="r">Bedrag</th><th><span className="sr-only">Kopieer</span></th></tr></thead>
          <tbody>
            {b.regels.map((r, i) => (
              <tr key={i}>
                <td>{r.omschrijving} <Kopieer tekst={r.omschrijving} /></td>
                <td className="r num">{r.aantal}</td>
                <td className="r num">{r.per_stuk != null ? euro(r.per_stuk) : '—'}</td>
                <td className="r num">{euro(r.bedrag)}</td>
                <td className="r"><Kopieer tekst={r.bedrag != null ? naarInvoer(r.bedrag) : ''} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><th colSpan={3}>Totaal</th><th className="r num">{euro(b.totaal)}</th><td className="r"><Kopieer tekst={naarInvoer(b.totaal)} /></td></tr></tfoot>
        </table>
      </div>
      <p className="note" style={{ marginBottom: 0 }}>Vrijgesteld van btw (art. 56bis). {b.vast > 0 && `Waarvan ${euro(b.vast)} vaste prijs (bv. verzending). `}Aangemaakt op {fmtDatum(dossier.aangemaakt_op)}.</p>
    </Dialoog>
  );
}
