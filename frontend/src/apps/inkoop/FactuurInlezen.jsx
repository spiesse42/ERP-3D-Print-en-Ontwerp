import { useEffect, useMemo, useState } from 'react';
import { api, BASE } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { ControlePaneel, Veld, Fout } from '../../schil/Weergaven.jsx';
import Icoon from '../../schil/Icoon.jsx';
import { euro, naarInvoer, uitInvoer } from '../../lib/formaat.js';

// Factuur, bonnetje of BESTELBON inlezen (stap 3c; bestelbon 25-09):
// - bestelbon (PDF, foto of geplakte tekst van de bestelmail) → aankoop
//   "besteld" met het bestelnummer, prijzen volgen met de factuur
// - factuur met een gekend bestelnummer → koppelen aan die aankoop
//   (prijzen per regel, ook van wat al ontvangen is)
// 1. bestand kiezen → Gemini leest → het ERP koppelt aan wat het kent
// 2. nakijken naast het document: per regel herkend / voorstel / nieuw / kost
// 3. "Aankoop aanmaken": alles in één keer (leverancier, nieuwe artikelen,
//    aankoop met bijlage, codes onthouden, standaard meteen ontvangen)

const STATUS = { herkend: ['b-pos', 'Herkend'], voorstel: ['b-warn', 'Voorstel'], nieuw: ['b-info', 'Nieuw'], kost: ['b-neutral', 'Kost'] };
const SOORTEN = [['artikel', 'Bestaand artikel'], ['nieuw_artikel', 'Nieuw artikel'], ['nieuw_filament', 'Nieuw filament'], ['kost', 'Kost']];

// Keuzelijst uit de catalogus, of een nieuwe naam intikken.
function KeuzeOfNieuw({ label, opties, id, naam, onWijzig }) {
  const nieuw = !id;
  return (
    <div className="kon">
      <select className="inp" aria-label={label} value={nieuw ? '__nieuw__' : String(id)}
        onChange={e => (e.target.value === '__nieuw__' ? onWijzig({ id: null, naam: naam || '' }) : onWijzig({ id: Number(e.target.value), naam: opties.find(o => String(o.id) === e.target.value)?.naam }))}>
        {opties.map(o => <option key={o.id} value={o.id}>{o.naam}</option>)}
        <option value="__nieuw__">{nieuw ? 'Nieuw:' : '+ Nieuw…'}</option>
      </select>
      {nieuw && <input className="inp" aria-label={`Nieuwe ${label.toLowerCase()}`} placeholder={`Nieuwe ${label.toLowerCase()}`} value={naam || ''} onChange={e => onWijzig({ id: null, naam: e.target.value })} />}
    </div>
  );
}

export default function FactuurInlezen() {
  const { melding, zetVuil, navigeer } = useOmgeving();
  const { data: integraties } = useData('/instellingen/integraties');
  const [fase, setFase] = useState('kiezen');       // kiezen | lezen | nakijken
  const [fout, setFout] = useState(null);
  const [lees, setLees] = useState(null);           // { token, bestandsnaam, mimetype }
  const [f, setF] = useState(null);                 // het nakijkformulier
  const [bezig, setBezig] = useState(false);
  const [sleep, setSleep] = useState(false);
  const [plak, setPlak] = useState('');
  const { data: leveranciers } = useData(fase === 'nakijken' ? '/leveranciers' : null);
  const { data: artikelen } = useData(fase === 'nakijken' ? '/voorraad/artikelen' : null);
  const { data: categorieen } = useData(fase === 'nakijken' ? '/voorraad/categorieen' : null);
  const { data: merken } = useData(fase === 'nakijken' ? '/filament/merken' : null);
  const { data: materialen } = useData(fase === 'nakijken' ? '/filament/materialen' : null);
  const { data: kleuren } = useData(fase === 'nakijken' ? '/filament/kleuren' : null);
  const { data: groepen } = useData(fase === 'nakijken' ? '/filament/types' : null);

  useEffect(() => { zetVuil(fase === 'nakijken'); return () => zetVuil(false); }, [fase, zetVuil]);

  async function leesIn(bestand, tekst = null) {
    if (!bestand && !tekst) return;
    setFout(null); setFase('lezen');
    try {
      const fd = new FormData();
      if (tekst) fd.append('tekst', tekst); else fd.append('bestand', bestand);
      const r = await api.upload('/inkoop/inlezen', fd);
      const v = r.voorstel;
      setLees({ token: r.token, bestandsnaam: r.bestandsnaam, mimetype: r.mimetype, model: r.model, hoofdmodel: r.hoofdmodel, bron: r.bron || 'ocr' });
      setF({
        leverancier: v.leverancier, factuurnummer: v.factuurnummer || '', datum: v.datum || '', totaal: v.totaal_factuur,
        documentsoort: v.documentsoort || 'factuur', bestelnummer: v.bestelnummer || '', bestelling: v.bestelling || null, koppelen: !!v.bestelling,
        dubbel: v.dubbel, toch_dubbel: false, meteen_ontvangen: !v.bestelling && v.documentsoort !== 'bestelbon', locatie: '', prijzenKg: {},
        regels: v.regels.map((r0, i) => ({ ...r0, sleutel: i, aantal: naarInvoer(r0.aantal), prijs_per_eenheid: naarInvoer(r0.prijs_per_eenheid), artikel_id: r0.artikel_id ?? '', aankoop_regel_id: r0.aankoop_regel_id ?? '' })),
      });
      setFase('nakijken');
    } catch (e) { setFout(e.message); setFase('kiezen'); }
  }

  const zetRegel = (i, w) => setF(x => ({ ...x, regels: x.regels.map((r, j) => (j === i ? { ...r, ...w } : r)) }));
  function wisselSoort(i, soort) {
    const r = f.regels[i];
    const w = { soort };
    if (soort === 'nieuw_artikel' && !r.nieuw_artikel) w.nieuw_artikel = { type: 'artikel', naam: r.omschrijving.slice(0, 80), categorie_id: null };
    if (soort === 'nieuw_filament' && !r.filament) w.filament = { merk_id: null, merk_naam: '', materiaal_id: null, materiaal_naam: '', kleur_id: null, kleur_naam: '', kleur_hex: '#888888' };
    if (soort === 'kost' && !r.omschrijving) w.omschrijving = 'Verzending';
    zetRegel(i, w);
  }

  // Nieuwe prijsgroepen (merk + type die nog niet bestaan): één prijs per groep.
  const sleutelGroep = fl => `${fl.merk_id || `n:${(fl.merk_naam || '').toLowerCase()}`}|${fl.materiaal_id || `n:${(fl.materiaal_naam || '').toLowerCase()}`}`;
  const nieuweGroepen = useMemo(() => {
    if (!f || !groepen) return [];   // pas tonen als de bestaande prijsgroepen geladen zijn (anders even een valse "nieuwe" groep)
    const m = new Map();
    f.regels.filter(r => r.soort === 'nieuw_filament' && r.filament).forEach(r => {
      const fl = r.filament;
      const bestaat = fl.merk_id && fl.materiaal_id && (groepen || []).some(g => g.merk_id === fl.merk_id && g.materiaal_id === fl.materiaal_id);
      if (!bestaat && (fl.merk_naam || fl.merk_id) && (fl.materiaal_naam || fl.materiaal_id)) m.set(sleutelGroep(fl), `${fl.merk_naam || '?'} ${fl.materiaal_naam || '?'}`);
    });
    return [...m.entries()];
  }, [f, groepen]);

  const som = f ? f.regels.reduce((s, r) => { const a = uitInvoer(r.aantal), p = uitInvoer(r.prijs_per_eenheid); return s + (a > 0 && p >= 0 && p !== null ? a * p : 0); }, 0) : 0;
  const klopt = f?.totaal == null ? null : Math.abs(f.totaal - som) <= 0.02;

  async function bevestig() {
    const ontbreekt = nieuweGroepen.find(([k]) => { const p = uitInvoer(f.prijzenKg[k]); return p === null || Number.isNaN(p); });
    if (ontbreekt) { melding(`Vul de verkoopprijs per kg in voor de nieuwe prijsgroep ${ontbreekt[1]}.`, 'fout'); return; }
    setBezig(true);
    try {
      const bestelbon = f.documentsoort === 'bestelbon';
      const koppel = !bestelbon && f.bestelling && f.koppelen;
      const body = {
        leverancier: f.leverancier.id ? { id: f.leverancier.id } : f.leverancier,
        documentsoort: f.documentsoort, bestelnummer: f.bestelnummer, aankoop_id: koppel ? f.bestelling.id : null,
        factuurnummer: bestelbon ? null : f.factuurnummer, datum: f.datum, meteen_ontvangen: !bestelbon && f.meteen_ontvangen, locatie: f.locatie, toch_dubbel: f.toch_dubbel,
        regels: f.regels.map(r => ({
          aankoop_regel_id: koppel && r.aankoop_regel_id ? Number(r.aankoop_regel_id) : null,
          soort: r.soort, artikel_id: r.artikel_id || null, nieuw_artikel: r.nieuw_artikel,
          filament: r.filament ? { ...r.filament, verkoopprijs_per_kg: uitInvoer(f.prijzenKg[sleutelGroep(r.filament)]) } : undefined,
          omschrijving: r.omschrijving, productcode: r.productcode, aantal: uitInvoer(r.aantal), prijs_per_eenheid: uitInvoer(r.prijs_per_eenheid),
        })),
      };
      const ak = await api.post(`/inkoop/inlezen/${lees.token}/bevestig`, body);
      zetVuil(false);
      melding(ak.gekoppeld
        ? `Factuur gekoppeld aan ${ak.nummer}: ${ak.bijgewerkt} regel${ak.bijgewerkt === 1 ? '' : 's'} bijgewerkt${ak.toegevoegd ? `, ${ak.toegevoegd} toegevoegd` : ''}.`
        : bestelbon ? `Bestelling ${ak.nummer} aangemaakt (besteld). Ontvang de rollen als ze binnen zijn; de factuur koppel je later aan deze aankoop.`
        : `Aankoop ${ak.nummer} aangemaakt${f.meteen_ontvangen ? ' en in voorraad ontvangen' : ''}.`);
      navigeer(`/inkoop/aankopen/${ak.id}`);
    } catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); }
  }

  if (fase !== 'nakijken') {
    return (
      <>
        <ControlePaneel kruimels={[{ label: 'Factuur of bestelbon inlezen' }]} />
        <div className="page">
          {integraties && !integraties.gemini && <Fout tekst="De Gemini-sleutel is niet ingesteld (GEMINI_API_KEY in de add-on-configuratie). Zonder sleutel kan een PDF of foto niet uitgelezen worden; een UBL-bestand (.xml) wel." />}
          {fout && <Fout tekst={fout} />}
          <label className={`dropzone${sleep ? ' over' : ''}${fase === 'lezen' ? ' bezig' : ''}`} htmlFor="factuurbestand"
            onDragOver={e => { e.preventDefault(); setSleep(true); }} onDragLeave={() => setSleep(false)}
            onDrop={e => { e.preventDefault(); setSleep(false); leesIn(e.dataTransfer.files?.[0]); }}>
            {fase === 'lezen' ? <>
              <b>Gemini leest het document…</b>
              <span className="sub">Dat duurt meestal 5 à 20 seconden. Is Gemini druk, dan probeert het ERP het vanzelf opnieuw en eventueel met een reservemodel (kan tot een minuut duren).</span>
            </> : <>
              <Icoon naam="plus" maat={28} />
              <b>Sleep een factuur, bonnetje of bestelbon hierheen</b>
              <span className="sub">of klik om een PDF, foto/screenshot of UBL-bestand (.xml, Peppol/Accountable-export) te kiezen (max. 20 MB)</span>
            </>}
          </label>
          <input id="factuurbestand" type="file" className="sr-only" accept="application/pdf,image/*,.xml,application/xml,text/xml" disabled={fase === 'lezen'} onChange={e => leesIn(e.target.files?.[0])} />
          <div className="plakvak">
            <label className="lbl" htmlFor="plaktekst">Of plak de tekst van een bestelmail (bv. "Bedankt voor uw bestelling")</label>
            <textarea id="plaktekst" className="inp" rows={5} value={plak} disabled={fase === 'lezen'} onChange={e => setPlak(e.target.value)}
              placeholder="Selecteer in je mail alles (Ctrl+A), kopieer (Ctrl+C) en plak het hier (Ctrl+V)." />
            <div><button type="button" className="btn" disabled={fase === 'lezen' || plak.trim().length < 20} onClick={() => leesIn(null, plak)}>Tekst inlezen</button></div>
          </div>
          <p className="note" style={{ margin: 0 }}><b>Bestelbon:</b> het ERP maakt een aankoop "besteld" met het bestelnummer (prijzen volgen met de factuur). Lees je later de factuur in, dan herkent het ERP de bestelling aan het bestel-/ordernummer en koppelt de factuur aan dezelfde aankoop.</p>
          <p className="note" style={{ margin: 0 }}>Gemini leest de gegevens (een UBL-bestand leest het ERP zelf, zonder Gemini); het ERP koppelt ze aan je leveranciers en artikelen. Je kijkt alles na voor er iets bewaard wordt. Wat je bevestigt (productcodes, omschrijvingen), wordt onthouden voor de volgende factuur van die leverancier.</p>
        </div>
      </>
    );
  }

  const levKeuze = f.leverancier.id ? String(f.leverancier.id) : '__nieuw__';
  const bestelbonModus = f.documentsoort === 'bestelbon';
  const koppelModus = !bestelbonModus && !!f.bestelling && f.koppelen;
  const tellers = f.regels.reduce((t, r) => ({ ...t, [r.status || 'nieuw']: (t[r.status || 'nieuw'] || 0) + 1 }), {});
  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Factuur of bestelbon inlezen', naar: '/inkoop/inlezen' }, { label: lees.bestandsnaam }]} />
      <div className="inlees">
        <div className="voorbeeld">
          {lees.mimetype === 'application/pdf' || lees.mimetype === 'application/xml' || lees.mimetype === 'text/plain'
            ? <iframe title="Factuur" src={`${BASE}/inkoop/inlezen/${lees.token}/bestand`} />
            : <img alt="Factuur" src={`${BASE}/inkoop/inlezen/${lees.token}/bestand`} />}
          <a className="linkish" href={`${BASE}/inkoop/inlezen/${lees.token}/bestand`} target="_blank" rel="noopener noreferrer">Document in een nieuw tabblad openen</a>
        </div>
        <div className="sheet">
          <div className="sheet-bar">
            <div className="links">
              <button type="button" className="btn terug" onClick={() => { zetVuil(false); setFase('kiezen'); setF(null); }}><Icoon naam="pijlLinks" maat={16} /> Ander document</button>
            </div>
            <div className="btns">
              <button type="button" className="btn primary" disabled={bezig || (f.dubbel && !f.toch_dubbel && !koppelModus)} onClick={bevestig}>
                {bezig ? 'Bezig…' : bestelbonModus ? 'Bestelling aanmaken' : koppelModus ? `Koppelen aan ${f.bestelling.nummer}` : 'Aankoop aanmaken'}</button>
            </div>
          </div>
          <div className="sheet-head">
            <div className="kop">
              <div className="nr">Nakijken</div>
              <h2>{f.leverancier.naam || 'Onbekende leverancier'}</h2>
              {lees.bron === 'ubl' && <div className="sub">Gelezen uit het UBL-bestand (zonder Gemini){lees.mimetype === 'application/pdf' ? '; links de meegestuurde PDF' : ''}.</div>}
              {lees.model && <div className="sub">Gelezen door <span className="mono">{lees.model}</span>{lees.model !== lees.hoofdmodel && <> <span className="badge b-warn">reservemodel: kijk extra goed na</span></>}</div>}
              <div className="badges">
                {Object.entries(tellers).map(([s, n]) => <span key={s} className={`badge ${STATUS[s]?.[0] || 'b-neutral'}`}>{n} {STATUS[s]?.[1].toLowerCase() || s}</span>)}
              </div>
            </div>
          </div>
          {f.bestelling && !bestelbonModus && (
            <div className="waarschuwing info-lint" style={{ display: 'block' }} role="status">
              <b>Deze factuur hoort bij bestelling {f.bestelling.extern_bestelnummer}</b>: aankoop {f.bestelling.nummer} van {f.bestelling.leverancier}, besteld op {f.bestelling.datum.split('-').reverse().join('/')} ({f.bestelling.status === 'besteld' ? 'nog niets ontvangen' : f.bestelling.status === 'deels' ? 'deels ontvangen' : f.bestelling.status}).
              <label className="vinkje" style={{ marginTop: 6 }}><input type="checkbox" checked={f.koppelen} onChange={e => setF(x => ({ ...x, koppelen: e.target.checked }))} /> Factuur aan {f.bestelling.nummer} koppelen (prijzen per regel bijwerken, ook van wat al ontvangen is), i.p.v. een nieuwe aankoop</label>
            </div>
          )}
          {f.dubbel && !koppelModus && (
            <div className="waarschuwing">
              <b>{bestelbonModus ? 'Deze bestelling werd al ingelezen' : 'Deze factuur werd al ingelezen'}</b> ({f.dubbel.nummer}).
              <label className="vinkje"><input type="checkbox" checked={f.toch_dubbel} onChange={e => setF(x => ({ ...x, toch_dubbel: e.target.checked }))} /> Toch opnieuw inlezen</label>
            </div>
          )}
          <div className="fields">
            <div>
              <Veld label="Leverancier" id="i-lev" hint={f.leverancier.id ? null : 'Nieuwe leverancier: wordt aangemaakt bij bevestigen.'}>
                <select id="i-lev" className="inp" value={levKeuze} onChange={e => {
                  const v = e.target.value;
                  setF(x => ({ ...x, leverancier: v === '__nieuw__' ? { id: null, naam: x.leverancier.naam || '', btw_nummer: x.leverancier.btw_nummer, website: x.leverancier.website } : { id: Number(v), naam: leveranciers.find(l => String(l.id) === v)?.naam } }));
                }}>
                  {(leveranciers || []).map(l => <option key={l.id} value={l.id}>{l.naam}</option>)}
                  <option value="__nieuw__">+ Nieuwe leverancier</option>
                </select>
                {!f.leverancier.id && <input className="inp" aria-label="Naam nieuwe leverancier" value={f.leverancier.naam || ''} onChange={e => setF(x => ({ ...x, leverancier: { ...x.leverancier, naam: e.target.value } }))} />}
              </Veld>
              <Veld label="Document">
                <div className="seg" role="group" aria-label="Soort document">
                  <button type="button" aria-pressed={!bestelbonModus} onClick={() => setF(x => ({ ...x, documentsoort: 'factuur' }))}>Factuur</button>
                  <button type="button" aria-pressed={bestelbonModus} onClick={() => setF(x => ({ ...x, documentsoort: 'bestelbon' }))}>Bestelbon</button>
                </div>
              </Veld>
              <Veld label="Bestelnummer" id="i-bnr" hint="Bestel-/ordernummer van de webshop: daarmee koppelt de factuur later aan deze aankoop."><input id="i-bnr" className="inp" value={f.bestelnummer} onChange={e => setF(x => ({ ...x, bestelnummer: e.target.value }))} /></Veld>
              {!bestelbonModus && <Veld label="Factuurnummer" id="i-fnr" hint="Enkel intern."><input id="i-fnr" className="inp" value={f.factuurnummer} onChange={e => setF(x => ({ ...x, factuurnummer: e.target.value }))} /></Veld>}
              <Veld label={bestelbonModus ? 'Besteldatum' : 'Datum'} id="i-datum"><input id="i-datum" type="date" className="inp" value={f.datum} onChange={e => setF(x => ({ ...x, datum: e.target.value }))} /></Veld>
            </div>
            <div>
              {!bestelbonModus && <Veld label="Totaal factuur"><b className="num">{euro(f.totaal)}</b></Veld>}
              {!bestelbonModus && <Veld label="Som van de regels"><span className="num">{euro(Math.round(som * 100) / 100)}</span> {klopt === true ? <span className="badge b-pos">klopt</span> : klopt === false ? <span className="badge b-warn">verschil {euro(Math.round((f.totaal - som) * 100) / 100)}</span> : null}</Veld>}
              {bestelbonModus ? <Veld label="Voorraad"><span className="sub">Nog niets: ontvang de rollen als ze binnen zijn (Inkoop → aankoop → Ontvangen). Prijzen mogen leeg blijven; ze komen met de factuur.</span></Veld> : (
                <Veld label="Voorraad">
                  <label className="vinkje" htmlFor="i-ontv"><input id="i-ontv" type="checkbox" checked={f.meteen_ontvangen} onChange={e => setF(x => ({ ...x, meteen_ontvangen: e.target.checked }))} /> {koppelModus ? 'Wat nog openstaat meteen in voorraad ontvangen' : 'Meteen in voorraad ontvangen'}</label>
                </Veld>
              )}
              {!bestelbonModus && f.meteen_ontvangen && <Veld label="Locatie" id="i-loc"><input id="i-loc" className="inp" value={f.locatie} placeholder="optioneel" onChange={e => setF(x => ({ ...x, locatie: e.target.value }))} /></Veld>}
            </div>
          </div>

          <div className="tabpanel">
            <h3 className="kopje">Regels</h3>
            <div className="inleesregels">
              {f.regels.map((r, i) => {
                const [bk, bl] = STATUS[r.status] || STATUS.nieuw;
                const a = uitInvoer(r.aantal), p = uitInvoer(r.prijs_per_eenheid);
                return (
                  <div className="irij" key={r.sleutel}>
                    {koppelModus && (() => {
                      const o = f.bestelling.regels.find(x => String(x.id) === String(r.aankoop_regel_id));
                      return (
                        <div className="irij-koppel">
                          <label className="sub" htmlFor={`i-kop-${i}`}>Hoort bij</label>
                          <select id={`i-kop-${i}`} className="inp" aria-label={`Bestelregel voor regel ${i + 1}`} value={String(r.aankoop_regel_id || '')} onChange={e => zetRegel(i, { aankoop_regel_id: e.target.value })}>
                            <option value="">Nieuwe regel (staat niet op de bestelling)</option>
                            {f.bestelling.regels.map(x => <option key={x.id} value={x.id}>{x.weergave} · {naarInvoer(x.aantal)} st.{x.ontvangen ? ` (${naarInvoer(x.ontvangen)} ontvangen)` : ''}</option>)}
                          </select>
                          {o && <span className="sub">prijs {o.prijs_per_eenheid == null ? 'nog leeg' : euro(o.prijs_per_eenheid)} → <b>{p === null || Number.isNaN(p) ? '—' : euro(p)}</b></span>}
                        </div>
                      );
                    })()}
                    <div className="irij-kop">
                      <span className={`badge ${bk}`}>{bl}{r.via ? ` via ${r.via}` : ''}</span>
                      <span className="sub oms" title={r.omschrijving}>{r.productcode && <span className="mono">{r.productcode} · </span>}{r.omschrijving}</span>
                      <button type="button" className="btn ghost" aria-label={`Regel ${i + 1} weglaten`} onClick={() => setF(x => ({ ...x, regels: x.regels.filter((_, j) => j !== i) }))}><Icoon naam="kruis" maat={14} /></button>
                    </div>
                    <div className="irij-body">
                      <select className="inp soortkeuze" aria-label={`Soort regel ${i + 1}`} value={r.soort} onChange={e => wisselSoort(i, e.target.value)}>
                        {SOORTEN.map(([w, l]) => <option key={w} value={w}>{l}</option>)}
                      </select>
                      <div className="wat">
                        {r.soort === 'artikel' && (
                          <select className="inp" aria-label={`Artikel regel ${i + 1}`} value={String(r.artikel_id || '')} onChange={e => zetRegel(i, { artikel_id: e.target.value ? Number(e.target.value) : '' })}>
                            <option value="">Kies een artikel…</option>
                            {(artikelen || []).map(x => <option key={x.id} value={x.id}>{x.weergave}</option>)}
                          </select>
                        )}
                        {r.soort === 'nieuw_artikel' && r.nieuw_artikel && (
                          <div className="velden3">
                            <input className="inp" aria-label={`Naam nieuw artikel regel ${i + 1}`} value={r.nieuw_artikel.naam} onChange={e => zetRegel(i, { nieuw_artikel: { ...r.nieuw_artikel, naam: e.target.value } })} />
                            <select className="inp" aria-label="Type" value={r.nieuw_artikel.type} onChange={e => zetRegel(i, { nieuw_artikel: { ...r.nieuw_artikel, type: e.target.value } })}>
                              <option value="artikel">Artikel</option><option value="dienst">Dienst</option>
                            </select>
                            <select className="inp" aria-label="Categorie" value={r.nieuw_artikel.categorie_id ?? ''} onChange={e => zetRegel(i, { nieuw_artikel: { ...r.nieuw_artikel, categorie_id: e.target.value ? Number(e.target.value) : null } })}>
                              <option value="">Geen categorie</option>
                              {(categorieen || []).map(c => <option key={c.id} value={c.id}>{c.pad}</option>)}
                            </select>
                          </div>
                        )}
                        {r.soort === 'nieuw_filament' && r.filament && (
                          <div className="velden3">
                            <KeuzeOfNieuw label="Merk" opties={merken || []} id={r.filament.merk_id} naam={r.filament.merk_naam}
                              onWijzig={v => zetRegel(i, { filament: { ...r.filament, merk_id: v.id, merk_naam: v.naam } })} />
                            <KeuzeOfNieuw label="Type" opties={materialen || []} id={r.filament.materiaal_id} naam={r.filament.materiaal_naam}
                              onWijzig={v => zetRegel(i, { filament: { ...r.filament, materiaal_id: v.id, materiaal_naam: v.naam } })} />
                            <div className="kleurrij">
                              <KeuzeOfNieuw label="Kleur" opties={kleuren || []} id={r.filament.kleur_id} naam={r.filament.kleur_naam}
                                onWijzig={v => zetRegel(i, { filament: { ...r.filament, kleur_id: v.id, kleur_naam: v.naam } })} />
                              {!r.filament.kleur_id && <input type="color" className="kleurkiezer" aria-label="Kleurcode nieuwe kleur" value={r.filament.kleur_hex || '#888888'} onChange={e => zetRegel(i, { filament: { ...r.filament, kleur_hex: e.target.value } })} />}
                            </div>
                          </div>
                        )}
                        {r.soort === 'kost' && (
                          <input className="inp" aria-label={`Omschrijving kost regel ${i + 1}`} value={r.omschrijving} onChange={e => zetRegel(i, { omschrijving: e.target.value })} />
                        )}
                      </div>
                      <div className="getallen">
                        <input className="inp num" inputMode="decimal" aria-label={`Aantal regel ${i + 1}`} value={r.aantal} onChange={e => zetRegel(i, { aantal: e.target.value })} />
                        <span className="sub">×</span>
                        <input className="inp num" inputMode="decimal" aria-label={`Prijs regel ${i + 1}`} value={r.prijs_per_eenheid} placeholder={bestelbonModus ? 'volgt' : undefined} onChange={e => zetRegel(i, { prijs_per_eenheid: e.target.value })} />
                        <span className="num sub">= {a > 0 && p >= 0 && p !== null ? euro(Math.round(a * p * 100) / 100) : '—'}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {nieuweGroepen.length > 0 && (
              <div className="nieuwegroepen">
                <h3 className="kopje">Nieuwe prijsgroepen</h3>
                <p className="note" style={{ marginTop: 0 }}>Deze combinaties van merk en type bestaan nog niet. Vul de verkoopprijs per kg in (zoals in Instellingen → Materiaalprijzen).</p>
                {nieuweGroepen.map(([k, naam]) => (
                  <div className="unit" key={k} style={{ marginBottom: 6 }}>
                    <span style={{ minWidth: 180, color: 'var(--ink)', fontWeight: 600 }}>{naam}</span>
                    <input className="inp num" inputMode="decimal" aria-label={`Verkoopprijs per kg ${naam}`} style={{ maxWidth: 110 }} value={f.prijzenKg[k] ?? ''} onChange={e => setF(x => ({ ...x, prijzenKg: { ...x.prijzenKg, [k]: e.target.value } }))} />
                    <span>€/kg</span>
                  </div>
                ))}
              </div>
            )}
            <p className="note">Prijzen incl. btw en na korting. Kosten (verzending) tellen niet mee in de kostprijs van de artikelen. Regels die je weglaat, komen niet in de aankoop.</p>
          </div>
        </div>
      </div>
    </>
  );
}
