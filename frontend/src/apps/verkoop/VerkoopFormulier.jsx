import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, BASE } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Veld, Laden, Fout } from '../../schil/Weergaven.jsx';
import { Link } from '../../schil/Schil.jsx';
import Historiek from '../../schil/Historiek.jsx';
import Icoon from '../../schil/Icoon.jsx';
import KeuzeMetToevoegen from '../../components/KeuzeMetToevoegen.jsx';
import { euro, datum, naarInvoer, uitInvoer, vandaag, aantal as fmtAantal } from '../../lib/formaat.js';
import { klantNaam } from '../klanten/klant.js';
import { FASE } from '../dossiers/dossier.jsx';
import { mailTekst } from '../dossiers/MailDialoog.jsx';
import { BonnetjeMailDialoog } from '../dossiers/AfrekenDialogen.jsx';
import { StatusBadge } from './VerkopenLijst.jsx';

// Losse verkoop (26-09). Eén bonnetje met regels van vier soorten:
// - artikel        uit voorraad (of een dienst, bv. verzending)
// - dossier        één regel voor een klantdossier; prijs = werkbon, zonder
//                  aanvaarde offerte aanpasbaar; het dossier wordt afgerekend
// - printopdracht  een voltooide losse printopdracht (hele opdracht), voorstel
//                  van de rekenmotor, aanpasbaar
// - vrije regel    omschrijving + prijs, zonder voorraad
// "Verkopen" = bonnetje (nummer uit Instellingen → Nummering) + voorraad eraf
// + dossiers afgerekend + mailen naar Accountable (+ optioneel de klant).
const openUrl = pad => window.open(new URL(`${BASE}${pad}`, document.baseURI).href, '_blank', 'noopener');
let teller = 0;
const nieuweRegel = soort => ({ sleutel: `r${++teller}`, soort, artikel_id: '', dossier_id: '', printopdracht_id: '', aantal: '1', prijs: '', omschrijving: '' });
const getal = t => { const n = uitInvoer(t); return n === null || Number.isNaN(n) ? null : n; };
const r2 = v => Math.round(v * 100) / 100;
const SOORT_LABEL = { artikel: 'Artikel', dossier: 'Dossier', printopdracht: 'Printopdracht', vrij: 'Vrije regel' };

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
  const { data: kand } = useData('/verkopen/kandidaten');
  const { data: instellingen } = useData('/instellingen');
  const bedrijf = (instellingen || []).find(i => i.sleutel === 'bedrijf_naam')?.waarde || '';
  const [f, setF] = useState({ datum: vandaag(), klant_id: '', omschrijving: '' });
  const [regels, setRegels] = useState(() => [nieuweRegel('artikel')]);
  const [toonFilament, setToonFilament] = useState(false);
  const [naarKlant, setNaarKlant] = useState(false);
  const [mail, setMail] = useState(null);
  const [bezig, setBezig] = useState(false);
  const { data: v, fout: voorstelFout } = useData(`/verkopen/voorstel?datum=${f.datum}`);
  const ingevuld = regels.filter(r => (r.soort === 'artikel' && r.artikel_id) || (r.soort === 'dossier' && r.dossier_id)
    || (r.soort === 'printopdracht' && r.printopdracht_id) || (r.soort === 'vrij' && (r.omschrijving || r.prijs)));
  const vuil = ingevuld.length > 0 || !!f.klant_id || !!f.omschrijving;
  useEffect(() => { zetVuil(vuil); return () => zetVuil(false); }, [vuil, zetVuil]);

  const klant = (klanten || []).find(k => String(k.id) === f.klant_id) || null;
  const perId = useMemo(() => new Map((artikelen || []).map(a => [String(a.id), a])), [artikelen]);
  const dossierVan = useMemo(() => new Map((kand?.dossiers || []).map(d => [String(d.id), d])), [kand]);
  const opdrachtVan = useMemo(() => new Map((kand?.printopdrachten || []).map(o => [String(o.id), o])), [kand]);
  // verkoopbaar: artikelen met voorraad, diensten die verkocht worden; filamentrollen enkel met het vinkje
  const gekozenArt = new Set(regels.map(r => r.artikel_id));
  const keuze = (artikelen || []).filter(a => (a.type === 'dienst' ? a.wordt_verkocht : a.voorraad > 0) && (a.type !== 'filament' || toonFilament || gekozenArt.has(String(a.id))));
  const groepen = [['artikel', 'Artikelen (op voorraad)'], ['dienst', 'Diensten (bv. verzending)'], ['filament', 'Filament (rollen op voorraad)']]
    .map(([t, l]) => [l, keuze.filter(a => a.type === t)]).filter(([, l]) => l.length);
  const zet = (k, w) => setF(x => ({ ...x, [k]: w }));
  const zetRegel = (i, w) => setRegels(rs => rs.map((r, j) => (j === i ? { ...r, ...w } : r)));
  function kiesArtikel(i, id) {
    const a = perId.get(id);
    zetRegel(i, { artikel_id: id, prijs: a?.verkoopprijs != null ? naarInvoer(a.verkoopprijs) : '', omschrijving: '' });
  }
  function kiesDossier(i, id) {
    const d = dossierVan.get(id);
    zetRegel(i, { dossier_id: id, aantal: '1', prijs: d?.bedrag != null ? naarInvoer(d.bedrag) : '', omschrijving: '' });
    if (d?.klant_id && !f.klant_id) zet('klant_id', String(d.klant_id));
  }
  function kiesOpdracht(i, id) {
    const o = opdrachtVan.get(id);
    // voorstel per stuk op 2 decimalen: aantal × prijs/stuk = het bedrag op het bonnetje
    zetRegel(i, { printopdracht_id: id, aantal: o ? naarInvoer(o.aantal_goed) : '1', prijs: o?.voorstel != null ? naarInvoer(r2(o.voorstel / o.aantal_goed)) : '', omschrijving: '' });
  }
  const bedragen = regels.map(r => { const n = getal(r.aantal), p = getal(r.prijs); return n != null && p != null ? r2(n * p) : null; });
  const totaal = r2(bedragen.reduce((t, b) => t + (b || 0), 0));
  const gevraagd = new Map();
  regels.forEach(r => { const a = r.soort === 'artikel' && perId.get(r.artikel_id); if (a && a.type !== 'dienst') gevraagd.set(r.artikel_id, (gevraagd.get(r.artikel_id) || 0) + (getal(r.aantal) || 0)); });
  const tekort = [...gevraagd].filter(([aid, n]) => n > (perId.get(aid)?.voorraad ?? 0) + 1e-9).map(([aid]) => perId.get(aid).weergave);
  const andereKlant = regels.some(r => r.soort === 'dossier' && r.dossier_id && dossierVan.get(r.dossier_id)?.klant_id && f.klant_id && String(dossierVan.get(r.dossier_id).klant_id) !== f.klant_id);
  const m = mail || { aan: klant?.email || '', onderwerp: v ? `${v.nummer}${f.omschrijving ? ` – ${f.omschrijving}` : ''}` : '', tekst: mailTekst({ klant, bedrijf, wat: 'je bonnetje', titel: f.omschrijving || 'je aankoop' }) };
  const zetMail = (k, w) => setMail({ ...m, [k]: w });
  const blokkeert = !v ? null : !v.mail_ingesteld ? 'Mailen is nog niet ingesteld (smtp_user/smtp_pass in de add-on-configuratie). Een bonnetje moet naar Accountable gemaild worden.'
    : !v.pdf_mogelijk ? 'Geen Chrome, Edge of Chromium gevonden om de PDF te maken.' : null;
  const onvolledig = !ingevuld.length ? 'Voeg minstens één regel toe.'
    : ingevuld.some(r => r.soort === 'vrij' && !r.omschrijving.trim()) ? 'Geef elke vrije regel een omschrijving.'
    : ingevuld.some(r => getal(r.aantal) == null || getal(r.aantal) <= 0) ? 'Vul bij elke regel een aantal in.'
    : ingevuld.some(r => getal(r.prijs) == null) ? 'Vul bij elke regel de prijs in.'
    : tekort.length ? `Onvoldoende voorraad: ${tekort.join(', ')}.`
    : andereKlant ? 'Een dossier hoort bij een andere klant dan de gekozen klant.' : null;
  const body = () => ({ datum: f.datum, klant_id: f.klant_id || null, omschrijving: f.omschrijving,
    regels: ingevuld.map(r => ({ soort: r.soort, artikel_id: r.soort === 'artikel' ? Number(r.artikel_id) : undefined,
      dossier_id: r.soort === 'dossier' ? Number(r.dossier_id) : undefined, printopdracht_id: r.soort === 'printopdracht' ? Number(r.printopdracht_id) : undefined,
      aantal: r.aantal, prijs_per_stuk: r.prijs, omschrijving: r.omschrijving })) });

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
      if (r.mail_fout) melding(`${r.nummer} is gemaakt, maar het mailen mislukte: ${r.mail_fout} Het is nog NIET bij Accountable: gebruik "Bonnetje mailen".`, 'fout');
      else melding(`${r.nummer} gemaakt en gemaild naar Accountable${naarKlant ? ` en ${m.aan}` : ''}.`);
      navigeer(`/verkoop/${r.id}`);
    } catch (e) { melding(e.message, 'fout'); setBezig(false); }
  }

  const gekozenD = new Set(regels.map(r => r.dossier_id).filter(Boolean));
  const gekozenO = new Set(regels.map(r => r.printopdracht_id).filter(Boolean));
  function celKeuze(r, i) {
    if (r.soort === 'artikel') {
      const a = perId.get(r.artikel_id);
      return <>
        <select className="inp" aria-label={`Artikel regel ${i + 1}`} value={r.artikel_id} onChange={e => kiesArtikel(i, e.target.value)}>
          <option value="">Kies een artikel…</option>
          {groepen.map(([l, lijst]) => <optgroup key={l} label={l}>{lijst.map(x => <option key={x.id} value={x.id}>{x.weergave}{x.type !== 'dienst' ? ` (${fmtAantal(x.voorraad)} op voorraad)` : ''}</option>)}</optgroup>)}
        </select>
        {a && <input className="inp" style={{ marginTop: 4 }} aria-label={`Omschrijving op het bonnetje, regel ${i + 1}`} placeholder={`Op het bonnetje: ${a.weergave}`} value={r.omschrijving} onChange={e => zetRegel(i, { omschrijving: e.target.value })} />}
      </>;
    }
    if (r.soort === 'dossier') {
      const d = dossierVan.get(r.dossier_id);
      const lijst = (kand?.dossiers || []).filter(x => !gekozenD.has(String(x.id)) || String(x.id) === r.dossier_id)
        .sort((x, y) => (String(y.klant_id) === f.klant_id) - (String(x.klant_id) === f.klant_id));
      return <>
        <select className="inp" aria-label={`Dossier regel ${i + 1}`} value={r.dossier_id} onChange={e => kiesDossier(i, e.target.value)}>
          <option value="">Kies een dossier…</option>
          {lijst.map(x => {
            const ander = f.klant_id && x.klant_id && String(x.klant_id) !== f.klant_id;
            return <option key={x.id} value={x.id} disabled={!x.volledig || ander}>{x.nummer} · {x.titel}{x.klant ? ` · ${x.klant}` : ''} · {FASE[x.fase]?.[1] || x.fase} · {x.volledig ? euro(x.bedrag) : 'nog niet te berekenen'}{ander ? ' (andere klant)' : ''}</option>;
          })}
        </select>
        {!kand?.dossiers?.length && <div className="sub">Geen klantdossiers om af te rekenen.</div>}
        {d && <>
          <input className="inp" style={{ marginTop: 4 }} aria-label={`Omschrijving op het bonnetje, regel ${i + 1}`} placeholder={`Op het bonnetje: ${d.titel} (dossier ${d.nummer})`} value={r.omschrijving} onChange={e => zetRegel(i, { omschrijving: e.target.value })} />
          <div className="sub">{d.offerte ? `Offerteprijs ${euro(d.bedrag)}: ligt vast (de klant ging akkoord).` : `Berekend (werkbon, metingen): ${euro(d.bedrag)}. Je mag de prijs aanpassen.`}</div>
          {d.waarschuwingen.map(w => <div key={w} className="sub" style={{ color: 'var(--warn, #9a6b1f)' }}>{w}</div>)}
        </>}
      </>;
    }
    if (r.soort === 'printopdracht') {
      const o = opdrachtVan.get(r.printopdracht_id);
      const lijst = (kand?.printopdrachten || []).filter(x => !gekozenO.has(String(x.id)) || String(x.id) === r.printopdracht_id);
      return <>
        <select className="inp" aria-label={`Printopdracht regel ${i + 1}`} value={r.printopdracht_id} onChange={e => kiesOpdracht(i, e.target.value)}>
          <option value="">Kies een printopdracht…</option>
          {lijst.map(x => <option key={x.id} value={x.id}>{x.naam} · {x.printer} · {datum(x.voltooid_op)} · {fmtAantal(x.aantal_goed)} st.</option>)}
        </select>
        {!kand?.printopdrachten?.length && <div className="sub">Geen voltooide losse printopdrachten die nog niet verkocht zijn.</div>}
        {o && <>
          <input className="inp" style={{ marginTop: 4 }} aria-label={`Omschrijving op het bonnetje, regel ${i + 1}`} placeholder={`Op het bonnetje: ${o.naam}`} value={r.omschrijving} onChange={e => zetRegel(i, { omschrijving: e.target.value })} />
          <div className="sub">{o.voorstel != null ? `Berekend: ${euro(o.voorstel)} voor ${fmtAantal(o.aantal_goed)} st. (${euro(r2(o.voorstel / o.aantal_goed))} per stuk). Je mag de prijs aanpassen.` : `Niet te berekenen (${o.fout}): vul zelf een prijs in.`}</div>
          {o.waarschuwingen.map(w => <div key={w} className="sub" style={{ color: 'var(--warn, #9a6b1f)' }}>{w}</div>)}
        </>}
      </>;
    }
    return <input className="inp" aria-label={`Omschrijving regel ${i + 1}`} placeholder="Omschrijving (bv. Bluey-sleutelhanger)" value={r.omschrijving} onChange={e => zetRegel(i, { omschrijving: e.target.value })} />;
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
              <Veld label="Omschrijving" id="vk-oms" hint="Optioneel, komt bovenaan het bonnetje (bv. Bestelling FB).">
                <input id="vk-oms" className="inp" value={f.omschrijving} onChange={e => zet('omschrijving', e.target.value)} placeholder="bv. Bestelling FB" /></Veld>
            </div>
            <div>
              <Veld label="Klant" id="vk-klant" hint="Optioneel bij een bonnetje; bij een dossier komt de klant van het dossier.">
                <KeuzeMetToevoegen id="vk-klant" ariaLabel="Klant" waarde={f.klant_id} leegLabel="Geen klant" opties={klantOpties(f.klant_id)}
                  onKies={w => zet('klant_id', w)} onNieuw={nieuweKlant} watLabel="klant" />
              </Veld>
              {klant?.type === 'zakelijk' && <p className="sub" style={{ margin: 0 }}>Zakelijke klant: normaal krijgt die een factuur (voorlopig via Accountable).</p>}
            </div>
          </div>
          <div style={{ padding: '0 22px 16px' }}>
            <div className="tabelvak">
              <table className="mini">
                <thead><tr><th>Soort</th><th>Wat</th><th className="r">Aantal</th><th className="r">Prijs/stuk</th><th className="r">Bedrag</th><th><span className="sr-only">Weghalen</span></th></tr></thead>
                <tbody>
                  {regels.length === 0 && <tr><td colSpan={6} className="sub">Nog geen regels: voeg hieronder een artikel, dossier, printopdracht of vrije regel toe.</td></tr>}
                  {regels.map((r, i) => {
                    const vastAantal = r.soort === 'dossier' || r.soort === 'printopdracht';
                    const vastePrijs = r.soort === 'dossier' && dossierVan.get(r.dossier_id)?.offerte;
                    const a = perId.get(r.artikel_id);
                    return (
                      <tr key={r.sleutel}>
                        <td className="sub" style={{ whiteSpace: 'nowrap' }}>{SOORT_LABEL[r.soort]}</td>
                        <td style={{ minWidth: 260 }}>{celKeuze(r, i)}</td>
                        <td className="r"><input className="inp num" style={{ maxWidth: 80 }} inputMode="decimal" aria-label={`Aantal regel ${i + 1}`} value={r.aantal} disabled={vastAantal} title={vastAantal ? (r.soort === 'dossier' ? 'Een dossier is één regel' : 'De hele printopdracht (goede stuks)') : undefined} onChange={e => zetRegel(i, { aantal: e.target.value })} /></td>
                        <td className="r"><span className="unit" style={{ justifyContent: 'flex-end' }}><input className="inp num" style={{ maxWidth: 90 }} inputMode="decimal" aria-label={`Prijs per stuk regel ${i + 1}`} value={r.prijs} disabled={vastePrijs} placeholder={r.soort === 'artikel' && a && a.verkoopprijs == null ? 'prijs?' : ''} onChange={e => zetRegel(i, { prijs: e.target.value })} /><span>€</span></span></td>
                        <td className="r num">{bedragen[i] != null ? euro(bedragen[i]) : '—'}</td>
                        <td><button type="button" className="btn ghost" aria-label={`Regel ${i + 1} weghalen`} onClick={() => setRegels(rs => rs.filter((_, j) => j !== i))}><Icoon naam="kruis" maat={12} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr><th colSpan={4}>Totaal <span className="sub" style={{ fontWeight: 400 }}>btw 0 % (vrijgesteld, art. 56bis)</span></th><th className="r num">{euro(totaal)}</th><th /></tr></tfoot>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
              <button type="button" className="linkish" onClick={() => setRegels(rs => [...rs, nieuweRegel('artikel')])}>+ artikel</button>
              <button type="button" className="linkish" onClick={() => setRegels(rs => [...rs, nieuweRegel('dossier')])}>+ dossier</button>
              <button type="button" className="linkish" onClick={() => setRegels(rs => [...rs, nieuweRegel('printopdracht')])}>+ printopdracht</button>
              <button type="button" className="linkish" onClick={() => setRegels(rs => [...rs, nieuweRegel('vrij')])}>+ vrije regel</button>
              <label className="keuze" style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
                <input type="checkbox" checked={toonFilament} onChange={e => setToonFilament(e.target.checked)} /> Ook filamentrollen tonen
              </label>
            </div>
            {v && totaal > v.drempel && <div className="waarschuwing" style={{ margin: '10px 0 0', display: 'block' }}>Meer dan {euro(v.drempel)}: volgens Accountable is voor zo'n verkoop mogelijk een factuur nodig in plaats van een bonnetje.</div>}
            {regels.some(r => r.soort === 'dossier' && r.dossier_id) && <p className="note" style={{ marginBottom: 0 }}>Een dossier op dit bonnetje wordt meteen afgerekend en betaald (zelfde nummer); de werkbon wordt definitief. Ongedaan maken kan later via deze verkoop.</p>}

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
  const metDossier = v.regels.some(r => r.soort === 'dossier');
  const na = async () => { await herlaad(); setVersie(x => x + 1); };
  async function klantZetten(w) {
    try { await api.put(`/verkopen/${v.id}`, { klant_id: w || null }); await na(); melding('Klant bewaard.'); } catch (e) { melding(e.message, 'fout'); }
  }
  async function ongedaan() {
    if (!await bevestig({ titel: 'Verkoop ongedaan maken', gevaarlijk: true, bevestigLabel: 'Ongedaan maken', annuleerLabel: 'Terug',
      tekst: `${v.nummer} ongedaan maken? De voorraad wordt teruggeboekt${metDossier ? ', de dossiers worden weer "af te rekenen" (werkbon weer concept)' : ''}${v.regels.some(r => r.soort === 'printopdracht') ? ', de printopdrachten komen weer vrij' : ''} en de verkoop telt niet meer mee in Financiën. Het nummer blijft bezet.${v.gemaild_op ? ' Het bonnetje staat al in Accountable: pas het daar ook aan.' : ''}` })) return;
    try { await api.post(`/verkopen/${v.id}/annuleer`); await na(); melding('Verkoop ongedaan gemaakt.'); } catch (e) { melding(e.message, 'fout'); }
  }
  async function mailVerstuur(f) {
    try { await api.post(`/verkopen/${v.id}/mail`, f); await na(); setMailen(false); melding(`${v.nummer} gemaild naar ${[f.naar_klant && f.aan, f.naar_accountable && 'Accountable'].filter(Boolean).join(' en ')}.`); }
    catch (e) { melding(e.message, 'fout'); }
  }
  const alsDossier = { klant_gegevens: v.klant_gegevens, afrekening_gemaild_op: v.gemaild_op, afrekening_klant_mail: v.klant_mail, afgerekend_nummer: v.nummer, titel: v.omschrijving || 'je aankoop' };
  const eigenBedrag = r2(v.totaal - v.dossierdeel);
  const marge = r2(eigenBedrag - v.kost);
  const heeftEigen = v.regels.some(r => r.soort !== 'dossier');
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
              <Veld label="Klant" id="vk-klant" hint={metDossier ? 'Volgt het dossier op dit bonnetje.' : undefined}>
                {metDossier ? <div style={{ padding: '8px 0' }}>{v.klant || '—'}</div> : (
                  <KeuzeMetToevoegen id="vk-klant" ariaLabel="Klant" waarde={v.klant_id ? String(v.klant_id) : ''} leegLabel="Geen klant" opties={klantOpties(v.klant_id ? String(v.klant_id) : '')}
                    onKies={klantZetten} onNieuw={nieuweKlant} watLabel="klant" />)}
              </Veld>
              <Veld label="Gemaild"><div style={{ padding: '8px 0' }}>{v.gemaild_op ? `Accountable op ${datum(v.gemaild_op)}` : 'Nog niet naar Accountable'}{v.klant_mail ? ` · klant: ${v.klant_mail}` : ''}</div></Veld>
            </div>
            <div>
              <Veld label="Totaal"><div className="num" style={{ padding: '8px 0' }}><b>{euro(v.totaal)}</b> <span className="sub">btw 0 %, betaald</span></div></Veld>
              {heeftEigen && <Veld label="Kost / marge" hint={`${v.onvolledig ? 'Onvolledig: een inkoopprijs of productiekost ontbreekt. ' : ''}${metDossier ? 'Zonder de dossiers (die staan met hun eigen marge in Financiën → Marges).' : 'Kost = inkoopprijs uit voorraad + productiekost van de printopdrachten.'}`}>
                <div className="num" style={{ padding: '8px 0' }}>{euro(v.kost)} · marge <b>{euro(marge)}</b></div></Veld>}
            </div>
          </div>
          <div style={{ padding: '0 22px 18px' }}>
            <div className="tabelvak">
              <table className="mini">
                <thead><tr><th>Omschrijving</th><th className="r">Aantal</th><th className="r">Prijs/stuk</th><th className="r">Bedrag</th></tr></thead>
                <tbody>{v.regels.map(r => (
                  <tr key={r.id}>
                    <td>{r.omschrijving}
                      <div className="sub">
                        {r.soort === 'dossier' && <>Dossier <Link naar={`/dossiers/${r.dossier_id}`}><span className="mono">{r.dossier_nummer}</span></Link></>}
                        {r.soort === 'printopdracht' && <>Printopdracht "{r.printopdracht_naam}"</>}
                        {r.soort === 'vrij' && 'Vrije regel'}
                        {r.soort === 'artikel' && r.type === 'dienst' && 'Dienst'}
                        {r.berekend != null && Math.abs(r.berekend - r.bedrag) > 0.005 && <> · berekend {euro(r.berekend)}</>}
                      </div></td>
                    <td className="r num">{fmtAantal(r.aantal)}</td><td className="r num">{euro(r.prijs_per_stuk)}</td><td className="r num">{euro(r.bedrag)}</td>
                  </tr>))}</tbody>
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
