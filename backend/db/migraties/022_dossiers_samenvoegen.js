// ═══════════════════════════════════════════════════════════════════════
// Migratie 022 — dossiers samenvoegen (29-09)
// ═══════════════════════════════════════════════════════════════════════
// Meerdere bestellingen van dezelfde klant in één dossier: de regels (met
// hun printopdrachten en runs), leveringen en bijlagen gaan naar het
// doeldossier. Het bronddossier blijft bestaan als verwijzing (fase
// "Samengevoegd", gearchiveerd), met zijn verstuurde offertes als historiek.
export const versie = 22;
export const naam = 'dossiers.samengevoegd_op + samengevoegd_in (dossiers samenvoegen)';

export function up(db) {
  db.exec(`
    ALTER TABLE dossiers ADD COLUMN samengevoegd_op TEXT;
    ALTER TABLE dossiers ADD COLUMN samengevoegd_in INTEGER REFERENCES dossiers(id) ON DELETE SET NULL;
  `);
}
