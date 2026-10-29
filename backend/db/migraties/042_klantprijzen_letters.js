// Migratie 042 (29-10):
// - klant_prijzen: prijsafspraak per klant en artikel (bv. wederverkoper:
//   bubble letter € 1,75 per stuk). Een regel met dat artikel in een dossier
//   van die klant krijgt die prijs (zoals een vast eindbedrag).
// - dossiers.letters: een letterbestelling (namen of kleuren → letters),
//   voor het overzicht per kleur en de inpaklijst per naam.
export const versie = 42;
export const naam = 'klant_prijzen + dossiers.letters';
export function up(db) {
  db.exec(`CREATE TABLE klant_prijzen (
      klant_id   INTEGER NOT NULL REFERENCES klanten(id) ON DELETE CASCADE,
      artikel_id INTEGER NOT NULL REFERENCES artikelen(id) ON DELETE CASCADE,
      prijs      REAL NOT NULL CHECK (prijs >= 0),
      PRIMARY KEY (klant_id, artikel_id)
    );
    ALTER TABLE dossiers ADD COLUMN letters TEXT;`);
}
