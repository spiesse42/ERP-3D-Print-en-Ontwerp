// ═══════════════════════════════════════════════════════════════════════
// Migratie 011 — voorraad vanuit productie (stap 6c)
// ═══════════════════════════════════════════════════════════════════════
// Beslist (25-09):
// - filament: ROL LEEGMELDEN bij de printerkaart = −1 rol FIFO (reden
//   "gebruik", bron "printer"); geen grammen uitboeken
// - eigen product: een printregel in een dossier "Eigen product" kan een
//   artikel (zelf geprint) krijgen (dossier_regels.artikel_id, bestond al).
//   Bij Bevestigen van de printopdracht komen de goede stuks in voorraad
//   (reden "productie", bron "printopdracht")
// - productiekost per goed stuk wordt bewaard op de printopdracht: echte
//   kost (filament aan INKOOPprijs, gemeten elektriciteit, machinetarief,
//   BMCU, mislukte pogingen) en apart de arbeid (voorbereiding/nabewerking).
//   De partij krijgt de kost zonder arbeid als prijs per stuk.

export const versie = 11;
export const naam = 'productiekost op printopdrachten (eindproducten naar voorraad)';

export function up(db) {
  db.exec(`
    ALTER TABLE printopdrachten ADD COLUMN productiekost_stuk REAL CHECK (productiekost_stuk IS NULL OR productiekost_stuk >= 0);
    ALTER TABLE printopdrachten ADD COLUMN arbeid_stuk REAL CHECK (arbeid_stuk IS NULL OR arbeid_stuk >= 0);
    ALTER TABLE printopdrachten ADD COLUMN kost_onvolledig INTEGER NOT NULL DEFAULT 0 CHECK (kost_onvolledig IN (0,1));
    CREATE INDEX IF NOT EXISTS idx_mutaties_bron ON voorraad_mutaties(bron_type, bron_id);
  `);
}
