import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';

const LEEG_FORM = {
  type: 'particulier', naam: '', voornaam: '', bedrijfsnaam: '',
  email: '', telefoon: '', gsm: '',
  straat: '', huisnummer: '', postcode: '', gemeente: '',
  btw_nummer: '', notities: '',
};

// Module-niveau, niet genest — anders verliest een <input> de focus bij elke
// toetsaanslag (zelfde les als in het oude pakket).
function KlantForm({ form, set, onOpslaan, onAnnuleer, bezig }) {
  return (
    <div>
      <div className="form-group">
        <label>Type</label>
        <select value={form.type} onChange={e => set('type', e.target.value)}>
          <option value="particulier">👤 Particulier</option>
          <option value="zakelijk">🏢 Zakelijk</option>
        </select>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Naam</label>
          <input value={form.naam} onChange={e => set('naam', e.target.value)} placeholder="verplicht" />
        </div>
        <div className="form-group">
          <label>Voornaam</label>
          <input value={form.voornaam} onChange={e => set('voornaam', e.target.value)} />
        </div>
      </div>
      {form.type === 'zakelijk' && (
        <div className="form-row">
          <div className="form-group">
            <label>Bedrijfsnaam</label>
            <input value={form.bedrijfsnaam} onChange={e => set('bedrijfsnaam', e.target.value)} />
          </div>
          <div className="form-group">
            <label>BTW-nummer</label>
            <input value={form.btw_nummer} onChange={e => set('btw_nummer', e.target.value)} />
          </div>
        </div>
      )}
      <div className="form-row">
        <div className="form-group">
          <label>E-mail</label>
          <input value={form.email} onChange={e => set('email', e.target.value)} />
        </div>
        <div className="form-group">
          <label>GSM</label>
          <input value={form.gsm} onChange={e => set('gsm', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label>Telefoon</label>
        <input value={form.telefoon} onChange={e => set('telefoon', e.target.value)} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Straat</label>
          <input value={form.straat} onChange={e => set('straat', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Nr.</label>
          <input value={form.huisnummer} onChange={e => set('huisnummer', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>Postcode</label>
          <input value={form.postcode} onChange={e => set('postcode', e.target.value)} />
        </div>
        <div className="form-group">
          <label>Gemeente</label>
          <input value={form.gemeente} onChange={e => set('gemeente', e.target.value)} />
        </div>
      </div>
      {form.type === 'particulier' && (
        <div className="form-group">
          <label>BTW-nummer <span style={{ textTransform: 'none', fontWeight: 400 }}>(optioneel)</span></label>
          <input value={form.btw_nummer} onChange={e => set('btw_nummer', e.target.value)} />
        </div>
      )}
      <div className="form-group">
        <label>Notities</label>
        <textarea rows={3} value={form.notities} onChange={e => set('notities', e.target.value)} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <button className="btn" type="button" onClick={onAnnuleer} disabled={bezig}>Annuleer</button>
        <button className="btn primary" type="button" onClick={onOpslaan} disabled={bezig || !form.naam}>
          {bezig ? 'Bezig...' : 'Opslaan'}
        </button>
      </div>
    </div>
  );
}

export default function Klanten() {
  const [klanten, setKlanten] = useState([]);
  const [detail, setDetail] = useState(null);   // volledige klant-rij (view-modus)
  const [bewerken, setBewerken] = useState(false); // view- of edit-modus in het paneel
  const [nieuweKlant, setNieuweKlant] = useState(false);
  const [form, setForm] = useState(LEEG_FORM);
  const [bezig, setBezig] = useState(false);
  const [zoek, setZoek] = useState('');
  const [filter, setFilter] = useState('');

  const load = () => api.get('/klanten').then(setKlanten).catch(e => alert(e.message));
  useEffect(() => { load(); }, []);

  const filtered = klanten.filter(k => {
    const matchZoek = !zoek ||
      k.naam.toLowerCase().includes(zoek.toLowerCase()) ||
      (k.voornaam || '').toLowerCase().includes(zoek.toLowerCase()) ||
      (k.bedrijfsnaam || '').toLowerCase().includes(zoek.toLowerCase()) ||
      (k.email || '').toLowerCase().includes(zoek.toLowerCase());
    const matchType = !filter || k.type === filter;
    return matchZoek && matchType;
  });

  function openDetail(k) {
    setNieuweKlant(false);
    setBewerken(false);
    setDetail(k);
  }

  function startNieuw() {
    setDetail(null);
    setNieuweKlant(true);
    setBewerken(true);
    setForm(LEEG_FORM);
  }

  function startBewerken() {
    setForm({ ...LEEG_FORM, ...detail });
    setBewerken(true);
  }

  function sluitPaneel() {
    setDetail(null);
    setNieuweKlant(false);
    setBewerken(false);
  }

  function setVeld(k, v) {
    setForm(f => ({ ...f, [k]: v }));
  }

  async function opslaan() {
    if (!form.naam) return;
    setBezig(true);
    try {
      if (nieuweKlant) {
        const { id } = await api.post('/klanten', form);
        await load();
        setNieuweKlant(false);
        setBewerken(false);
        setDetail({ ...form, id });
      } else {
        await api.put(`/klanten/${detail.id}`, form);
        await load();
        setBewerken(false);
        setDetail({ ...form, id: detail.id });
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setBezig(false);
    }
  }

  async function verwijderen(k) {
    if (!confirm(`${k.naam} verwijderen?`)) return;
    try {
      await api.delete(`/klanten/${k.id}`);
      if (detail?.id === k.id) sluitPaneel();
      load();
    } catch (e) { alert(e.message); }
  }

  const volledigAdres = (k) => {
    const straatregel = [k.straat, k.huisnummer].filter(Boolean).join(' ');
    const pcregel = [k.postcode, k.gemeente].filter(Boolean).join(' ');
    return [straatregel, pcregel].filter(Boolean).join(', ') || '—';
  };

  const paneelOpen = detail || nieuweKlant;

  return (
    <div>
      <div className="page-header">
        <h1>Klanten</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Alle types</option>
            <option value="particulier">👤 Particulier</option>
            <option value="zakelijk">🏢 Zakelijk</option>
          </select>
          <input value={zoek} onChange={e => setZoek(e.target.value)} placeholder="Zoeken..." style={{ width: 200 }} />
          <button className="btn primary" onClick={startNieuw}>+ Nieuwe klant</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: paneelOpen ? '1fr 380px' : '1fr', gap: '1rem' }}>
        <div>
          {filtered.length === 0
            ? <div className="empty">Geen klanten gevonden</div>
            : <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th>Naam</th>
                      <th>Bedrijf</th>
                      <th>Postcode</th>
                      <th>Gemeente</th>
                      <th>E-mail</th>
                      <th>GSM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(k => (
                      <tr key={k.id}
                        onClick={() => openDetail(k)}
                        style={{ cursor: 'pointer', background: detail?.id === k.id ? 'var(--surface-sunken)' : undefined }}>
                        <td>{k.type === 'zakelijk' ? '🏢' : '👤'}</td>
                        <td style={{ fontWeight: 600 }}>{k.voornaam ? `${k.voornaam} ${k.naam}` : k.naam}</td>
                        <td style={{ color: 'var(--muted)' }}>{k.bedrijfsnaam || '—'}</td>
                        <td style={{ color: 'var(--muted)' }}>{k.postcode || '—'}</td>
                        <td style={{ color: 'var(--muted)' }}>{k.gemeente || '—'}</td>
                        <td style={{ fontSize: 12.5 }}>{k.email || '—'}</td>
                        <td style={{ fontSize: 12.5 }}>{k.gsm || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          }
        </div>

        {paneelOpen && (
          <div className="card panel">
            {bewerken ? (
              <>
                <div className="panel-head">
                  <h2>{nieuweKlant ? 'Nieuwe klant' : 'Klant bewerken'}</h2>
                  <div className="panel-actions">
                    <button onClick={sluitPaneel} title="Sluiten">✕</button>
                  </div>
                </div>
                <KlantForm form={form} set={setVeld} onOpslaan={opslaan} onAnnuleer={sluitPaneel} bezig={bezig} />
              </>
            ) : (
              <>
                <div className="panel-head">
                  <h2>
                    {detail.type === 'zakelijk' ? '🏢' : '👤'}{' '}
                    {detail.voornaam ? `${detail.voornaam} ${detail.naam}` : detail.naam}
                  </h2>
                  <div className="panel-actions">
                    <button onClick={startBewerken} title="Bewerken">✏</button>
                    <button onClick={sluitPaneel} title="Sluiten">✕</button>
                  </div>
                </div>

                {detail.bedrijfsnaam && (
                  <div className="info-block">
                    <strong>{detail.bedrijfsnaam}</strong>
                    {detail.btw_nummer && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>BTW: {detail.btw_nummer}</div>}
                  </div>
                )}

                <div style={{ display: 'grid', gap: 6, fontSize: 13, marginBottom: '1rem' }}>
                  {detail.email && <div><span style={{ color: 'var(--muted)' }}>E-mail: </span>{detail.email}</div>}
                  {detail.telefoon && <div><span style={{ color: 'var(--muted)' }}>Tel: </span>{detail.telefoon}</div>}
                  {detail.gsm && <div><span style={{ color: 'var(--muted)' }}>GSM: </span>{detail.gsm}</div>}
                  {detail.type === 'particulier' && detail.btw_nummer && <div><span style={{ color: 'var(--muted)' }}>BTW: </span>{detail.btw_nummer}</div>}
                  <div><span style={{ color: 'var(--muted)' }}>Adres: </span>{volledigAdres(detail)}</div>
                  {detail.notities && <div><span style={{ color: 'var(--muted)' }}>Notities: </span>{detail.notities}</div>}
                </div>

                <div className="info-block" style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Jobs/offertes/werkbons van deze klant verschijnen hier zodra die
                  onderdelen gebouwd zijn (Fase 1/2).
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                  <button className="btn danger" onClick={() => verwijderen(detail)}>✕ Verwijder klant</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
