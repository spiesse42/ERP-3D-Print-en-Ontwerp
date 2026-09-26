import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, BASE } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Veld, Laden, Fout } from '../../schil/Weergaven.jsx';
import Historiek from '../../schil/Historiek.jsx';
import Icoon from '../../schil/Icoon.jsx';
import KeuzeMetToevoegen from '../../components/KeuzeMetToevoegen.jsx';
import { euro, datum, naarInvoer, uitInvoer, vandaag, aantal as fmtAantal } from '../../lib/formaat.js';
import { klantNaam } from '../klanten/klant.js';
import { mailTekst } from '../dossiers/MailDialoog.jsx';
import { BonnetjeMailDialoog } from '../dossiers/AfrekenDialogen.jsx';
import { StatusBadge } from './VerkopenLijst.jsx';

// Losse verkoop (26-09): iets verkopen dat op voorraad ligt, zonder dossier.
// "Verkopen" = in één keer: bonnetje (nummer uit Instellingen → Nummering,
// zelfde reeks als op een dossier), voorraad eraf (oudste partij eerst) en
// mailen naar Accountable (+ optioneel de klant). Daarna ligt de verkoop
// vast; enkel de klant kan nog aangevuld worden (opvolging).
const openUrl = pad => window.open(new URL(`${BASE}${pad}`, document.baseURI).href, '_blank', 'noopener');
const legeRegel = () => ({ sleutel: Math.random().toString(36).slice(2), artikel_id: '', aantal: '1', prijs: '', omschrijving: '' });
const getal = t => { const n = uitInvoer(t); return n === null || Number.isNaN(n) ? null : n; };

export default function VerkoopFormulier() {
  const { id } = useParams();
  return id === 'nieuw' ? <NieuweVerkoop /> : <Verkoop id={id} />;
}

function useKlanten() {
  const { data: klanten, herlaad } = useData('/klanten?archief=alle');
  const opties = (sel) => (klanten || []).filter(k => !k.gearchiveerd || String(k.id) === sel)
    .map(k => ({ id: k.id, naam: klantNaam(k) })).sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
  async function nieuw(naam) { const k = await api.post('/klanten', { type: 'particulier', naam }); await herlaad(); return k; }
  return { klanten, opties, nieuw };
}

function NieuweVerkoop() {
  const { melding, navigeer, zetVuil } = useOmgeving();
  const { klanten, opties: klantOpties, nieuw: nieuweKlant } = useKlanten();
  const { data: artikelen } = useData('/voorraad/artikelen');
  const { data: instellingen } = useData('/instellingen');
  const bedrijf = (instellingen || []).find(i => i.sleutel === 'bedrijf_naam')?.waarde || '';
  const [f, setF] = useState({ datum: vandaag(), klant_id: '', omschrijving: '' });
  const [regels, setRegels] = useState([legeRegel()]);
  const [naarKlant, setNaarKlant] = useState(false);
  const [mail, setMail] = useState(null);
  const [bezig, setBezig] = useState(false);
  const { data: v, fout: voorstelFout } = useData(`/verkopen/voorstel?datum=${f.datum}`);
  const vuil = regels.some(r => r.artikel_id) || !!f.klant_id || !!f.omschrijving;
  useEffect(() => { zetVuil(vuil); return () => zetVuil(false); }, [vuil, zetVuil]);

  const klant = (klanten || []).find(k => String(k.id) === f.klant_id) || null;
  // verkoopbaar: artikelen/filament met voorraad, diensten die verkocht worden
  const perId = useMemo(() => new Map((artikelen || []).map(a => [String(a.id), a])), [artikelen]);
  const keuze = (artikelen || []).filter(a => (a.type === 'dienst' ? a.wordt_verkocht : a.voorraad > 0));
  const groepen = [['artikel', 'Artikelen (op voorraad)'], ['filament', 'Filament (rollen op voorraad)'], ['dienst', 'Diensten (bv. verzending)']]
    .map(([t, l]) => [l, keuze.filter(a => a.type === t)]).filter(([, l]) => l.length);
  const zet = (k, w) => setF(x => ({ ...x, [k]: w }));
  const zetRegel = (i, w) => setRegels(rs => rs.map((r, j) => (j === i ? { ...r, ...w } : r)));
  function kiesArtikel(i, id) {
    const a = perId.get(id);
    zetRegel(i, { artikel_id: id, prijs: a?.verkoopprijs != null ? naarInvoer(a.verkoopprijs) : '', omschrijving: '' });
  }
  const bedragen = regels.map(r => { const n = getal(r.aantal), p = getal(r.prijs); return n != null && p != null ? Math.round(n * p * 100) / 100 : null; });
  const totaal = Math.round(bedragen.reduce((t, b) => t + (b || 0), 0) * 100) / 100;
  // zelfde artikel op meerdere regels: samen tegenover de voorraad
  const gevraagd = new Map();
  regels.forEach(r => { const a = perId.get(r.artikel_id); if (a && a.type !== 'dienst') gevraagd.set(r.artikel_id, (gevraagd.get(r.artikel_id) || 0) + (getal(r.aantal) || 0)); });
  const tekort = [...gevraagd].filter(([aid, n]) => n > (perId.get(aid)?.voorraad ?? 0) + 1e-9).map(([aid]) => perId.get(aid).weergave);
  const ingevuld = regels.filter(r => r.artikel_id);
  const m = mail || { aan: klant?.email || '', onderwerp: v ? `${v.nummer}${f.omschrijving ? ` – ${f.omschrijving}` : ''}` : '', tekst: mailTekst({ klant, bedrijf, wat: 'je bonnetje', titel: f.omschrijving || 'je aankoop' }) };
  const zetMail = (k, w) => setMail({ ...m, [k]: w });
  const blokkeert = !v ? null : !v.mail_ingesteld ? 'Mailen is nog niet ingesteld (smtp_user/smtp_pass in de add-on-configuratie). Een bonnetje moet naar Accountable gemaild worden.'
    : !v.pdf_mogelijk ? 'Geen Chrome, Edge of Chromium gevonden om de PDF te maken.' : null;
  const onvolledig = !ingevuld.length ? 'Kies minstens één artikel.' : ingevuld.some((r, i) => getal(r.aantal) == null || getal(r.aantal) <= 0) ? 'Vul bij elke regel een aantal in.'
    : ingevuld.some(r => getal(r.prijs) == null) ? 'Vul bij elke regel de prijs per stuk in.' : tekort.length ? `Onvoldoende voorraad: ${tekort.join(', ')}.` : null;
  const body = () => ({ datum: f.datum, klant_id: f.klant_id || null, omschrijving: f.omschrijving,
    regels: ingevuld.map(r => ({ artikel_id: Number(r.artikel_id), aantal: r.aantal, prijs_per_stuk: r.prijs, omschrijving: r.omschrijving })) });

  async function voorbeeld() {
    try {
      const res = await fetch(`${BASE}/verkopen/voorbeeld`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Voorbeeld mislukt');
      window.open(URL.createObjectURL(await res.blob()), '_blank', 'noopener');
    } catch (e) { melding(e.message, 'fout'); }
  }
  async function verkopen() {
    setBezig(true);
    try {
      const r = await api.post('/verkopen', { ...body(), naar_klant: naarKlant, ...(naarKlant ? { aan: m.aan, onderwerp: m.onderwerp, tekst: m.tekst } : {}) });
      zetVuil(false);
      if (r.mail_fout) melding(`${r.nummer} is gemaakt en de voorraad is aangepast, maar het mailen mislukte: ${r.mail_fout} Het is nog NIET bij Accountable: gebruik "Bonnetje mailen".`, 'fout');
      else melding(`${r.nummer} gemaakt en gemaild naar Accountable${naarKlant ? ` en ${m.aan}` : ''}.`);
      navigeer(`/verkoop/${r.id}`);
    } catch (e) { melding(e.message, 'fout'); setBezig(false); }
  }

  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Verkoop', naar: '/verkoop' }, { label: 'Nieuwe verkoop' }]} />
      <div className="sheet-wrap">
        <div className="sheet">
          <div className="sheet-head">
            <div className="kop">
              <div className="nr">Nieuwe verkoop · bonnetje</div>
              <h2 className="mono-titel">{v?.nummer ?? '…'}</h2>
              <div className="sub">Dit nummer krijgt het bonnetje bij "Verkopen" (Instellingen → Nummering).</div>
            </div>
          </div>
          {(voorstelFout || blokkeert) && <div className="waarschuwing" style={{ margin: '0 22px 10px', display: 'block' }} role="alert">{voorstelFout || blokkeert}</div>}
          <div className="fields">
            <div>
              <Veld label="Datum" id="vk-datum"><input id="vk-datum" type="date" className="inp" max={vandaag()} value={f.datum} onChange={e => zet('datum', e.target.value || vandaag())} /></Veld>
              <Veld label="Omschrijving" id="vk-oms" hint="Optioneel, komt bovenaan het bonnetje (bv. Markt Aarsele).">
                <input id="vk-oms" className="inp" value={f.omschrijving} onChange={e => zet('omschrijving', e.target.value)} placeholder="bv. Markt Aarsele" /></Veld>
            </div>
            <div>
              <Veld label="Klant" id="vk-klant" hint="Optioneel bij een bonnetje; handig voor de opvolging.">
                <KeuzeMetToevoegen id="vk-klant" ariaLabel="Klant" waarde={f.klant_id} leegLabel="Geen klant" opties={klantOpties(f.klant_id)}
                  onKies={w => zet('klant_id', w)} onNieuw={nieuweKlant} watLabel="klant" />
              </Veld>
              {klant?.type === 'zakelijk' && <p className="sub" style={{ margin: 0 }}>Zakelijke klant: normaal krijgt die een factuur (voorlopig via Accountable).</p>}
            </div>
          </div>
          <div style={{ padding: '0 22px 16px' }}>
            <div className="tabelvak">
              <table className="mini">
                <thead><tr><th>Artikel</th><th className="r">Aantal</th><th className="r">Prijs/stuk</th><th className="r">Bedrag</th><th><span className="sr-only">Weghalen</span></th></tr></thead>
                <tbody>
                  {regels.map((r, i) => {
                    const a = perId.get(r.artikel_id);
                    return (
                      <tr key={r.sleutel}>
                        <td style={{ minWidth: 240 }}>
                          <select className="inp" aria-label={`Artikel regel ${i + 1}`} value={r.artikel_id} onChange={e => kiesArtikel(i, e.target.value)}>
                            <option value="">Kies een artikel…</option>
                            {groepen.map(([l, lijst]) => <optgroup key={l} label={l}>{lijst.map(x => <option key={x.id} value={x.id}>{x.weergave}{x.type !== 'dienst' ? ` (${fmtAantal(x.voorraad)} op voorraad)` : ''}</option>)}</optgroup>)}
                          </select>
                          {a && <input className="inp" style={{ marginTop: 4 }} aria-label={`Omschrijving op het bonnetje, regel ${i + 1}`} placeholder={`Op het bonnetje: ${a.weergave}`} value={r.omschrijving} onChange={e => zetRegel(i, { omschrijving: e.target.value })} />}
                        </td>
                        <td className="r"><input className="inp num" style={{ maxWidth: 80 }} inputMode="decimal" aria-label={`Aantal regel ${i + 1}`} value={r.aantal} onChange={e => zetRegel(i, { aantal: e.target.value })} /></td>
                        <td className="r"><span className="unit" style={{ justifyContent: 'flex-end' }}><input className="inp num" style={{ maxWidth: 90 }} inputMode="decimal" aria-label={`Prijs per stuk regel ${i + 1}`} value={r.prijs} placeholder={a && a.verkoopprijs == null ? 'prijs?' : ''} onChange={e => zetRegel(i, { prijs: e.target.value })} /><span>€</span></span></td>
                        <td className="r num">{bedragen[i] != null ? euro(bedragen[i]) : '—'}</td>
                        <td>{regels.length > 1 && <button type="button" className="btn ghost" aria-label={`Regel ${i + 1} weghalen`} onClick={() => setRegels(rs => rs.filter((_, j) => j !== i))}><Icoon naam="kruis" maat={12} /></button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr><th colSpan={3}>Totaal <span className="sub" style={{ fontWeight: 400 }}>btw 0 % (vrijgesteld, art. 56bis)</span></th><th className="r num">{euro(totaal)}</th><th /></tr></tfoot>
              </table>
            </div>
            <button type="button" className="linkish" style={{ marginTop: 6 }} onClick={() => setRegels(rs => [...rs, legeRegel()])}>+ nog een artikel</button>
            {artikelen && !keuze.length && <p className="sub">Er ligt niets op voorraad om te verkopen.</p>}
            {v && totaal > v.drempel && <div className="waarschuwing" style={{ margin: '10px 0 0', display: 'block' }}>Meer dan {euro(v.drempel)}: volgens Accountable is voor zo'n verkoop mogelijk een factuur nodig in plaats van een bonnetje.</div>}

            <label className="keuze" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
              <input type="checkbox" checked={naarKlant} onChange={e => setNaarKlant(e.target.checked)} /> Ook naar de klant mailen
            </label>
            {naarKlant && (
              <div className="fgrid" style={{ marginTop: 8 }}>
                <div style={{ gridColumn: '1/-1' }}><label htmlFor="vk-aan">Aan</label><input id="vk-aan" type="email" className="inp" value={m.aan} onChange={e => zetMail('aan', e.target.value)} /></div>
                <div style={{ gridColumn: '1/-1' }}><label htmlFor="vk-ond">Onderwerp</label><input id="vk-ond" className="inp" value={m.onderwerp} onChange={e => zetMail('onderwerp', e.target.value)} /></div>
                <div style={{ gridColumn: '1/-1' }}><label htmlFor="vk-tekst">Bericht</label><textarea id="vk-tekst" className="inp" rows={5} value={m.tekst} onChange={e => zetMail('tekst', e.target.value)} /></div>
              </div>
            )}
            <p className="note">Het bonnetje gaat altijd naar <b>{v?.accountable || 'Accountable'}</b>{naarKlant ? ' (in cc)' : ''}{v?.afzender ? <>, verstuurd vanaf <b>{v.afzender}</b></> : null}. De voorraad gaat meteen naar beneden (oudste partij eerst) en de verkoop staat op betaald.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" className="btn primary" disabled={bezig || !!onvolledig || !!blokkeert || !v || (naarKlant && !m.aan.trim())} onClick={verkopen}>
                {bezig ? 'Bezig…' : naarKlant ? 'Verkopen en mailen (klant + Accountable)' : 'Verkopen en mailen naar Accountable'}</button>
              <button type="button" className="btn" disabled={!!onvolledig} onClick={voorbeeld}>Voorbeeld (PDF)</button>
              <button type="button" className="btn ghost" onClick={() => navigeer('/verkoop')}>Annuleren</button>
              {onvolledig && ingevuld.length > 0 && <span className="sub">{onvolledig}</span>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Verkoop({ id }) {
  const { melding, bevestig } = useOmgeving();
  const { data: v, fout, herlaad } = useData(`/verkopen/${id}`);
  const { opties: klantOpties, nieuw: nieuweKlant } = useKlanten();
  const { data: instellingen } = useData('/instellingen');
  const bedrijf = (instellingen || []).find(i => i.sleutel === 'bedrijf_naam')?.waarde || '';
  const [mailen, setMailen] = useState(false);
  const [versie, setVersie] = useState(0);
  if (fout) return <><ControlePaneel kruimels={[{ label: 'Verkoop', naar: '/verkoop' }, { label: 'Niet gevonden' }]} /><Fout tekst={fout} /></>;
  if (!v) return <Laden />;
  const na = async () => { await herlaad(); setVersie(x => x + 1); };
  async function klantZetten(w) {
    try { await api.put(`/verkopen/${v.id}`, { klant_id: w || null }); await na(); melding('Klant bewaard.'); } catch (e) { melding(e.message, 'fout'); }
  }
  async function ongedaan() {
    if (!await bevestig({ titel: 'Verkoop ongedaan maken', gevaarlijk: true, bevestigLabel: 'Ongedaan maken', annuleerLabel: 'Terug',
      tekst: `${v.nummer} ongedaan maken? De voorraad wordt teruggeboekt en de verkoop telt niet meer mee in Financiën. Het nummer blijft bezet.${v.gemaild_op ? ' Het bonnetje staat al in Accountable: pas het daar ook aan.' : ''}` })) return;
    try { await api.post(`/verkopen/${v.id}/annuleer`); await na(); melding('Verkoop ongedaan gemaakt, voorraad teruggeboekt.'); } catch (e) { melding(e.message, 'fout'); }
  }
  async function mailVerstuur(f) {
    try { await api.post(`/verkopen/${v.id}/mail`, f); await na(); setMailen(false); melding(`${v.nummer} gemaild naar ${[f.naar_klant && f.aan, f.naar_accountable && 'Accountable'].filter(Boolean).join(' en ')}.`); }
    catch (e) { melding(e.message, 'fout'); }
  }
  const alsDossier = { klant_gegevens: v.klant_gegevens, afrekening_gemaild_op: v.gemaild_op, afrekening_klant_mail: v.klant_mail, afgerekend_nummer: v.nummer, titel: v.omschrijving || 'je aankoop' };
  const marge = Math.round((v.totaal - v.kost) * 100) / 100;
  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Verkoop', naar: '/verkoop' }, { label: v.nummer, mono: true }]} />
      <div className="sheet-wrap">
        <div className="sheet">
          <div className="sheet-status">
            <div className="btns">
              <button type="button" className="btn" onClick={() => openUrl(`/verkopen/${v.id}/pdf`)}>Bonnetje (PDF)</button>
              {!v.geannuleerd_op && <button type="button" className={`btn${v.gemaild_op ? '' : ' primary'}`} onClick={() => setMailen(true)}>Bonnetje mailen</button>}
              {!v.geannuleerd_op && <button type="button" className="btn ghost" onClick={ongedaan}>Ongedaan maken</button>}
            </div>
            <StatusBadge x={{ ...v, erp: true }} />
          </div>
          {!v.gemaild_op && !v.geannuleerd_op && <div className="waarschuwing" style={{ margin: '0 22px 10px', display: 'block' }} role="alert">Dit bonnetje is nog NIET naar Accountable gemaild. Kies "Bonnetje mailen", anders ontbreekt het in je dagontvangstenboek.</div>}
          <div className="sheet-head">
            <div className="kop">
              <div className="nr">Losse verkoop · {datum(v.datum)}</div>
              <h2 className="mono-titel">{v.nummer}</h2>
              {v.omschrijving && <div>{v.omschrijving}</div>}
            </div>
          </div>
          <div className="fields">
            <div>
              <Veld label="Klant" id="vk-klant">
                <KeuzeMetToevoegen id="vk-klant" ariaLabel="Klant" waarde={v.klant_id ? String(v.klant_id) : ''} leegLabel="Geen klant" opties={klantOpties(v.klant_id ? String(v.klant_id) : '')}
                  onKies={klantZetten} onNieuw={nieuweKlant} watLabel="klant" />
              </Veld>
              <Veld label="Gemaild"><div style={{ padding: '8px 0' }}>{v.gemaild_op ? `Accountable op ${datum(v.gemaild_op)}` : 'Nog niet naar Accountable'}{v.klant_mail ? ` · klant: ${v.klant_mail}` : ''}</div></Veld>
            </div>
            <div>
              <Veld label="Totaal"><div className="num" style={{ padding: '8px 0' }}><b>{euro(v.totaal)}</b> <span className="sub">btw 0 %, betaald</span></div></Veld>
              <Veld label="Kost / marge" hint={v.onvolledig ? 'Onvolledig: een partij had geen inkoopprijs.' : 'Kost = inkoopprijs van de uitgeboekte partijen.'}>
                <div className="num" style={{ padding: '8px 0' }}>{euro(v.kost)} · marge <b>{euro(marge)}</b></div></Veld>
            </div>
          </div>
          <div style={{ padding: '0 22px 18px' }}>
            <div className="tabelvak">
              <table className="mini">
                <thead><tr><th>Omschrijving</th><th className="r">Aantal</th><th className="r">Prijs/stuk</th><th className="r">Bedrag</th></tr></thead>
                <tbody>{v.regels.map(r => <tr key={r.id}><td>{r.omschrijving}{r.type === 'dienst' && <span className="sub"> · dienst</span>}</td><td className="r num">{fmtAantal(r.aantal)}</td><td className="r num">{euro(r.prijs_per_stuk)}</td><td className="r num">{euro(r.bedrag)}</td></tr>)}</tbody>
                <tfoot><tr><th colSpan={3}>Totaal</th><th className="r num">{euro(v.totaal)}</th></tr></tfoot>
              </table>
            </div>
          </div>
        </div>
        <Historiek entiteit="verkoop" id={v.id} versie={versie} />
      </div>
      {mailen && <BonnetjeMailDialoog dossier={alsDossier} bedrijf={bedrijf} onSluit={() => setMailen(false)} onVerstuur={mailVerstuur} />}
    </>
  );
}
