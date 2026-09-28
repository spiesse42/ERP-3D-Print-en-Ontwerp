// ═══════════════════════════════════════════════════════════════════════
// Migratie 021 — slicerbestand bij een printregel (28-09)
// ═══════════════════════════════════════════════════════════════════════
// Het geüploade .gcode.3mf / .gcode wordt een bijlage van het dossier; de
// printregel onthoudt welk bestand en welke plaat. Nu om te downloaden bij
// regel en printopdracht; later (LAN-modus) om de print vanuit het ERP te
// starten (bestand naar de printer + print_project_file met de plaat).
export const versie = 21;
export const naam = 'dossier_regels.slicer_bijlage_id + slicer_plaat (slicerbestand per printregel)';

export function up(db) {
  db.exec(`
    ALTER TABLE dossier_regels ADD COLUMN slicer_bijlage_id INTEGER REFERENCES bijlagen(id) ON DELETE SET NULL;
    ALTER TABLE dossier_regels ADD COLUMN slicer_plaat INTEGER CHECK (slicer_plaat IS NULL OR slicer_plaat > 0);
  `);
}
