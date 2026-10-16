// Migratie 036 — slijtage van de wisselaar per printer (16-10)
// Het tarief "BMCU/AMS-slijtage per print" gold voor alle printers. Een
// Snapmaker U1 heeft geen AMS/BMCU (vier toolheads), dus krijgt elke printer
// een eigen bedrag. Leeg = het tarief uit Instellingen (zo verandert er voor de
// bestaande printers niets); 0 = geen slijtage rekenen.
export const versie = 36;
export const naam = 'printers.slijtage_per_print';

export function up(db) {
  db.exec(`ALTER TABLE printers ADD COLUMN slijtage_per_print REAL CHECK (slijtage_per_print IS NULL OR slijtage_per_print >= 0);`);
}
