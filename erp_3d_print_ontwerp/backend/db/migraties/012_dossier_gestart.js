// ═══════════════════════════════════════════════════════════════════════
// Migratie 012 — dossier "gestart" (automatische flow, 25-09-2026)
// ═══════════════════════════════════════════════════════════════════════
// Beslist (25-09):
// - knop STARTEN op een dossier (keuze B), of automatisch bij "offerte
//   aanvaard": klantopdracht → werkbon; elke printregel met printer →
//   printopdracht. Eigen product / intern: enkel printopdrachten.
// - vanaf dan volgen de printopdrachten de regels, zolang er op een opdracht
//   nog niets geprint is. Meer nodig terwijl er al geprint wordt → extra
//   opdracht voor het verschil. Te veel geprint → enkel een melding.
// Enkel een kolom erbij: oudere versies van het ERP negeren ze (terugvallen
// op een vorige versie blijft mogelijk).

export const versie = 12;
export const naam = 'dossier gestart (werkbon en printopdrachten automatisch)';

export function up(db) {
  db.exec(`ALTER TABLE dossiers ADD COLUMN gestart_op TEXT;`);
}
