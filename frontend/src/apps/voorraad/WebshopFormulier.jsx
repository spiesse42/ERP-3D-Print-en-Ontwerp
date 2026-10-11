import { useEffect, useState } from 'react';
import { api, BASE } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving } from '../../schil/Omgeving.jsx';
import { euro, naarInvoer, datum } from '../../lib/formaat.js';

// Webshop (11-10): de velden van het webshopproduct beheren in het ERP en met
// "Naar webshop" in Sanity zetten (en zo op de site). Naam en prijs komen van
// het artikel. Varianten, video, vormvoorbeelden en het letterformulier
// blijven in Sanity. Een nieuw product staat standaard verborgen.
const VINKJES = [
  ['hidden', 'Verborgen (niet zichtbaar op de site)'],
  ['comingSoon', 'Binnenkort beschikbaar'],
  ['featured', 'Uitgelicht op de homepage'],
  ['priceFrom', 'Prijs als "vanaf"'],
  ['imageIsRender', 'Foto is een render (geen echte printfoto)'],
  ['customOrder', 'Maatwerk / offerte-aanvraag'],
];

export default function WebshopFormulier({ art, onKlaar }) {
  const { melding, bevestig } = useOmgeving();
  const { data, herlaad } = useData(`/producten/${art.id}/webshop`);
  const { data: k } = useData('/producten/webshop/keuzes');
  const [f, setF] = useState(null);
  const [bezig, setBezig] = useState(false);
  useEffect(() => { if (data) setF({ ...data.data, weightGrams: naarInvoer(data.data.weightGrams), featuredOrder: naarInvoer(data.data.featuredOrder), colorChoiceCount: naarInvoer(data.data.colorChoiceCount) }); }, [data]);
  if (!data || !f) return null;
  const zet = (sl, w) => setF(x => ({ ...x, [sl]: w }));
  const vuil = JSON.stringify(f) !== JSON.stringify({ ...data.data, weightGrams: naarInvoer(data.data.weightGrams), featuredOrder: naarInvoer(data.data.featuredOrder), colorChoiceCount: naarInvoer(data.data.colorChoiceCount) }) || data.bron !== 'erp';
  const extra = new Set(f.photo_bijlage_ids || []);

  async function bewaar() {
    await api.put(`/producten/${art.id}/webshop`, f);
    await herlaad();
  }
  async function opslaan() {
    setBezig(true);
    try { await bewaar(); melding('Webshopgegevens bewaard (nog niet naar de webshop gestuurd).'); } catch (e) { melding(e.message, 'fout'); }
    setBezig(false);
  }
  async function push(forceer = false) {
    setBezig(true);
    try {
      if (vuil && !forceer) await bewaar();
      const r = await api.post(`/producten/${art.id}/webshop/push`, { forceer });
      melding(`${r.nieuw ? 'Aangemaakt' : 'Bijgewerkt'} in de webshop${r.verborgen ? ' (verborgen)' : ''}.${r.waarschuwing ? ` ${r.waarschuwing}` : ''}`);
      await herlaad(); onKlaar?.();
    } catch (e) {
      setBezig(false);
      if (/gewijzigd sinds de laatste push/.test(e.message) && await bevestig({ titel: 'In Sanity gewijzigd', tekst: e.message, bevestigLabel: 'Toch pushen', annuleerLabel: 'Terug', gevaarlijk: true })) return push(true);
      if (!/gewijzigd sinds/.test(e.message)) melding(e.message, 'fout');
      return;
    }
    setBezig(false);
  }
  async function los() {
    if (!await bevestig({ titel: 'Loskoppelen van de webshop', tekst: `${art.weergave} blijft in het ERP en in de webshop, maar ze zijn niet meer gekoppeld.`, bevestigLabel: 'Loskoppelen', annuleerLabel: 'Terug' })) return;
    try { await api.post(`/producten/${art.id}/ontkoppel`); melding('Losgekoppeld van de webshop.'); onKlaar?.(); } catch (e) { melding(e.message, 'fout'); }
  }

  if (data.variant) {
    return <p className="note" style={{ marginTop: 0 }}>Dit artikel is de maatvariant <b>{data.variant}</b> van <a href={`https://www.3dprintenontwerp.be/producten/${data.slug}`} target="_blank" rel="noopener noreferrer">{data.slug}</a>. Varianten beheer je voorlopig in Sanity. <button type="button" className="linkish" onClick={los}>Loskoppelen</button></p>;
  }
  return (
    <div>
      <p className="note" style={{ marginTop: 0 }}>
        {data.slug ? <>Gekoppeld aan <a href={`https://www.3dprintenontwerp.be/producten/${data.slug}`} target="_blank" rel="noopener noreferrer">{data.slug}</a>. </> : 'Nog niet in de webshop. '}
        {data.gepusht_op ? `Laatst naar de webshop: ${datum(data.gepusht_op.slice(0, 10))}. ` : ''}
        {data.bron === 'sanity' && 'Ingevuld met wat nu in de webshop staat; bewaar of push om het ERP de baas te maken. '}
        Naam (<b>{data.naam}</b>) en prijs (<b>{data.prijs != null ? euro(data.prijs) : 'nog geen'}</b>) komen van het artikel.
        {k && !k.token && <b> Er is nog geen Sanity-token ingesteld: pushen lukt pas als dat in de add-on-instellingen staat.</b>}
      </p>
      <div className="fgrid">
        <div><label htmlFor="ws-cat">Categorie (webshop)</label>
          <select id="ws-cat" className="inp" value={f.category_id || ''} onChange={e => zet('category_id', e.target.value)}>
            <option value="">Kies…</option>
            {(k?.categorieen || []).map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select></div>
        <div><label htmlFor="ws-emoji">Emoji (als er geen foto is)</label><input id="ws-emoji" className="inp" value={f.emoji} onChange={e => zet('emoji', e.target.value)} /></div>
        <div><label htmlFor="ws-gew">Gewicht (gram)</label><input id="ws-gew" className="inp num" inputMode="decimal" placeholder={data.gewicht_profiel != null ? `uit printprofiel: ${naarInvoer(data.gewicht_profiel)}` : ''} value={f.weightGrams} onChange={e => zet('weightGrams', e.target.value)} /></div>
        <div><label htmlFor="ws-datum">Datum toegevoegd</label><input id="ws-datum" type="date" className="inp" value={f.createdAt || ''} onChange={e => zet('createdAt', e.target.value)} /></div>
      </div>
      <label htmlFor="ws-besch" style={{ display: 'block', marginTop: 10 }}>Beschrijving <span className="sub">(lege regel = nieuwe alinea)</span></label>
      <textarea id="ws-besch" className="inp" rows={6} value={f.description} onChange={e => zet('description', e.target.value)} placeholder="Wat is het, afmetingen, materiaal… Ontwerp van een ander? Vermeld de ontwerper." />

      <div style={{ marginTop: 10 }}>
        <span className="lbl">Foto's voor de webshop</span>
        {data.fotos.length === 0 ? <p className="sub">Nog geen foto's bij dit artikel (tabblad Foto's & bestanden).{data.sanity_foto ? ' De foto in de webshop blijft staan.' : ''}</p> : (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {data.fotos.map(ft => (
              <div key={ft.id} style={{ width: 110 }}>
                <img src={`${BASE}/bijlagen/bestand/${ft.id}`} alt={ft.bestandsnaam} style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 8, outline: f.image_bijlage_id === ft.id ? '3px solid var(--accent)' : 'none' }} />
                <label className="vinkje"><input type="radio" name="ws-hoofd" checked={f.image_bijlage_id === ft.id} onChange={() => setF(x => ({ ...x, image_bijlage_id: ft.id, photo_bijlage_ids: (x.photo_bijlage_ids || []).filter(i => i !== ft.id) }))} /> hoofdfoto</label>
                <label className="vinkje"><input type="checkbox" disabled={f.image_bijlage_id === ft.id} checked={extra.has(ft.id)} onChange={e => zet('photo_bijlage_ids', e.target.checked ? [...extra, ft.id] : [...extra].filter(i => i !== ft.id))} /> extra</label>
              </div>
            ))}
          </div>
        )}
        {f.image_bijlage_id && <button type="button" className="linkish" onClick={() => setF(x => ({ ...x, image_bijlage_id: null, photo_bijlage_ids: [] }))}>geen foto's vanuit het ERP{data.sanity_foto ? ' (die in de webshop blijven)' : ''}</button>}
        <p className="sub">Enkel je eigen foto's: foto's van een ontwerper (bv. Patreon) mogen niet in de webshop.</p>
      </div>

      <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '2px 16px' }}>
        {VINKJES.map(([sl, l]) => <label key={sl} className="vinkje"><input type="checkbox" checked={!!f[sl]} onChange={e => zet(sl, e.target.checked)} /> {l}</label>)}
      </div>
      {f.featured && <div className="fgrid" style={{ marginTop: 6 }}><div><label htmlFor="ws-fo">Volgorde in de banner</label><input id="ws-fo" className="inp num" inputMode="numeric" value={f.featuredOrder} onChange={e => zet('featuredOrder', e.target.value)} /></div></div>}

      <div style={{ marginTop: 10 }}>
        <label className="vinkje"><input type="checkbox" checked={!!f.colorChoice} onChange={e => zet('colorChoice', e.target.checked)} /> Klant kiest een kleur</label>
        {f.colorChoice && <>
          <div className="fgrid">
            <div><label htmlFor="ws-kc">Aantal kleurkeuzes</label><input id="ws-kc" className="inp num" inputMode="numeric" placeholder="1" value={f.colorChoiceCount} onChange={e => zet('colorChoiceCount', e.target.value)} /></div>
            <div><label htmlFor="ws-kl">Naam van de keuze</label><input id="ws-kl" className="inp" placeholder="bv. Kleur" value={f.colorChoiceLabel} onChange={e => zet('colorChoiceLabel', e.target.value)} /></div>
          </div>
          <span className="lbl" style={{ marginTop: 6, display: 'block' }}>Enkel deze kleuren <span className="sub">(niets aangevinkt = alle kleuren)</span></span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px' }}>
            {(k?.kleuren || []).map(c => (
              <label key={c._id} className="vinkje"><input type="checkbox" checked={f.allowedColors.includes(c._id)} onChange={e => zet('allowedColors', e.target.checked ? [...f.allowedColors, c._id] : f.allowedColors.filter(x => x !== c._id))} />
                <span className="kleurstip" style={{ background: c.hex || 'transparent', display: 'inline-block', width: 12, height: 12, borderRadius: 6, border: '1px solid var(--line)' }} /> {c.label}</label>
            ))}
          </div>
        </>}
      </div>

      <div className="tabacties" style={{ marginTop: 14 }}>
        <button type="button" className="btn primary" disabled={bezig} onClick={() => push(false)}>{data.slug ? 'Bijwerken in de webshop' : 'Naar de webshop'}</button>
        <button type="button" className="btn" disabled={bezig || !vuil} onClick={opslaan}>Enkel bewaren</button>
        {data.slug && <button type="button" className="btn ghost" disabled={bezig} onClick={los}>Loskoppelen</button>}
      </div>
    </div>
  );
}
