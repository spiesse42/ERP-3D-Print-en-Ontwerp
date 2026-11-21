import { useEffect, useState } from 'react';
import { api, BASE } from '../../lib/api.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { useData } from '../../schil/useData.js';
import Icoon from '../../schil/Icoon.jsx';
import { Totalen } from '../../components/RegelEditor.jsx';
import { euro, datum, naarInvoer } from '../../lib/formaat.js';
import { OfferteBadge } from './dossier.jsx';
import MailDialoog, { mailTekst } from './MailDialoog.jsx';

// Offertes en werkbon van een dossier (stap 5b). Alle regels en bedragen komen
// uit het dossier; een verstuurde offerte / definitieve werkbon is een
// bevroren momentopname in de backend.
const pdfUrl = pad => new URL(`${BASE}${pad}`, document.baseURI).href;
const openPdf = pad => window.open(pdfUrl(pad), '_blank', 'noopener');

function useActies({ vuil, herlaad }) {
  const { melding, bevestig } = useOmgeving();
  return async (methode, pad, tekst, { body, vraag } = {}) => {
    if (vuil) { melding('Sla eerst je wijzigingen op of verwerp ze.', 'fout'); return false; }
    if (vraag && !await bevestig(vraag)) return false;
    try { await api[methode](pad, body); await herlaad(); melding(tekst); return true; }
    catch (e) { melding(e.message, 'fout'); return false; }
  };
}

// 17-11: foto-bijlagen die op de pagina "Beelden" van de offerte kunnen
const OFFERTE_FOTO = /^image\/(png|jpe?g|webp)$/;
const vanOfferte = o => ({ geldig_tot: o.geldig_tot || '', levertermijn: o.levertermijn || '', opmerking: o.opmerking || '', een_regel: o.een_regel || '', fotos: o.fotos || [],
  staffel: o.staffel ? { regel_id: o.staffel.regel_id, aantallen: o.staffel.aantallen.join(', '), extra: o.staffel.extra || [] } : null });
const zelfde = (a, b) => a.geldig_tot === b.geldig_tot && a.levertermijn === b.levertermijn && a.opmerking === b.opmerking && a.een_regel === b.een_regel
  && a.fotos.length === b.fotos.length && a.fotos.every((x, i) => x === b.fotos[i]) && JSON.stringify(a.staffel) === JSON.stringify(b.staffel);

// 21-11: prijs per aantal (staffel) — één printregel herrekend voor andere
// aantallen; live voorbeeld uit de backend, zelfde berekening als op de PDF.
function StaffelKeuze({ d, f, setF }) {
  const print = d.regels.filter(r => r.type === 'printen' && r.id);
  const st = f.staffel;
  const [voorbeeld, setVoorbeeld] = useState(null);
  const [fout, setFout] = useState(null);
  const sleutel = st ? `${st.regel_id}|${st.aantallen}|${(st.extra || []).join(',')}` : '';
  // 21-11: artikels (bv. sleutelring, geen vaste prijs zoals verzending) en extra kosten per stuk tellen 1 per stuk mee
  const vast = new Set((d.berekening?.regels || []).filter(r => r._berekend?.vaste_prijs).map(r => r.id));
  const perStuk = d.regels.filter(r => r.id && ((r.type === 'artikel' && r.artikel_id && !vast.has(r.id)) || (r.type === 'extra' && r.per_stuk)));
  const berekend = new Map((d.berekening?.regels || []).map(r => [r.id, r]));
  const naamVan = r => r.omschrijving || berekend.get(r.id)?.naam || (r.type === 'artikel' ? 'Artikel' : 'Extra kost');
  const wisselExtra = id => setF(x => ({ ...x, staffel: { ...x.staffel, extra: (x.staffel.extra || []).includes(id) ? x.staffel.extra.filter(y => y !== id) : [...(x.staffel.extra || []), id] } }));
  useEffect(() => {
    if (!st?.regel_id || !String(st.aantallen).trim()) { setVoorbeeld(null); setFout(null); return undefined; }
    const t = setTimeout(async () => {
      try { setVoorbeeld(await api.post(`/dossiers/${d.id}/staffel`, { regel_id: st.regel_id, aantallen: st.aantallen, extra: st.extra || [] })); setFout(null); }
      catch (e) { setVoorbeeld(null); setFout(e.message); }
    }, 350);
    return () => clearTimeout(t);
  }, [sleutel, d.berekening?.totaal]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!print.length) return null;
  const standaard = () => (print.find(r => Number(r.per_plaat) > 0) || [...print].sort((a, b) => Number(b.aantal) - Number(a.aantal))[0]).id;
  return (
    <div style={{ marginTop: 10 }}>
      <label className="vinkje"><input type="checkbox" checked={!!st}
        onChange={e => setF(x => ({ ...x, staffel: e.target.checked ? { regel_id: standaard(), aantallen: '48, 96, 192', extra: [] } : null }))} /> Prijs per aantal tonen (indicatief)</label>
      {st && <>
        <div className="fgrid" style={{ marginTop: 4 }}>
          <div><label htmlFor={`st-regel-${d.id}`}>Printregel</label>
            <select id={`st-regel-${d.id}`} className="inp" value={st.regel_id} onChange={e => setF(x => ({ ...x, staffel: { ...x.staffel, regel_id: Number(e.target.value) } }))}>
              {print.map(r => <option key={r.id} value={r.id}>{r.omschrijving || 'Printwerk'} ({r.aantal} st.{Number(r.per_plaat) > 0 ? `, ${r.per_plaat} per plaat` : ''})</option>)}
            </select></div>
          <div><label htmlFor={`st-aantal-${d.id}`}>Aantallen</label>
            <input id={`st-aantal-${d.id}`} className="inp" placeholder="bv. 50, 100, 200" value={st.aantallen} onChange={e => setF(x => ({ ...x, staffel: { ...x.staffel, aantallen: e.target.value } }))} /></div>
        </div>
        {perStuk.length > 0 && (
          <div className="vinkjes" style={{ marginTop: 6 }}>
            <span className="sub">Per stuk meerekenen (1 per stuk):</span>
            {perStuk.map(r => <label key={r.id} className="vinkje"><input type="checkbox" checked={(st.extra || []).includes(r.id)} onChange={() => wisselExtra(r.id)} /> {naamVan(r)}</label>)}
          </div>
        )}
        {fout && <div className="note fout" style={{ marginTop: 6 }}>{fout}</div>}
        {voorbeeld && (
          <table className="staffel-tabel">
            <thead><tr><th>Aantal</th><th className="r">Platen</th><th className="r">Prijs per stuk</th><th className="r">Totaal</th></tr></thead>
            <tbody>{voorbeeld.rijen.map(x => <tr key={x.aantal}><td>{x.aantal} stuks</td><td className="r num">{x.platen ?? '—'}</td><td className="r num"><b>{euro(x.per_stuk)}</b></td><td className="r num">{euro(x.totaal)}</td></tr>)}</tbody>
          </table>
        )}
        <div className="sub">Herrekent "{print.find(r => r.id === st.regel_id)?.omschrijving || 'Printwerk'}"{voorbeeld?.extra?.length ? ` + ${voorbeeld.extra.join(', ')}` : ''} per aantal (printtijd, filament en platen). Het totaal van de offerte verandert niet; eenmalige kosten zoals ontwerp tellen niet mee.</div>
      </>}
    </div>
  );
}

function OfferteOpmaak({ d, o, f, setF }) {
  const { data } = useData(`/bijlagen/dossier/${d.id}`);
  const fotos = (data || []).filter(b => OFFERTE_FOTO.test(b.mimetype || ''));
  const printregels = d.regels.filter(r => r.type === 'printen').length;
  const samen = f.een_regel !== '';
  const wissel = id => setF(x => ({ ...x, fotos: x.fotos.includes(id) ? x.fotos.filter(y => y !== id) : [...x.fotos, id] }));
  return (
    <div className="offerte-opmaak" style={{ gridColumn: '1/-1' }}>
      {printregels > 1 && <>
        <label className="vinkje"><input type="checkbox" checked={samen}
          onChange={e => setF(x => ({ ...x, een_regel: e.target.checked ? (d.titel || 'Printwerk') : '' }))} /> De {printregels} printregels als één regel op de offerte</label>
        {samen && <input id={`o-een-${o.id}`} className="inp" aria-label="Omschrijving van de ene regel" maxLength={200} value={f.een_regel}
          placeholder="bv. Beeld Sainte Geneviève, 3D-print in 3 delen, PETG, hoogte 60 cm" onChange={e => setF(x => ({ ...x, een_regel: e.target.value }))}
          onBlur={e => { if (!e.target.value.trim()) setF(x => ({ ...x, een_regel: d.titel || 'Printwerk' })); }} />}
        {samen && <div className="sub">Ontwerp, afwerking en andere regels blijven apart. Het totaal blijft gelijk.</div>}
      </>}
      <StaffelKeuze d={d} f={f} setF={setF} />
      <div className="lbl" style={{ marginTop: 10 }}>Foto's op een aparte pagina "Beelden" {f.fotos.length > 0 && <span className="sub">({f.fotos.length} gekozen)</span>}</div>
      {fotos.length === 0 ? <div className="sub">Nog geen foto's in dit dossier. Voeg ze bovenaan het dossier toe (jpg, png of webp).</div> : (
        <div className="offerte-fotos">
          {fotos.map(b => {
            const aan = f.fotos.includes(b.id);
            return (
              <button key={b.id} type="button" className={`ofoto${aan ? ' aan' : ''}`} aria-pressed={aan} title={b.bestandsnaam} onClick={() => wissel(b.id)}>
                <img src={`${BASE}/bijlagen/bestand/${b.id}`} alt={b.bestandsnaam} loading="lazy" />
                {aan && <span className="nr">{f.fotos.indexOf(b.id) + 1}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OfferteKaart({ d, o, doe, vuil, onMail }) {
  const concept = o.status === 'concept';
  const [f, setF] = useState(() => vanOfferte(o));
  const fotosSleutel = (o.fotos || []).join(',');
  const staffelSleutel = JSON.stringify(o.staffel || null);
  useEffect(() => { setF(vanOfferte(o)); }, [o.geldig_tot, o.levertermijn, o.opmerking, o.een_regel, fotosSleutel, staffelSleutel]); // eslint-disable-line react-hooks/exhaustive-deps
  const gewijzigd = concept && !zelfde(f, vanOfferte(o));
  const kanAntwoorden = o.status === 'verstuurd' || o.status === 'verlopen';
  const afgerekend = d.fase === 'afgerekend' || d.fase === 'betaald';
  return (
    <div className="doc-kaart">
      <div className="doc-kop">
        <span><b className="mono">{o.weergave}</b> <OfferteBadge status={o.status} /></span>
        <b className="num">{euro(concept ? d.berekening.totaal : o.totaal)}</b>
      </div>
      <div className="sub">
        {concept ? 'Concept: volgt de huidige regels van het dossier.' : `Verstuurd op ${datum(o.verstuurd_op)} · geldig tot ${datum(o.geldig_tot)}`}
        {o.aanvaard_op && ` · aanvaard op ${datum(o.aanvaard_op)}`}{o.geweigerd_op && ` · geweigerd op ${datum(o.geweigerd_op)}`}
        {!concept && o.levertermijn && ` · levertermijn ${o.levertermijn}`}
      </div>
      {concept && (
        <div className="fgrid" style={{ marginTop: 10 }}>
          <div><label htmlFor={`o-geldig-${o.id}`}>Geldig tot</label><input id={`o-geldig-${o.id}`} type="date" className="inp" value={f.geldig_tot} onChange={e => setF(x => ({ ...x, geldig_tot: e.target.value }))} /></div>
          <div><label htmlFor={`o-lever-${o.id}`}>Levertermijn</label><input id={`o-lever-${o.id}`} className="inp" placeholder="bv. 1 week na akkoord" value={f.levertermijn} onChange={e => setF(x => ({ ...x, levertermijn: e.target.value }))} /></div>
          <div style={{ gridColumn: '1/-1' }}><label htmlFor={`o-opm-${o.id}`}>Opmerkingen en voorwaarden op de offerte</label><textarea id={`o-opm-${o.id}`} className="inp" rows={Math.min(12, Math.max(2, f.opmerking.split('\n').length + 1))} value={f.opmerking} onChange={e => setF(x => ({ ...x, opmerking: e.target.value }))} placeholder="bv. Kleur naar keuze, ophalen in Geel mogelijk" /></div>
          <OfferteOpmaak d={d} o={o} f={f} setF={setF} />
        </div>
      )}
      {!concept && o.opmerking && <div className="sub" style={{ marginTop: 4 }}>Opmerking: {o.opmerking}</div>}
      {!concept && (o.een_regel || o.fotos?.length > 0 || o.staffel) && <div className="sub" style={{ marginTop: 4 }}>{[o.een_regel && `Printwerk als één regel: ${o.een_regel}`, o.fotos?.length && `${o.fotos.length} foto('s) op de pagina Beelden`, o.staffel && `prijs per aantal: ${o.staffel.aantallen.join(', ')}`].filter(Boolean).join(' · ')}</div>}
      <div className="doc-knoppen">
        {gewijzigd && <button type="button" className="btn primary" onClick={() => doe('put', `/offertes/${o.id}`, 'Offerte bewaard.', { body: f })}>Bewaren</button>}
        <button type="button" className="btn" disabled={gewijzigd} onClick={() => openPdf(`/offertes/${o.id}/pdf`)}><Icoon naam="lijst" maat={14} /> PDF</button>
        {(concept || kanAntwoorden) && <button type="button" className="btn" disabled={gewijzigd || vuil} onClick={() => onMail(o)}>Mailen</button>}
        {concept && <button type="button" className="btn" disabled={gewijzigd} onClick={() => doe('post', `/offertes/${o.id}/versturen`, 'Offerte verstuurd en vastgelegd.', { vraag: { titel: 'Offerte versturen', tekst: `${o.weergave} wordt vastgelegd zoals ze nu is (${euro(d.berekening.totaal)}). Gebruik dit als je de offerte zelf doorstuurt (bv. via Vinted of WhatsApp). Wijzigen kan daarna enkel met een nieuwe versie.`, bevestigLabel: 'Versturen', annuleerLabel: 'Terug' } })}>Markeren als verstuurd</button>}
        {kanAntwoorden && <>
          <button type="button" className="btn primary" onClick={() => doe('post', `/offertes/${o.id}/aanvaard`, d.acties.starten ? `Offerte aanvaard: ${d.regels.some(r => r.type === 'printen') ? 'werkbon en printopdrachten aangemaakt' : 'werkbon aangemaakt'}.` : 'Offerte aanvaard.')}>Aanvaard</button>
          <button type="button" className="btn ghost" onClick={() => doe('post', `/offertes/${o.id}/geweigerd`, 'Offerte geweigerd.', { vraag: { titel: 'Offerte geweigerd', tekst: `De klant weigerde ${o.weergave}? Je kunt daarna een nieuwe versie maken.`, bevestigLabel: 'Geweigerd', annuleerLabel: 'Terug' } })}>Geweigerd</button>
        </>}
        {(o.status === 'aanvaard' || o.status === 'geweigerd') && !afgerekend && (
          <button type="button" className="btn ghost" onClick={() => doe('post', `/offertes/${o.id}/antwoord-ongedaan`, 'Antwoord ongedaan gemaakt.')}>Antwoord ongedaan</button>
        )}
        {concept && <button type="button" className="btn ghost" onClick={() => doe('delete', `/offertes/${o.id}`, 'Concept-offerte verwijderd.', { vraag: { titel: 'Concept verwijderen', tekst: `${o.weergave} verwijderen?`, bevestigLabel: 'Verwijderen', gevaarlijk: true } })}>Verwijderen</button>}
      </div>
    </div>
  );
}

export function OffertesTab({ d, vuil, herlaad, bedrijf }) {
  const doe = useActies({ vuil, herlaad });
  const [mail, setMail] = useState(null);
  const lijst = [...d.offertes].sort((a, b) => b.versie - a.versie);
  const heeftConcept = lijst.some(o => o.status === 'concept');
  return (
    <>
      {d.soort !== 'klant' ? <p className="sub">Een voorraaddossier of intern dossier krijgt geen offerte.</p> : <>
        {lijst.length === 0 && <div className="leeg" style={{ padding: '18px 8px' }}><b>Nog geen offerte.</b>Een offerte toont de regels van dit dossier. Bij het versturen wordt ze vastgelegd.</div>}
        {d.acties.offerte && !heeftConcept && (
          <button type="button" className="btn primary" style={{ marginBottom: 12 }} disabled={vuil}
            onClick={() => doe('post', `/dossiers/${d.id}/offertes`, lijst.length ? 'Nieuwe versie aangemaakt.' : 'Offerte aangemaakt.')}>
            <Icoon naam="plus" maat={14} /> {lijst.length ? 'Nieuwe versie' : 'Offerte maken'}
          </button>
        )}
        <div className="doc-lijst">{lijst.map(o => <OfferteKaart key={o.id} d={d} o={o} doe={doe} vuil={vuil} onMail={setMail} />)}</div>
      </>}
      {mail && <MailDialoog titel={`Offerte ${mail.weergave} mailen`} aan={d.klant_gegevens?.email}
        onderwerp={`Offerte ${mail.weergave} – ${d.titel}`} tekst={mailTekst({ klant: d.klant_gegevens, bedrijf, wat: 'onze offerte', titel: d.titel })}
        waarschuwing={mail.status === 'concept' ? 'Deze concept-offerte wordt eerst vastgelegd (verstuurd), daarna gemaild.' : null}
        onSluit={() => setMail(null)}
        onVerstuur={async f => { if (await doe('post', `/offertes/${mail.id}/mail`, `Offerte gemaild naar ${f.aan}.`, { body: f })) setMail(null); }} />}
    </>
  );
}

export function WerkbonTab({ d, vuil, herlaad, bedrijf }) {
  const doe = useActies({ vuil, herlaad });
  const w = d.werkbon;
  const printregels = d.regels.filter(r => r.type === 'printen');
  const begin = () => Object.fromEntries(printregels.map(r => [r.id, { uren: naarInvoer(r.werkelijk?.uren), kwh: naarInvoer(r.werkelijk?.kwh) }]));
  const [werkelijk, setWerkelijk] = useState(begin);
  const [opmerking, setOpmerking] = useState(w?.opmerking || '');
  const [mail, setMail] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setWerkelijk(begin()); setOpmerking(w?.opmerking || ''); }, [d]);
  const vast = !!w?.definitief_op || !d.acties.bewerken;
  const werkelijkGewijzigd = JSON.stringify(werkelijk) !== JSON.stringify(begin());
  const opmGewijzigd = !!w && opmerking !== (w.opmerking || '');
  if (!w) {
    return (
      <div className="leeg" style={{ padding: '18px 8px' }}>
        <b>Nog geen werkbon.</b>
        De werkbon toont wat er echt gedaan is: de regels van het dossier met de werkelijke printtijd en het gemeten verbruik.{d.soort === 'klant' && ' Hij wordt vanzelf gemaakt bij Starten, als de klant de offerte aanvaardt, of bij het afrekenen.'}
        {d.acties.werkbon && <div style={{ marginTop: 12 }}><button type="button" className="btn primary" disabled={vuil} onClick={() => doe('post', `/dossiers/${d.id}/werkbon`, 'Werkbon aangemaakt.')}><Icoon naam="plus" maat={14} /> Werkbon maken</button></div>}
      </div>
    );
  }
  const zet = (id, k, v) => setWerkelijk(x => ({ ...x, [id]: { ...x[id], [k]: v } }));
  const b = w.berekening;
  const g = r => (r.gemeten?.geslaagd.runs ? r.gemeten.geslaagd : null);
  const gemetenUren = r => (g(r) ? naarInvoer(Math.round(g(r).uren * 100) / 100) : '—');
  const gemetenKwh = r => (g(r) && !g(r).kwh_onbekend ? naarInvoer(Math.round(g(r).kwh * 1000) / 1000) : '—');
  const mislukt = printregels.reduce((t, r) => t + (r.gemeten?.mislukt.kost || 0), 0);
  return (
    <>
      <div className="doc-kaart">
        <div className="doc-kop">
          <span><b className="mono">{w.weergave}</b> {w.definitief_op ? <span className="badge b-pos">Definitief {datum(w.definitief_op)}</span> : <span className="badge b-neutral">Concept</span>}</span>
          <b className="num">{euro(w.definitief_op ? w.totaal : w.bedrag)}</b>
        </div>
        <div className="sub">{w.definitief_op ? 'Vastgelegd bij het afrekenen.'
          : w.basis === 'offerte' ? `Bedrag volgens de aanvaarde offerte ${w.offerte}. De metingen hieronder dienen voor de marge-analyse. Wordt definitief bij het afrekenen.`
          : 'Geen aanvaarde offerte: berekend met de werkelijke printtijd en het gemeten verbruik (anders de schatting). Wordt definitief bij het afrekenen.'}</div>
        <div className="doc-knoppen">
          <button type="button" className="btn" onClick={() => openPdf(`/werkbonnen/${w.id}/pdf`)}><Icoon naam="lijst" maat={14} /> PDF</button>
          <button type="button" className="btn" disabled={vuil || werkelijkGewijzigd || opmGewijzigd} onClick={() => setMail(true)}>Mailen</button>
          {!w.definitief_op && <button type="button" className="btn ghost" onClick={() => doe('delete', `/werkbonnen/${w.id}`, 'Werkbon verwijderd.', { vraag: { titel: 'Werkbon verwijderen', tekst: `${w.weergave} verwijderen? De ingevulde werkelijke tijden blijven bij de regels bewaard.`, bevestigLabel: 'Verwijderen', gevaarlijk: true } })}>Verwijderen</button>}
        </div>
      </div>

      {d.wijkt_af_van_offerte && !vast && (
        <div className="waarschuwing" style={{ margin: '12px 0' }}>
          <span>De regels wijken af van de aanvaarde offerte.</span>
          <button type="button" className="btn" style={{ marginLeft: 'auto' }} disabled={vuil}
            onClick={() => doe('post', `/dossiers/${d.id}/regels-uit-offerte`, 'Regels teruggezet naar de offerte.', { vraag: { titel: 'Regels terugzetten', tekst: 'De regels van het dossier worden vervangen door die van de aanvaarde offerte. Werkelijke tijden blijven bewaard.', bevestigLabel: 'Terugzetten', annuleerLabel: 'Terug' } })}>Regels terugzetten naar offerte</button>
        </div>
      )}

      {printregels.length > 0 && (
        <>
          <h4 className="tussenkop">Werkelijk verbruik per print</h4>
          <div className="tabelvak">
            <table className="mini werkelijk">
              <thead><tr><th>Print</th><th className="r">Geschat</th><th className="r">Werkelijke printtijd</th><th className="r">Gemeten verbruik</th></tr></thead>
              <tbody>
                {printregels.map((r, i) => (
                  <tr key={r.id}>
                    <td>{r.omschrijving || `Printregel ${i + 1}`}
                      {r.gemeten?.geslaagd.runs > 0 && <div className="sub">gemeten: {r.gemeten.geslaagd.runs} geslaagde run{r.gemeten.geslaagd.runs > 1 ? 's' : ''}</div>}
                      {r.gemeten?.mislukt.runs > 0 && <div className="sub">+ {r.gemeten.mislukt.runs} mislukt (niet op de werkbon)</div>}</td>
                    <td className="r num">{naarInvoer(Math.round((r.tijd_min / 60) * 100) / 100)} u</td>
                    <td className="r"><span className="unit"><input className="inp num" inputMode="decimal" aria-label={`Werkelijke printtijd ${r.omschrijving || i + 1}`} disabled={vast} placeholder={gemetenUren(r)} value={werkelijk[r.id]?.uren ?? ''} onChange={e => zet(r.id, 'uren', e.target.value)} /><span>u</span></span></td>
                    <td className="r"><span className="unit"><input className="inp num" inputMode="decimal" aria-label={`Gemeten kWh ${r.omschrijving || i + 1}`} disabled={vast} placeholder={gemetenKwh(r)} value={werkelijk[r.id]?.kwh ?? ''} onChange={e => zet(r.id, 'kwh', e.target.value)} /><span>kWh</span></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {werkelijkGewijzigd && <button type="button" className="btn primary" style={{ marginTop: 8 }}
            onClick={() => doe('put', `/dossiers/${d.id}/werkelijk`, 'Werkelijk verbruik bewaard.', { body: { regels: printregels.map(r => ({ id: r.id, ...werkelijk[r.id] })) } })}>Werkelijk verbruik bewaren</button>}
          <p className="note">Grijs = gemeten door de printers (enkel de geslaagde runs van de gekoppelde printopdrachten, zie tabblad Productie). Vul je zelf een waarde in, dan gaat die voor (correctie). Leeg zonder meting = de schatting van het dossier.</p>
        </>
      )}

      <label className="lbl" htmlFor="wb-opm" style={{ marginTop: 12 }}>Opmerking op de werkbon</label>
      <textarea id="wb-opm" className="inp" rows={2} disabled={!!w.definitief_op} value={opmerking} onChange={e => setOpmerking(e.target.value)} />
      {opmGewijzigd && <button type="button" className="btn primary" style={{ marginTop: 8 }} onClick={() => doe('put', `/werkbonnen/${w.id}`, 'Werkbon bewaard.', { body: { opmerking } })}>Bewaren</button>}

      {!w.definitief_op && b && <>
        <h4 className="tussenkop">{w.basis === 'offerte' ? 'Kost volgens de metingen (marge-analyse)' : 'Totaal volgens de werkbon'}</h4>
        <Totalen uitkomst={b} />
        {mislukt > 0 && <p className="note">Mislukte pogingen (niet op de werkbon, kost voor jou): <b className="num">{euro(Math.round(mislukt * 100) / 100)}</b> aan elektriciteit en machinetarief.</p>}
        {w.basis === 'offerte' && b.volledig && <p className="note">Verschil met de offerte: <b className="num">{euro(Math.round((w.bedrag - b.totaal) * 100) / 100)}</b> {w.bedrag >= b.totaal ? '(offerte hoger dan de gemeten kost)' : '(gemeten kost hoger dan de offerte)'}.</p>}
      </>}
      {mail && <MailDialoog titel={`Werkbon ${w.weergave} mailen`} aan={d.klant_gegevens?.email}
        onderwerp={`Werkbon ${w.weergave} – ${d.titel}`} tekst={mailTekst({ klant: d.klant_gegevens, bedrijf, wat: 'de werkbon', titel: d.titel })}
        onSluit={() => setMail(false)}
        onVerstuur={async f => { if (await doe('post', `/werkbonnen/${w.id}/mail`, `Werkbon gemaild naar ${f.aan}.`, { body: f })) setMail(false); }} />}
    </>
  );
}
