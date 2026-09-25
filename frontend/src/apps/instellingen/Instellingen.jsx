import { useEffect, useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { api, BASE } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Laden, Fout } from '../../schil/Weergaven.jsx';
import { Link } from '../../schil/Schil.jsx';
import KeuzeMetToevoegen from '../../components/KeuzeMetToevoegen.jsx';
import Printers from './Printers.jsx';
import Proefberekening from './Proefberekening.jsx';
import OntbrekendeGegevens from './OntbrekendeGegevens.jsx';
import Nummering from './Nummering.jsx';

const SECTIES = [
  ['tarieven', 'Tarieven'],
  ['printers', 'Printers'],
  ['materiaal', 'Materiaalprijzen'],
  ['proef', 'Proefberekening'],
  ['bedrijf', 'Bedrijfsgegevens'],
  ['nummering', 'Nummering'],
  ['integraties', 'Integraties'],
  ['ontbreekt', 'Ontbrekende gegevens'],
  ['onderhoud', 'Onderhoud'],
];

export default function Instellingen() {
  const { sectie } = useParams();
  if (!sectie) return <Navigate to="/instellingen/tarieven" replace />;
  const huidige = SECTIES.find(s => s[0] === sectie);
  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Instellingen', naar: '/instellingen/tarieven' }, { label: huidige ? huidige[1] : 'Onbekend' }]} />
      <div className="settings">
        <nav className="snav" aria-label="Onderdelen">
          {SECTIES.map(([id, label]) => <Link key={id} naar={`/instellingen/${id}`} className={id === sectie ? 'on' : ''} aria-current={id === sectie ? 'page' : undefined}>{label}</Link>)}
        </nav>
        <div>
          {sectie === 'tarieven' && <Tarieven />}
          {sectie === 'printers' && <Printers />}
          {sectie === 'materiaal' && <Materiaalprijzen />}
          {sectie === 'proef' && <Proefberekening />}
          {sectie === 'bedrijf' && <Bedrijf />}
          {sectie === 'integraties' && <Integraties />}
          {sectie === 'nummering' && <Nummering />}
          {sectie === 'ontbreekt' && <OntbrekendeGegevens />}
          {sectie === 'onderhoud' && <Onderhoud />}
          {!huidige && <Fout tekst="Dit onderdeel bestaat niet." />}
        </div>
      </div>
    </>
  );
}

/* ── Tarieven ─────────────────────────────────────────────────────────── */
const TARIEF_GROEPEN = [
  ['Energie & slijtage', ['kwh_prijs', 'bmcu_per_job']],
  ['Marge & faalfactor', ['marge_grens_uur', 'marge_klein_pct', 'marge_groot_pct', 'faalfactor_pct']],
  ['Vaste arbeid per print', ['voorbereiding_min', 'nabewerking_min']],
  ['Regietarieven', ['arbeid_per_uur', 'ontwerp_tarief', 'nabewerking_tarief']],
];
const EENHEID = { 'EUR/kWh': '€/kWh', 'EUR/u': '€/u', 'EUR': '€', '%': '%', 'u': 'uur', 'min': 'min' };
const getal = v => (typeof v === 'number' ? String(v).replace('.', ',') : v);

function Tarieven() {
  const { data, fout, laden, herlaad } = useData('/tarieven');
  const { melding, zetVuil } = useOmgeving();
  const [waarden, setWaarden] = useState({});
  const [bezig, setBezig] = useState(false);
  const origineel = useMemo(() => Object.fromEntries((data || []).map(t => [t.sleutel, getal(t.waarde)])), [data]);
  useEffect(() => { setWaarden(origineel); }, [origineel]);
  const gewijzigd = Object.keys(waarden).filter(k => String(waarden[k]) !== String(origineel[k]));
  useEffect(() => { zetVuil(gewijzigd.length > 0); return () => zetVuil(false); }, [gewijzigd.length, zetVuil]);
  const ongeldig = gewijzigd.filter(k => !/^\d+([.,]\d+)?$/.test(String(waarden[k]).trim()));

  async function opslaan() {
    if (ongeldig.length) { melding('Vul geldige, niet-negatieve getallen in.', 'fout'); return; }
    setBezig(true);
    try {
      await api.put('/tarieven', Object.fromEntries(gewijzigd.map(k => [k, waarden[k]])));
      await herlaad();
      melding('Tarieven opgeslagen.');
    } catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); }
  }

  if (fout) return <Fout tekst={fout} />;
  if (!data && laden) return <Laden />;
  const perSleutel = Object.fromEntries(data.map(t => [t.sleutel, t]));
  return (
    <div className="panel">
      <h3>Tarieven <span className="sub" style={{ fontWeight: 400 }}>gebruikt door de rekenmotor</span>
        {gewijzigd.length > 0 && (
          <span className="opslaanbalk">
            <button type="button" className="btn primary" disabled={bezig} onClick={opslaan}>Opslaan</button>
            <button type="button" className="btn" disabled={bezig} onClick={() => setWaarden(origineel)}>Verwerpen</button>
          </span>
        )}
      </h3>
      <div className="pbody">
        <div className="fgrid">
          {TARIEF_GROEPEN.map(([titel, sleutels]) => (
            <FragmentGroep key={titel} titel={titel}>
              {sleutels.filter(s => perSleutel[s]).map(s => (
                <div key={s}>
                  <label htmlFor={`t-${s}`}>{perSleutel[s].label}</label>
                  <div className="unit">
                    <input id={`t-${s}`} className={`inp num${ongeldig.includes(s) ? ' fout' : ''}`} inputMode="decimal"
                      value={waarden[s] ?? ''} onChange={e => setWaarden(w => ({ ...w, [s]: e.target.value }))} />
                    <span>{EENHEID[perSleutel[s].eenheid] || perSleutel[s].eenheid}</span>
                  </div>
                </div>
              ))}
            </FragmentGroep>
          ))}
        </div>
        <p className="note" style={{ marginBottom: 0 }}>Machinekost: het tarief van elke printer zelf (zie <Link naar="/instellingen/printers">Printers</Link>), zonder terugval. BMCU/AMS-slijtage: bij elke print. Materiaal: verkoopprijs per kg per prijsgroep (zie Materiaalprijzen), zonder marge. De marge klein/groot geldt voor energie, machine, arbeid, BMCU en extra's. Uitproberen kan in <Link naar="/instellingen/proef">Proefberekening</Link>.</p>
      </div>
    </div>
  );
}
function FragmentGroep({ titel, children }) {
  return <><div className="fgroep">{titel}</div>{children}</>;
}

/* ── Materiaalprijzen (prijsgroepen merk + type) ─────────────────────── */
const LEGE_GROEP = { merk_id: '', materiaal_id: '', verkoopprijs_per_kg: '', min_rollen: '', max_rollen: '', rolgewicht_g: '1000', dichtheid_g_per_cm3: '', leverancier: '', notities: '' };

function Materiaalprijzen() {
  const { data: types, fout, laden, herlaad } = useData('/filament/types');
  const { data: merken, herlaad: herlaadMerken } = useData('/filament/merken');
  const { data: materialen, herlaad: herlaadMat } = useData('/filament/materialen');
  const { melding, bevestig } = useOmgeving();
  const [open, setOpen] = useState(null);   // null | 'nieuw' | type-object
  const [form, setForm] = useState(LEGE_GROEP);
  const [bezig, setBezig] = useState(false);

  function openen(t) {
    setOpen(t);
    setForm(t === 'nieuw' ? LEGE_GROEP : Object.fromEntries(Object.keys(LEGE_GROEP).map(k => [k, t[k] == null ? '' : String(t[k]).replace('.', ['verkoopprijs_per_kg', 'dichtheid_g_per_cm3', 'rolgewicht_g'].includes(k) ? ',' : '.')])));
  }
  const zet = k => v => setForm(f => ({ ...f, [k]: v }));
  const naarGetal = v => String(v).replace(',', '.');

  async function opslaan() {
    setBezig(true);
    const body = { ...form, verkoopprijs_per_kg: naarGetal(form.verkoopprijs_per_kg), dichtheid_g_per_cm3: naarGetal(form.dichtheid_g_per_cm3), rolgewicht_g: naarGetal(form.rolgewicht_g) };
    try {
      if (open === 'nieuw') await api.post('/filament/types', body);
      else await api.put(`/filament/types/${open.id}`, body);
      await herlaad();
      setOpen(null);
      melding('Prijsgroep opgeslagen.');
    } catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); }
  }

  async function verwijder() {
    if (!await bevestig({ titel: 'Prijsgroep verwijderen', tekst: `${open.merk} · ${open.materiaal} verwijderen?`, bevestigLabel: 'Verwijderen', gevaarlijk: true })) return;
    try { await api.delete(`/filament/types/${open.id}`); await herlaad(); setOpen(null); melding('Prijsgroep verwijderd.'); }
    catch (e) { melding(e.message, 'fout'); }
  }

  async function nieuwMerk(naam) { const n = await api.post('/filament/merken', { naam }); await herlaadMerken(); return n; }
  async function nieuwMateriaal(naam) { const n = await api.post('/filament/materialen', { naam }); await herlaadMat(); return n; }

  if (fout) return <Fout tekst={fout} />;
  if (!types && laden) return <Laden />;
  return (
    <div className="panel">
      <h3>Materiaalprijzen <button type="button" className="btn primary" onClick={() => openen('nieuw')}>Nieuw</button></h3>
      <div className="pbody">
        {types.length === 0 ? <div className="leeg" style={{ padding: 20 }}><b>Nog geen prijsgroepen.</b>Een prijsgroep is een merk + type met een verkoopprijs per kg, bv. Bambu Lab · PLA Matte.</div> : (
          <div className="listwrap">
            <table className="mini">
              <thead><tr><th>Merk · type</th><th className="r">Verkoopprijs</th><th className="r">Rolgewicht</th><th className="r">Min – max rollen per kleur</th><th>Leverancier</th></tr></thead>
              <tbody>
                {types.map(t => (
                  <tr key={t.id} className="clk" tabIndex={0} onClick={() => openen(t)} onKeyDown={e => { if (e.key === 'Enter') openen(t); }}>
                    <td><b>{t.merk}</b> · {t.materiaal}</td>
                    <td className="r num">€ {Number(t.verkoopprijs_per_kg).toFixed(2).replace('.', ',')}/kg</td>
                    <td className="r num">{Number(t.rolgewicht_g).toLocaleString('nl-BE')} g</td>
                    <td className="r num">{t.min_rollen == null && t.max_rollen == null ? <span className="sub">—</span> : `${t.min_rollen ?? '…'} – ${t.max_rollen ?? '…'}`}</td>
                    <td>{t.leverancier || <span className="sub">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note" style={{ marginBottom: 0 }}>Materiaalkost = gewicht × verkoopprijs/kg × faalfactor. Min/max gelden per kleur; een kleur kan in Voorraad → Artikelen een eigen waarde krijgen. Leeg minimum = geen bestel-opvolging. Rolgewicht dient voor de kostprijs per kg.</p>
      </div>
      {open && (
        <Dialoog breed titel={open === 'nieuw' ? 'Nieuwe prijsgroep' : `${open.merk} · ${open.materiaal}`} onSluit={() => setOpen(null)}
          voet={<>
            {open !== 'nieuw' && <button type="button" className="btn ghost" style={{ marginRight: 'auto' }} onClick={verwijder}>Verwijderen</button>}
            <button type="button" className="btn" onClick={() => setOpen(null)}>Annuleren</button>
            <button type="button" className="btn primary" disabled={bezig || !form.merk_id || !form.materiaal_id || form.verkoopprijs_per_kg === ''} onClick={opslaan}>Opslaan</button>
          </>}>
          <div className="fgrid">
            <KeuzeMetToevoegen id="m-merk" label="Merk" waarde={String(form.merk_id)} opties={merken || []} onKies={zet('merk_id')} onNieuw={nieuwMerk} watLabel="merk" />
            <KeuzeMetToevoegen id="m-type" label="Type" waarde={String(form.materiaal_id)} opties={materialen || []} onKies={zet('materiaal_id')} onNieuw={nieuwMateriaal} watLabel="type" />
            <div><label htmlFor="m-prijs">Verkoopprijs</label><div className="unit"><input id="m-prijs" className="inp num" inputMode="decimal" value={form.verkoopprijs_per_kg} onChange={e => zet('verkoopprijs_per_kg')(e.target.value)} placeholder="verplicht" /><span>€/kg</span></div></div>
            <div><label htmlFor="m-min">Minimum rollen per kleur</label><input id="m-min" className="inp num" inputMode="numeric" value={form.min_rollen} onChange={e => zet('min_rollen')(e.target.value)} placeholder="leeg = geen opvolging" /></div>
            <div><label htmlFor="m-max">Maximum rollen per kleur</label><input id="m-max" className="inp num" inputMode="numeric" value={form.max_rollen} onChange={e => zet('max_rollen')(e.target.value)} placeholder="te bestellen vult aan tot hier" /></div>
            <div><label htmlFor="m-rol">Rolgewicht</label><div className="unit"><input id="m-rol" className="inp num" inputMode="decimal" value={form.rolgewicht_g} onChange={e => zet('rolgewicht_g')(e.target.value)} /><span>g per rol</span></div></div>
            <div><label htmlFor="m-dicht">Dichtheid</label><div className="unit"><input id="m-dicht" className="inp num" inputMode="decimal" value={form.dichtheid_g_per_cm3} onChange={e => zet('dichtheid_g_per_cm3')(e.target.value)} placeholder="optioneel" /><span>g/cm³</span></div></div>
            <div><label htmlFor="m-lev">Leverancier</label><input id="m-lev" className="inp" value={form.leverancier} onChange={e => zet('leverancier')(e.target.value)} placeholder="optioneel" /></div>
            <div style={{ gridColumn: '1/-1' }}><label htmlFor="m-not">Notities</label><textarea id="m-not" className="inp" rows={2} value={form.notities} onChange={e => zet('notities')(e.target.value)} /></div>
          </div>
        </Dialoog>
      )}
    </div>
  );
}

/* ── Bedrijfsgegevens ─────────────────────────────────────────────────── */
const BEDRIJF_VELDEN = [
  ['bedrijf_naam', 'Naam', 'bv. 3Dplezier'],
  ['bedrijf_btw', 'Ondernemingsnummer', 'BE0123.456.789'],
  ['bedrijf_adres', 'Adres', 'Straat nr, postcode gemeente'],
  ['bedrijf_email', 'E-mail', ''],
  ['bedrijf_iban', 'IBAN', 'BE00 0000 0000 0000'],
  ['offerte_geldig_dagen', 'Offerte geldig (dagen)', '30'],   // stap 5b
  // stap 7: drempels bijberoep (Financiën → Overzicht); leeg = standaard
  ['bedrijf_startdatum', 'Startdatum onderneming (JJJJ-MM-DD)', 'bv. 2025-07-01'],
  ['drempel_omzet_jaar', 'Drempel btw-vrijstelling (omzet per jaar, €)', '25000'],
  ['drempel_winst_jaar', 'Drempel sociale bijdragen bijberoep (per jaar, €)', '1881,76'],
];

function Bedrijf() {
  const { data, fout, laden, herlaad } = useData('/instellingen');
  const { melding, zetVuil } = useOmgeving();
  const origineel = useMemo(() => {
    const m = Object.fromEntries((data || []).map(r => [r.sleutel, r.waarde ?? '']));
    return Object.fromEntries(BEDRIJF_VELDEN.map(([s]) => [s, m[s] ?? '']));
  }, [data]);
  const [w, setW] = useState(origineel);
  const [bezig, setBezig] = useState(false);
  useEffect(() => { setW(origineel); }, [origineel]);
  const vuil = JSON.stringify(w) !== JSON.stringify(origineel);
  useEffect(() => { zetVuil(vuil); return () => zetVuil(false); }, [vuil, zetVuil]);

  async function opslaan() {
    setBezig(true);
    try { await api.put('/instellingen', w); await herlaad(); melding('Bedrijfsgegevens opgeslagen.'); }
    catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); }
  }

  if (fout) return <Fout tekst={fout} />;
  if (!data && laden) return <Laden />;
  return (
    <div className="panel">
      <h3>Bedrijfsgegevens <span className="sub" style={{ fontWeight: 400 }}>op offerte, werkbon en pakbon · startdatum en drempels voor Financiën</span>
        {vuil && <span className="opslaanbalk">
          <button type="button" className="btn primary" disabled={bezig} onClick={opslaan}>Opslaan</button>
          <button type="button" className="btn" disabled={bezig} onClick={() => setW(origineel)}>Verwerpen</button>
        </span>}
      </h3>
      <div className="pbody">
        <div className="fgrid">
          {BEDRIJF_VELDEN.map(([s, label, ph]) => (
            <div key={s}><label htmlFor={`b-${s}`}>{label}</label>
              <input id={`b-${s}`} className="inp" value={w[s] ?? ''} placeholder={ph} onChange={e => setW(x => ({ ...x, [s]: e.target.value }))} /></div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Integraties ──────────────────────────────────────────────────────── */
function Integraties() {
  const { data, fout } = useData('/instellingen/integraties');
  if (fout) return <Fout tekst={fout} />;
  const status = (aan) => data == null ? <span className="sub">…</span>
    : aan ? <span className="badge b-pos">Ingesteld</span> : <span className="badge b-neutral">Niet ingesteld</span>;
  return (
    <div className="panel">
      <h3>Integraties</h3>
      <div className="pbody listwrap">
        <table className="mini">
          <tbody>
            <tr><td><b>Home Assistant</b><div className="sub">printers, wattage, kWh (stap 6)</div></td><td>{status(data?.home_assistant)}</td><td className="sub">Token via de add-on-configuratie, nooit in de databank.</td></tr>
            <tr><td><b>Gemini</b><div className="sub">factuur inlezen (Inkoop)</div></td><td>{status(data?.gemini)}</td><td className="sub">Sleutel via GEMINI_API_KEY.{data?.gemini_model && <> Model: <span className="mono">{data.gemini_model}</span> (GEMINI_MODEL).</>}{data && <> Reserve bij overbelasting: {data.gemini_reserve?.length ? data.gemini_reserve.map(m => <span key={m} className="mono">{m} </span>) : 'geen'} (GEMINI_MODEL_RESERVE).</>}</td></tr>
            <tr><td><b>E-mail</b><div className="sub">offertes en werkbonnen mailen</div></td><td>{status(data?.mail)}</td><td className="sub">Via {data?.mail_server || 'Gmail'}. Add-on-configuratie: smtp_user, smtp_pass, optioneel smtp_from; voor een eigen mailserver ook smtp_host en smtp_port (OVH: ssl0.ovh.net, 465). Leeg = Gmail met app-wachtwoord. Nooit in de databank.</td></tr>
            <tr><td><b>PDF</b><div className="sub">offerte, werkbon, pakbon</div></td><td>{data == null ? <span className="sub">…</span> : data.pdf ? <span className="badge b-pos">Browser gevonden</span> : <span className="badge b-warn">Geen browser</span>}</td><td className="sub">Maakt de PDF met Chrome, Edge of Chromium (lokaal) of het Chromium van de add-on. Een ander pad: PUPPETEER_EXECUTABLE_PATH.</td></tr>
            <tr><td><b>Accountable</b><div className="sub">facturen, bonnetjes, Peppol</div></td><td><span className="badge b-neutral">Via export</span></td><td className="sub">Geen API. Het inlezen van de export komt onder Financiën (stap 7).</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Onderhoud (stap 8): versie en backups ─────────────────────────────── */
function Onderhoud() {
  const { data, fout, herlaad } = useData('/onderhoud');
  const { melding } = useOmgeving();
  const [bezig, setBezig] = useState(false);
  const kb = n => `${Math.max(1, Math.round(n / 1024)).toLocaleString('nl-BE')} kB`;
  async function nu() {
    setBezig(true);
    try { const r = await api.post('/onderhoud/backups'); melding(`Backup ${r.naam} gemaakt.`); await herlaad(); }
    catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  if (fout) return <Fout tekst={fout} />;
  if (!data) return <Laden />;
  return (
    <div className="panel">
      <h3>Onderhoud</h3>
      <div className="pbody" style={{ display: 'grid', gap: 12 }}>
        <dl className="pwaarden" style={{ maxWidth: 520 }}>
          <dt>Versie</dt><dd className="num">{data.versie}</dd>
          <dt>Databank</dt><dd className="num">versie {data.db_versie}</dd>
          <dt>Map</dt><dd className="mono" style={{ overflowWrap: 'anywhere' }}>{data.db_pad}</dd>
        </dl>
        <div><button type="button" className="btn primary" disabled={bezig || !data.backup_map} onClick={nu}>Nu een backup maken</button></div>
        <p className="note" style={{ margin: 0 }}>{data.automatisch ? 'Elke dag wordt automatisch een backup gemaakt (de laatste 14 blijven bewaard); ' : 'Automatische backups staan uit; '}
          backups met de hand: de laatste 20. Ze staan in <span className="mono">{data.backup_map || '—'}</span>{' '}
          (in de add-on zitten ze ook in de back-ups van Home Assistant). Download er af en toe één naar je pc. Terugzetten: hernoem de backup naar <span className="mono">terugzetten.db</span>, zet hem in de map van de add-on (addon_configs, via Samba of SSH) en herstart de add-on; de huidige databank gaat eerst naar de backups. Zie de README.</p>
        {data.backups.length > 0 && (
          <div className="tabelvak">
            <table className="mini">
              <thead><tr><th>Backup</th><th>Soort</th><th className="r">Grootte</th><th /></tr></thead>
              <tbody>{data.backups.map(b => (
                <tr key={b.naam}><td className="mono">{b.naam}</td><td>{b.soort}</td><td className="r num">{kb(b.grootte)}</td>
                  <td className="r"><a className="btn ghost klein" href={new URL(`${BASE}/onderhoud/backups/${b.naam}`, document.baseURI).href} download>Download</a></td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
