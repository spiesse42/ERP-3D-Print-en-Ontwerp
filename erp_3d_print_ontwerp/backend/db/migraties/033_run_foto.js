// Migratie 033 — foto per printrun (11-10): voorbeeldafbeelding van de print
// (Bambu) of camerabeeld na het einde, om runs achteraf te herkennen.
export const versie = 33;
export const naam = 'printruns.foto';
export function up(db) { db.exec('ALTER TABLE printruns ADD COLUMN foto TEXT'); }
