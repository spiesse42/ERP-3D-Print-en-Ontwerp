// ═══════════════════════════════════════════════════════════════════════
// Webshop-producten uit Sanity (06-10)
// ═══════════════════════════════════════════════════════════════════════
// De webshop (repo 3dprintenontwerp-webshop) bewaart zijn producten in
// Sanity, in een PUBLIEK leesbare dataset: geen token nodig. Het ERP leest
// enkel (gepubliceerde producten, geen concepten) en schrijft nooit terug.
// Project en dataset zijn geen geheimen; aanpasbaar met SANITY_PROJECT /
// SANITY_DATASET.
export class WebshopFout extends Error {}

const project = () => process.env.SANITY_PROJECT || 'o0bi0oux';
const dataset = () => process.env.SANITY_DATASET || 'production';

export const PRODUCTEN_QUERY = `*[_type == "product" && !(_id in path("drafts.**"))] | order(name asc) {
  _id, name, "slug": slug.current, price, priceFrom, "categorie": coalesce(category->name, category), "hoofdcategorie": category->parent->name,
  "foto": image.asset->url, weightGrams, sizeVariants[]{ label, price, weightGrams },
  customOrder, hasLetterOrderForm, orderHref, hidden, comingSoon
}`;

export async function haalProducten({ fetchFn = fetch } = {}) {
  // SANITY_API: andere basis-URL (enkel om te testen)
  const basis = process.env.SANITY_API || `https://${project()}.apicdn.sanity.io`;
  const url = `${basis}/v2024-01-01/data/query/${dataset()}?query=${encodeURIComponent(PRODUCTEN_QUERY)}`;
  let res;
  try { res = await fetchFn(url, { signal: AbortSignal.timeout(20000) }); }
  catch (e) { throw new WebshopFout(`De webshop (Sanity) is niet bereikbaar: ${e.message}`); }
  if (!res.ok) throw new WebshopFout(`De webshop (Sanity) gaf een fout (${res.status}). Is de dataset nog publiek leesbaar?`);
  const j = await res.json();
  if (!Array.isArray(j?.result)) throw new WebshopFout('Onverwacht antwoord van de webshop (Sanity).');
  return j.result;
}

// ── Schrijven naar Sanity (11-10): het ERP beheert de webshopvelden ──────
// Vergt een token met schrijfrechten (rol Editor): add-on-optie sanity_token
// → SANITY_TOKEN. Lezen zonder CDN (verse _updatedAt), schrijven via mutate,
// foto's via de asset-API. SANITY_WRITE_API: andere basis-URL (testen).
const schrijfBasis = () => process.env.SANITY_WRITE_API || `https://${project()}.api.sanity.io`;
const API = 'v2024-01-01';
function token() {
  const t = process.env.SANITY_TOKEN;
  if (!t) throw new WebshopFout('Er is geen Sanity-token ingesteld (add-on-optie "sanity_token"): het ERP kan niet naar de webshop schrijven.');
  return t;
}
async function sanityFetch(url, opties, fetchFn) {
  let res;
  try { res = await fetchFn(url, { ...opties, signal: AbortSignal.timeout(60000) }); }
  catch (e) { throw new WebshopFout(`De webshop (Sanity) is niet bereikbaar: ${e.message}`); }
  const j = await res.json().catch(() => null);
  if (!res.ok) {
    const m = j?.error?.description || j?.message || j?.error || res.status;
    throw new WebshopFout(res.status === 401 || res.status === 403
      ? 'Sanity weigert: het token is ongeldig of heeft geen schrijfrechten (rol Editor nodig).' : `Sanity gaf een fout: ${typeof m === 'string' ? m : JSON.stringify(m)}`);
  }
  return j;
}
export async function sanityQuery(query, params = {}, { fetchFn = fetch, metToken = true } = {}) {
  const qs = new URLSearchParams({ query, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [`$${k}`, JSON.stringify(v)])) });
  const basis = metToken ? schrijfBasis() : (process.env.SANITY_API || `https://${project()}.apicdn.sanity.io`);
  const j = await sanityFetch(`${basis}/${API}/data/query/${dataset()}?${qs}`, metToken ? { headers: { Authorization: `Bearer ${token()}` } } : {}, fetchFn);
  return j?.result;
}
export async function sanityMutate(mutations, { fetchFn = fetch } = {}) {
  return sanityFetch(`${schrijfBasis()}/${API}/data/mutate/${dataset()}?returnIds=true&visibility=sync`, {
    method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ mutations }),
  }, fetchFn);
}
export async function sanityAfbeelding(buffer, mimetype, bestandsnaam, { fetchFn = fetch } = {}) {
  const j = await sanityFetch(`${schrijfBasis()}/${API}/assets/images/${dataset()}?filename=${encodeURIComponent(bestandsnaam || 'foto')}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': mimetype || 'application/octet-stream' }, body: buffer,
  }, fetchFn);
  const id = j?.document?._id;
  if (!id) throw new WebshopFout('Sanity gaf geen id terug voor de foto.');
  return id;
}
