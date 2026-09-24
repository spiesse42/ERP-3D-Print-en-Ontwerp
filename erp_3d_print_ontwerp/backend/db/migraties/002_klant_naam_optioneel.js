// ═══════════════════════════════════════════════════════════════════════
// Migratie 002 — naam optioneel voor zakelijke klanten (stap 2, 23-09-2026)
// ═══════════════════════════════════════════════════════════════════════
// In 001 was `naam` verplicht. Voor een bedrijf is de bedrijfsnaam de echte
// naam en is een contactpersoon optioneel. Nieuwe regel, afgedwongen door de
// databank: een particulier heeft een naam; een zakelijke klant heeft een
// bedrijfsnaam of een naam.
// SQLite kan NOT NULL niet met ALTER TABLE weghalen, dus: tabel herbouwen.
// Bestaande klanten blijven behouden (zelfde id's). Er verwijst nog geen
// andere tabel met een foreign key naar klanten.

export const versie = 2;
export const naam = 'klant: naam optioneel voor zakelijke klanten';

export function up(db) {
  db.exec(`
    CREATE TABLE klanten_nieuw (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL DEFAULT 'particulier' CHECK (type IN ('particulier','zakelijk')),
      naam          TEXT,
      voornaam      TEXT,
      bedrijfsnaam  TEXT,
      email         TEXT,
      telefoon      TEXT,
      gsm           TEXT,
      straat        TEXT,
      huisnummer    TEXT,
      postcode      TEXT,
      gemeente      TEXT,
      btw_nummer    TEXT,
      peppol_id     TEXT,
      notities      TEXT,
      gearchiveerd  INTEGER NOT NULL DEFAULT 0 CHECK (gearchiveerd IN (0,1)),
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (
        (type = 'particulier' AND naam IS NOT NULL)
        OR (type = 'zakelijk' AND (naam IS NOT NULL OR bedrijfsnaam IS NOT NULL))
      )
    );
    INSERT INTO klanten_nieuw
      SELECT id, type, naam, voornaam, bedrijfsnaam, email, telefoon, gsm, straat, huisnummer,
             postcode, gemeente, btw_nummer, peppol_id, notities, gearchiveerd, aangemaakt_op
      FROM klanten;
    DROP TABLE klanten;
    ALTER TABLE klanten_nieuw RENAME TO klanten;
  `);
}
