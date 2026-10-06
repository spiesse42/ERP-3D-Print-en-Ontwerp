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
  _id, name, "slug": slug.current, price, priceFrom, "categorie": coalesce(category->name, category),
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
