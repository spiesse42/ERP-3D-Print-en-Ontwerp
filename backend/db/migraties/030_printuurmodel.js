// Migratie 030 — printuurmodel (08-10): winst per printuur i.p.v. de
// getrapte marge, en materiaal minstens inkoop × opslag. Op een bestaande
// installatie (er zijn al dossiers) meteen aan: € 1/printuur, boven 12 u aan
// 60 %, opslag 200 %. Op een lege databank uit (0): de oude berekening.
export const versie = 30;
export const naam = 'tarieven printuurmodel';

export function up(db) {
  const bestaand = db.prepare('SELECT COUNT(*) n FROM dossiers').get().n > 0;
  const ins = db.prepare('INSERT OR IGNORE INTO tarieven (sleutel,waarde,eenheid,label) VALUES (?,?,?,?)');
  ins.run('winst_per_printuur', bestaand ? 1 : 0, 'EUR/u', 'Winst per printuur (0 = oude berekening met marge)');
  ins.run('winst_lang_grens_uur', 12, 'u', 'Lange print vanaf');
  ins.run('winst_lang_pct', 60, '%', 'Winst per printuur boven die grens');
  ins.run('materiaal_opslag_pct', bestaand ? 200 : 0, '%', 'Materiaal minstens inkoopprijs × (0 = enkel verkoopprijs/kg)');
}
