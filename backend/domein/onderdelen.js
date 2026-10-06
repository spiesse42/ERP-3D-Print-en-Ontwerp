// ═══════════════════════════════════════════════════════════════════════
// ONDERDELEN PER STUK (06-10)
// ═══════════════════════════════════════════════════════════════════════
// Bij een (zelf geprint) product: wat er per verkocht stuk bij hoort, bv. een
// sleutelring of een zakje. Afgeboekt bij de VERKOOP (sleutelhangers worden
// pas bij een bestelling in elkaar gezet), aan de reden "levering" en aan de
// verkoopregel — zo telt het mee in de kost van de verkoop en gaat het bij
// "ongedaan maken" vanzelf terug. Is er te weinig, dan wordt afgeboekt wat er
// is en komt er een melding (de verkoop gaat wel door).
import { DomeinFout } from './hulp.js';
import { boekUit, voorraadVan } from './voorraad.js';
import { weergaveNaam } from './artikelen.js';

const NAAM = `SELECT a.*, fm.naam AS merk, fmat.naam AS materiaal, k.naam AS kleur FROM artikelen a
  LEFT JOIN filament_types ft ON ft.id = a.filament_type_id LEFT JOIN filament_merken fm ON fm.id = ft.merk_id
  LEFT JOIN filament_materialen fmat ON fmat.id = ft.materiaal_id LEFT JOIN filament_kleuren k ON k.id = a.kleur_id WHERE a.id = ?`;

export function leesOnderdelen(db, artikelId) {
  return db.prepare(`SELECT o.onderdeel_id, o.aantal FROM artikel_onderdelen o WHERE o.artikel_id = ? ORDER BY o.volgorde, o.onderdeel_id`).all(Number(artikelId))
    .map(o => {
      const a = db.prepare(NAAM).get(o.onderdeel_id);
      const prijs = db.prepare(`SELECT prijs_per_eenheid p FROM voorraad_partijen WHERE artikel_id = ? AND prijs_per_eenheid IS NOT NULL ORDER BY ontvangen_op DESC, id DESC LIMIT 1`).get(o.onderdeel_id)?.p ?? a?.inkoopprijs ?? null;
      return { ...o, naam: a ? weergaveNaam(a) : '?', eenheid: a?.eenheid, voorraad: voorraadVan(db, o.onderdeel_id), prijs };
    });
}

export function bewaarOnderdelen(db, artikelId, lijst) {
  const a = db.prepare('SELECT id, type FROM artikelen WHERE id = ?').get(Number(artikelId));
  if (!a) throw Object.assign(new DomeinFout('Artikel niet gevonden'), { status: 404 });
  if (a.type !== 'artikel') throw new DomeinFout('Onderdelen horen bij een artikel.');
  if (!Array.isArray(lijst)) throw new DomeinFout('Onderdelen moeten een lijst zijn');
  const gezien = new Set();
  const rijen = lijst.map((o, i) => {
    const id = Number(o?.onderdeel_id);
    const x = db.prepare('SELECT id, type FROM artikelen WHERE id = ?').get(id);
    if (!x || x.type !== 'artikel') throw new DomeinFout(`Onderdeel ${i + 1}: kies een artikel uit de voorraad`);
    if (id === a.id) throw new DomeinFout('Een artikel kan geen onderdeel van zichzelf zijn');
    if (gezien.has(id)) throw new DomeinFout(`Onderdeel ${i + 1} staat er twee keer in`);
    gezien.add(id);
    const n = Number(String(o?.aantal ?? 1).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) throw new DomeinFout(`Onderdeel ${i + 1}: aantal moet groter dan 0 zijn`);
    return { id, n };
  });
  db.prepare('DELETE FROM artikel_onderdelen WHERE artikel_id = ?').run(a.id);
  const ins = db.prepare('INSERT INTO artikel_onderdelen (artikel_id, onderdeel_id, aantal, volgorde) VALUES (?,?,?,?)');
  rijen.forEach((r, i) => ins.run(a.id, r.id, r.n, i));
  return leesOnderdelen(db, a.id);
}

// Bij een verkochte regel: onderdelen eraf. Geeft de tekorten terug (tekst).
export function boekOnderdelenUit(db, { artikelId, aantal, regelId, notitie }) {
  const tekort = [];
  for (const o of db.prepare('SELECT onderdeel_id, aantal FROM artikel_onderdelen WHERE artikel_id = ? ORDER BY volgorde').all(artikelId)) {
    const nodig = Math.round(o.aantal * aantal * 1000) / 1000;
    const er = voorraadVan(db, o.onderdeel_id);
    const neem = Math.min(nodig, er);
    if (neem > 1e-9) boekUit(db, { artikelId: o.onderdeel_id, aantal: neem, reden: 'levering', bronType: 'verkoop_regel', bronId: regelId, notitie });
    if (nodig - neem > 1e-9) tekort.push(`${weergaveNaam(db.prepare(NAAM).get(o.onderdeel_id))} (${String(Math.round((nodig - neem) * 1000) / 1000).replace('.', ',')} te weinig in voorraad)`);
  }
  return tekort;
}
