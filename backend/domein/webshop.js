// ═══════════════════════════════════════════════════════════════════════
// WEBSHOPPRODUCTEN IN HET ERP (06-10)
// ═══════════════════════════════════════════════════════════════════════
// Per webshopproduct (en per maatvariant) één artikel "Printen we zelf".
// Koppelsleutel: slug + label van de maatvariant (de webshop kent geen
// kleurvarianten; de kleur kan per bestelling wijzigen → printprofiel met
// een prijsgroep, de kleur kies je bij het printen).
// Taakverdeling: de WEBSHOP (Sanity) is de bron voor naam, prijs, foto en
// categorie; het ERP voor printprofiel, onderdelen, voorraad en kost.
// Ophalen = vergelijken; overnemen = nieuw aanmaken, of bestaand bijwerken
// (naam, prijs, foto, gewicht). Een artikel met dezelfde naam dat nog niet
// gekoppeld is, wordt gekoppeld in plaats van dubbel aangemaakt.
import { DomeinFout } from './hulp.js';
import { maakArtikel } from './artikelen.js';
import { logGebeurtenis } from './historiek.js';

const r2 = v => (v == null ? null : Math.round(Number(v) * 100) / 100);
export const sleutel = (slug, variant) => `${slug}|${variant ?? ''}`;

// Sanity-producten → één rij per verkoopbaar ding (product of maatvariant)
export function webshopRijen(producten) {
  const uit = [];
  for (const p of producten || []) {
    if (!p?.slug || !p?.name) continue;
    const basis = { slug: p.slug, product: p.name, categorie: p.categorie || null, foto: p.foto || null,
      maatwerk: !!(p.customOrder || p.hasLetterOrderForm || p.orderHref), verborgen: !!p.hidden, binnenkort: !!p.comingSoon, vanaf: !!p.priceFrom };
    const varianten = (p.sizeVariants || []).filter(v => v?.label);
    if (varianten.length) {
      for (const v of varianten) uit.push({ ...basis, variant: v.label, naam: `${p.name} – ${v.label}`, prijs: r2(v.price), gewicht_g: v.weightGrams ?? null });
    } else {
      uit.push({ ...basis, variant: null, naam: p.name, prijs: r2(p.price), gewicht_g: p.weightGrams ?? null });
    }
  }
  return uit.map(x => ({ ...x, sleutel: sleutel(x.slug, x.variant) }));
}

const ART = `SELECT id, naam, type, zelf_geprint, wordt_verkocht, verkoopprijs, gearchiveerd, webshop_slug, webshop_variant, webshop_foto, webshop_gewicht_g FROM artikelen`;

// Vergelijking webshop ↔ ERP: status per rij + gekoppelde artikelen die niet meer in de webshop staan
export function vergelijk(db, rijen) {
  const gekoppeld = new Map(db.prepare(`${ART} WHERE webshop_slug IS NOT NULL`).all().map(a => [sleutel(a.webshop_slug, a.webshop_variant), a]));
  const opNaam = db.prepare(`${ART} WHERE type <> 'filament' AND naam = ? COLLATE NOCASE`);
  const lijst = rijen.map(r => {
    const a = gekoppeld.get(r.sleutel);
    if (a) {
      const verschil = [];
      if (a.naam !== r.naam) verschil.push(`naam: ${a.naam} → ${r.naam}`);
      if (r.prijs != null && r2(a.verkoopprijs) !== r.prijs) verschil.push(`prijs: ${a.verkoopprijs ?? '—'} → ${r.prijs}`);
      if ((a.webshop_foto || null) !== r.foto) verschil.push('foto');
      return { ...r, artikel: { id: a.id, naam: a.naam, verkoopprijs: a.verkoopprijs, gearchiveerd: !!a.gearchiveerd }, status: verschil.length ? 'gewijzigd' : 'gekoppeld', verschil };
    }
    const n = opNaam.get(r.naam);
    if (n && !n.webshop_slug) return { ...r, artikel: { id: n.id, naam: n.naam, verkoopprijs: n.verkoopprijs, gearchiveerd: !!n.gearchiveerd }, status: 'zelfde_naam', verschil: [] };
    return { ...r, artikel: null, status: 'nieuw', verschil: [] };
  });
  const inWebshop = new Set(rijen.map(r => r.sleutel));
  const weg = [...gekoppeld.entries()].filter(([k]) => !inWebshop.has(k)).map(([, a]) => ({ id: a.id, naam: a.naam, gearchiveerd: !!a.gearchiveerd }));
  return { producten: lijst, weg };
}

function categorieVoor(db, naam) {
  if (!naam) return null;
  const vind = (n, ouder) => db.prepare('SELECT id FROM categorieen WHERE naam = ? COLLATE NOCASE AND COALESCE(ouder_id, 0) = ?').get(n, ouder ?? 0)?.id;
  let top = vind('Webshop', null);
  if (!top) top = Number(db.prepare('INSERT INTO categorieen (naam, ouder_id) VALUES (?, NULL)').run('Webshop').lastInsertRowid);
  return vind(naam, top) ?? Number(db.prepare('INSERT INTO categorieen (naam, ouder_id) VALUES (?, ?)').run(naam, top).lastInsertRowid);
}

// Overnemen: keuzes = lijst van sleutels (slug|variant). Geeft per rij wat er gebeurde.
export function neemOver(db, rijen, keuzes) {
  const gekozen = new Set(keuzes || []);
  if (!gekozen.size) throw new DomeinFout('Kies minstens één product.');
  const { producten } = vergelijk(db, rijen);
  const uit = [];
  for (const r of producten.filter(x => gekozen.has(x.sleutel))) {
    const velden = { webshop_slug: r.slug, webshop_variant: r.variant, webshop_foto: r.foto, webshop_gewicht_g: r.gewicht_g };
    const zetWebshop = id => db.prepare(`UPDATE artikelen SET webshop_slug = ?, webshop_variant = ?, webshop_foto = ?, webshop_gewicht_g = ?, webshop_bijgewerkt_op = datetime('now') WHERE id = ?`)
      .run(velden.webshop_slug, velden.webshop_variant, velden.webshop_foto, velden.webshop_gewicht_g, id);
    if (r.status === 'nieuw') {
      const id = maakArtikel(db, { type: 'artikel', wordt_gekocht: 0, wordt_verkocht: 1, zelf_geprint: 1, categorie_id: categorieVoor(db, r.categorie), naam: r.naam,
        filament_type_id: null, kleur_id: null, eenheid: 'stuks', verkoopprijs: r.prijs ?? 0, inkoopprijs: null, marge_pct: null, productieprijs: null, vaste_prijs: 0,
        min_voorraad: null, max_voorraad: null, locatie: null, notities: null }, `Overgenomen uit de webshop (${r.slug}${r.variant ? `, ${r.variant}` : ''})`);
      zetWebshop(id);
      uit.push({ sleutel: r.sleutel, artikel_id: id, actie: 'aangemaakt' });
      continue;
    }
    const a = db.prepare('SELECT * FROM artikelen WHERE id = ?').get(r.artikel.id);
    if (a.type !== 'artikel') { uit.push({ sleutel: r.sleutel, artikel_id: a.id, actie: 'overgeslagen', reden: `"${a.naam}" is een dienst, geen artikel` }); continue; }
    const wijz = [];
    if (a.naam !== r.naam) {
      const bezet = db.prepare(`SELECT id FROM artikelen WHERE type <> 'filament' AND naam = ? COLLATE NOCASE AND id <> ?`).get(r.naam, a.id);
      if (bezet) wijz.push(`naam niet aangepast ("${r.naam}" bestaat al)`);
      else { db.prepare('UPDATE artikelen SET naam = ? WHERE id = ?').run(r.naam, a.id); wijz.push(`naam → ${r.naam}`); }
    }
    if (r.prijs != null && r2(a.verkoopprijs) !== r.prijs) { db.prepare('UPDATE artikelen SET verkoopprijs = ? WHERE id = ?').run(r.prijs, a.id); wijz.push(`verkoopprijs → € ${String(r.prijs.toFixed(2)).replace('.', ',')}`); }
    if (!a.zelf_geprint || !a.wordt_verkocht) { db.prepare('UPDATE artikelen SET zelf_geprint = 1, wordt_verkocht = 1 WHERE id = ?').run(a.id); wijz.push('printen we zelf + verkocht'); }
    if (!a.categorie_id && r.categorie) db.prepare('UPDATE artikelen SET categorie_id = ? WHERE id = ?').run(categorieVoor(db, r.categorie), a.id);
    zetWebshop(a.id);
    const tekst = r.status === 'zelfde_naam' ? `Gekoppeld aan de webshop (${r.slug}${r.variant ? `, ${r.variant}` : ''})${wijz.length ? `: ${wijz.join(', ')}` : ''}`
      : `Bijgewerkt uit de webshop${wijz.length ? `: ${wijz.join(', ')}` : ''}`;
    logGebeurtenis(db, 'artikel', a.id, 'gewijzigd', tekst);
    uit.push({ sleutel: r.sleutel, artikel_id: a.id, actie: r.status === 'zelfde_naam' ? 'gekoppeld' : 'bijgewerkt' });
  }
  return uit;
}

// Koppeling met de webshop verbreken (bv. product weg uit de webshop)
export function ontkoppel(db, artikelId) {
  const a = db.prepare('SELECT id, webshop_slug FROM artikelen WHERE id = ?').get(Number(artikelId));
  if (!a) throw Object.assign(new DomeinFout('Artikel niet gevonden'), { status: 404 });
  db.prepare('UPDATE artikelen SET webshop_slug = NULL, webshop_variant = NULL, webshop_foto = NULL, webshop_gewicht_g = NULL, webshop_bijgewerkt_op = NULL WHERE id = ?').run(a.id);
  logGebeurtenis(db, 'artikel', a.id, 'gewijzigd', `Losgekoppeld van de webshop (${a.webshop_slug})`);
}
