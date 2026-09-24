// v6 — Inkoopprijs/marge% (onderdeel) en productieprijs (eindproduct) op
// artikel_types (2026-09-22, vervolg op db_migration_v5.js).
//
// Prijsmodel per categorie, bevestigd door de gebruiker:
// - 'onderdeel'    → inkoopprijs (verplicht) + marge_pct (verplicht, per
//                    artikel individueel instelbaar) geven een VOORSTEL voor
//                    de verkoopprijs (inkoopprijs × (1 + marge_pct/100)) —
//                    de frontend rekent dit voor en vult verkoopprijs
//                    automatisch in, maar de gebruiker kan dat bedrag nadien
//                    nog zelf overschrijven/afronden (verkoopprijs blijft
//                    dus het veld dat écht opgeslagen/gebruikt wordt).
// - 'eindproduct'  → enkel verkoopprijs (zelf bepaald, geen kost+marge-
//                    berekening — zelfde filosofie als filament sinds
//                    deel 20). productieprijs is optioneel en zuiver
//                    informatief, geen rekenkundige koppeling met de
//                    verkoopprijs.
// - 'dienst'       → ongewijzigd, enkel verkoopprijs (+ evt. vaste_prijs).
//
// Alle 3 nieuwe kolommen zijn nullable — enkel relevant/ingevuld voor de
// categorie waar ze bij horen (zie routes/artikelen.js). Gewone ADD COLUMNs,
// geen tabelherbouw nodig (in tegenstelling tot v5, dat een CHECK-constraint
// moest verruimen).
export function migrateDbV6(db) {
  const kolommen = db.prepare(`PRAGMA table_info(artikel_types)`).all().map(k => k.name);
  if (!kolommen.includes('inkoopprijs')) {
    db.exec(`ALTER TABLE artikel_types ADD COLUMN inkoopprijs REAL`);
  }
  if (!kolommen.includes('marge_pct')) {
    db.exec(`ALTER TABLE artikel_types ADD COLUMN marge_pct REAL`);
  }
  if (!kolommen.includes('productieprijs')) {
    db.exec(`ALTER TABLE artikel_types ADD COLUMN productieprijs REAL`);
  }
}
