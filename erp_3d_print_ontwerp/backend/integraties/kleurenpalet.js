// Kleurenpalet van de webshop (Sanity): label/slug → { label, hex,
// filamentName }. 10 min in het geheugen; niet bereikbaar = lege kaart,
// nooit een fout. Gebruikt door de webshopbestellingen (filament bij de
// gekozen kleur) en de letterbestellingen (29-10).
import { sanityQuery } from './sanity.js';

let cache = { t: 0, map: null };
export async function kleurenPalet() {
  if (cache.map && Date.now() - cache.t < 10 * 60000) return cache.map;
  try {
    const lijst = await sanityQuery('*[_type == "color" && !(_id in path("drafts.**"))]{ label, "slug": slug.current, hex, filamentName }', {}, { metToken: false }) || [];
    const map = new Map();
    for (const c of lijst) for (const k of [c.label, c.slug]) if (k) map.set(String(k).trim().toLowerCase(), c);
    cache = { t: Date.now(), map };
  } catch { /* webshop niet bereikbaar */ }
  return cache.map || new Map();
}
