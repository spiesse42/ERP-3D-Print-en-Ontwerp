// ═══════════════════════════════════════════════════════════════════════
// Migratie 017 — bonnetje gemaakt door het ERP (26-09-2026)
// ═══════════════════════════════════════════════════════════════════════
// Herziening van "optie A" (claude/beslissingen-2026-09-26.md): het ERP maakt
// zelf het bonnetje (nummer uit de reeks BON, "Bonnetje 2026-020"), mailt het
// naar inkomsten@accountable.eu (dagontvangstenboek) en optioneel naar de
// klant. De afrekening zelf blijft in afgerekend_* staan (soort 'bonnetje').
// - afrekening_pdf_op: het ERP maakte het document (anders = verwijzing naar
//   een document uit Accountable, zoals voorheen)
// - afrekening_gemaild_op: naar Accountable gemaild (EXACT één keer: een
//   tweede mail zou een dubbele inkomst geven)
// - afrekening_klant_mail: laatste adres van de klant waarnaar gemaild werd
// Het PDF-bestand wordt niet bewaard: het wordt opnieuw opgebouwd uit de
// definitieve werkbon (momentopname) + nummer/datum/bedrag van de afrekening.
export const versie = 17;
export const naam = 'dossiers.afrekening_pdf_op / afrekening_gemaild_op / afrekening_klant_mail';

export function up(db) {
  db.exec(`
    ALTER TABLE dossiers ADD COLUMN afrekening_pdf_op TEXT;
    ALTER TABLE dossiers ADD COLUMN afrekening_gemaild_op TEXT;
    ALTER TABLE dossiers ADD COLUMN afrekening_klant_mail TEXT;
  `);
}
