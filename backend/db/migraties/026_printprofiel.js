// ═══════════════════════════════════════════════════════════════════════
// Migratie 026 — vaste producten: per stuk rekenen + printprofiel (06-10)
// ═══════════════════════════════════════════════════════════════════════
// dossier_regels.per_plaat: hoeveel stuks er op één plaat passen (printregel).
//   De printopdrachten worden per plaat verdeeld; BMCU en de standaard-
//   voorbereiding tellen per plaat. (per_stuk bestond al: bij een printregel
//   betekent het "tijd en gram per stuk ingegeven"; bewaard blijven de
//   totalen, zodat werkbon, productiekost en voorraad niets merken.)
// artikelen.printprofiel: JSON met tijd en gram PER STUK, stuks per plaat,
//   printer, voorbereiding per plaat en nabewerking per stuk — voor een
//   zelf geprint artikel (webshop, voorraad).
export const versie = 26;
export const naam = 'dossier_regels.per_plaat + artikelen.printprofiel (vaste producten)';

export function up(db) {
  db.exec(`
    ALTER TABLE dossier_regels ADD COLUMN per_plaat INTEGER CHECK (per_plaat IS NULL OR per_plaat > 0);
    ALTER TABLE artikelen ADD COLUMN printprofiel TEXT;
  `);
}
