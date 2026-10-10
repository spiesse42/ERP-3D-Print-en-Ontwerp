import { useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import Icoon from '../../schil/Icoon.jsx';

// Artikels importeren uit een map (10-10), bv. een Patreon-download van
// patreon-dl: elke post staat in een eigen map "<id> - <titel>" met foto's en
// bijlagen. Per post → één artikel (zelf geprint) in de gekozen categorie, met
// één foto (de grootste) en de modelbestanden (3mf/stl) als bijlage. Een
// artikel met dezelfde naam wordt overgeslagen. "Wordt verkocht" staat aan,
// zonder prijs (sinds 10-10 niet meer verplicht; invullen in de lijst).
const IS_FOTO = /\.(jpe?g|png|webp)$/i;
const IS_MODEL = /\.(3mf|stl)$/i;
const MAX_FOTO = 20 * 1024 * 1024;
const MAX_MODEL = 200 * 1024 * 1024;
const norm = s => String(s || '').trim().toLowerCase();

// Bestanden groeperen per post-map: het padsegment "<cijfers> - <titel>",
// anders de map waar het bestand in staat.
function groepeer(bestanden) {
  const posts = new Map();
  for (const f of bestanden) {
    const delen = (f.webkitRelativePath || f.name).split('/');
    const i = delen.findIndex(d => /^\d+ - .+/.test(d));
    const sleutel = i >= 0 ? delen.slice(0, i + 1).join('/') : delen.slice(0, -1).join('/');
    const naam = i >= 0 ? delen[i].replace(/^\d+ - /, '') : delen[delen.length - 2] || f.name;
    if (/thumb|post_info|campaign_info/i.test(delen.slice(i + 1).join('/'))) continue;
    if (!posts.has(sleutel)) posts.set(sleutel, { sleutel, naam: naam.trim(), fotos: [], modellen: [] });
    const p = posts.get(sleutel);
    if (IS_FOTO.test(f.name) && f.size <= MAX_FOTO) p.fotos.push(f);
    else if (IS_MODEL.test(f.name) && f.size <= MAX_MODEL) p.modellen.push(f);
  }
  return [...posts.values()].filter(p => p.fotos.length || p.modellen.length)
    .map(p => ({ ...p, foto: p.fotos.sort((a, b) => b.size - a.size)[0] || null }))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
}

export default function MapImport({ onSluit, onKlaar }) {
  const { melding } = useOmgeving();
  const { data: categorieen } = useData('/voorraad/categorieen');
  const { data: artikelen } = useData('/voorraad/artikelen');
  const [posts, setPosts] = useState(null);
  const [mee, setMee] = useState({});
  const [categorie, setCategorie] = useState('');
  const [nieuweCat, setNieuweCat] = useState('Layer & Leaf');
  const [bron, setBron] = useState('Ontwerp: Layer And Leaf (Patreon, commerciële licentie zolang het lidmaatschap loopt)');
  const [bezig, setBezig] = useState(null);

  const bestaand = useMemo(() => new Set((artikelen || []).map(a => norm(a.naam))), [artikelen]);
  function kies(lijst) {
    const g = groepeer([...lijst]);
    setPosts(g);
    setMee(Object.fromEntries(g.map(p => [p.sleutel, !bestaand.has(norm(p.naam))])));
    if (!g.length) melding('Geen foto\'s of modelbestanden (3mf, stl) gevonden in deze map.', 'fout');
  }
  const gekozen = (posts || []).filter(p => mee[p.sleutel]);

  async function importeer() {
    let catId = categorie;
    try {
      if (catId === '__nieuw__') {
        catId = (await api.post('/voorraad/categorieen', { naam: nieuweCat.trim() })).id;
      }
    } catch (e) { melding(e.message, 'fout'); return; }
    let ok = 0, fouten = 0, eerste = null;
    for (const [i, p] of gekozen.entries()) {
      setBezig(`${i + 1} / ${gekozen.length}: ${p.naam}`);
      try {
        const { id } = await api.post('/voorraad/artikelen', { type: 'artikel', naam: p.naam, categorie_id: catId || null,
          zelf_geprint: true, wordt_verkocht: true, notities: bron.trim() || null });
        for (const f of [p.foto, ...p.modellen].filter(Boolean)) {
          const fd = new FormData();
          fd.append('bestand', f);
          try { await api.upload(`/bijlagen/artikel/${id}`, fd); } catch (e) { fouten++; eerste ??= `${f.name}: ${e.message}`; }
        }
        ok++;
      } catch (e) { fouten++; eerste ??= `${p.naam}: ${e.message}`; }
    }
    setBezig(null);
    melding(`${ok} artikel${ok === 1 ? '' : 's'} aangemaakt${fouten ? ` · ${fouten} fout${fouten === 1 ? '' : 'en'}, bv. ${eerste}` : ''}.`, fouten ? 'fout' : undefined);
    onKlaar?.();
  }

  return (
    <Dialoog titel="Artikels importeren uit een map" breed onSluit={bezig ? () => {} : onSluit}
      voet={posts && <>
        <button type="button" className="btn" disabled={!!bezig} onClick={onSluit}>Terug</button>
        <button type="button" className="btn primary" disabled={!!bezig || !gekozen.length || (categorie === '__nieuw__' && !nieuweCat.trim())} onClick={importeer}>
          {bezig ? 'Bezig…' : `${gekozen.length} artikel${gekozen.length === 1 ? '' : 's'} aanmaken`}
        </button>
      </>}>
      {!posts ? <>
        <label htmlFor="map-import" className="dropzone">
          <Icoon naam="plus" maat={28} />
          <b>Kies de map met de downloads</b>
          <span className="sub">bv. Catalogus\LayerLeaf — elke submap "&lt;nummer&gt; - &lt;titel&gt;" wordt één artikel</span>
        </label>
        <input id="map-import" type="file" className="sr-only" webkitdirectory="" directory="" multiple onChange={e => kies(e.target.files || [])} />
        <p className="note">Per artikel: de naam van de post, één foto (de grootste) en de modelbestanden (.3mf, .stl). ZIP-bestanden worden niet meegenomen: pak die eerst uit als je de modellen erin wilt. De bestanden worden naar het ERP gekopieerd; je browser vraagt eerst toestemming om de map te lezen.</p>
      </> : <>
        <div className="fgrid">
          <div><label htmlFor="mi-cat">Categorie</label>
            <select id="mi-cat" className="inp" value={categorie} onChange={e => setCategorie(e.target.value)}>
              <option value="">— geen —</option>
              <option value="__nieuw__">+ Nieuwe categorie…</option>
              {(categorieen || []).map(c => <option key={c.id} value={c.id}>{c.pad}</option>)}
            </select></div>
          {categorie === '__nieuw__' && <div><label htmlFor="mi-nieuw">Naam nieuwe categorie</label><input id="mi-nieuw" className="inp" value={nieuweCat} onChange={e => setNieuweCat(e.target.value)} /></div>}
        </div>
        <label htmlFor="mi-bron" style={{ marginTop: 8, display: 'block' }}>Notitie bij elk artikel (bron / licentie)</label>
        <input id="mi-bron" className="inp" value={bron} onChange={e => setBron(e.target.value)} />
        <p className="sub" style={{ margin: '10px 0 6px' }}>{posts.length} posts gevonden · {gekozen.length} aangevinkt. Al bestaande namen staan uit.
          {' '}<button type="button" className="linkish" onClick={() => setMee(Object.fromEntries(posts.map(p => [p.sleutel, true])))}>alles</button>
          {' · '}<button type="button" className="linkish" onClick={() => setMee({})}>niets</button></p>
        <div className="tabelvak" style={{ maxHeight: 360, overflow: 'auto' }}>
          <table className="mini">
            <thead><tr><th /><th>Naam</th><th className="r">Foto</th><th className="r">Modellen</th></tr></thead>
            <tbody>{posts.map(p => (
              <tr key={p.sleutel}>
                <td><input type="checkbox" aria-label={`${p.naam} importeren`} checked={!!mee[p.sleutel]} disabled={!!bezig} onChange={e => setMee(m => ({ ...m, [p.sleutel]: e.target.checked }))} /></td>
                <td>{p.naam}{bestaand.has(norm(p.naam)) && <span className="badge b-neutral" style={{ marginLeft: 6 }}>bestaat al</span>}</td>
                <td className="r num">{p.foto ? '1' : '—'}</td>
                <td className="r num" title={p.modellen.map(f => f.name).join('\n')}>{p.modellen.length || '—'}</td>
              </tr>))}</tbody>
          </table>
        </div>
        {bezig && <p className="sub">Bezig: {bezig}</p>}
      </>}
    </Dialoog>
  );
}
