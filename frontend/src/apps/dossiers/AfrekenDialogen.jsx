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
export function AfrekenDialoog({ dossier, onSluit, onBevestig }) {
  // Standaardbedrag = bedrag van de werkbon (offerteprijs bij een aanvaarde offerte, anders volgens de metingen).
  // Nog geen werkbon: die wordt bij het afrekenen gemaakt (zonder_werkbon = wat hij zou tonen).
  const totaal = dossier.werkbon?.bedrag ?? dossier.zonder_werkbon?.bedrag ?? dossier.berekening.totaal;
  const [f, setF] = useState({ soort: 'factuur', nummer: '', datum: vandaag(), bedrag: naarInvoer(totaal) });
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
      {(dossier.lever_status === 'geen' || dossier.lever_status === 'deels') && (
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
        <div><label htmlFor="af-datum">Datum</label><input id="af-datum" type="date" className="inp" value={f.datum} onChange={e => zet('datum', e.target.value)} /></div>
        <div><label htmlFor="af-bedrag">Bedrag</label><div className="unit"><input id="af-bedrag" className="inp num" inputMode="decimal" value={f.bedrag} onChange={e => zet('bedrag', e.target.value)} /><span>€</span></div></div>
      </div>
    </Dialoog>
  );
}

// ── Bonnetje door het ERP (26-09) ───────────────────────────────────────
// Het ERP maakt het bonnetje (nummer uit Instellingen → Nummering, reeks
// Bonnetje), zet het dossier op afgerekend + betaald en mailt het ALTIJD
// naar Accountable (dagontvangstenboek); naar de klant is optioneel
// (Accountable dan in cc). Het bedrag is dat van de werkbon.
export function BonnetjeDialoog({ dossier, bedrijf, onSluit, onBevestig }) {
  const [dag, setDag] = useState(vandaag());
  const { data: v, fout } = useData(`/dossiers/${dossier.id}/bonnetje/voorstel?datum=${dag}`);
  const k = dossier.klant_gegevens;
  const [naarKlant, setNaarKlant] = useState(false);
  const [mail, setMail] = useState(null);   // pas invullen zodra het nummer gekend is
  const [bezig, setBezig] = useState(false);
  const m = mail || { aan: k?.email || '', onderwerp: v ? `${v.nummer} – ${dossier.titel}` : '', tekst: mailTekst({ klant: k, bedrijf, wat: 'je bonnetje', titel: dossier.titel }) };
  const zetMail = (sl, w) => setMail({ ...m, [sl]: w });
  const blokkeert = !v ? null : !v.mail_ingesteld ? 'Mailen is nog niet ingesteld (smtp_user/smtp_pass in de add-on-configuratie). Een bonnetje moet naar Accountable gemaild worden.'
    : !v.pdf_mogelijk ? 'Geen Chrome, Edge of Chromium gevonden om de PDF te maken.' : null;
  const kan = v && !blokkeert && !bezig && (!naarKlant || m.aan.trim());
  async function ok() {
    setBezig(true);
    try { await onBevestig({ datum: dag, naar_klant: naarKlant, ...(naarKlant ? { aan: m.aan, onderwerp: m.onderwerp, tekst: m.tekst } : {}) }); }
    finally { setBezig(false); }
  }
  return (
    <Dialoog titel="Bonnetje maken" onSluit={onSluit} breed
      voet={<>
        <button type="button" className="btn ghost" disabled={!v} onClick={() => openPdf(`/dossiers/${dossier.id}/bonnetje/voorbeeld?datum=${dag}`)}>Voorbeeld (PDF)</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={onSluit}>Annuleren</button>
        <button type="button" className="btn primary" disabled={!kan} onClick={ok}>{bezig ? 'Bezig…' : naarKlant ? 'Maken en mailen (klant + Accountable)' : 'Maken en mailen naar Accountable'}</button>
      </>}>
      {fout && <div className="waarschuwing" style={{ margin: '0 0 12px', display: 'block' }} role="alert">{fout}</div>}
      {blokkeert && <div className="waarschuwing" style={{ margin: '0 0 12px', display: 'block' }} role="alert">{blokkeert}</div>}
      <div className="fgrid">
        <div><label htmlFor="bn-datum">Datum (ontvangen)</label><input id="bn-datum" type="date" className="inp" max={vandaag()} value={dag} onChange={e => setDag(e.target.value || vandaag())} /></div>
        <div><span className="lbl">Nummer</span><div className="mono" style={{ padding: '8px 0' }}>{v?.nummer ?? '…'}</div></div>
        <div><span className="lbl">Bedrag</span><div className="num" style={{ padding: '8px 0' }}><b>{v ? euro(v.bedrag) : '…'}</b> <span className="sub">btw 0 %</span></div></div>
      </div>
      <p className="sub" style={{ margin: '4px 0 0' }}>Het bedrag is dat van de werkbon{v?.werkbon ? ` ${v.werkbon}` : ''}{dossier.werkbon ? '' : ' (wordt nu gemaakt)'}; de werkbon wordt definitief en het dossier staat meteen op betaald. Een ander bedrag nodig? Pas eerst de regels aan.</p>
      {v && v.bedrag > v.drempel && <div className="waarschuwing" style={{ margin: '10px 0 0', display: 'block' }}>Meer dan {euro(v.drempel)}: volgens Accountable is voor zo'n verkoop mogelijk een factuur nodig in plaats van een bonnetje.</div>}
      {k?.type === 'zakelijk' && <div className="waarschuwing" style={{ margin: '10px 0 0', display: 'block' }}>Zakelijke klant: normaal krijgt die een factuur (voorlopig nog via Accountable: "Afrekenen").</div>}
      {(dossier.lever_status === 'geen' || dossier.lever_status === 'deels') && <div className="waarschuwing" style={{ margin: '10px 0 0', display: 'block' }}>Nog niet alles geleverd{dossier.lever_status === 'deels' ? ' (deels geleverd)' : ''}. Dat mag; lever daarna verder via het tabblad Leveringen.</div>}
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
      <p className="note" style={{ marginBottom: 0 }}>Het bonnetje gaat altijd naar <b>{v?.accountable || 'Accountable'}</b>{naarKlant ? ' (in cc)' : ''}{v?.afzender ? <>, verstuurd vanaf <b>{v.afzender}</b></> : null}. Accountable verwerkt enkel mails vanaf je geregistreerde adres of een goedgekeurde alias; het bonnetje verschijnt er na enkele minuten onder "Te valideren".</p>
    </Dialoog>
  );
}

// Bonnetje (opnieuw) mailen: naar de klant, en naar Accountable zolang dat
// nog niet gebeurd is (nooit twee keer: dat zou een dubbele inkomst geven).
export function BonnetjeMailDialoog({ dossier, bedrijf, onSluit, onVerstuur }) {
  const k = dossier.klant_gegevens;
  const nogNietBijAccountable = !dossier.afrekening_gemaild_op;
  const [naarAcc, setNaarAcc] = useState(nogNietBijAccountable);
  const [naarKlant, setNaarKlant] = useState(!nogNietBijAccountable);
  const [m, setM] = useState({ aan: dossier.afrekening_klant_mail || k?.email || '', onderwerp: `${dossier.afgerekend_nummer} – ${dossier.titel}`, tekst: mailTekst({ klant: k, bedrijf, wat: 'je bonnetje', titel: dossier.titel }) });
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
      {nogNietBijAccountable
        ? <div className="waarschuwing" style={{ margin: '0 0 12px', display: 'block' }}>Dit bonnetje is nog <b>niet</b> naar Accountable gemaild.</div>
        : <p className="note" style={{ marginTop: 0 }}>Al naar Accountable gemaild op {fmtDatum(dossier.afrekening_gemaild_op)}. Nog eens sturen kan niet: dat zou een dubbele inkomst geven.</p>}
      <label className="keuze" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={naarAcc} disabled={!nogNietBijAccountable} onChange={e => setNaarAcc(e.target.checked)} /> Naar Accountable
      </label>
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
  const waarde = dossier.werkbon?.bedrag ?? dossier.zonder_werkbon?.bedrag ?? dossier.berekening.totaal;
  return (
    <Dialoog titel="Gratis geleverd" onSluit={onSluit}
      voet={<><button type="button" className="btn" onClick={onSluit}>Terug</button><button type="button" className="btn primary" onClick={() => onBevestig(d)}>Gratis geleverd</button></>}>
      <p className="note" style={{ marginTop: 0 }}>De klant krijgt dit zonder te betalen (bv. goodwill of een test). Er komt <b>geen</b> factuur of bonnetje in Accountable en het telt <b>niet</b> als omzet.
        Je kost blijft zichtbaar in Financiën → Marges en in het overzicht. {dossier.werkbon ? `De werkbon ${dossier.werkbon.weergave} wordt definitief.` : 'Er wordt een werkbon gemaakt en definitief gezet.'}</p>
      {waarde != null && <p style={{ margin: '0 0 10px' }}>Waarde volgens de werkbon: <b className="num">{euro(waarde)}</b></p>}
      <label className="lbl" htmlFor="gr-datum">Datum</label>
      <input id="gr-datum" type="date" className="inp" value={d} onChange={e => setD(e.target.value)} />
      <p className="sub" style={{ marginBottom: 0 }}>Gaat de opdracht helemaal niet door? Gebruik dan "Dossier annuleren".</p>
    </Dialoog>
  );
}

export function BetaaldDialoog({ onSluit, onBevestig }) {
  const [d, setD] = useState(vandaag());
  return (
    <Dialoog titel="Betaald" onSluit={onSluit}
      voet={<><button type="button" className="btn" onClick={onSluit}>Annuleren</button><button type="button" className="btn primary" onClick={() => onBevestig(d)}>Betaald</button></>}>
      <label className="lbl" htmlFor="bt-datum">Betaald op</label>
      <input id="bt-datum" type="date" className="inp" value={d} onChange={e => setD(e.target.value)} autoFocus />
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
