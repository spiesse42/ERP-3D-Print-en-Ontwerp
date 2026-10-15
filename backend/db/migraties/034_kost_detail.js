// Migratie 034 — opbouw van de gemeten productiekost per printopdracht (15-10):
// filament, stroom, machine, BMCU, arbeid en de hoeveelheden (gram, kWh,
// uren), vastgelegd bij het bevestigen. Voor de kostenopbouw over een heel
// dossier en per jaar. Oudere opdrachten: wordt live berekend.
export const versie = 34;
export const naam = 'printopdrachten.kost_detail';
export function up(db) { db.exec('ALTER TABLE printopdrachten ADD COLUMN kost_detail TEXT'); }
