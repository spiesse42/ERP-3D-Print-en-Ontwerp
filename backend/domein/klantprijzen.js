// ═══════════════════════════════════════════════════════════════════════
// PRIJSAFSPRAKEN PER KLANT (29-10)
// ═══════════════════════════════════════════════════════════════════════
// Bv. een wederverkoper: "Bubble letter" aan € 1,75 per stuk. In een dossier
// van die klant krijgt elke printregel (product) of artikelregel met dat
// artikel automatisch die prijs × het aantal — zoals een vast eindbedrag;
// een zelf ingevuld eindbedrag gaat altijd voor. Kost en winst blijven
// berekend zoals altijd.
import { DomeinFout } from './hulp.js';

export function leesKlantPrijzen(db, klantId) {
  return db.prepare(`SELECT kp.artikel_id, kp.prijs, a.naam, a.verkoopprijs FROM klant_prijzen kp JOIN artikelen a ON a.id = kp.artikel_id
    WHERE kp.klant_id = ? ORDER BY a.naam COLLATE NOCASE`).all(Number(klantId));
}

export function bewaarKlantPrijzen(db, klantId, lijst) {
  const k = db.prepare('SELECT id FROM klanten WHERE id = ?').get(Number(klantId));
  if (!k) throw Object.assign(new DomeinFout('Klant niet gevonden'), { status: 404 });
  if (!Array.isArray(lijst)) throw new DomeinFout('Prijsafspraken moeten een lijst zijn');
  const gezien = new Set();
  const rijen = lijst.map((x, i) => {
    const artikel = Number(x?.artikel_id);
    const a = db.prepare(`SELECT id, naam, type FROM artikelen WHERE id = ?`).get(artikel);
    if (!a || a.type === 'filament') throw new DomeinFout(`Afspraak ${i + 1}: kies een artikel`);
    if (gezien.has(a.id)) throw new DomeinFout(`${a.naam} staat er twee keer in`);
    gezien.add(a.id);
    const prijs = Number(String(x?.prijs ?? '').replace(',', '.'));
    if (String(x?.prijs ?? '').trim() === '' || !Number.isFinite(prijs) || prijs < 0) throw new DomeinFout(`${a.naam}: vul een prijs vanaf 0 in`);
    return [a.id, Math.round(prijs * 10000) / 10000];
  });
  db.prepare('DELETE FROM klant_prijzen WHERE klant_id = ?').run(k.id);
  const ins = db.prepare('INSERT INTO klant_prijzen (klant_id, artikel_id, prijs) VALUES (?,?,?)');
  for (const [a, p] of rijen) ins.run(k.id, a, p);
  return leesKlantPrijzen(db, k.id);
}

// artikel_id → prijs voor die klant (lege Map zonder klant)
export function afsprakenVan(db, klantId) {
  if (!klantId) return new Map();
  return new Map(db.prepare('SELECT artikel_id, prijs FROM klant_prijzen WHERE klant_id = ?').all(Number(klantId)).map(r => [r.artikel_id, r.prijs]));
}
