// ═══════════════════════════════════════════════════════════════════════
// Migratie 018 — losse verkoop zonder dossier (26-09-2026)
// ═══════════════════════════════════════════════════════════════════════
// Tegel "Verkoop" (claude/beslissingen-2026-09-26.md): iets verkopen dat op
// voorraad ligt, zonder dossier. Het ERP maakt meteen een bonnetje (reeks
// BON, dezelfde teller als "Bonnetje maken" op een dossier), boekt de
// voorraad FIFO uit en mailt het bonnetje naar Accountable (+ optioneel de
// klant). Een bonnetje is meteen betaald (dagontvangsten).
// - regels verwijzen altijd naar een artikel (artikel/filament: voorraad
//   eraf; dienst, bv. verzending: geen voorraad); omschrijving en prijs
//   worden bewaard zoals ze op het bonnetje stonden (momentopname)
// - ongedaan maken = geannuleerd_op + voorraad terug op dezelfde partijen;
//   het nummer blijft bezet (Accountable kreeg het al)
// - gemaild_op: naar Accountable (EXACT één keer); klant_mail: laatste adres
export const versie = 18;
export const naam = 'verkopen + verkoop_regels (losse verkoop met bonnetje)';

export function up(db) {
  db.exec(`
    CREATE TABLE verkopen (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      nummer         TEXT NOT NULL UNIQUE,
      datum          TEXT NOT NULL,
      klant_id       INTEGER REFERENCES klanten(id),
      omschrijving   TEXT,
      totaal         REAL NOT NULL CHECK (totaal >= 0),
      gemaild_op     TEXT,
      klant_mail     TEXT,
      geannuleerd_op TEXT,
      aangemaakt_op  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_verkopen_datum ON verkopen(datum);
    CREATE INDEX idx_verkopen_klant ON verkopen(klant_id);

    CREATE TABLE verkoop_regels (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      verkoop_id     INTEGER NOT NULL REFERENCES verkopen(id) ON DELETE CASCADE,
      volgorde       INTEGER NOT NULL,
      artikel_id     INTEGER NOT NULL REFERENCES artikelen(id),
      omschrijving   TEXT NOT NULL,
      aantal         REAL NOT NULL CHECK (aantal > 0),
      prijs_per_stuk REAL NOT NULL CHECK (prijs_per_stuk >= 0),
      bedrag         REAL NOT NULL CHECK (bedrag >= 0)
    );
    CREATE INDEX idx_verkoop_regels_verkoop ON verkoop_regels(verkoop_id);
  `);
}
