import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, BASE } from '../../lib/api.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import { Link } from '../../schil/Schil.jsx';
import Icoon from '../../schil/Icoon.jsx';
import { Fout, Laden } from '../../schil/Weergaven.jsx';
import Opstellen from './Opstellen.jsx';

// Tegel Mail (30-09): de mailbox (IMAP) zoals in een mailprogramma — mappen,
// lezen, zoeken, beantwoorden, doorsturen, verplaatsen, verwijderen, mappen
// beheren — met de koppelingen van het ERP: afzender = klant (met zijn open
// dossiers), bijlage of mail bewaren bij een dossier/klant/aankoop, factuur
// of bestelmail meteen inlezen, nieuwe klant of dossier uit een mail.
// De mails blijven op de mailserver; de webmail blijft gewoon werken.
const url = pad => new URL(`${BASE}${pad}`, document.baseURI).href;
const q = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
const SOORT_ICOON = { inbox: 'bericht', verzonden: 'pijlRechts', concepten: 'pen', prullenbak: 'vuilbak', spam: 'let', archief: 'archief' };
const SOORT_NAAM = { inbox: 'Inbox', verzonden: 'Verzonden', concepten: 'Concepten', prullenbak: 'Prullenbak', spam: 'Spam', archief: 'Archief' };
const mapNaam = m => SOORT_NAAM[m?.soort] || m?.naam || m?.pad || '';
const wie = a => (a ? a.naam || a.adres : '—');
const wieVol = a => (a ? (a.naam ? `${a.naam} <${a.adres}>` : a.adres) : '');
function tijd(iso) {
  if (!iso) return '';
  const d = new Date(iso), nu = new Date();
  if (d.toDateString() === nu.toDateString()) return d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', ...(d.getFullYear() !== nu.getFullYear() ? { year: 'numeric' } : {}) });
}
const grootte = n => (n > 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);
const INLEESBAAR = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif)|application\/xml|text\/xml)$/i;

export default function Mail() {
  const { melding, bevestig } = useOmgeving();
  const [zp, setZp] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [mappen, setMappen] = useState(null);
  const [map, setMap] = useState(zp.get('map') || 'INBOX');
  const [lijst, setLijst] = useState(null);       // { totaal, berichten, pagina }
  const [zoek, setZoek] = useState('');
  const [zoekActief, setZoekActief] = useState('');
  const [ongelezen, setOngelezen] = useState(false);
  const [gekozen, setGekozen] = useState(new Set());
  const [uid, setUid] = useState(zp.get('uid') ? Number(zp.get('uid')) : null);
  const [fout, setFout] = useState(null);
  const [bezig, setBezig] = useState(false);
  const [opstellen, setOpstellen] = useState(zp.get('nieuw') || zp.get('aan') ? { soort: 'nieuw', aan: zp.get('aan') || '', onderwerp: zp.get('onderwerp') || '' } : null);
  const [versie, setVersie] = useState(0);        // lezer opnieuw laden

  const laadMappen = useCallback(async () => {
    try { setMappen(await api.get('/mail/mappen')); } catch (e) { setFout(e.message); }
  }, []);
  const laadLijst = useCallback(async ({ pagina = 0, erbij = false } = {}) => {
    setBezig(true);
    try {
      const r = await api.get(`/mail/berichten?${q({ map, pagina, zoek: zoekActief, ongelezen: ongelezen ? 1 : '' })}`);
      setLijst(l => (erbij && l ? { ...r, berichten: [...l.berichten, ...r.berichten] } : r));
      setFout(null);
    } catch (e) { setFout(e.message); }
    finally { setBezig(false); }
  }, [map, zoekActief, ongelezen]);

  useEffect(() => { api.get('/mail/status').then(setStatus).catch(e => setFout(e.message)); }, []);
  useEffect(() => { if (status?.ingesteld) laadMappen(); }, [status, laadMappen]);
  useEffect(() => { if (status?.ingesteld) { setGekozen(new Set()); laadLijst(); } }, [status, laadLijst]);
  // elke minuut nieuwe mail ophalen (enkel de eerste pagina, zonder zoekopdracht)
  useEffect(() => {
    if (!status?.ingesteld) return undefined;
    const t = setInterval(() => { if (!document.hidden && !zoekActief) { laadLijst(); laadMappen(); } }, 60000);
    return () => clearInterval(t);
  }, [status, laadLijst, laadMappen, zoekActief]);
  useEffect(() => { setZp(p => { const n = new URLSearchParams(p); n.set('map', map); if (uid) n.set('uid', uid); else n.delete('uid'); n.delete('nieuw'); n.delete('aan'); n.delete('onderwerp'); return n; }, { replace: true }); }, [map, uid, setZp]);

  const huidigeMap = (mappen || []).find(m => m.pad === map);
  const vernieuw = () => { laadLijst(); laadMappen(); };
  const kiesMap = p => { setMap(p); setUid(null); setZoek(''); setZoekActief(''); };
  const bijwerk = (uids, veranderd) => setLijst(l => l && { ...l, berichten: l.berichten.map(b => (uids.includes(b.uid) ? { ...b, ...veranderd } : b)) });

  async function vlag(uids, v, tekst) {
    try { await api.post('/mail/vlaggen', { map, uids, ...v }); bijwerk(uids, Object.fromEntries(Object.entries(v).map(([k, w]) => [k, w]))); laadMappen(); if (tekst) melding(tekst); }
    catch (e) { melding(e.message, 'fout'); }
  }
  async function verplaats(uids, doel) {
    try {
      await api.post('/mail/verplaats', { map, uids, doel });
      melding(`${uids.length === 1 ? 'Bericht' : `${uids.length} berichten`} verplaatst naar ${mapNaam((mappen || []).find(m => m.pad === doel)) || doel}.`);
      if (uids.includes(uid)) setUid(null);
      setGekozen(new Set()); vernieuw();
    } catch (e) { melding(e.message, 'fout'); }
  }
  async function verwijder(uids) {
    const definitief = huidigeMap?.soort === 'prullenbak';
    if (definitief && !await bevestig({ titel: 'Definitief verwijderen', tekst: `${uids.length === 1 ? 'Dit bericht' : `${uids.length} berichten`} definitief verwijderen? Dit kan niet ongedaan gemaakt worden.`, bevestigLabel: 'Verwijderen', gevaarlijk: true })) return;
    try {
      const r = await api.post('/mail/verwijder', { map, uids });
      melding(r.definitief ? 'Definitief verwijderd.' : 'Naar de prullenbak verplaatst.');
      if (uids.includes(uid)) setUid(null);
      setGekozen(new Set()); vernieuw();
    } catch (e) { melding(e.message, 'fout'); }
  }

  if (fout && !status) return <Fout tekst={fout} />;
  if (!status) return <Laden />;
  if (!status.ingesteld) return <NietIngesteld />;

  const alleGekozen = lijst?.berichten.length > 0 && lijst.berichten.every(b => gekozen.has(b.uid));
  const sel = [...gekozen];
  return (
    <div className={`mailbox${uid ? ' leest' : ''}`}>
      <aside className="mb-mappen" aria-label="Mappen">
        <button type="button" className="btn primary" style={{ width: '100%', marginBottom: 10 }} onClick={() => setOpstellen({ soort: 'nieuw' })}><Icoon naam="pen" maat={14} /> Nieuwe mail</button>
        <MappenBoom mappen={mappen} huidig={map} onKies={kiesMap} onGewijzigd={setMappen} />
        <div className="sub" style={{ marginTop: 10, wordBreak: 'break-all' }}>{status.adres}<br />{status.server}</div>
      </aside>

      <section className="mb-lijst" aria-label="Berichten">
        <div className="mb-lijstkop">
          <form className="mb-zoek" onSubmit={e => { e.preventDefault(); setUid(null); setZoekActief(zoek.trim()); }}>
            <Icoon naam="zoek" maat={14} />
            <input className="inp" type="search" placeholder={`Zoeken in ${mapNaam(huidigeMap) || map}`} aria-label="Zoeken" value={zoek}
              onChange={e => { setZoek(e.target.value); if (!e.target.value) setZoekActief(''); }} />
          </form>
          <div className="mb-balk">
            <input type="checkbox" aria-label="Alles selecteren" checked={!!alleGekozen} onChange={() => setGekozen(alleGekozen ? new Set() : new Set(lijst.berichten.map(b => b.uid)))} />
            {sel.length ? <>
              <button type="button" className="btn ghost klein" title="Gelezen" onClick={() => vlag(sel, { gelezen: true })}>Gelezen</button>
              <button type="button" className="btn ghost klein" title="Ongelezen" onClick={() => vlag(sel, { gelezen: false })}>Ongelezen</button>
              <VerplaatsKeuze mappen={mappen} huidig={map} onKies={d => verplaats(sel, d)} />
              <button type="button" className="btn ghost klein" aria-label="Verwijderen" title="Verwijderen" onClick={() => verwijder(sel)}><Icoon naam="vuilbak" maat={14} /></button>
            </> : <>
              <label className="keuze klein"><input type="checkbox" checked={ongelezen} onChange={e => setOngelezen(e.target.checked)} /> Ongelezen</label>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn ghost klein" aria-label="Vernieuwen" title="Vernieuwen" disabled={bezig} onClick={vernieuw}><Icoon naam="herstel" maat={14} /></button>
            </>}
          </div>
          {zoekActief && <div className="sub" style={{ padding: '0 10px 6px' }}>{lijst?.totaal ?? '…'} resultaten voor "{zoekActief}" · <button type="button" className="linkish" onClick={() => { setZoek(''); setZoekActief(''); }}>wissen</button></div>}
        </div>
        {fout && <div className="waarschuwing" role="alert" style={{ margin: 10, display: 'block' }}>{fout}</div>}
        {!lijst ? <Laden /> : !lijst.berichten.length ? <p className="sub" style={{ padding: 16 }}>{zoekActief ? 'Niets gevonden.' : ongelezen ? 'Geen ongelezen berichten.' : 'Deze map is leeg.'}</p> : (
          <ul className="mb-rijen">
            {lijst.berichten.map(b => {
              const verzonden = ['verzonden', 'concepten'].includes(huidigeMap?.soort);
              return (
                <li key={b.uid} className={`${b.gelezen ? '' : 'ongelezen'}${uid === b.uid ? ' open' : ''}`}>
                  <input type="checkbox" aria-label={`Selecteer ${b.onderwerp}`} checked={gekozen.has(b.uid)}
                    onChange={() => setGekozen(g => { const n = new Set(g); if (n.has(b.uid)) n.delete(b.uid); else n.add(b.uid); return n; })} />
                  <button type="button" className="mb-rij" onClick={() => { setUid(b.uid); if (!b.gelezen) { bijwerk([b.uid], { gelezen: true }); setTimeout(laadMappen, 1500); } }}>
                    <span className="r1"><span className="wie">{verzonden ? `Aan: ${b.aan.map(wie).join(', ') || '—'}` : wie(b.van)}</span><span className="wanneer">{tijd(b.datum)}</span></span>
                    <span className="r2">{b.beantwoord && <span title="Beantwoord" className="sub">↩ </span>}{b.onderwerp}{b.bijlagen && <span title="Met bijlagen" className="sub"> 📎</span>}</span>
                  </button>
                  <button type="button" className={`mb-ster${b.ster ? ' aan' : ''}`} aria-label={b.ster ? 'Ster weghalen' : 'Ster'} onClick={() => vlag([b.uid], { ster: !b.ster })}>{b.ster ? '★' : '☆'}</button>
                </li>
              );
            })}
          </ul>
        )}
        {lijst && lijst.berichten.length < lijst.totaal && (
          <button type="button" className="btn ghost" style={{ margin: 10 }} disabled={bezig} onClick={() => laadLijst({ pagina: (lijst.pagina || 0) + 1, erbij: true })}>
            {bezig ? 'Laden…' : `Meer laden (${lijst.berichten.length} van ${lijst.totaal})`}</button>
        )}
      </section>

      <section className="mb-lezer" aria-label="Bericht">
        {uid ? <Lezer key={`${map}-${uid}-${versie}`} map={map} uid={uid} mappen={mappen} mapSoort={huidigeMap?.soort}
          onTerug={() => setUid(null)} onVlag={(v, t) => vlag([uid], v, t)} onVerplaats={d => verplaats([uid], d)} onVerwijder={() => verwijder([uid])}
          onOpstellen={setOpstellen} />
          : <div className="mb-leeg"><Icoon naam="bericht" maat={40} dik={1.2} /><p>Kies een bericht.</p></div>}
      </section>

      {opstellen && <Opstellen start={opstellen} onSluit={() => setOpstellen(null)} onVerstuurd={() => { setOpstellen(null); vernieuw(); setVersie(v => v + 1); }} />}
    </div>
  );
}

function NietIngesteld() {
  return (
    <div className="panel" style={{ margin: 22, maxWidth: 720 }}>
      <h3>Mailbox nog niet ingesteld</h3>
      <div className="pbody">
        <p>Vul in Home Assistant bij de add-on <b>ERP 3D Print &amp; Ontwerp</b> → <b>Configuratie</b> in:</p>
        <ul>
          <li><b>smtp_user</b>: je volledige e-mailadres (info@3dprintenontwerp.be)</li>
          <li><b>smtp_pass</b>: het wachtwoord van de mailbox</li>
          <li><b>smtp_host</b>: <code>ssl0.ovh.net</code> en <b>smtp_port</b>: 465</li>
          <li><b>imap_host</b>: leeg laten (zelfde server) of <code>ssl0.ovh.net</code>, <b>imap_port</b>: 993</li>
        </ul>
        <p className="sub">Het wachtwoord staat enkel in de add-on-configuratie, niet in de databank. Herstart de add-on na het opslaan.</p>
      </div>
    </div>
  );
}

// ── mappen ──────────────────────────────────────────────────────────────
function MappenBoom({ mappen, huidig, onKies, onGewijzigd }) {
  const { melding, bevestig } = useOmgeving();
  const [vraag, setVraag] = useState(null);   // { soort: 'nieuw' | 'hernoem', waarde }
  if (!mappen) return <Laden />;
  const diepte = m => (m.ouder ? (mappen.find(x => x.pad === m.ouder) ? diepte(mappen.find(x => x.pad === m.ouder)) + 1 : 1) : 0);
  const cur = mappen.find(m => m.pad === huidig);
  const eigen = cur && !cur.soort;
  async function bewaar() {
    const w = vraag.waarde.trim();
    if (!w) return;
    try {
      if (vraag.soort === 'nieuw') {
        const pad = vraag.onder && cur ? `${cur.pad}${cur.scheiding}${w}` : w;
        onGewijzigd(await api.post('/mail/mappen', { pad })); melding(`Map "${w}" gemaakt.`);
      } else {
        const naar = cur.ouder ? `${cur.ouder}${cur.scheiding}${w}` : w;
        onGewijzigd(await api.put('/mail/mappen', { van: cur.pad, naar })); melding('Map hernoemd.'); onKies(naar);
      }
      setVraag(null);
    } catch (e) { melding(e.message, 'fout'); }
  }
  async function weg() {
    if (!await bevestig({ titel: 'Map verwijderen', tekst: `De map "${cur.naam}" en alle berichten erin definitief verwijderen?`, bevestigLabel: 'Verwijderen', gevaarlijk: true })) return;
    try { onGewijzigd(await api.delete(`/mail/mappen?pad=${encodeURIComponent(cur.pad)}`)); onKies('INBOX'); melding('Map verwijderd.'); }
    catch (e) { melding(e.message, 'fout'); }
  }
  return (
    <>
      <ul className="mb-boom">
        {mappen.map(m => (
          <li key={m.pad}>
            <button type="button" className={m.pad === huidig ? 'on' : ''} disabled={!m.selecteerbaar} style={{ paddingLeft: 8 + diepte(m) * 14 }} onClick={() => onKies(m.pad)}>
              <Icoon naam={SOORT_ICOON[m.soort] || 'map'} maat={14} />
              <span className="nm">{mapNaam(m)}</span>
              {m.ongelezen > 0 && m.soort !== 'verzonden' && m.soort !== 'concepten' && <span className="tel">{m.ongelezen}</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="mb-mapknoppen">
        <button type="button" className="linkish" onClick={() => setVraag({ soort: 'nieuw', waarde: '', onder: false })}>+ map</button>
        {cur && <button type="button" className="linkish" onClick={() => setVraag({ soort: 'nieuw', waarde: '', onder: true })}>+ submap</button>}
        {eigen && <button type="button" className="linkish" onClick={() => setVraag({ soort: 'hernoem', waarde: cur.naam })}>hernoemen</button>}
        {eigen && <button type="button" className="linkish" onClick={weg}>verwijderen</button>}
      </div>
      {vraag && (
        <Dialoog titel={vraag.soort === 'nieuw' ? (vraag.onder ? `Nieuwe map in ${mapNaam(cur)}` : 'Nieuwe map') : `"${cur.naam}" hernoemen`} onSluit={() => setVraag(null)}
          voet={<><button type="button" className="btn" onClick={() => setVraag(null)}>Annuleren</button><button type="button" className="btn primary" disabled={!vraag.waarde.trim()} onClick={bewaar}>Bewaren</button></>}>
          <label className="lbl" htmlFor="mb-mapnaam">Naam</label>
          <input id="mb-mapnaam" className="inp" autoFocus value={vraag.waarde} onChange={e => setVraag(v => ({ ...v, waarde: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') bewaar(); }} />
        </Dialoog>
      )}
    </>
  );
}
function VerplaatsKeuze({ mappen, huidig, onKies }) {
  return (
    <select className="inp klein" aria-label="Verplaatsen naar" value="" onChange={e => e.target.value && onKies(e.target.value)} style={{ maxWidth: 170 }}>
      <option value="">Verplaatsen naar…</option>
      {(mappen || []).filter(m => m.pad !== huidig && m.selecteerbaar).map(m => <option key={m.pad} value={m.pad}>{mapNaam(m)}{m.ouder ? ` (${m.pad})` : ''}</option>)}
    </select>
  );
}

// ── lezen ───────────────────────────────────────────────────────────────
function Lezer({ map, uid, mappen, mapSoort, onTerug, onVlag, onVerplaats, onVerwijder, onOpstellen }) {
  const { melding, navigeer } = useOmgeving();
  const [b, setB] = useState(null);
  const [fout, setFout] = useState(null);
  const [afb, setAfb] = useState(false);
  const [bewaren, setBewaren] = useState(false);
  useEffect(() => {
    let weg = false;
    setB(null); setFout(null);
    api.get(`/mail/bericht?${q({ map, uid, afbeeldingen: afb ? 1 : '' })}`).then(r => { if (!weg) setB(r); }).catch(e => { if (!weg) setFout(e.message); });
    return () => { weg = true; };
  }, [map, uid, afb]);
  if (fout) return <div style={{ padding: 16 }}><button type="button" className="btn ghost mb-terug" onClick={onTerug}><Icoon naam="pijlLinks" maat={14} /> Terug</button><Fout tekst={fout} /></div>;
  if (!b) return <Laden />;
  const eigenMap = ['verzonden', 'concepten'].includes(mapSoort);
  const antwoordAan = (b.antwoord_aan[0] || b.van);
  const citeer = (kop, tekst) => `\n\n${kop}\n${String(tekst || '').split('\n').map(l => `> ${l}`).join('\n')}`;
  const re = s => (/^(re|antw):/i.test(s) ? s : `Re: ${s}`);
  const fw = s => (/^(fwd?|dr?):/i.test(s) ? s : `Fwd: ${s}`);
  const klant = b.erp.klanten[0];
  const dossierLink = klant?.dossiers?.[0];
  const basis = { antwoord_map: map, antwoord_uid: uid, entiteit: dossierLink ? 'dossier' : klant ? 'klant' : null, entiteit_id: dossierLink?.id ?? klant?.id ?? null, erp: b.erp };
  const beantwoord = alle => onOpstellen({ ...basis, soort: 'antwoord', aan: eigenMap ? b.aan.map(a => a.adres).join(', ') : antwoordAan?.adres || '',
    cc: alle ? [...b.aan, ...b.cc].map(a => a.adres).filter(a => a && a !== antwoordAan?.adres).join(', ') : '', onderwerp: re(b.onderwerp), tekst: citeer(b.citaat.kop, b.citaat.tekst) });
  const doorsturen = () => onOpstellen({ ...basis, soort: 'doorsturen', aan: '', onderwerp: fw(b.onderwerp), bijlagen: b.bijlagen,
    tekst: `\n\n---------- Doorgestuurd bericht ----------\nVan: ${wieVol(b.van)}\nDatum: ${b.datum ? new Date(b.datum).toLocaleString('nl-BE') : ''}\nOnderwerp: ${b.onderwerp}\nAan: ${b.aan.map(wieVol).join(', ')}\n\n${b.citaat.tekst}` });
  function inlezen(extra) {
    try { sessionStorage.setItem('erp-inlezen-uit-mail', JSON.stringify(extra)); } catch { /* privé-venster */ }
    navigeer('/inkoop/inlezen');
  }
  return (
    <div className="mb-bericht">
      <div className="mb-acties">
        <button type="button" className="btn ghost mb-terug" onClick={onTerug}><Icoon naam="pijlLinks" maat={14} /> Terug</button>
        <button type="button" className="btn" onClick={() => beantwoord(false)}>Beantwoorden</button>
        {(b.aan.length + b.cc.length > 1) && <button type="button" className="btn" onClick={() => beantwoord(true)}>Allen</button>}
        <button type="button" className="btn" onClick={doorsturen}>Doorsturen</button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn ghost klein" onClick={() => onVlag({ gelezen: false }, 'Als ongelezen gemarkeerd.')}>Ongelezen</button>
        <button type="button" className="btn ghost klein" onClick={() => { onVlag({ ster: !b.ster }); setB(x => ({ ...x, ster: !x.ster })); }}>{b.ster ? '★ Ster' : '☆ Ster'}</button>
        <VerplaatsKeuze mappen={mappen} huidig={map} onKies={onVerplaats} />
        <a className="btn ghost klein" href={url(`/mail/bron?${q({ map, uid })}`)} title="Hele mail downloaden (.eml)">.eml</a>
        <button type="button" className="btn ghost klein" aria-label="Verwijderen" title="Verwijderen" onClick={onVerwijder}><Icoon naam="vuilbak" maat={14} /></button>
      </div>
      <h2 className="mb-onderwerp">{b.onderwerp}</h2>
      <div className="mb-kop">
        <div><b>{wie(b.van)}</b> {b.van?.naam && <span className="sub">&lt;{b.van.adres}&gt;</span>}</div>
        <div className="sub">Aan: {b.aan.map(wieVol).join(', ') || '—'}{b.cc.length ? ` · Cc: ${b.cc.map(wieVol).join(', ')}` : ''}</div>
        <div className="sub">{b.datum ? new Date(b.datum).toLocaleString('nl-BE', { dateStyle: 'full', timeStyle: 'short' }) : ''}</div>
      </div>

      <ErpPaneel b={b} onBewaren={() => setBewaren(true)} onInlezenTekst={() => inlezen({ tekst: b.tekst || b.citaat.tekst, onderwerp: b.onderwerp })} />

      {b.bijlagen.length > 0 && (
        <ul className="mb-bijlagen">
          {b.bijlagen.map(a => (
            <li key={a.index}>
              <a href={url(`/mail/bijlage?${q({ map, uid, index: a.index })}`)} target="_blank" rel="noopener noreferrer">📎 {a.naam}</a>
              <span className="sub"> {grootte(a.grootte)}</span>
              <a className="linkish" href={url(`/mail/bijlage?${q({ map, uid, index: a.index, download: 1 })}`)}>download</a>
              {INLEESBAAR.test(a.type) && !b.erp.klanten.length && <button type="button" className="linkish" onClick={() => inlezen({ map, uid, index: a.index, naam: a.naam, type: a.type })}>factuur inlezen</button>}
            </li>
          ))}
        </ul>
      )}
      {b.geblokkeerd > 0 && !afb && (
        <div className="mb-afb">{b.geblokkeerd} afbeelding{b.geblokkeerd > 1 ? 'en' : ''} van het internet niet geladen (privacy). <button type="button" className="linkish" onClick={() => setAfb(true)}>Toch tonen</button></div>
      )}
      <MailInhoud b={b} afbeeldingen={afb} />
      {bewaren && <BewaarDialoog b={b} map={map} uid={uid} onSluit={() => setBewaren(false)} onKlaar={t => { setBewaren(false); melding(t); }} />}
    </div>
  );
}

// De HTML in een afgeschermd iframe: geen scripts (sandbox), Content-Security-
// Policy (enkel ingesloten afbeeldingen, of ook van het internet na "Toch
// tonen"), links openen in een nieuw venster.
function MailInhoud({ b, afbeeldingen }) {
  const ref = useRef(null);
  const [hoogte, setHoogte] = useState(200);
  const doc = useMemo(() => {
    const csp = `default-src 'none'; img-src data:${afbeeldingen ? ' https: http:' : ''}; style-src 'unsafe-inline'; font-src data:`;
    const body = b.html ?? `<pre>${String(b.tekst || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>`;
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank">
<style>body{font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#222;margin:0;padding:4px 2px;word-wrap:break-word}
pre{white-space:pre-wrap;font-family:inherit}img{max-width:100%;height:auto}blockquote{margin:0 0 0 8px;padding-left:10px;border-left:3px solid #ddd;color:#555}a{color:#1a5fb4}</style>
</head><body>${body}</body></html>`;
  }, [b, afbeeldingen]);
  function meet() {
    try { const d = ref.current?.contentDocument; if (d) setHoogte(Math.min(20000, Math.max(120, d.documentElement.scrollHeight + 20))); } catch { /* niet meetbaar */ }
  }
  return <iframe ref={ref} title="Inhoud van de mail" className="mb-iframe" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ height: hoogte }} onLoad={meet} />;
}

// Wat het ERP over de afzender/ontvangers weet + snelle acties.
function ErpPaneel({ b, onBewaren, onInlezenTekst }) {
  const { navigeer } = useOmgeving();
  const { klanten, leveranciers } = b.erp;
  const afzender = b.van;
  return (
    <div className="mb-erp">
      {klanten.map(k => (
        <div key={k.id}>
          <span className="badge b-pos">Klant</span> <Link naar={`/klanten/${k.id}`}>{k.naam}</Link>
          {k.dossiers.length > 0 && <> · open dossier{k.dossiers.length > 1 ? 's' : ''}: {k.dossiers.map((d, i) => <span key={d.id}>{i ? ', ' : ''}<Link naar={`/dossiers/${d.id}`}><span className="mono">{d.nummer}</span> {d.titel}</Link></span>)}</>}
          {' · '}<button type="button" className="linkish" onClick={() => navigeer(`/dossiers/nieuw?${q({ klant: k.id, titel: b.onderwerp })}`)}>nieuw dossier</button>
        </div>
      ))}
      {leveranciers.map(l => <div key={l.id}><span className="badge b-neutral">Leverancier</span> <Link naar={`/inkoop/leveranciers/${l.id}`}>{l.naam}</Link> · <button type="button" className="linkish" onClick={onInlezenTekst}>bestelmail inlezen</button></div>)}
      <div className="mb-erp-knoppen">
        {!klanten.length && !leveranciers.length && afzender && (
          <button type="button" className="btn ghost klein" onClick={() => navigeer(`/klanten/nieuw?${q({ naam: afzender.naam || '', email: afzender.adres })}`)}>+ Nieuwe klant</button>
        )}
        <button type="button" className="btn ghost klein" onClick={onBewaren}>Bewaren bij dossier/klant…</button>
        {!leveranciers.length && <button type="button" className="btn ghost klein" title="De tekst van de mail laten lezen als bestelling of factuur (bv. een bestelbevestiging)" onClick={onInlezenTekst}>Bestelmail inlezen</button>}
      </div>
    </div>
  );
}

function BewaarDialoog({ b, map, uid, onSluit, onKlaar }) {
  const { melding } = useOmgeving();
  const voorstel = b.erp.klanten[0]?.dossiers?.[0] ? `dossier:${b.erp.klanten[0].dossiers[0].id}` : b.erp.klanten[0] ? `klant:${b.erp.klanten[0].id}` : '';
  const [doel, setDoel] = useState(voorstel);
  const [indexen, setIndexen] = useState(new Set(b.bijlagen.map(a => a.index)));
  const [mail, setMail] = useState(true);
  const [dossiers, setDossiers] = useState(null);
  const [klanten, setKlanten] = useState(null);
  const [bezig, setBezig] = useState(false);
  useEffect(() => {
    api.get('/dossiers').then(setDossiers).catch(() => setDossiers([]));
    api.get('/klanten').then(setKlanten).catch(() => setKlanten([]));
  }, []);
  async function ok() {
    const [entiteit, id] = doel.split(':');
    setBezig(true);
    try {
      const r = await api.post('/mail/bewaar', { map, uid, entiteit, entiteit_id: Number(id), indexen: [...indexen], mail });
      onKlaar(`Bewaard: ${r.bewaard.join(', ')}.`);
    } catch (e) { melding(e.message, 'fout'); setBezig(false); }
  }
  const knaam = k => (k.type === 'zakelijk' && k.bedrijfsnaam ? k.bedrijfsnaam : [k.voornaam, k.naam].filter(Boolean).join(' '));
  const eigenKlant = new Set(b.erp.klanten.map(k => k.id));
  return (
    <Dialoog titel="Bewaren in het ERP" breed onSluit={onSluit}
      voet={<><button type="button" className="btn" onClick={onSluit}>Annuleren</button><button type="button" className="btn primary" disabled={!doel || (!mail && !indexen.size) || bezig} onClick={ok}>Bewaren</button></>}>
      <label className="lbl" htmlFor="mb-doel">Bij</label>
      <select id="mb-doel" className="inp" value={doel} onChange={e => setDoel(e.target.value)}>
        <option value="">Kies…</option>
        <optgroup label="Dossiers">
          {(dossiers || []).filter(d => !['samengevoegd'].includes(d.fase)).sort((x, y) => (eigenKlant.has(y.klant_id) - eigenKlant.has(x.klant_id)) || y.id - x.id)
            .map(d => <option key={`d${d.id}`} value={`dossier:${d.id}`}>{d.nummer} · {d.titel}{d.klant ? ` · ${d.klant}` : ''}</option>)}
        </optgroup>
        <optgroup label="Klanten">{(klanten || []).map(k => <option key={`k${k.id}`} value={`klant:${k.id}`}>{knaam(k)}</option>)}</optgroup>
      </select>
      <p className="lbl" style={{ marginTop: 12 }}>Wat</p>
      {b.bijlagen.map(a => (
        <label key={a.index} className="keuze" style={{ display: 'flex', gap: 8 }}>
          <input type="checkbox" checked={indexen.has(a.index)} onChange={() => setIndexen(s => { const n = new Set(s); if (n.has(a.index)) n.delete(a.index); else n.add(a.index); return n; })} /> {a.naam} <span className="sub">{grootte(a.grootte)}</span>
        </label>
      ))}
      <label className="keuze" style={{ display: 'flex', gap: 8 }}><input type="checkbox" checked={mail} onChange={e => setMail(e.target.checked)} /> De mail zelf (.eml, te openen in een mailprogramma)</label>
      <p className="sub" style={{ marginBottom: 0 }}>Komt bij de bijlagen van het dossier of de klant, met een regel in de historiek. De mail blijft ook gewoon in je mailbox.</p>
    </Dialoog>
  );
}
