// Migratie 043 (11-11): bonnetjes met een eigen ERP-nummer ("Kassabon
// 2026-001", reeks KB) naast het nummer dat Accountable eraan geeft. Dat
// Accountable-nummer is het juiste voor de boekhouding: het staat apart
// (accountable_nummer), kan later ingevuld worden en de Accountable-import
// koppelt er ook op.
export const versie = 43;
export const naam = 'accountable_nummer bij dossiers en verkopen (kassabon)';
export function up(db) {
  db.exec(`ALTER TABLE dossiers ADD COLUMN accountable_nummer TEXT;
    ALTER TABLE verkopen ADD COLUMN accountable_nummer TEXT;`);
}
