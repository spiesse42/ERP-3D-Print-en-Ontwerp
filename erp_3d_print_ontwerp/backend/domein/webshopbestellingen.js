// ═══════════════════════════════════════════════════════════════════════
// WEBSHOPBESTELLINGEN (07-10)
// ═══════════════════════════════════════════════════════════════════════
// Het ERP haalt de betaalde bestellingen op uit de webshop (Supabase) en
// bewaart ze hier. Per regel: het gekoppelde artikel (webshop_slug +
// maatvariant), de voorraad en de gekozen kleur(en). Een verkoop maken met
// de bestelling erbij zet ze op afgehandeld.
import { DomeinFout } from './hulp.js';

const getal = v => (v == null ? 0 : Number(v) || 0);

export function bewaarBestellingen(db, orders) {
  const bestaand = db.prepare('SELECT 1 FROM webshop_bestellingen WHERE id = ?');
  const ins = db.prepare(`INSERT INTO webshop_bestellingen (id, besteld_op, status, klant_naam, email, telefoon, adres, opmerking, items, totaal, verzending, verzendkost, tracking_url)
    VALUES (@id, @besteld_op, @status, @klant_naam, @email, @telefoon, @adres, @opmerking, @items, @totaal, @verzending, @verzendkost, @tracking_url)`);
  const upd = db.prepare('UPDATE webshop_bestellingen SET status = @status, tracking_url = @tracking_url WHERE id = @id');
  let nieuw = 0;
  for (const o of orders || []) {
    if (!o?.id) continue;
    const r = {
      id: String(o.id), besteld_op: o.created_at || new Date().toISOString(), status: o.status || 'paid',
      klant_naam: o.customer_name || null, email: o.customer_email || null, telefoon: o.customer_phone || null,
      adres: [o.street, o.postal_city, o.country].filter(Boolean).join(', ') || null,
      opmerking: [o.notes, o.pickup_location_note].filter(Boolean).join(' · ') || null,
      items: JSON.stringify(Array.isArray(o.items) ? o.items : []),
      totaal: getal(o.total), verzending: o.shipping_method_label || null, verzendkost: getal(o.shipping_price),
      tracking_url: o.sendcloud_tracking_url || null,
    };
    if (bestaand.get(r.id)) upd.run(r); else { ins.run(r); nieuw++; }
  }
  return nieuw;
}

const ART = `SELECT a.id, a.naam, a.verkoopprijs,
  (SELECT COALESCE(SUM(aantal_resterend), 0) FROM voorraad_partijen p WHERE p.artikel_id = a.id) AS voorraad
  FROM artikelen a WHERE a.webshop_slug = ? AND COALESCE(a.webshop_variant, '') = ?`;

export function leesBestellingen(db, { alles = false } = {}) {
  const art = db.prepare(ART);
  const rijen = db.prepare(`SELECT b.*, v.nummer AS verkoop_nummer, v.id AS verkoop_id FROM webshop_bestellingen b
    LEFT JOIN verkopen v ON v.webshop_bestelling = b.id AND v.geannuleerd_op IS NULL
    ${alles ? '' : `WHERE b.afgehandeld_op IS NULL OR b.besteld_op >= date('now', '-30 days')`}
    ORDER BY b.besteld_op DESC`).all();
  return rijen.map(b => {
    const items = JSON.parse(b.items || '[]').map(i => {
      const a = art.get(i.slug, i.variantLabel ?? '') || null;
      return { slug: i.slug, naam: i.name, aantal: i.quantity, prijs: i.price, variant: i.variantLabel ?? null,
        kleuren: i.colors || (i.color ? [i.color] : []), artikel: a };
    });
    const klant = b.email ? db.prepare('SELECT id FROM klanten WHERE lower(email) = lower(?) LIMIT 1').get(b.email) : null;
    return { ...b, items, klant_id: klant?.id ?? null, afgehandeld: !!b.afgehandeld_op };
  });
}

export function zetAfgehandeld(db, id, aan) {
  const b = db.prepare('SELECT id FROM webshop_bestellingen WHERE id = ?').get(String(id));
  if (!b) throw Object.assign(new DomeinFout('Bestelling niet gevonden'), { status: 404 });
  db.prepare('UPDATE webshop_bestellingen SET afgehandeld_op = ? WHERE id = ?').run(aan ? new Date().toISOString() : null, b.id);
}
