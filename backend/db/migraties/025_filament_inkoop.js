// ═══════════════════════════════════════════════════════════════════════
// Migratie 025 — familie & vrienden: filament aan inkoopprijs (04-10)
// ═══════════════════════════════════════════════════════════════════════
// dossiers.filament_inkoop: het verbruikte filament wordt aangerekend aan de
// INKOOPprijs per kg (zoals de productiekost) i.p.v. de verkoopprijs van de
// prijsgroep. klanten.familie: nieuwe dossiers van die klant krijgen dat
// vinkje meteen.
export const versie = 25;
export const naam = 'dossiers.filament_inkoop + klanten.familie (filament aan inkoopprijs)';

export function up(db) {
  db.exec(`
    ALTER TABLE dossiers ADD COLUMN filament_inkoop INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE klanten ADD COLUMN familie INTEGER NOT NULL DEFAULT 0;
  `);
}
