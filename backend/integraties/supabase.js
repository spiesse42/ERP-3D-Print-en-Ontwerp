// Betaalde bestellingen uit de webshop (Supabase, tabel orders) — enkel lezen
// via de REST-API. SUPABASE_URL + SUPABASE_KEY (service-role-sleutel van de
// webshop) uit de add-on-configuratie.
export class SupabaseFout extends Error {}

export const supabaseIngesteld = () => !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);

export async function haalBetaaldeBestellingen({ fetchFn = fetch, sinds = null } = {}) {
  if (!supabaseIngesteld()) throw new SupabaseFout('De webshop is nog niet gekoppeld: vul supabase_url en supabase_key in bij de add-on-configuratie.');
  const basis = process.env.SUPABASE_URL.replace(/\/+$/, '');
  const q = `status=eq.paid&order=created_at.desc&limit=200${sinds ? `&created_at=gte.${encodeURIComponent(sinds)}` : ''}`;
  let res;
  try {
    res = await fetchFn(`${basis}/rest/v1/orders?select=*&${q}`, {
      headers: { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` },
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) { throw new SupabaseFout(`De webshop (Supabase) is niet bereikbaar: ${e.message}`); }
  if (!res.ok) throw new SupabaseFout(`De webshop (Supabase) gaf een fout (${res.status}). Klopt de supabase_key?`);
  return res.json();
}
