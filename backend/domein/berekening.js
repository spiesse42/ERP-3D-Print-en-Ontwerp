// Verrijken + berekenen: zet regels met id's (printer_id, filament, artikel_id)
// om naar wat de zuivere rekenmotor nodig heeft (prijzen, tarieven, printer).
// Eén plaats, gebruikt door POST /api/bereken en straks door dossiers (stap 5).
import { getTarieven } from './hulp.js';
import { bereken } from './rekenmotor.js';

// Voorbereide opdrachten per databank hergebruiken (29-09): de dossierlijst
// rekent elk dossier door; opnieuw voorbereiden per regel kostte het meest.
const cache = new WeakMap();
function sql(db) {
  let s = cache.get(db);
  if (!s) {
    s = {
      filament: db.prepare(`SELECT ft.id, m.naam || ' ' || mat.naam || ' · ' || k.naam AS naam, ft.verkoopprijs_per_kg
        FROM artikelen a JOIN filament_types ft ON ft.id = a.filament_type_id
        JOIN filament_merken m ON m.id = ft.merk_id JOIN filament_materialen mat ON mat.id = ft.materiaal_id
        JOIN filament_kleuren k ON k.id = a.kleur_id WHERE a.id = ? AND a.type = 'filament'`),
      groep: db.prepare(`SELECT ft.id, m.naam || ' ' || mat.naam AS naam, ft.verkoopprijs_per_kg FROM filament_types ft
        JOIN filament_merken m ON m.id = ft.merk_id JOIN filament_materialen mat ON mat.id = ft.materiaal_id WHERE ft.id = ?`),
      printer: db.prepare('SELECT id, naam, machine_per_uur, verbruik_watt, actief FROM printers WHERE id = ?'),
      artikel: db.prepare('SELECT id, type, naam, verkoopprijs, wordt_verkocht, vaste_prijs FROM artikelen WHERE id = ?'),
    };
    cache.set(db, s);
  }
  return s;
}

function prijsgroep(db, { filament_type_id, artikel_id }) {
  if (artikel_id) return sql(db).filament.get(artikel_id);
  if (filament_type_id) return sql(db).groep.get(filament_type_id);
  return null;
}

export function verrijk(db, regels) {
  const q = sql(db);
  return (Array.isArray(regels) ? regels : []).map(r => {
    if (r?.type === 'printen') {
      const printer = r.printer_id ? q.printer.get(r.printer_id) ?? null : null;
      const materialen = (Array.isArray(r.materialen) ? r.materialen : []).map(m => {
        const pg = prijsgroep(db, m);
        return { ...m, naam: pg?.naam ?? m.naam ?? null, prijs_per_kg: pg ? pg.verkoopprijs_per_kg : null };
      });
      return { ...r, printer, materialen };
    }
    if (r?.type === 'artikel') {
      const a = r.artikel_id ? q.artikel.get(r.artikel_id) : null;
      if (!a || a.type === 'filament' || !a.wordt_verkocht) return { ...r, naam: a?.naam ?? r.naam, prijs: null, vaste_prijs: false };
      return { ...r, naam: a.naam, prijs: a.verkoopprijs, vaste_prijs: !!a.vaste_prijs };
    }
    return r;
  });
}

// opties.tarieven: al opgehaald (de dossierlijst haalt ze één keer op)
export function berekenMetDb(db, regels, { tarieven = null, ...opties } = {}) {
  return bereken(verrijk(db, regels), tarieven || getTarieven(db), opties);
}
