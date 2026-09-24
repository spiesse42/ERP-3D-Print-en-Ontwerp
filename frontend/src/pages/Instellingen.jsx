import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import KeuzeMetToevoegen from '../components/KeuzeMetToevoegen.jsx';

// Groepering en volgorde 1-op-1 overgenomen uit het bewezen patroon van het
// oude pakket (Instellingen.jsx → Tarieven-tab). Labels/eenheden komen uit de
// databank zelf (zie backend/db.js seed-data), niet hardcoded hier.
const TARIEF_GROEPEN = [
  { titel: 'Kosten & energie', velden: ['kwh_prijs', 'machine_per_uur'] },
  { titel: 'Marge',            velden: ['marge_grens_uur', 'marge_klein_pct', 'marge_groot_pct', 'faalfactor_pct'] },
  { titel: 'Standaard arbeid', velden: ['voorbereiding_min', 'nabewerking_min'] },
  { titel: 'Regie tarieven',   velden: ['ontwerp_tarief', 'nabewerking_tarief', 'arbeid_per_uur'] },
  { titel: 'BMCU',             velden: ['bmcu_per_job'] },
];

// Moet exact overeenkomen met de INSTELLING_SLEUTELS-allowlist in
// backend/routes/instellingen.js.
const BEDRIJF_VELDEN = [
  { sleutel: 'bedrijf_naam',  label: 'Bedrijfsnaam' },
  { sleutel: 'bedrijf_btw',   label: 'BTW-nummer' },
  { sleutel: 'bedrijf_adres', label: 'Adres' },
  { sleutel: 'bedrijf_email', label: 'E-mail' },
  { sleutel: 'bedrijf_iban',  label: 'IBAN' },
];

const TABS = [
  { key: 'tarieven',    label: 'Tarieven' },
  { key: 'materiaal',   label: 'Materiaal' },
  { key: 'bedrijf',     label: 'Bedrijf' },
  { key: 'integraties', label: 'Integraties' },
];

const LEEG_TYPE = {
  merk_id: '', materiaal_id: '', verkoopprijs_per_kg: '',
  min_rollen: '', dichtheid_g_per_cm3: '', leverancier: '', notities: '',
};

function MateriaalForm({ form, set, merken, materialen, onNieuwMerk, onNieuwMateriaal, onOpslaan, onAnnuleer, bezig }) {
  return (
    <div>
      <KeuzeMetToevoegen label="Merk" waarde={form.merk_id} opties={merken} onKies={v => set('merk_id', v)} onNieuw={onNieuwMerk} watLabel="merk" />
      <KeuzeMetToevoegen label="Type" waarde={form.materiaal_id} opties={materialen} onKies={v => set('materiaal_id', v)} onNieuw={onNieuwMateriaal} watLabel="type" />
      <div className="form-row">
        <div className="form-group">
          <label>Verkoopprijs per kg (€)</label>
          <input value={form.verkoopprijs_per_kg} onChange={e => set('verkoopprijs_per_kg', e.target.value)} inputMode="decimal" placeholder="verplicht" />
        </div>
        <div className="form-group">
          <label>Minimum aantal rollen <span style={{ textTransform: 'none', fontWeight: 400 }}>optioneel</span></label>
          <input value={form.min_rollen} onChange={e => set('min_rollen', e.target.value)} inputMode="numeric" placeholder="leeg = geen bestel-opvolging" />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Dichtheid (g/cm³) <span style={{ textTransform: 'none', fontWeight: 400 }}>optioneel</span></label>
          <input value={form.dichtheid_g_per_cm3} onChange={e => set('dichtheid_g_per_cm3', e.target.value)} inputMode="decimal" />
        </div>
        <div className="form-group">
          <label>Leverancier <span style={{ textTransform: 'none', fontWeight: 400 }}>optioneel</span></label>
          <input value={form.leverancier} onChange={e => set('leverancier', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label>Notities <span style={{ textTransform: 'none', fontWeight: 400 }}>optioneel</span></label>
        <textarea rows={3} value={form.notities} onChange={e => set('notities', e.target.value)} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <button className="btn" type="button" onClick={onAnnuleer} disabled={bezig}>Annuleer</button>
        <button className="btn primary" type="button" onClick={onOpslaan}
          disabled={bezig || !form.merk_id || !form.materiaal_id || form.verkoopprijs_per_kg === ''}>
          {bezig ? 'Bezig...' : 'Opslaan'}
        </button>
      </div>
    </div>
  );
}

export default function Instellingen() {
  const [tab, setTab] = useState('tarieven');
  const [tarieven, setTarieven] = useState([]);
  const [bedrijf, setBedrijf] = useState({});
  const [types, setTypes] = useState([]);
  const [merken, setMerken] = useState([]);
  const [materialen, setMaterialen] = useState([]);
  // Ruwe string-waarden tijdens het typen, apart van de opgeslagen/geparste
  // waarden — zelfde les als in het oude pakket: anders springt een
  // numeriek veld tijdens het typen (bv. "0." wordt meteen "0").
  const [ruw, setRuw] = useState({});
  const [opgeslagen, setOpgeslagen] = useState(null);
  const [laden, setLaden] = useState(true);
  const [bezig, setBezig] = useState(false);

  const [detailType, setDetailType] = useState(null);
  const [bewerkenType, setBewerkenType] = useState(false);
  const [nieuweType, setNieuweType] = useState(false);
  const [formType, setFormType] = useState(LEEG_TYPE);

  const laad = () => {
    setLaden(true);
    Promise.all([
      api.get('/tarieven'), api.get('/instellingen'),
      api.get('/filament/types'), api.get('/filament/merken'), api.get('/filament/materialen'),
    ])
      .then(([t, i, ty, mk, mt]) => {
        setTarieven(t);
        const map = {};
        i.forEach(row => { map[row.sleutel] = row.waarde ?? ''; });
        setBedrijf(map);
        setTypes(ty);
        setMerken(mk);
        setMaterialen(mt);
      })
      .catch(e => alert(e.message))
      .finally(() => setLaden(false));
  };
  useEffect(() => { laad(); }, []);

  function ruwVoor(sleutel, huidig) {
    return ruw[sleutel] !== undefined ? ruw[sleutel] : String(huidig ?? '');
  }
  function setRuwVeld(sleutel, v) {
    setRuw(r => ({ ...r, [sleutel]: v }));
  }
  function flitsOpgeslagen(sleutel) {
    setOpgeslagen(sleutel);
    setTimeout(() => setOpgeslagen(s => (s === sleutel ? null : s)), 1500);
  }

  async function opslaanTarief(sleutel) {
    const waarde = ruw[sleutel];
    if (waarde === undefined) return;
    const getal = parseFloat(String(waarde).replace(',', '.'));
    if (!Number.isFinite(getal)) { alert('Ongeldig getal'); return; }
    try {
      await api.put(`/tarieven/${sleutel}`, { waarde: getal });
      setTarieven(ts => ts.map(t => (t.sleutel === sleutel ? { ...t, waarde: getal } : t)));
      setRuw(r => { const n = { ...r }; delete n[sleutel]; return n; });
      flitsOpgeslagen(sleutel);
    } catch (e) { alert(e.message); }
  }

  async function opslaanBedrijf(sleutel) {
    const waarde = ruw[sleutel];
    if (waarde === undefined) return;
    try {
      await api.put(`/instellingen/${sleutel}`, { waarde });
      setBedrijf(b => ({ ...b, [sleutel]: waarde }));
      setRuw(r => { const n = { ...r }; delete n[sleutel]; return n; });
      flitsOpgeslagen(sleutel);
    } catch (e) { alert(e.message); }
  }

  const tariefRij = (sleutel) => tarieven.find(t => t.sleutel === sleutel);

  // ── Materiaal (verkoopprijzen per merk + type) ─────────────────────────────
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
  function openDetailType(t) {
    setNieuweType(false);
    setBewerkenType(false);
    setDetailType(t);
  }
  function startNieuweType() {
    setDetailType(null);
    setNieuweType(true);
    setBewerkenType(true);
    setFormType(LEEG_TYPE);
  }
  function startBewerkenType() {
    setFormType({
      ...LEEG_TYPE, ...detailType,
      merk_id: String(detailType.merk_id), materiaal_id: String(detailType.materiaal_id),
    });
    setBewerkenType(true);
  }
  function sluitPaneelType() {
    setDetailType(null);
    setNieuweType(false);
    setBewerkenType(false);
  }
  function setVeldType(k, v) {
    setFormType(f => ({ ...f, [k]: v }));
  }
  async function opslaanType() {
    setBezig(true);
    try {
      if (nieuweType) {
        const { id } = await api.post('/filament/types', formType);
        await laad();
        setNieuweType(false);
        setBewerkenType(false);
        setDetailType({ ...formType, id });
      } else {
        await api.put(`/filament/types/${detailType.id}`, formType);
        await laad();
        setBewerkenType(false);
        setDetailType(t => ({ ...t, ...formType }));
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setBezig(false);
    }
  }
  async function verwijderType(t) {
    if (!confirm(`Verkoopprijs voor "${t.merk} ${t.materiaal}" verwijderen?`)) return;
    try {
      await api.delete(`/filament/types/${t.id}`);
      if (detailType?.id === t.id) sluitPaneelType();
      laad();
    } catch (e) { alert(e.message); }
  }

  const paneelOpenType = detailType || nieuweType;

  return (
    <div>
      <div className="page-header">
        <h1>Instellingen</h1>
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

      {laden ? (
        <div className="empty">Laden...</div>
      ) : tab === 'tarieven' ? (
        <div style={{ display: 'grid', gap: '1.25rem', maxWidth: 640 }}>
          {TARIEF_GROEPEN.map(groep => (
            <div className="card" key={groep.titel}>
              <div className="section-title" style={{ margin: '0 0 12px' }}>{groep.titel}</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {groep.velden.map(sleutel => {
                  const t = tariefRij(sleutel);
                  if (!t) return null;
                  return (
                    <div key={sleutel} style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 12, alignItems: 'end' }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label>{t.label}</label>
                        <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'none', fontWeight: 400 }}>{t.eenheid}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          value={ruwVoor(sleutel, t.waarde)}
                          onChange={e => setRuwVeld(sleutel, e.target.value)}
                          onBlur={() => opslaanTarief(sleutel)}
                          inputMode="decimal"
                        />
                        {opgeslagen === sleutel && <span style={{ color: 'var(--positive)', fontSize: 14 }}>✓</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : tab === 'materiaal' ? (
        <>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 16, maxWidth: 640, lineHeight: 1.5 }}>
            Verkoopprijs per kg per merk + type — dit voedt straks de kostenberekening
            van offertes/werkbons (Fase 2), los van wat een rol effectief gekost heeft
            (dat blijft apart per rol in Voorraad). Ontbrekende merken of types kan je
            hier meteen zelf toevoegen.
          </p>
          <div className="page-header" style={{ marginBottom: '1rem' }}>
            <div />
            <button className="btn primary" onClick={startNieuweType}>+ Nieuwe verkoopprijs</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: paneelOpenType ? '1fr 380px' : '1fr', gap: '1rem' }}>
            <div>
              {types.length === 0
                ? <div className="empty">Nog geen verkoopprijzen ingesteld</div>
                : <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Merk</th>
                          <th>Type</th>
                          <th>Verkoopprijs/kg</th>
                          <th>Min. rollen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {types.map(t => (
                          <tr key={t.id}
                            onClick={() => openDetailType(t)}
                            style={{ cursor: 'pointer', background: detailType?.id === t.id ? 'var(--surface-sunken)' : undefined }}>
                            <td style={{ fontWeight: 600 }}>{t.merk}</td>
                            <td>{t.materiaal}</td>
                            <td>€{Number(t.verkoopprijs_per_kg).toFixed(2)}</td>
                            <td style={{ color: 'var(--muted)' }}>{t.min_rollen ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
              }
            </div>

            {paneelOpenType && (
              <div className="card panel">
                {bewerkenType ? (
                  <>
                    <div className="panel-head">
                      <h2>{nieuweType ? 'Nieuwe verkoopprijs' : 'Verkoopprijs bewerken'}</h2>
                      <div className="panel-actions">
                        <button onClick={sluitPaneelType} title="Sluiten">✕</button>
                      </div>
                    </div>
                    <MateriaalForm
                      form={formType} set={setVeldType} merken={merken} materialen={materialen}
                      onNieuwMerk={nieuwMerk} onNieuwMateriaal={nieuwMateriaal}
                      onOpslaan={opslaanType} onAnnuleer={sluitPaneelType} bezig={bezig}
                    />
                  </>
                ) : (
                  <>
                    <div className="panel-head">
                      <h2>{detailType.merk} {detailType.materiaal}</h2>
                      <div className="panel-actions">
                        <button onClick={startBewerkenType} title="Bewerken">✏</button>
                        <button onClick={sluitPaneelType} title="Sluiten">✕</button>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: 6, fontSize: 13, marginBottom: '1rem' }}>
                      <div><span style={{ color: 'var(--muted)' }}>Verkoopprijs: </span>€{Number(detailType.verkoopprijs_per_kg).toFixed(2)} / kg</div>
                      <div><span style={{ color: 'var(--muted)' }}>Minimum aantal rollen: </span>{detailType.min_rollen ?? 'geen bestel-opvolging'}</div>
                      {detailType.dichtheid_g_per_cm3 && <div><span style={{ color: 'var(--muted)' }}>Dichtheid: </span>{detailType.dichtheid_g_per_cm3} g/cm³</div>}
                      {detailType.leverancier && <div><span style={{ color: 'var(--muted)' }}>Leverancier: </span>{detailType.leverancier}</div>}
                      {detailType.notities && <div><span style={{ color: 'var(--muted)' }}>Notities: </span>{detailType.notities}</div>}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                      <button className="btn danger" onClick={() => verwijderType(detailType)}>✕ Verwijder</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      ) : tab === 'bedrijf' ? (
        <div className="card" style={{ maxWidth: 480 }}>
          <div className="section-title" style={{ margin: '0 0 12px' }}>Bedrijfsgegevens</div>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
            Verschijnen op offertes en werkbons zodra Fase 2 gebouwd is.
          </p>
          <div style={{ display: 'grid', gap: 4 }}>
            {BEDRIJF_VELDEN.map(v => (
              <div key={v.sleutel} className="form-group">
                <label>{v.label}</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    value={ruwVoor(v.sleutel, bedrijf[v.sleutel])}
                    onChange={e => setRuwVeld(v.sleutel, e.target.value)}
                    onBlur={() => opslaanBedrijf(v.sleutel)}
                  />
                  {opgeslagen === v.sleutel && <span style={{ color: 'var(--positive)', fontSize: 14 }}>✓</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="card" style={{ maxWidth: 480 }}>
          <div className="section-title" style={{ margin: '0 0 12px' }}>Integraties</div>
          <p style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
            Externe diensten die de app aanspreekt. Dit zijn geheimen — ze staan
            bewust niet in de databank en worden niet via dit scherm bewerkt,
            maar ingesteld via de Home Assistant add-on-configuratie.
          </p>
          <div className="form-group">
            <label>Gemini API-key <span style={{ textTransform: 'none', fontWeight: 400 }}>voor factuur-OCR (Aankoopfacturen)</span></label>
            <input value="Ingesteld via de add-on configuratie (GEMINI_API_KEY)" disabled />
          </div>
        </div>
      )}
    </div>
  );
}
