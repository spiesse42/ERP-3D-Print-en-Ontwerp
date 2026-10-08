// Verrijken + berekenen: zet regels met id's (printer_id, filament, artikel_id)
// om naar wat de zuivere rekenmotor nodig heeft (prijzen, tarieven, printer).
// Eén plaats, gebruikt door POST /api/bereken en straks door dossiers (stap 5).
import { getTarieven } from './hulp.js';
import { bereken } from './rekenmotor.js';
import { kostPerKg } from '../productie/kost.js';

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

// filamentInkoop (04-10, familie & vrienden): het filament aan de INKOOPprijs
// per kg (gemiddelde van de rollen in voorraad, anders de laatste aankoop —
// dezelfde prijs als de productiekost) i.p.v. de verkoopprijs van de prijsgroep.
export function verrijk(db, regels, { filamentInkoop = false } = {}) {
  const q = sql(db);
  return (Array.isArray(regels) ? regels : []).map(r => {
    if (r?.type === 'printen') {
      const printer = r.printer_id ? q.printer.get(r.printer_id) ?? null : null;
      const materialen = (Array.isArray(r.materialen) ? r.materialen : []).map(m => {
        const pg = prijsgroep(db, m);
        if (filamentInkoop) {
          const kg = pg ? kostPerKg(db, m) : null;
          return { ...m, naam: pg?.naam ?? m.naam ?? null, prijs_per_kg: kg == null ? null : Math.round(kg * 100) / 100, prijs_bron: 'inkoop' };
        }
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
export function berekenMetDb(db, regels, { tarieven = null, filamentInkoop = false, ...opties } = {}) {
  const uit = bereken(verrijk(db, regels, { filamentInkoop }), tarieven || getTarieven(db), opties);
  voegKostToe(db, uit, regels);
  return uit;
}

// ── PRODUCTIEKOST per printregel (08-10, intern) ─────────────────────────
// Wat de print JOU kost: filament aan inkoopprijs (zonder faalfactor, zoals
// de gemeten productiekost), energie, machine en BMCU uit de rekenmotor
// (die rekenen zonder marge). Arbeid apart. Winst = eindbedrag − kost.
function voegKostToe(db, uit, regels) {
  const r4 = v => Math.round(v * 10000) / 10000;
  let kost = 0, arbeid = 0, bedrag = 0, onvolledig = false, n = 0;
  uit.regels.forEach((r, i) => {
    const b = r._berekend;
    if (r.type !== 'printen' || !b || b.fout || !b.detail) return;
    const ontbreekt = [];
    let filament = 0;
    for (const m of regels[i]?.materialen || []) {
      const gram = Number(String(m.gram ?? '').replace(',', '.')) || 0;
      if (!gram || !(m.artikel_id || m.filament_type_id)) continue;
      const kg = kostPerKg(db, m);
      if (kg == null) ontbreekt.push('inkoopprijs filament'); else filament += gram / 1000 * kg;
    }
    const d = b.detail;
    const k = filament + d.energie + d.machine + d.bmcu;
    const a = Number(String(r.aantal ?? 1).replace(',', '.')) || 1;
    b.kost = { filament: r4(filament), energie: r4(d.energie), machine: r4(d.machine), bmcu: r4(d.bmcu), kost: r4(k), arbeid: r4(d.arbeid),
      per_stuk: r4(k / a), winst: r4(b.eindbedrag - k), winst_na_arbeid: r4(b.eindbedrag - k - d.arbeid),
      onvolledig: ontbreekt.length > 0, ontbreekt };
    kost += k; arbeid += d.arbeid; bedrag += b.eindbedrag; onvolledig ||= ontbreekt.length > 0; n++;
  });
  uit.productiekost = n ? { kost: r4(kost), arbeid: r4(arbeid), bedrag: r4(bedrag), winst: r4(bedrag - kost), winst_na_arbeid: r4(bedrag - kost - arbeid), onvolledig } : null;
}
