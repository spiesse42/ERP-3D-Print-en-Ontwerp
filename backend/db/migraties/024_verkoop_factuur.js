// ═══════════════════════════════════════════════════════════════════════
// Migratie 024 — factuur bij een losse verkoop (29-09)
// ═══════════════════════════════════════════════════════════════════════
// Een losse verkoop kan nu ook een factuur zijn (reeks FAC, zelfde teller
// als "Factuur maken" in een dossier). Een factuur is niet meteen betaald:
// vervaldatum + betaald_op. Bestaande verkopen zijn bonnetjes, betaald op de
// verkoopdatum.
export const versie = 24;
export const naam = 'verkopen.soort + vervaldatum + betaald_op (factuur bij een losse verkoop)';

export function up(db) {
  db.exec(`
    ALTER TABLE verkopen ADD COLUMN soort TEXT NOT NULL DEFAULT 'bonnetje' CHECK (soort IN ('bonnetje', 'factuur'));
    ALTER TABLE verkopen ADD COLUMN vervaldatum TEXT;
    ALTER TABLE verkopen ADD COLUMN betaald_op TEXT;
    UPDATE verkopen SET betaald_op = datum;
  `);
}
