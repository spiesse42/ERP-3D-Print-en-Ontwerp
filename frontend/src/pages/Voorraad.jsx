import { useState, useEffect } from 'react';
import { api, BASE } from '../lib/api.js';
import KeuzeMetToevoegen from '../components/KeuzeMetToevoegen.jsx';
import FactuurUploadModal from '../components/FactuurUploadModal.jsx';

// ── Gedeelde groepeer-helpers ────────────────────────────────────────────────
// Filament (rollen) en Artikelen (voorraad-eenheden) delen exact hetzelfde
// weergavepatroon: 1 regel per combinatie/artikel in de hoofdlijst, en bij het
// openklikken de onderliggende "batches" (toevoegmomenten) apart — i.p.v. elke
// individuele rol/stuk plat door elkaar te tonen. Een batch wordt herkend via
// een EXPLICIETE `batch_id` (verwijst naar het id van de eerst-aangemaakte rij
// van die batch — zie db_migration_v4.js), niet via toevallig gelijke datum/
// prijs, zodat de groepering ook klopt als je die velden leeg laat.
function groepeer(rijen, sleutelFn) {
  const map = new Map();
  for (const rij of rijen) {
    const key = sleutelFn(rij);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(rij);
  }
  return [...map.values()];
}
function groepeerBatches(rijen) {
  const map = new Map();
  for (const rij of rijen) {
    const bid = rij.batch_id ?? rij.id;
    if (!map.has(bid)) map.set(bid, []);
    map.get(bid).push(rij);
  }
  // Meest recente batch (hoogste id erin) eerst.
  return [...map.values()].sort((a, b) => Math.max(...b.map(r => r.id)) - Math.max(...a.map(r => r.id)));
}

// Batch-regel: toont 1 toevoegmoment (aantal/prijs/datum/locatie) met een
// +/- stepper om er stuks van actief naar inactief te zetten (en terug), en
// knoppen om de gedeelde velden van de hele batch te bewerken of de hele
// batch te verwijderen. Herbruikt letterlijk zowel voor filamentrollen als
// artikel-voorraad — beide hebben dezelfde vorm (id/aankoopprijs_eur/locatie/
// gekocht_op/actief/batch_id).
function BatchRij({ batch, eenheid, onWijzigActief, onBewerken, onVerwijder, bezig }) {
  const eerste = batch[0];
  const totaal = batch.length;
  const actief = batch.filter(x => x.actief).length;
  return (
    <div className="card" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          {eerste.gekocht_op ? `Gekocht op ${eerste.gekocht_op}` : 'Datum onbekend'}
          {eerste.locatie && <> · {eerste.locatie}</>}
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          <button onClick={onBewerken} title="Bewerken" disabled={bezig}>✏</button>
          <button onClick={onVerwijder} title="Batch verwijderen" disabled={bezig}>🗑</button>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          {eerste.aankoopprijs_eur != null ? `€${Number(eerste.aankoopprijs_eur).toFixed(2)} / ${eenheid}` : 'Geen aankoopprijs'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn" type="button" onClick={() => onWijzigActief(-1)} disabled={bezig || actief === 0} style={{ padding: '2px 10px' }}>−</button>
          <strong style={{ minWidth: 46, textAlign: 'center' }}>{actief} / {totaal}</strong>
          <button className="btn" type="button" onClick={() => onWijzigActief(1)} disabled={bezig || actief === totaal} style={{ padding: '2px 10px' }}>+</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Filament
// ═══════════════════════════════════════════════════════════════════════════

const LEEG_ROL = {
  merk_id: '', materiaal_id: '', kleur_id: '',
  verkoopprijs_nieuw: '', min_rollen_nieuw: '',
  aankoopprijs_eur: '', locatie: '', gekocht_op: '',
  aantal: '1',
};

function rgbTekstNaarHex(tekst) {
  const m = /^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*$/.exec(tekst || '');
  if (!m) return null;
  const clamp = n => Math.max(0, Math.min(255, parseInt(n, 10)));
  const hex = n => clamp(n).toString(16).padStart(2, '0');
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`.toUpperCase();
}

// Doorzoekbare kleurkeuze + "nieuwe kleur toevoegen" (naam + hex, met een
// visuele kleurkiezer en een optioneel RGB-veld als alternatief voor hex).
// Module-niveau, niet genest — anders verliest een <input> de focus bij elke
// toetsaanslag.
function KleurKeuze({ waarde, opties, onKies, onNieuw }) {
  const [toevoegen, setToevoegen] = useState(false);
  const [naam, setNaam] = useState('');
  const [hex, setHex] = useState('#c9c2b2');
  const [rgbTekst, setRgbTekst] = useState('');
  const [bezig, setBezig] = useState(false);

  function opRgbBlur() {
    const h = rgbTekstNaarHex(rgbTekst);
    if (h) setHex(h);
  }

  async function bevestigNieuw() {
    const n = naam.trim();
    if (!n) return;
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) { alert('Ongeldige kleurcode — gebruik #RRGGBB of vul RGB in'); return; }
    setBezig(true);
    try {
      const nieuw = await onNieuw(n, hex);
      onKies(String(nieuw.id));
      setToevoegen(false);
      setNaam(''); setHex('#c9c2b2'); setRgbTekst('');
    } catch (e) {
      alert(e.message);
    } finally {
      setBezig(false);
    }
  }

  if (toevoegen) {
    return (
      <div className="form-group">
        <label>Kleur</label>
        <div style={{ display: 'grid', gap: 6 }}>
          <input value={naam} onChange={e => setNaam(e.target.value)} placeholder="naam, bv. Lava Rood" autoFocus />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="color" value={hex} onChange={e => setHex(e.target.value)} style={{ padding: 3, height: 34, width: 44 }} />
            <input value={hex} onChange={e => setHex(e.target.value)} placeholder="#RRGGBB" style={{ width: 100 }} />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>of RGB</span>
            <input value={rgbTekst} onChange={e => setRgbTekst(e.target.value)} onBlur={opRgbBlur} placeholder="r, g, b" style={{ width: 90 }} />
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button className="btn" type="button" onClick={() => { setToevoegen(false); setNaam(''); setRgbTekst(''); }} disabled={bezig}>Annuleer</button>
            <button className="btn primary" type="button" onClick={bevestigNieuw} disabled={bezig || !naam.trim()}>
              {bezig ? '...' : 'Toevoegen'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="form-group">
      <label>Kleur</label>
      <select value={waarde} onChange={e => (e.target.value === '__nieuw__' ? setToevoegen(true) : onKies(e.target.value))}>
        <option value="">— kies —</option>
        {opties.map(o => <option key={o.id} value={o.id}>{o.naam}</option>)}
        <option value="__nieuw__">+ Nieuwe kleur toevoegen</option>
      </select>
    </div>
  );
}

// Rol-formulier — dient nu voor 2 dingen: een NIEUWE batch aanmaken (modus
// 'nieuw', met een "aantal rollen"-veld), of de GEDEELDE velden van een
// bestaande batch bewerken (modus 'batch', geen aantal-veld — dat wijzigt
// enkel via de +/- stepper in het overzicht, niet hier). Merk/Type blijven
// twee onafhankelijke keuzelijsten over de volledige catalogus; bestaat de
// gekozen combinatie nog niet, dan wordt de verkoopprijs (verplicht) meteen
// hier gevraagd — zelfde "vind-of-maak-aan"-logica als voorheen.
function RolForm({ form, set, types, kleuren, merkenCatalogus, materialenCatalogus, onNieuweKleur, onNieuwMerk, onNieuwMateriaal, onOpslaan, onAnnuleer, bezig, modus }) {
  const nieuw = modus === 'nieuw';
  const merkGekozen = form.merk_id !== '';
  const materiaalGekozen = form.materiaal_id !== '';
  const bestaandeCombo = (merkGekozen && materiaalGekozen)
    ? types.find(t => t.merk_id === Number(form.merk_id) && t.materiaal_id === Number(form.materiaal_id))
    : null;
  const nieuweComboNodig = merkGekozen && materiaalGekozen && !bestaandeCombo;

  const magOpslaan = !bezig && merkGekozen && materiaalGekozen && !!form.kleur_id
    && (!nieuweComboNodig || form.verkoopprijs_nieuw !== '');

  return (
    <div>
      <div className="form-row">
        <KeuzeMetToevoegen label="Merk" waarde={form.merk_id} opties={merkenCatalogus} onKies={v => set('merk_id', v)} onNieuw={onNieuwMerk} watLabel="merk" />
        <KeuzeMetToevoegen label="Type" waarde={form.materiaal_id} opties={materialenCatalogus} onKies={v => set('materiaal_id', v)} onNieuw={onNieuwMateriaal} watLabel="type" />
      </div>

      {bestaandeCombo && (
        <div className="info-block" style={{ fontSize: 12.5, marginBottom: 12 }}>
          Verkoopprijs: €{Number(bestaandeCombo.verkoopprijs_per_kg).toFixed(2)}/kg
          {bestaandeCombo.min_rollen != null && <> · Min. rollen: {bestaandeCombo.min_rollen}</>}
        </div>
      )}

      {nieuweComboNodig && (
        <div className="card" style={{ padding: 12, marginBottom: 14, background: 'var(--surface-sunken)' }}>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>
            Nieuwe combinatie — verschijnt na het opslaan ook bij Instellingen → Materiaal.
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Verkoopprijs per kg (€)</label>
              <input value={form.verkoopprijs_nieuw} onChange={e => set('verkoopprijs_nieuw', e.target.value)} inputMode="decimal" placeholder="verplicht" />
            </div>
            <div className="form-group">
              <label>Min. rollen <span style={{ textTransform: 'none', fontWeight: 400 }}>optioneel</span></label>
              <input value={form.min_rollen_nieuw} onChange={e => set('min_rollen_nieuw', e.target.value)} inputMode="numeric" />
            </div>
          </div>
        </div>
      )}

      <KleurKeuze waarde={form.kleur_id} opties={kleuren} onKies={v => set('kleur_id', v)} onNieuw={onNieuweKleur} />

      {nieuw && (
        <div className="form-group">
          <label>Aantal rollen</label>
          <input value={form.aantal} onChange={e => set('aantal', e.target.value)} inputMode="numeric" />
        </div>
      )}
      <div className="form-row">
        <div className="form-group">
          <label>Aankoopprijs per rol (€) <span style={{ textTransform: 'none', fontWeight: 400 }}>optioneel</span></label>
          <input value={form.aankoopprijs_eur} onChange={e => set('aankoopprijs_eur', e.target.value)} inputMode="decimal" />
        </div>
        <div className="form-group">
          <label>Gekocht op <span style={{ textTransform: 'none', fontWeight: 400 }}>optioneel</span></label>
          <input type="date" value={form.gekocht_op || ''} onChange={e => set('gekocht_op', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label>Locatie <span style={{ textTransform: 'none', fontWeight: 400 }}>optioneel</span></label>
        <input value={form.locatie} onChange={e => set('locatie', e.target.value)} placeholder="bv. rek A, printer 2" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <button className="btn" type="button" onClick={onAnnuleer} disabled={bezig}>Annuleer</button>
        <button className="btn primary" type="button" onClick={onOpslaan} disabled={!magOpslaan}>
          {bezig ? 'Bezig...' : 'Opslaan'}
        </button>
      </div>
    </div>
  );
}

function FilamentTab() {
  const [types, setTypes] = useState([]);
  const [merken, setMerken] = useState([]);
  const [materialen, setMaterialen] = useState([]);
  const [kleuren, setKleuren] = useState([]);
  const [rollen, setRollen] = useState([]);
  const [teBestellen, setTeBestellen] = useState([]);
  const [laden, setLaden] = useState(true);
  const [bezig, setBezig] = useState(false);
  const [zoek, setZoek] = useState('');

  const [detailGroep, setDetailGroep] = useState(null);   // { key, rows }
  const [paneelModus, setPaneelModus] = useState(null);   // null | 'nieuw' | 'batch'
  const [bewerkBatch, setBewerkBatch] = useState(null);   // rijen van de batch die bewerkt wordt
  const [formRol, setFormRol] = useState(LEEG_ROL);

  const load = async () => {
    setLaden(true);
    try {
      const [ty, mk, mt, kl, r, tb] = await Promise.all([
        api.get('/filament/types'),
        api.get('/filament/merken'),
        api.get('/filament/materialen'),
        api.get('/filament/kleuren'),
        api.get('/filament/rollen'),
        api.get('/filament/te-bestellen'),
      ]);
      setTypes(ty); setMerken(mk); setMaterialen(mt); setKleuren(kl); setRollen(r); setTeBestellen(tb);
      return r;
    } catch (e) {
      alert(e.message);
      return null;
    } finally {
      setLaden(false);
    }
  };
  useEffect(() => { load(); }, []);

  const groepen = groepeer(rollen, r => `${r.filament_type_id}-${r.kleur_id}`)
    .map(rows => ({ key: `${rows[0].filament_type_id}-${rows[0].kleur_id}`, rows }))
    .filter(g => {
      if (!zoek) return true;
      const z = zoek.toLowerCase();
      const r = g.rows[0];
      return r.merk.toLowerCase().includes(z) || r.materiaal.toLowerCase().includes(z) || r.kleur.toLowerCase().includes(z);
    })
    .sort((a, b) => {
      const ra = a.rows[0], rb = b.rows[0];
      return (ra.merk + ra.materiaal + ra.kleur).localeCompare(rb.merk + rb.materiaal + rb.kleur);
    });

  // Als de data ververst is (na een save), de open groep verversen i.p.v. de
  // verouderde snapshot te laten staan.
  function verversDetailGroep(verseRollen, key) {
    const rows = verseRollen.filter(r => `${r.filament_type_id}-${r.kleur_id}` === key);
    setDetailGroep(rows.length ? { key, rows } : null);
  }

  async function nieuweKleur(naam, hex) {
    const nieuw = await api.post('/filament/kleuren', { naam, hex });
    setKleuren(k => [...k, nieuw].sort((a, b) => a.naam.localeCompare(b.naam)));
    return nieuw;
  }
  async function nieuwMerk(naam) {
    const nieuw = await api.post('/filament/merken', { naam });
    setMerken(m => [...m, nieuw].sort((a, b) => a.naam.localeCompare(b.naam)));
    return nieuw;
  }
  async function nieuwMateriaal(naam) {
    const nieuw = await api.post('/filament/materialen', { naam });
    setMaterialen(m => [...m, nieuw].sort((a, b) => a.naam.localeCompare(b.naam)));
    return nieuw;
  }
  async function resolveTypeId(f) {
    const bestaand = types.find(t => t.merk_id === Number(f.merk_id) && t.materiaal_id === Number(f.materiaal_id));
    if (bestaand) return bestaand.id;
    const body = { merk_id: f.merk_id, materiaal_id: f.materiaal_id, verkoopprijs_per_kg: f.verkoopprijs_nieuw };
    if (f.min_rollen_nieuw !== '') body.min_rollen = f.min_rollen_nieuw;
    const { id } = await api.post('/filament/types', body);
    return id;
  }

  function openGroep(g) {
    setDetailGroep(g);
    setPaneelModus(null);
    setBewerkBatch(null);
  }
  function startNieuw(vanGroep) {
    setPaneelModus('nieuw');
    setBewerkBatch(null);
    if (vanGroep) {
      const t = types.find(t => t.id === vanGroep.rows[0].filament_type_id);
      setFormRol({ ...LEEG_ROL, merk_id: t ? String(t.merk_id) : '', materiaal_id: t ? String(t.materiaal_id) : '', kleur_id: String(vanGroep.rows[0].kleur_id) });
      setDetailGroep(vanGroep);
    } else {
      setFormRol({ ...LEEG_ROL });
      setDetailGroep(null);
    }
  }
  function startBatchBewerken(batch) {
    const eerste = batch[0];
    const t = types.find(t => t.id === eerste.filament_type_id);
    setFormRol({
      ...LEEG_ROL,
      merk_id: t ? String(t.merk_id) : '', materiaal_id: t ? String(t.materiaal_id) : '',
      kleur_id: String(eerste.kleur_id),
      aankoopprijs_eur: eerste.aankoopprijs_eur ?? '', locatie: eerste.locatie ?? '', gekocht_op: eerste.gekocht_op ?? '',
    });
    setBewerkBatch(batch);
    setPaneelModus('batch');
  }
  function sluitPaneel() {
    setDetailGroep(null);
    setPaneelModus(null);
    setBewerkBatch(null);
  }
  function setVeldRol(k, v) {
    setFormRol(f => ({ ...f, [k]: v }));
  }

  async function opslaanNieuw() {
    setBezig(true);
    try {
      const typeId = await resolveTypeId(formRol);
      const { merk_id, materiaal_id, verkoopprijs_nieuw, min_rollen_nieuw, aantal, kleur_id, ...rest } = formRol;
      await api.post('/filament/rollen', { ...rest, filament_type_id: typeId, kleur_id, aantal });
      const verse = await load();
      setPaneelModus(null);
      setBewerkBatch(null);
      if (verse) verversDetailGroep(verse, `${typeId}-${kleur_id}`);
    } catch (e) {
      alert(e.message);
    } finally {
      setBezig(false);
    }
  }
  async function opslaanBatch() {
    setBezig(true);
    try {
      const typeId = await resolveTypeId(formRol);
      const { merk_id, materiaal_id, verkoopprijs_nieuw, min_rollen_nieuw, aantal, kleur_id, ...gedeeld } = formRol;
      for (const rij of bewerkBatch) {
        await api.put(`/filament/rollen/${rij.id}`, { ...gedeeld, filament_type_id: typeId, kleur_id, actief: rij.actief });
      }
      const verse = await load();
      setPaneelModus(null);
      setBewerkBatch(null);
      if (verse) verversDetailGroep(verse, `${typeId}-${kleur_id}`);
    } catch (e) {
      alert(e.message);
    } finally {
      setBezig(false);
    }
  }
  async function wijzigActiefInBatch(batch, delta) {
    const doel = delta < 0 ? batch.find(x => x.actief) : batch.find(x => !x.actief);
    if (!doel) return;
    setBezig(true);
    try {
      await api.put(`/filament/rollen/${doel.id}`, {
        filament_type_id: doel.filament_type_id, kleur_id: doel.kleur_id,
        aankoopprijs_eur: doel.aankoopprijs_eur, locatie: doel.locatie, gekocht_op: doel.gekocht_op,
        actief: delta > 0,
      });
      const verse = await load();
      if (verse && detailGroep) verversDetailGroep(verse, detailGroep.key);
    } catch (e) { alert(e.message); } finally { setBezig(false); }
  }
  async function verwijderBatch(batch) {
    if (!confirm(`Deze batch (${batch.length} rol${batch.length === 1 ? '' : 'len'}) volledig verwijderen?`)) return;
    setBezig(true);
    try {
      for (const rij of batch) await api.delete(`/filament/rollen/${rij.id}`);
      const verse = await load();
      if (verse && detailGroep) verversDetailGroep(verse, detailGroep.key);
    } catch (e) { alert(e.message); } finally { setBezig(false); }
  }

  const paneelOpen = !!detailGroep || paneelModus === 'nieuw';

  return (
    <div>
      {teBestellen.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: '1.25rem' }}>
          <div className="section-title" style={{ margin: '0 0 10px', color: 'var(--warning)', borderColor: 'var(--warning-bg)' }}>
            ⚠ Te bestellen
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {teBestellen.map(tb => (
              <div key={`${tb.filament_type_id}-${tb.kleur_id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span className="spool" style={{ borderColor: tb.kleur_hex || 'var(--line-strong)' }} />
                <strong>{tb.merk} {tb.materiaal}</strong>
                <span style={{ color: 'var(--muted)' }}>{tb.kleur}</span>
                <span className="badge warning" style={{ marginLeft: 'auto' }}>{tb.aantal_rollen} van {tb.min_rollen}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {laden ? (
        <div className="empty">Laden...</div>
      ) : (
        <>
          <div className="page-header" style={{ marginBottom: '1rem' }}>
            <input value={zoek} onChange={e => setZoek(e.target.value)} placeholder="Zoeken..." style={{ width: 200 }} />
            <button className="btn primary" onClick={() => startNieuw(null)}>+ Nieuwe rol</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: paneelOpen ? '1fr 380px' : '1fr', gap: '1rem' }}>
            <div>
              {groepen.length === 0
                ? <div className="empty">Geen rollen gevonden</div>
                : <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                    <table>
                      <thead>
                        <tr><th></th><th>Type</th><th>Kleur</th><th>Aantal</th></tr>
                      </thead>
                      <tbody>
                        {groepen.map(g => {
                          const r0 = g.rows[0];
                          const actief = g.rows.filter(x => x.actief).length;
                          return (
                            <tr key={g.key} onClick={() => openGroep(g)}
                              style={{ cursor: 'pointer', background: detailGroep?.key === g.key ? 'var(--surface-sunken)' : undefined }}>
                              <td><span className="spool" style={{ borderColor: r0.kleur_hex || 'var(--line-strong)' }} /></td>
                              <td style={{ fontWeight: 600 }}>{r0.merk} {r0.materiaal}</td>
                              <td>{r0.kleur}</td>
                              <td>{actief === 0
                                ? <span className="badge neutral">0 actief</span>
                                : <span className="badge positive">{actief} actief</span>}
                                {actief !== g.rows.length && <span style={{ color: 'var(--muted)', fontSize: 11.5, marginLeft: 4 }}>({g.rows.length} totaal)</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
              }
            </div>

            {paneelOpen && (
              <div className="card panel">
                {paneelModus === 'nieuw' || paneelModus === 'batch' ? (
                  <>
                    <div className="panel-head">
                      <h2>{paneelModus === 'nieuw' ? 'Nieuwe rol' : 'Batch bewerken'}</h2>
                      <div className="panel-actions">
                        <button onClick={sluitPaneel} title="Sluiten">✕</button>
                      </div>
                    </div>
                    <RolForm form={formRol} set={setVeldRol} types={types} kleuren={kleuren} onNieuweKleur={nieuweKleur}
                      merkenCatalogus={merken} materialenCatalogus={materialen} onNieuwMerk={nieuwMerk} onNieuwMateriaal={nieuwMateriaal}
                      onOpslaan={paneelModus === 'nieuw' ? opslaanNieuw : opslaanBatch} onAnnuleer={sluitPaneel} bezig={bezig} modus={paneelModus} />
                  </>
                ) : (
                  <>
                    <div className="panel-head">
                      <h2>
                        <span className="spool" style={{ borderColor: detailGroep.rows[0].kleur_hex || 'var(--line-strong)', display: 'inline-block', marginRight: 6, verticalAlign: 'middle' }} />
                        {detailGroep.rows[0].kleur}
                      </h2>
                      <div className="panel-actions">
                        <button onClick={sluitPaneel} title="Sluiten">✕</button>
                      </div>
                    </div>
                    <div className="info-block" style={{ marginBottom: '1rem' }}>
                      <strong>{detailGroep.rows[0].merk} {detailGroep.rows[0].materiaal}</strong>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div className="section-title" style={{ margin: 0 }}>Batches</div>
                      <button className="btn" type="button" onClick={() => startNieuw(detailGroep)}>+ Rollen toevoegen</button>
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {groepeerBatches(detailGroep.rows).map(batch => (
                        <BatchRij key={batch[0].batch_id ?? batch[0].id} batch={batch} eenheid="rol" bezig={bezig}
                          onWijzigActief={d => wijzigActiefInBatch(batch, d)}
                          onBewerken={() => startBatchBewerken(batch)}
                          onVerwijder={() => verwijderBatch(batch)} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Artikelen (onderdelen + diensten)
// ═══════════════════════════════════════════════════════════════════════════

const LEEG_TYPE = {
  naam: '', categorie: 'onderdeel', eenheid: 'stuk',
  inkoopprijs: '', marge_pct: '', verkoopprijs: '', productieprijs: '',
  vaste_prijs: false, min_aantal: '', notities: '',
};

// Prijsmodel per categorie (bevestigd 2026-09-22): bij een onderdeel geven
// inkoopprijs + marge% een VOORSTEL voor de verkoopprijs — de gebruiker kan
// dat voorstel nadien nog altijd zelf overschrijven/afronden, dus dit is
// bewust geen dwingende berekening maar enkel een handig startpunt.
function berekenVoorstelVerkoopprijs(inkoopprijs, margePct) {
  const i = parseFloat(inkoopprijs), m = parseFloat(margePct);
  if (!Number.isFinite(i) || !Number.isFinite(m)) return null;
  return Math.round(i * (1 + m / 100) * 100) / 100;
}
const LEEG_BATCH = { aantal: '1', aankoopprijs_eur: '', locatie: '', gekocht_op: '' };

// 'onderdeel' (losse componenten, bv. sleutelhanger-ringetjes) en
// 'eindproduct' (afgewerkte, verkoopklare producten — bv. voor de webshop)
// hebben allebei een voorraad; enkel 'dienst' (prijslijst, bv. verzendkosten)
// niet. Overal in dit bestand waar voorraad/batches getoond worden, wordt
// deze ene helper gebruikt i.p.v. een losse `=== 'onderdeel'`-check, zodat
// beide categorieën consistent hetzelfde gedrag krijgen.
function heeftVoorraad(categorie) {
  return categorie === 'onderdeel' || categorie === 'eindproduct';
}
function categorieLabel(categorie) {
  if (categorie === 'onderdeel') return 'Onderdeel';
  if (categorie === 'eindproduct') return 'Eindproduct';
  return 'Dienst';
}

function ArtikelTypeForm({ form, set, onOpslaan, onAnnuleer, bezig, nieuw }) {
  const isOnderdeel = form.categorie === 'onderdeel';
  const isEindproduct = form.categorie === 'eindproduct';
  const magOpslaan = !bezig && form.naam.trim() !== '' && form.verkoopprijs !== ''
    && (!isOnderdeel || (form.inkoopprijs !== '' && form.marge_pct !== ''));

  // Inkoopprijs/marge wijzigen herberekent meteen een voorstel-verkoopprijs
  // (afgerond op 2 cijfers) — de gebruiker kan het verkoopprijs-veld daarna
  // nog altijd zelf overschrijven, dat wordt dan niet opnieuw overschreven
  // tenzij inkoopprijs/marge opnieuw wijzigt.
  function opInkoopOfMargeWijzig(veld, waarde) {
    set(veld, waarde);
    const nieuweInkoop = veld === 'inkoopprijs' ? waarde : form.inkoopprijs;
    const nieuweMarge = veld === 'marge_pct' ? waarde : form.marge_pct;
    const voorstel = berekenVoorstelVerkoopprijs(nieuweInkoop, nieuweMarge);
    if (voorstel !== null) set('verkoopprijs', String(voorstel));
  }

  return (
    <div>
      <div className="form-group">
        <label>Naam</label>
        <input value={form.naam} onChange={e => set('naam', e.target.value)} placeholder="bv. Sleutelhanger-ring 25mm" autoFocus={nieuw} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Categorie</label>
          <select value={form.categorie} onChange={e => set('categorie', e.target.value)}>
            <option value="onderdeel">Onderdeel (losse component, met voorraad)</option>
            <option value="eindproduct">Eindproduct (afgewerkt, bv. webshop — met voorraad)</option>
            <option value="dienst">Dienst (prijslijst, geen voorraad)</option>
          </select>
        </div>
        <div className="form-group">
          <label>Eenheid <span style={{ textTransform: 'none', fontWeight: 400 }}>optioneel</span></label>
          <input value={form.eenheid} onChange={e => set('eenheid', e.target.value)} placeholder="stuk, u, ..." />
        </div>
      </div>

      {isOnderdeel && (
        <div className="card" style={{ padding: 12, marginBottom: 14, background: 'var(--surface-sunken)' }}>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>
            Inkoopprijs + marge geven hieronder een voorstel voor de verkoopprijs — je kan die nadien nog zelf aanpassen.
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Inkoopprijs (€)</label>
              <input value={form.inkoopprijs} onChange={e => opInkoopOfMargeWijzig('inkoopprijs', e.target.value)} inputMode="decimal" placeholder="verplicht" />
            </div>
            <div className="form-group">
              <label>Marge (%)</label>
              <input value={form.marge_pct} onChange={e => opInkoopOfMargeWijzig('marge_pct', e.target.value)} inputMode="decimal" placeholder="verplicht" />
            </div>
          </div>
        </div>
      )}

      <div className="form-row">
        <div className="form-group">
          <label>Verkoopprijs (€)</label>
          <input value={form.verkoopprijs} onChange={e => set('verkoopprijs', e.target.value)} inputMode="decimal" placeholder="verplicht" />
        </div>
        {heeftVoorraad(form.categorie) && (
          <div className="form-group">
            <label>Min. aantal <span style={{ textTransform: 'none', fontWeight: 400 }}>optioneel</span></label>
            <input value={form.min_aantal} onChange={e => set('min_aantal', e.target.value)} inputMode="numeric" placeholder="leeg = geen bestel-opvolging" />
          </div>
        )}
      </div>

      {isEindproduct && (
        <div className="form-group">
          <label>Productieprijs (€) <span style={{ textTransform: 'none', fontWeight: 400 }}>optioneel, informatief</span></label>
          <input value={form.productieprijs} onChange={e => set('productieprijs', e.target.value)} inputMode="decimal" placeholder="bv. materiaal + printtijd — geen invloed op de verkoopprijs" />
        </div>
      )}

      <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={!!form.vaste_prijs} onChange={e => set('vaste_prijs', e.target.checked)} />
        <label style={{ marginBottom: 0 }}>Vaste prijs (geen marge, buiten BTW-grondslag — bv. verzendkosten)</label>
      </div>
      <div className="form-group">
        <label>Notities <span style={{ textTransform: 'none', fontWeight: 400 }}>optioneel</span></label>
        <textarea rows={2} value={form.notities} onChange={e => set('notities', e.target.value)} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <button className="btn" type="button" onClick={onAnnuleer} disabled={bezig}>Annuleer</button>
        <button className="btn primary" type="button" onClick={onOpslaan} disabled={!magOpslaan}>{bezig ? 'Bezig...' : 'Opslaan'}</button>
      </div>
    </div>
  );
}

function VoorraadBatchForm({ form, set, onOpslaan, onAnnuleer, bezig, nieuw }) {
  return (
    <div>
      {nieuw && (
        <div className="form-group">
          <label>Aantal</label>
          <input value={form.aantal} onChange={e => set('aantal', e.target.value)} inputMode="numeric" />
        </div>
      )}
      <div className="form-row">
        <div className="form-group">
          <label>Aankoopprijs per stuk (€) <span style={{ textTransform: 'none', fontWeight: 400 }}>optioneel</span></label>
          <input value={form.aankoopprijs_eur} onChange={e => set('aankoopprijs_eur', e.target.value)} inputMode="decimal" />
        </div>
        <div className="form-group">
          <label>Gekocht op <span style={{ textTransform: 'none', fontWeight: 400 }}>optioneel</span></label>
          <input type="date" value={form.gekocht_op || ''} onChange={e => set('gekocht_op', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label>Locatie <span style={{ textTransform: 'none', fontWeight: 400 }}>optioneel</span></label>
        <input value={form.locatie} onChange={e => set('locatie', e.target.value)} placeholder="bv. rek A, lade 3" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <button className="btn" type="button" onClick={onAnnuleer} disabled={bezig}>Annuleer</button>
        <button className="btn primary" type="button" onClick={onOpslaan} disabled={bezig}>{bezig ? 'Bezig...' : 'Opslaan'}</button>
      </div>
    </div>
  );
}

function ArtikelenTab() {
  const [types, setTypes] = useState([]);
  const [voorraad, setVoorraad] = useState([]);
  const [teBestellen, setTeBestellen] = useState([]);
  const [laden, setLaden] = useState(true);
  const [bezig, setBezig] = useState(false);
  const [zoek, setZoek] = useState('');

  const [detailType, setDetailType] = useState(null);
  const [paneelModus, setPaneelModus] = useState(null); // null | 'nieuw-type' | 'bewerk-type' | 'nieuw-batch' | 'bewerk-batch'
  const [bewerkBatch, setBewerkBatch] = useState(null);
  const [formType, setFormType] = useState(LEEG_TYPE);
  const [formBatch, setFormBatch] = useState(LEEG_BATCH);

  const load = async () => {
    setLaden(true);
    try {
      const [ty, vr, tb] = await Promise.all([
        api.get('/artikelen/types'),
        api.get('/artikelen/voorraad'),
        api.get('/artikelen/te-bestellen'),
      ]);
      setTypes(ty); setVoorraad(vr); setTeBestellen(tb);
      return { types: ty, voorraad: vr };
    } catch (e) {
      alert(e.message);
      return null;
    } finally {
      setLaden(false);
    }
  };
  useEffect(() => { load(); }, []);

  const rijen = types
    .filter(t => !zoek || t.naam.toLowerCase().includes(zoek.toLowerCase()))
    .sort((a, b) => (a.categorie + a.naam).localeCompare(b.categorie + b.naam))
    .map(t => ({ type: t, rollen: voorraad.filter(v => v.artikel_type_id === t.id) }));

  function verversDetailType(verseTypes, id) {
    const t = verseTypes.find(x => x.id === id);
    setDetailType(t || null);
  }

  function openType(t) {
    setDetailType(t);
    setPaneelModus(null);
    setBewerkBatch(null);
  }
  function startNieuwType() {
    setDetailType(null);
    setFormType({ ...LEEG_TYPE });
    setPaneelModus('nieuw-type');
  }
  function startBewerkType() {
    setFormType({
      naam: detailType.naam, categorie: detailType.categorie, eenheid: detailType.eenheid || '',
      inkoopprijs: detailType.inkoopprijs ?? '', marge_pct: detailType.marge_pct ?? '',
      verkoopprijs: String(detailType.verkoopprijs), productieprijs: detailType.productieprijs ?? '',
      vaste_prijs: !!detailType.vaste_prijs,
      min_aantal: detailType.min_aantal ?? '', notities: detailType.notities || '',
    });
    setPaneelModus('bewerk-type');
  }
  function startNieuwBatch() {
    setFormBatch({ ...LEEG_BATCH });
    setBewerkBatch(null);
    setPaneelModus('nieuw-batch');
  }
  function startBewerkBatch(batch) {
    const eerste = batch[0];
    setFormBatch({ aantal: '1', aankoopprijs_eur: eerste.aankoopprijs_eur ?? '', locatie: eerste.locatie ?? '', gekocht_op: eerste.gekocht_op ?? '' });
    setBewerkBatch(batch);
    setPaneelModus('bewerk-batch');
  }
  function sluitPaneel() {
    setDetailType(null);
    setPaneelModus(null);
    setBewerkBatch(null);
  }

  async function opslaanType() {
    setBezig(true);
    try {
      const body = { ...formType, verkoopprijs: formType.verkoopprijs, min_aantal: formType.min_aantal === '' ? null : formType.min_aantal };
      if (paneelModus === 'nieuw-type') {
        const { id } = await api.post('/artikelen/types', body);
        const verse = await load();
        setPaneelModus(null);
        if (verse) verversDetailType(verse.types, id);
      } else {
        await api.put(`/artikelen/types/${detailType.id}`, body);
        const verse = await load();
        setPaneelModus(null);
        if (verse) verversDetailType(verse.types, detailType.id);
      }
    } catch (e) { alert(e.message); } finally { setBezig(false); }
  }
  async function verwijderType(t) {
    if (!confirm(`Artikel "${t.naam}" volledig verwijderen?`)) return;
    try {
      await api.delete(`/artikelen/types/${t.id}`);
      if (detailType?.id === t.id) sluitPaneel();
      load();
    } catch (e) { alert(e.message); }
  }

  async function opslaanBatch() {
    setBezig(true);
    try {
      if (paneelModus === 'nieuw-batch') {
        await api.post('/artikelen/voorraad', { artikel_type_id: detailType.id, ...formBatch });
      } else {
        for (const rij of bewerkBatch) {
          await api.put(`/artikelen/voorraad/${rij.id}`, {
            artikel_type_id: detailType.id,
            aankoopprijs_eur: formBatch.aankoopprijs_eur, locatie: formBatch.locatie, gekocht_op: formBatch.gekocht_op,
            actief: rij.actief,
          });
        }
      }
      const verse = await load();
      setPaneelModus(null);
      setBewerkBatch(null);
      if (verse) verversDetailType(verse.types, detailType.id);
    } catch (e) { alert(e.message); } finally { setBezig(false); }
  }
  async function wijzigActiefInBatch(batch, delta) {
    const doel = delta < 0 ? batch.find(x => x.actief) : batch.find(x => !x.actief);
    if (!doel) return;
    setBezig(true);
    try {
      await api.put(`/artikelen/voorraad/${doel.id}`, {
        artikel_type_id: doel.artikel_type_id,
        aankoopprijs_eur: doel.aankoopprijs_eur, locatie: doel.locatie, gekocht_op: doel.gekocht_op,
        actief: delta > 0,
      });
      const verse = await load();
      if (verse && detailType) verversDetailType(verse.types, detailType.id);
    } catch (e) { alert(e.message); } finally { setBezig(false); }
  }
  async function verwijderBatch(batch) {
    if (!confirm(`Deze batch (${batch.length} stuk${batch.length === 1 ? '' : 's'}) volledig verwijderen?`)) return;
    setBezig(true);
    try {
      for (const rij of batch) await api.delete(`/artikelen/voorraad/${rij.id}`);
      const verse = await load();
      if (verse && detailType) verversDetailType(verse.types, detailType.id);
    } catch (e) { alert(e.message); } finally { setBezig(false); }
  }

  const paneelOpen = !!detailType || paneelModus === 'nieuw-type';
  const huidigeRollen = detailType ? voorraad.filter(v => v.artikel_type_id === detailType.id) : [];

  return (
    <div>
      {teBestellen.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warning)', marginBottom: '1.25rem' }}>
          <div className="section-title" style={{ margin: '0 0 10px', color: 'var(--warning)', borderColor: 'var(--warning-bg)' }}>
            ⚠ Te bestellen
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {teBestellen.map(tb => (
              <div key={tb.artikel_type_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <strong>{tb.naam}</strong>
                <span className="badge warning" style={{ marginLeft: 'auto' }}>{tb.aantal} van {tb.min_aantal}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {laden ? (
        <div className="empty">Laden...</div>
      ) : (
        <>
          <div className="page-header" style={{ marginBottom: '1rem' }}>
            <input value={zoek} onChange={e => setZoek(e.target.value)} placeholder="Zoeken..." style={{ width: 200 }} />
            <button className="btn primary" onClick={startNieuwType}>+ Nieuw artikel</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: paneelOpen ? '1fr 380px' : '1fr', gap: '1rem' }}>
            <div>
              {rijen.length === 0
                ? <div className="empty">Nog geen artikelen</div>
                : <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                    <table>
                      <thead>
                        <tr><th>Naam</th><th>Categorie</th><th>Prijs</th><th>Aantal</th></tr>
                      </thead>
                      <tbody>
                        {rijen.map(({ type: t, rollen }) => {
                          const actief = rollen.filter(x => x.actief).length;
                          return (
                            <tr key={t.id} onClick={() => openType(t)}
                              style={{ cursor: 'pointer', background: detailType?.id === t.id ? 'var(--surface-sunken)' : undefined }}>
                              <td style={{ fontWeight: 600 }}>{t.naam}</td>
                              <td><span className="badge neutral">{categorieLabel(t.categorie)}</span></td>
                              <td>€{Number(t.verkoopprijs).toFixed(2)}{t.eenheid ? ` / ${t.eenheid}` : ''}</td>
                              <td style={{ color: 'var(--muted)' }}>{heeftVoorraad(t.categorie) ? `${actief} actief` : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
              }
            </div>

            {paneelOpen && (
              <div className="card panel">
                {paneelModus === 'nieuw-type' || paneelModus === 'bewerk-type' ? (
                  <>
                    <div className="panel-head">
                      <h2>{paneelModus === 'nieuw-type' ? 'Nieuw artikel' : 'Artikel bewerken'}</h2>
                      <div className="panel-actions"><button onClick={sluitPaneel} title="Sluiten">✕</button></div>
                    </div>
                    <ArtikelTypeForm form={formType} set={(k, v) => setFormType(f => ({ ...f, [k]: v }))}
                      onOpslaan={opslaanType} onAnnuleer={sluitPaneel} bezig={bezig} nieuw={paneelModus === 'nieuw-type'} />
                  </>
                ) : paneelModus === 'nieuw-batch' || paneelModus === 'bewerk-batch' ? (
                  <>
                    <div className="panel-head">
                      <h2>{paneelModus === 'nieuw-batch' ? 'Voorraad toevoegen' : 'Batch bewerken'}</h2>
                      <div className="panel-actions"><button onClick={() => setPaneelModus(null)} title="Sluiten">✕</button></div>
                    </div>
                    <VoorraadBatchForm form={formBatch} set={(k, v) => setFormBatch(f => ({ ...f, [k]: v }))}
                      onOpslaan={opslaanBatch} onAnnuleer={() => setPaneelModus(null)} bezig={bezig} nieuw={paneelModus === 'nieuw-batch'} />
                  </>
                ) : (
                  <>
                    <div className="panel-head">
                      <h2>{detailType.naam}</h2>
                      <div className="panel-actions">
                        <button onClick={startBewerkType} title="Bewerken">✏</button>
                        <button onClick={sluitPaneel} title="Sluiten">✕</button>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gap: 6, fontSize: 13, marginBottom: '1rem' }}>
                      <div><span style={{ color: 'var(--muted)' }}>Categorie: </span>{categorieLabel(detailType.categorie)}{heeftVoorraad(detailType.categorie) ? ' (met voorraad)' : ' (geen voorraad)'}</div>
                      {detailType.categorie === 'onderdeel' && (
                        <>
                          <div><span style={{ color: 'var(--muted)' }}>Inkoopprijs: </span>€{Number(detailType.inkoopprijs).toFixed(2)}</div>
                          <div><span style={{ color: 'var(--muted)' }}>Marge: </span>{Number(detailType.marge_pct).toFixed(1)}%</div>
                        </>
                      )}
                      <div><span style={{ color: 'var(--muted)' }}>Verkoopprijs: </span>€{Number(detailType.verkoopprijs).toFixed(2)}{detailType.eenheid ? ` / ${detailType.eenheid}` : ''}</div>
                      {detailType.categorie === 'eindproduct' && detailType.productieprijs != null && (
                        <div><span style={{ color: 'var(--muted)' }}>Productieprijs: </span>€{Number(detailType.productieprijs).toFixed(2)} <span style={{ fontSize: 11, color: 'var(--muted)' }}>(informatief)</span></div>
                      )}
                      {!!detailType.vaste_prijs && <div><span className="badge neutral">Vaste prijs — geen marge, buiten BTW</span></div>}
                      {heeftVoorraad(detailType.categorie) && <div><span style={{ color: 'var(--muted)' }}>Min. aantal: </span>{detailType.min_aantal ?? 'geen bestel-opvolging'}</div>}
                      {detailType.notities && <div><span style={{ color: 'var(--muted)' }}>Notities: </span>{detailType.notities}</div>}
                    </div>

                    {heeftVoorraad(detailType.categorie) && (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div className="section-title" style={{ margin: 0 }}>Batches</div>
                          <button className="btn" type="button" onClick={startNieuwBatch}>+ Voorraad toevoegen</button>
                        </div>
                        {huidigeRollen.length === 0
                          ? <div className="empty" style={{ padding: 12, fontSize: 12.5 }}>Nog geen voorraad</div>
                          : <div style={{ display: 'grid', gap: 8, marginBottom: '1rem' }}>
                              {groepeerBatches(huidigeRollen).map(batch => (
                                <BatchRij key={batch[0].batch_id ?? batch[0].id} batch={batch} eenheid={detailType.eenheid || 'stuk'} bezig={bezig}
                                  onWijzigActief={d => wijzigActiefInBatch(batch, d)}
                                  onBewerken={() => startBewerkBatch(batch)}
                                  onVerwijder={() => verwijderBatch(batch)} />
                              ))}
                            </div>
                        }
                      </>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                      <button className="btn danger" onClick={() => verwijderType(detailType)}>✕ Verwijder artikel</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Aankoopfacturen
// ═══════════════════════════════════════════════════════════════════════════

function AankoopfacturenTab() {
  const [facturen, setFacturen] = useState([]);
  const [laden, setLaden] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const load = () => {
    setLaden(true);
    api.get('/facturen').then(setFacturen).catch(e => alert(e.message)).finally(() => setLaden(false));
  };
  useEffect(() => { load(); }, []);

  async function verwijder(f) {
    if (!confirm(`Factuur "${f.bestandsnaam}" verwijderen? De gekoppelde voorraad/rollen blijven gewoon bestaan, enkel het bewijsstuk + de koppeling verdwijnt.`)) return;
    try {
      await api.delete(`/facturen/${f.id}`);
      load();
    } catch (e) { alert(e.message); }
  }

  return (
    <div>
      <div className="page-header" style={{ marginBottom: '1rem' }}>
        <div />
        <button className="btn primary" onClick={() => setModalOpen(true)}>📄 Factuur inlezen</button>
      </div>

      {laden ? (
        <div className="empty">Laden...</div>
      ) : facturen.length === 0 ? (
        <div className="empty">Nog geen aankoopfacturen ingelezen</div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Leverancier</th>
                <th>Datum</th>
                <th>Factuurnummer</th>
                <th>Totaalbedrag</th>
                <th>Gekoppeld</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {facturen.map(f => (
                <tr key={f.id}>
                  <td><span className="badge neutral">{f.type === 'bonnetje' ? 'Bonnetje' : 'Factuur'}</span></td>
                  <td style={{ fontWeight: 600 }}>{f.leverancier || '—'}</td>
                  <td>{f.datum || '—'}</td>
                  <td>{f.factuurnummer || '—'}</td>
                  <td>{f.totaal_bedrag != null ? `€${Number(f.totaal_bedrag).toFixed(2)}` : '—'}</td>
                  <td style={{ color: 'var(--muted)' }}>
                    {f.aantal_rollen > 0 && <>{f.aantal_rollen} rol{f.aantal_rollen === 1 ? '' : 'len'}</>}
                    {f.aantal_rollen > 0 && f.aantal_voorraad > 0 && ' · '}
                    {f.aantal_voorraad > 0 && <>{f.aantal_voorraad} stuk{f.aantal_voorraad === 1 ? '' : 's'}</>}
                    {f.aantal_rollen === 0 && f.aantal_voorraad === 0 && '—'}
                  </td>
                  <td style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                    <a className="btn" href={`${BASE}/facturen/${f.id}/bestand`} target="_blank" rel="noreferrer" title="Downloaden">⬇</a>
                    <button className="btn" onClick={() => verwijder(f)} title="Verwijderen">🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <FactuurUploadModal onSluiten={() => setModalOpen(false)} onKlaar={load} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════

const TABS = [
  { key: 'filament', label: 'Filament' },
  { key: 'artikelen', label: 'Artikelen' },
  { key: 'aankoopfacturen', label: 'Aankoopfacturen' },
];

export default function Voorraad() {
  const [tab, setTab] = useState('filament');
  return (
    <div>
      <div className="page-header">
        <h1>Voorraad</h1>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: '1.25rem', borderBottom: '1px solid var(--line)' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 16px',
              border: '1px solid var(--line-strong)',
              borderBottom: tab === t.key ? '1px solid var(--surface)' : '1px solid var(--line-strong)',
              borderRadius: '3px 3px 0 0',
              marginBottom: '-1px',
              background: tab === t.key ? 'var(--surface)' : 'var(--surface-sunken)',
              color: tab === t.key ? 'var(--ink)' : 'var(--muted)',
              fontWeight: tab === t.key ? 700 : 500,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'filament' ? <FilamentTab /> : tab === 'artikelen' ? <ArtikelenTab /> : <AankoopfacturenTab />}
    </div>
  );
}
