// v3 — Voorraad-vereenvoudiging (2026-09-22): gewicht-tracking per rol
// (gewicht_gram_start/gewicht_gram_huidig) bleek na overleg nergens meer van
// nut. Tijdens productie wil je niet met grammen per rol rekenen — als een rol
// op is en je hangt een andere in, pas je dat gewoon rechtstreeks aan (de rol
// op inactief zetten). Voorraad wordt dus puur op rol-niveau bijgehouden
// (aanwezig/niet, via `actief`), zonder gewichtsdetail.
//
// Het "gewicht in gram" dat de rekenmotor gebruikt (materiaalkost = geschat
// gewicht × verkoopprijs/kg) is een losse, onafhankelijke waarde die pas bij
// het berekenen van een offerte/werkbon-prijs wordt ingevuld (Fase 2) — geen
// koppeling met de fysieke rollen hier.
//
// ALTER TABLE ... DROP COLUMN (ondersteund sinds SQLite 3.35, aanwezig in de
// better-sqlite3@13.0.3-binary) i.p.v. de tabel te vervangen, zodat bestaande
// rollen (met hun aankoopprijs/locatie/gekocht_op/actief) niet verloren gaan —
// in tegenstelling tot v2's aanpak (toen was er nog geen echte data ingevoerd).
export function migrateDbV3(db) {
  const kolommen = db.prepare(`PRAGMA table_info(filament_rollen)`).all().map(k => k.name);
  if (kolommen.includes('gewicht_gram_start')) {
    db.exec(`ALTER TABLE filament_rollen DROP COLUMN gewicht_gram_start`);
  }
  if (kolommen.includes('gewicht_gram_huidig')) {
    db.exec(`ALTER TABLE filament_rollen DROP COLUMN gewicht_gram_huidig`);
  }
}
