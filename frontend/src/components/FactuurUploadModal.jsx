import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api.js';
import KeuzeMetToevoegen from './KeuzeMetToevoegen.jsx';

// Aankoopfacturen/OCR — upload → Gemini laat het bestand analyseren → jij
// controleert/corrigeert de herkende regels → bevestigen maakt de factuur-rij
// + de effectieve filamentrollen/artikel-voorraad aan (elk met factuur_id).
// Herbouw van het bewezen patroon uit het oude pakket (sessie-notities.md,
// "Vervolgsessie deel 4"), aangepast aan het nieuwe schema: enkel Filament en
// Onderdelen (geen eindproducten — die zijn zelfgemaakt, geen aankoop; geen
// diensten). Zie ook backend/routes/facturen.js voor het analyseer-schema.

const LEEG_FACTUUR = { leverancier: '', factuurnummer: '', datum: '', type: 'factuur', totaal_bedrag: '' };

// Zelfde formule als in Voorraad.jsx (ArtikelenTab) — bewust een voorstel,
// geen dwingende berekening (marge%/verkoopprijs blijven overschrijfbaar).
function berekenVoorstelVerkoopprijs(inkoopprijs, margePct) {
  const i = parseFloat(inkoopprijs), m = parseFloat(margePct);
  if (!Number.isFinite(i) || !Number.isFinite(m)) return null;
  return Math.round(i * (1 + m / 100) * 100) / 100;
}

function standaardType(mimetype) {
  return mimetype.startsWith('image/') ? 'bonnetje' : 'factuur';
}

function vindNaam(lijst, naam) {
  const n = String(naam || '').trim().toLowerCase();
  if (!n) return null;
  return lijst.find(x => x.naam.toLowerCase() === n) || null;
}

// ── Gemini-regel → bewerkbare regel-state, met automatische matching tegen
// de al bestaande catalogi. Geen enkele nieuwe merk/materiaal/kleur/artikel
// wordt hier al aangemaakt — dat gebeurt pas als jij het expliciet bevestigt
// (per jouw keuze: "handmatig aanvullen bij bevestigen").
function matchFilamentRegel(r, catalogus) {
  const merk = vindNaam(catalogus.merken, r.merk);
  const materiaal = vindNaam(catalogus.materialen, r.materiaal);
  const kleur = vindNaam(catalogus.kleuren, r.kleur);
  return {
    categorie: 'filament',
    merkId: merk ? String(merk.id) : '',
    materiaalId: materiaal ? String(materiaal.id) : '',
    kleurId: kleur ? String(kleur.id) : '',
    verkoopprijsPerKgNieuw: '',
    aantal: r.aantal != null && r.aantal !== '' ? String(r.aantal) : '1',
    prijsPerStuk: r.prijs_per_stuk != null && r.prijs_per_stuk !== '' ? String(r.prijs_per_stuk) : '',
    herkendMerk: r.merk || '', herkendMateriaal: r.materiaal || '', herkendKleur: r.kleur || '',
  };
}
function matchOnderdeelRegel(r, catalogus) {
  const onderdeelTypes = catalogus.artikelTypes.filter(t => t.categorie === 'onderdeel');
  const bestaand = vindNaam(onderdeelTypes, r.naam);
  return {
    categorie: 'onderdeel',
    naam: r.naam || '',
    typeKeuze: bestaand ? String(bestaand.id) : '__nieuw__',
    inkoopprijsNieuw: r.prijs_per_stuk != null && r.prijs_per_stuk !== '' ? String(r.prijs_per_stuk) : '',
    margePctNieuw: '',
    aantal: r.aantal != null && r.aantal !== '' ? String(r.aantal) : '1',
    prijsPerStuk: r.prijs_per_stuk != null && r.prijs_per_stuk !== '' ? String(r.prijs_per_stuk) : '',
  };
}
function nieuweLegeOnderdeelRegel() {
  return { categorie: 'onderdeel', naam: '', typeKeuze: '__nieuw__', inkoopprijsNieuw: '', margePctNieuw: '', aantal: '1', prijsPerStuk: '' };
}

// ── Rij-componenten — module-niveau, niet genest (anders verliezen de
// invoervelden focus bij elke toetsaanslag, zelfde les als overal elders). ──

function FilamentRegelRij({ regel, i, catalogus, setVeld, onNieuwMerk, onNieuwMateriaal, onNieuwKleur, onVerwijder }) {
  const heeftType = regel.merkId && regel.materiaalId &&
    catalogus.filamentTypes.some(t => String(t.merk_id) === regel.merkId && String(t.materiaal_id) === regel.materiaalId);
  return (
    <div className="card" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="badge neutral">Filament</span>
        <button onClick={() => onVerwijder(i)} title="Regel verwijderen">✕</button>
      </div>
      {(regel.herkendMerk || regel.herkendMateriaal || regel.herkendKleur) && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          Herkend: {[regel.herkendMerk, regel.herkendMateriaal, regel.herkendKleur].filter(Boolean).join(' · ')}
        </div>
      )}
      <div className="form-row">
        <KeuzeMetToevoegen label="Merk" waarde={regel.merkId} opties={catalogus.merken} watLabel="merk"
          onKies={v => setVeld(i, { merkId: v })} onNieuw={naam => onNieuwMerk(naam, i)} />
        <KeuzeMetToevoegen label="Type" waarde={regel.materiaalId} opties={catalogus.materialen} watLabel="type"
          onKies={v => setVeld(i, { materiaalId: v })} onNieuw={naam => onNieuwMateriaal(naam, i)} />
      </div>
      <KeuzeMetToevoegen label="Kleur" waarde={regel.kleurId} opties={catalogus.kleuren} watLabel="kleur"
        onKies={v => setVeld(i, { kleurId: v })} onNieuw={naam => onNieuwKleur(naam, i)} />
      {regel.merkId && regel.materiaalId && !heeftType && (
        <div className="form-group">
          <label>Verkoopprijs per kg (€) <span style={{ textTransform: 'none', fontWeight: 400 }}>nieuwe combinatie — verplicht</span></label>
          <input value={regel.verkoopprijsPerKgNieuw} onChange={e => setVeld(i, { verkoopprijsPerKgNieuw: e.target.value })} inputMode="decimal" placeholder="bv. 22.50" />
        </div>
      )}
      <div className="form-row">
        <div className="form-group">
          <label>Aantal rollen</label>
          <input value={regel.aantal} onChange={e => setVeld(i, { aantal: e.target.value })} inputMode="numeric" />
        </div>
        <div className="form-group">
          <label>Aankoopprijs per rol (€) <span style={{ textTransform: 'none', fontWeight: 400 }}>optioneel</span></label>
          <input value={regel.prijsPerStuk} onChange={e => setVeld(i, { prijsPerStuk: e.target.value })} inputMode="decimal" />
        </div>
      </div>
    </div>
  );
}

function OnderdeelRegelRij({ regel, i, catalogus, setVeld, onVerwijder }) {
  const onderdeelTypes = catalogus.artikelTypes.filter(t => t.categorie === 'onderdeel');
  const voorstel = berekenVoorstelVerkoopprijs(regel.inkoopprijsNieuw, regel.margePctNieuw);
  return (
    <div className="card" style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="badge neutral">Onderdeel</span>
        <button onClick={() => onVerwijder(i)} title="Regel verwijderen">✕</button>
      </div>
      <div className="form-group">
        <label>Artikel</label>
        <select value={regel.typeKeuze} onChange={e => setVeld(i, { typeKeuze: e.target.value })}>
          <option value="__nieuw__">+ Nieuw artikel — "{regel.naam || '...'}"</option>
          {onderdeelTypes.map(t => <option key={t.id} value={t.id}>{t.naam}</option>)}
        </select>
      </div>
      {regel.typeKeuze === '__nieuw__' && (
        <>
          <div className="form-group">
            <label>Naam</label>
            <input value={regel.naam} onChange={e => setVeld(i, { naam: e.target.value })} placeholder="bv. Ring 25mm" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Inkoopprijs (€)</label>
              <input value={regel.inkoopprijsNieuw} onChange={e => setVeld(i, { inkoopprijsNieuw: e.target.value })} inputMode="decimal" />
            </div>
            <div className="form-group">
              <label>Marge % <span style={{ textTransform: 'none', fontWeight: 400 }}>verplicht bij een nieuw onderdeel</span></label>
              <input value={regel.margePctNieuw} onChange={e => setVeld(i, { margePctNieuw: e.target.value })} inputMode="decimal" placeholder="bv. 50" />
            </div>
          </div>
          {voorstel != null && (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Voorstel verkoopprijs: €{voorstel.toFixed(2)} (nadien in Voorraad nog aanpasbaar)</div>
          )}
        </>
      )}
      <div className="form-row">
        <div className="form-group">
          <label>Aantal stuks</label>
          <input value={regel.aantal} onChange={e => setVeld(i, { aantal: e.target.value })} inputMode="numeric" />
        </div>
        <div className="form-group">
          <label>Aankoopprijs per stuk (€) <span style={{ textTransform: 'none', fontWeight: 400 }}>optioneel</span></label>
          <input value={regel.prijsPerStuk} onChange={e => setVeld(i, { prijsPerStuk: e.target.value })} inputMode="decimal" />
        </div>
      </div>
    </div>
  );
}

export default function FactuurUploadModal({ onSluiten, onKlaar }) {
  const [catalogus, setCatalogus] = useState(null);
  const [stap, setStap] = useState('upload'); // upload | analyseren | controle | bevestigen
  const [bestand, setBestand] = useState(null);
  const [fout, setFout] = useState(null);
  const [factuurVelden, setFactuurVelden] = useState(LEEG_FACTUUR);
  const [regels, setRegels] = useState([]);
  const [bezig, setBezig] = useState(false);

  // Retry-veiligheid (zelfde les als het oude pakket, buglijst K5): bij een
  // gedeeltelijke mislukking mag "Bevestigen" opnieuw klikken geen dubbele
  // rollen/voorraad aanmaken — enkel de nog niet verwerkte regels herhalen.
  const factuurIdRef = useRef(null);
  const verwerkteRegelsRef = useRef(new Set());

  useEffect(() => {
    Promise.all([
      api.get('/filament/merken'), api.get('/filament/materialen'), api.get('/filament/kleuren'),
      api.get('/filament/types'), api.get('/artikelen/types'),
    ]).then(([merken, materialen, kleuren, filamentTypes, artikelTypes]) => {
      setCatalogus({ merken, materialen, kleuren, filamentTypes, artikelTypes });
    }).catch(e => setFout(e.message));
  }, []);

  function kiesBestand(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBestand(f);
    setFactuurVelden(v => ({ ...v, type: standaardType(f.type) }));
    setFout(null);
  }

  async function analyseer() {
    if (!bestand) return;
    setStap('analyseren');
    setFout(null);
    try {
      const fd = new FormData();
      fd.append('bestand', bestand);
      const resultaat = await api.upload('/facturen/analyseer', fd);
      setFactuurVelden(v => ({
        ...v,
        leverancier: resultaat.leverancier || '',
        factuurnummer: resultaat.factuurnummer || '',
        datum: resultaat.datum || '',
        totaal_bedrag: resultaat.totaal_bedrag != null ? String(resultaat.totaal_bedrag) : '',
      }));
      setRegels((resultaat.regels || []).map(r => (
        r.categorie === 'filament' ? matchFilamentRegel(r, catalogus) : matchOnderdeelRegel(r, catalogus)
      )));
      setStap('controle');
    } catch (e) {
      setFout(e.message);
      setStap('upload');
    }
  }

  function setVeldFactuur(k, v) {
    setFactuurVelden(f => ({ ...f, [k]: v }));
  }
  function setVeldRegel(i, patch) {
    setRegels(rs => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function verwijderRegel(i) {
    setRegels(rs => rs.filter((_, idx) => idx !== i));
  }
  function voegOnderdeelRegelToe() {
    setRegels(rs => [...rs, nieuweLegeOnderdeelRegel()]);
  }
  function voegFilamentRegelToe() {
    setRegels(rs => [...rs, matchFilamentRegel({}, catalogus)]);
  }

  async function onNieuwMerk(naam, i) {
    const nieuw = await api.post('/filament/merken', { naam });
    setCatalogus(c => ({ ...c, merken: [...c.merken, nieuw].sort((a, b) => a.naam.localeCompare(b.naam)) }));
    setVeldRegel(i, { merkId: String(nieuw.id) });
    return nieuw;
  }
  async function onNieuwMateriaal(naam, i) {
    const nieuw = await api.post('/filament/materialen', { naam });
    setCatalogus(c => ({ ...c, materialen: [...c.materialen, nieuw].sort((a, b) => a.naam.localeCompare(b.naam)) }));
    setVeldRegel(i, { materiaalId: String(nieuw.id) });
    return nieuw;
  }
  async function onNieuwKleur(naam, i) {
    // Neutrale placeholder-hex — de exacte kleurcode kan je nadien nog
    // verfijnen via de bestaande kleurenlijst (Voorraad → Filament).
    const nieuw = await api.post('/filament/kleuren', { naam, hex: '#c9c2b2' });
    setCatalogus(c => ({ ...c, kleuren: [...c.kleuren, nieuw].sort((a, b) => a.naam.localeCompare(b.naam)) }));
    setVeldRegel(i, { kleurId: String(nieuw.id) });
    return nieuw;
  }

  function valideerRegels() {
    for (let i = 0; i < regels.length; i++) {
      const r = regels[i];
      const label = `Regel ${i + 1}`;
      if (r.prijsPerStuk !== '' && (!Number.isFinite(parseFloat(r.prijsPerStuk)) || parseFloat(r.prijsPerStuk) < 0)) {
        return `${label}: aankoopprijs moet een geldig, niet-negatief getal zijn (of leeg)`;
      }
      const aantal = parseInt(r.aantal, 10);
      if (!Number.isInteger(aantal) || aantal < 1) return `${label}: aantal moet een geheel getal ≥ 1 zijn`;
      if (r.categorie === 'filament') {
        if (!r.merkId) return `${label}: kies of maak een merk aan`;
        if (!r.materiaalId) return `${label}: kies of maak een type aan`;
        if (!r.kleurId) return `${label}: kies of maak een kleur aan`;
        const heeftType = catalogus.filamentTypes.some(t => String(t.merk_id) === r.merkId && String(t.materiaal_id) === r.materiaalId);
        if (!heeftType && (r.verkoopprijsPerKgNieuw === '' || !Number.isFinite(parseFloat(r.verkoopprijsPerKgNieuw)) || parseFloat(r.verkoopprijsPerKgNieuw) < 0)) {
          return `${label}: nieuwe merk+type-combinatie — verkoopprijs per kg is verplicht`;
        }
      } else {
        if (r.typeKeuze === '__nieuw__') {
          if (!r.naam.trim()) return `${label}: naam is verplicht bij een nieuw onderdeel`;
          if (!Number.isFinite(parseFloat(r.inkoopprijsNieuw)) || parseFloat(r.inkoopprijsNieuw) < 0) return `${label}: inkoopprijs is verplicht bij een nieuw onderdeel`;
          if (!Number.isFinite(parseFloat(r.margePctNieuw)) || parseFloat(r.margePctNieuw) < 0) return `${label}: marge% is verplicht bij een nieuw onderdeel`;
        }
      }
    }
    return null;
  }

  async function bevestigen() {
    if (regels.length === 0) { setFout('Voeg minstens 1 regel toe'); return; }
    if (!['factuur', 'bonnetje'].includes(factuurVelden.type)) { setFout('Type moet \'factuur\' of \'bonnetje\' zijn'); return; }
    const regelFout = valideerRegels();
    if (regelFout) { setFout(regelFout); return; }

    setFout(null);
    setBezig(true);
    setStap('bevestigen');
    try {
      if (!factuurIdRef.current) {
        const fd = new FormData();
        fd.append('bestand', bestand);
        fd.append('leverancier', factuurVelden.leverancier);
        fd.append('factuurnummer', factuurVelden.factuurnummer);
        fd.append('datum', factuurVelden.datum);
        fd.append('type', factuurVelden.type);
        fd.append('totaal_bedrag', factuurVelden.totaal_bedrag);
        const { factuur_id } = await api.upload('/facturen/opslaan', fd);
        factuurIdRef.current = factuur_id;
      }
      const factuurId = factuurIdRef.current;

      // Binnen deze ene bevestiging: een nieuwe filamenttype/onderdeel-type
      // maar 1x aanmaken, ook als meerdere regels naar dezelfde nieuwe
      // combinatie/naam verwijzen.
      const filamentTypeCache = new Map(catalogus.filamentTypes.map(t => [`${t.merk_id}-${t.materiaal_id}`, t.id]));
      const onderdeelTypeCache = new Map(
        catalogus.artikelTypes.filter(t => t.categorie === 'onderdeel').map(t => [t.naam.toLowerCase(), t.id])
      );

      for (let i = 0; i < regels.length; i++) {
        if (verwerkteRegelsRef.current.has(i)) continue;
        const r = regels[i];
        const aantal = parseInt(r.aantal, 10);
        const aankoopprijs = r.prijsPerStuk !== '' ? parseFloat(r.prijsPerStuk) : undefined;

        if (r.categorie === 'filament') {
          const sleutel = `${r.merkId}-${r.materiaalId}`;
          let filamentTypeId = filamentTypeCache.get(sleutel);
          if (!filamentTypeId) {
            const { id } = await api.post('/filament/types', { merk_id: r.merkId, materiaal_id: r.materiaalId, verkoopprijs_per_kg: r.verkoopprijsPerKgNieuw });
            filamentTypeId = id;
            filamentTypeCache.set(sleutel, id);
          }
          await api.post('/filament/rollen', {
            filament_type_id: filamentTypeId, kleur_id: r.kleurId, aantal,
            aankoopprijs_eur: aankoopprijs, factuur_id: factuurId,
          });
        } else {
          let artikelTypeId = r.typeKeuze !== '__nieuw__' ? Number(r.typeKeuze) : onderdeelTypeCache.get(r.naam.trim().toLowerCase());
          if (!artikelTypeId) {
            const voorstel = berekenVoorstelVerkoopprijs(r.inkoopprijsNieuw, r.margePctNieuw);
            const { id } = await api.post('/artikelen/types', {
              naam: r.naam.trim(), categorie: 'onderdeel',
              inkoopprijs: r.inkoopprijsNieuw, marge_pct: r.margePctNieuw,
              verkoopprijs: voorstel != null ? voorstel : r.inkoopprijsNieuw,
            });
            artikelTypeId = id;
            onderdeelTypeCache.set(r.naam.trim().toLowerCase(), id);
          }
          await api.post('/artikelen/voorraad', {
            artikel_type_id: artikelTypeId, aantal,
            aankoopprijs_eur: aankoopprijs, factuur_id: factuurId,
          });
        }
        verwerkteRegelsRef.current.add(i);
      }

      onKlaar();
      onSluiten();
    } catch (e) {
      setFout(`${e.message} — de al verwerkte regels blijven staan; klik opnieuw op "Bevestigen" om enkel de rest te herhalen.`);
      setStap('controle');
    } finally {
      setBezig(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !bezig) onSluiten(); }}>
      <div className="modal" style={{ width: 640, maxHeight: '93vh', overflowY: 'auto' }}>
        <div className="modal-header">
          <h2>Factuur inlezen</h2>
          <div>
            <button className="btn" onClick={onSluiten} disabled={bezig}>✕</button>
          </div>
        </div>

        {fout && <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginBottom: 12, fontSize: 13 }}>{fout}</div>}

        {!catalogus ? (
          <div className="empty">Laden...</div>
        ) : stap === 'upload' || stap === 'analyseren' ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
              Upload een PDF-factuur of een foto van een bonnetje. Gemini leest het uit —
              je krijgt daarna alle herkende regels te zien om na te kijken en aan te vullen
              voor er iets bewaard wordt.
            </p>
            <div className="form-group">
              <label>Bestand</label>
              <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={kiesBestand} disabled={stap === 'analyseren'} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn primary" onClick={analyseer} disabled={!bestand || stap === 'analyseren'}>
                {stap === 'analyseren' ? 'Analyseren...' : 'Analyseren'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            <div className="card">
              <div className="section-title" style={{ margin: '0 0 10px' }}>Factuurgegevens</div>
              <div className="form-row">
                <div className="form-group">
                  <label>Leverancier</label>
                  <input value={factuurVelden.leverancier} onChange={e => setVeldFactuur('leverancier', e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Factuur-/ticketnummer</label>
                  <input value={factuurVelden.factuurnummer} onChange={e => setVeldFactuur('factuurnummer', e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Datum</label>
                  <input value={factuurVelden.datum} onChange={e => setVeldFactuur('datum', e.target.value)} placeholder="JJJJ-MM-DD" />
                </div>
                <div className="form-group">
                  <label>Totaalbedrag (€)</label>
                  <input value={factuurVelden.totaal_bedrag} onChange={e => setVeldFactuur('totaal_bedrag', e.target.value)} inputMode="decimal" />
                </div>
              </div>
              <div className="form-group">
                <label>Type</label>
                <select value={factuurVelden.type} onChange={e => setVeldFactuur('type', e.target.value)}>
                  <option value="factuur">Factuur</option>
                  <option value="bonnetje">Bonnetje</option>
                </select>
              </div>
            </div>

            <div>
              <div className="section-title" style={{ margin: '0 0 10px' }}>Regels ({regels.length})</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {regels.map((r, i) => (
                  r.categorie === 'filament'
                    ? <FilamentRegelRij key={i} regel={r} i={i} catalogus={catalogus} setVeld={setVeldRegel}
                        onNieuwMerk={onNieuwMerk} onNieuwMateriaal={onNieuwMateriaal} onNieuwKleur={onNieuwKleur} onVerwijder={verwijderRegel} />
                    : <OnderdeelRegelRij key={i} regel={r} i={i} catalogus={catalogus} setVeld={setVeldRegel} onVerwijder={verwijderRegel} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn" type="button" onClick={voegFilamentRegelToe}>+ Filamentregel</button>
                <button className="btn" type="button" onClick={voegOnderdeelRegelToe}>+ Onderdeelregel</button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={onSluiten} disabled={bezig}>Annuleer</button>
              <button className="btn primary" onClick={bevestigen} disabled={bezig}>
                {bezig ? 'Bezig...' : 'Bevestigen'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
