// ═══════════════════════════════════════════════════════════════════════
// Migratie 001 — basisschema (23-09-2026)
// ═══════════════════════════════════════════════════════════════════════
//
// Vervangt de vroegere db.js + db_migration_v2..v7 volledig (afspraak: van 0
// beginnen, geen overname van testdata). Volgt claude/domeinmodel-v2.md:
//
//   Fundament   klanten, tarieven, instellingen, nummering,
//               gebeurtenissen (historiek), bijlagen
//   Catalogus   filament_merken / _materialen / _kleuren,
//               filament_types (= prijsgroep merk + type),
//               artikelen (één lijst: filament / onderdeel / eindproduct / dienst)
//   Inkoop      leveranciers, aankopen, aankoop_regels
//   Voorraad    voorraad_partijen (per ontvangen partij), voorraad_mutaties
//
// Dossiers (stap 5) en productie (stap 6) krijgen elk hun eigen migratie
// wanneer die stap gebouwd wordt.
//
// Statussen worden NIET als vrij tekstveld opgeslagen. Een aankoop bewaart
// gebeurtenissen met een datum (besteld_op, geannuleerd_op); de status die
// je ziet wordt daaruit en uit de ontvangen aantallen berekend.

export const versie = 1;
export const naam = 'basisschema';

export function up(db) {
  db.exec(`
    -- ── Fundament ──────────────────────────────────────────────────────────
    CREATE TABLE klanten (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL DEFAULT 'particulier' CHECK (type IN ('particulier','zakelijk')),
      naam          TEXT NOT NULL,
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
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE tarieven (
      sleutel TEXT PRIMARY KEY,
      waarde  REAL NOT NULL,
      eenheid TEXT,
      label   TEXT
    );

    -- Vrije tekst-instellingen (bedrijfsgegevens, ...). Welke sleutels via de
    -- API mogen, bepaalt de allowlist in routes/instellingen.js. Geheimen
    -- (HA-token, Gemini-sleutel) horen hier nooit: die komen uit de
    -- add-on-configuratie (omgevingsvariabelen).
    CREATE TABLE instellingen (
      sleutel TEXT PRIMARY KEY,
      waarde  TEXT,
      label   TEXT
    );

    -- Eén teller per reeks en per jaar (AK-2026-0001, later D-, PB-, ...).
    -- Enkel voor interne documenten: facturen en bonnetjes nummert Accountable.
    CREATE TABLE nummering (
      reeks   TEXT NOT NULL,
      jaar    INTEGER NOT NULL,
      laatste INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (reeks, jaar)
    );

    -- Historiek onderaan elk formulier (Odoo-"chatter"): gebeurtenissen en
    -- notities per record. entiteit = 'aankoop', 'artikel', 'klant', ...
    CREATE TABLE gebeurtenissen (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entiteit    TEXT NOT NULL,
      entiteit_id INTEGER NOT NULL,
      tijdstip    TEXT NOT NULL DEFAULT (datetime('now')),
      soort       TEXT NOT NULL DEFAULT 'notitie',
      tekst       TEXT
    );
    CREATE INDEX idx_gebeurtenissen_record ON gebeurtenissen(entiteit, entiteit_id);

    -- Bijlagen (factuur-PDF, foto van een bonnetje, 3MF, ...) per record.
    CREATE TABLE bijlagen (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      entiteit      TEXT NOT NULL,
      entiteit_id   INTEGER NOT NULL,
      bestandsnaam  TEXT NOT NULL,
      pad           TEXT NOT NULL,
      mimetype      TEXT,
      grootte       INTEGER,
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_bijlagen_record ON bijlagen(entiteit, entiteit_id);

    -- ── Catalogus ──────────────────────────────────────────────────────────
    CREATE TABLE filament_merken (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      naam          TEXT NOT NULL UNIQUE COLLATE NOCASE,
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE filament_materialen (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      naam          TEXT NOT NULL UNIQUE COLLATE NOCASE,
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE filament_kleuren (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      naam          TEXT NOT NULL UNIQUE COLLATE NOCASE,
      hex           TEXT NOT NULL,
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Prijsgroep: merk + type met verkoopprijs/kg en het minimum aantal
    -- rollen PER KLEUR (leeg = geen bestel-opvolging).
    CREATE TABLE filament_types (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      merk_id             INTEGER NOT NULL REFERENCES filament_merken(id),
      materiaal_id        INTEGER NOT NULL REFERENCES filament_materialen(id),
      verkoopprijs_per_kg REAL NOT NULL CHECK (verkoopprijs_per_kg >= 0),
      dichtheid_g_per_cm3 REAL,
      min_rollen          INTEGER CHECK (min_rollen IS NULL OR min_rollen >= 0),
      leverancier         TEXT,
      notities            TEXT,
      aangemaakt_op       TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (merk_id, materiaal_id)
    );

    -- Eén catalogus voor alles wat je koopt, maakt of verkoopt.
    -- filament  = prijsgroep + kleur (naam wordt afgeleid, prijs komt uit de prijsgroep)
    -- onderdeel = inkoopprijs + marge% → voorstel verkoopprijs (overschrijfbaar)
    -- eindproduct = verkoopprijs (+ optionele productieprijs, informatief)
    -- dienst    = prijs, eventueel vaste prijs (geen marge), geen voorraad
    CREATE TABLE artikelen (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      soort            TEXT NOT NULL CHECK (soort IN ('filament','onderdeel','eindproduct','dienst')),
      naam             TEXT,
      filament_type_id INTEGER REFERENCES filament_types(id),
      kleur_id         INTEGER REFERENCES filament_kleuren(id),
      eenheid          TEXT NOT NULL DEFAULT 'stuks',
      verkoopprijs     REAL CHECK (verkoopprijs IS NULL OR verkoopprijs >= 0),
      inkoopprijs      REAL CHECK (inkoopprijs IS NULL OR inkoopprijs >= 0),
      marge_pct        REAL,
      productieprijs   REAL CHECK (productieprijs IS NULL OR productieprijs >= 0),
      vaste_prijs      INTEGER NOT NULL DEFAULT 0 CHECK (vaste_prijs IN (0,1)),
      min_voorraad     REAL CHECK (min_voorraad IS NULL OR min_voorraad >= 0),
      locatie          TEXT,
      notities         TEXT,
      gearchiveerd     INTEGER NOT NULL DEFAULT 0 CHECK (gearchiveerd IN (0,1)),
      aangemaakt_op    TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (
        (soort = 'filament'  AND filament_type_id IS NOT NULL AND kleur_id IS NOT NULL)
        OR
        (soort <> 'filament' AND filament_type_id IS NULL AND kleur_id IS NULL AND naam IS NOT NULL)
      )
    );
    CREATE UNIQUE INDEX uq_artikelen_filament ON artikelen(filament_type_id, kleur_id) WHERE soort = 'filament';
    CREATE UNIQUE INDEX uq_artikelen_naam ON artikelen(soort, naam COLLATE NOCASE) WHERE soort <> 'filament';

    -- ── Inkoop ─────────────────────────────────────────────────────────────
    CREATE TABLE leveranciers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      naam          TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email         TEXT,
      website       TEXT,
      notities      TEXT,
      gearchiveerd  INTEGER NOT NULL DEFAULT 0 CHECK (gearchiveerd IN (0,1)),
      aangemaakt_op TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Eén document van bestelling tot factuur. Status = afgeleid:
    -- geannuleerd_op → geannuleerd; geen besteld_op → concept;
    -- anders volgens de ontvangen aantallen (besteld / deels ontvangen / ontvangen).
    CREATE TABLE aankopen (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      nummer               TEXT NOT NULL UNIQUE,
      leverancier_id       INTEGER REFERENCES leveranciers(id),
      datum                TEXT NOT NULL DEFAULT (date('now')),
      besteld_op           TEXT,
      geannuleerd_op       TEXT,
      bron                 TEXT NOT NULL DEFAULT 'manueel' CHECK (bron IN ('manueel','ocr','ubl')),
      extern_factuurnummer TEXT,   -- uitsluitend intern, nooit op klantdocumenten
      totaal_bedrag        REAL,
      notities             TEXT,
      aangemaakt_op        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Een regel verwijst naar een artikel, OF is een plaatshouder
    -- ("PLA, merk nog onbekend": merk kiezen bij ontvangst), OF is een losse
    -- kostregel met enkel een omschrijving (bv. verzending).
    CREATE TABLE aankoop_regels (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      aankoop_id                INTEGER NOT NULL REFERENCES aankopen(id) ON DELETE CASCADE,
      volgorde                  INTEGER NOT NULL DEFAULT 0,
      artikel_id                INTEGER REFERENCES artikelen(id),
      plaatshouder_materiaal_id INTEGER REFERENCES filament_materialen(id),
      plaatshouder_kleur_id     INTEGER REFERENCES filament_kleuren(id),
      omschrijving              TEXT,
      aantal                    REAL NOT NULL CHECK (aantal > 0),
      prijs_per_eenheid         REAL CHECK (prijs_per_eenheid IS NULL OR prijs_per_eenheid >= 0),
      CHECK (NOT (artikel_id IS NOT NULL AND plaatshouder_materiaal_id IS NOT NULL)),
      CHECK (artikel_id IS NOT NULL OR plaatshouder_materiaal_id IS NOT NULL OR omschrijving IS NOT NULL)
    );
    CREATE INDEX idx_aankoop_regels_aankoop ON aankoop_regels(aankoop_id);
    CREATE INDEX idx_aankoop_regels_artikel ON aankoop_regels(artikel_id);

    -- ── Voorraad ───────────────────────────────────────────────────────────
    -- Eén rij per ontvangen partij (= wat vroeger een "batch" was). Voorraad
    -- van een artikel = som van aantal_resterend. UIT/levering neemt eerst
    -- van de oudste partij (FIFO).
    CREATE TABLE voorraad_partijen (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      artikel_id        INTEGER NOT NULL REFERENCES artikelen(id),
      aankoop_regel_id  INTEGER REFERENCES aankoop_regels(id) ON DELETE SET NULL,
      ontvangen_op      TEXT NOT NULL DEFAULT (date('now')),
      aantal_ontvangen  REAL NOT NULL CHECK (aantal_ontvangen > 0),
      aantal_resterend  REAL NOT NULL CHECK (aantal_resterend >= 0 AND aantal_resterend <= aantal_ontvangen),
      prijs_per_eenheid REAL CHECK (prijs_per_eenheid IS NULL OR prijs_per_eenheid >= 0),
      locatie           TEXT,
      aangemaakt_op     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_partijen_artikel ON voorraad_partijen(artikel_id, ontvangen_op, id);
    CREATE INDEX idx_partijen_regel ON voorraad_partijen(aankoop_regel_id);

    -- Logboek van elke beweging. aantal > 0 = erbij, < 0 = eraf.
    -- bron_type/bron_id wijzen naar de oorzaak (aankoop_regel, levering,
    -- printopdracht, ...), leeg bij een manuele correctie.
    CREATE TABLE voorraad_mutaties (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      artikel_id INTEGER NOT NULL REFERENCES artikelen(id),
      partij_id  INTEGER REFERENCES voorraad_partijen(id) ON DELETE SET NULL,
      tijdstip   TEXT NOT NULL DEFAULT (datetime('now')),
      aantal     REAL NOT NULL CHECK (aantal <> 0),
      reden      TEXT NOT NULL CHECK (reden IN ('ontvangst','gebruik','levering','productie','correctie')),
      bron_type  TEXT,
      bron_id    INTEGER,
      notitie    TEXT
    );
    CREATE INDEX idx_mutaties_artikel ON voorraad_mutaties(artikel_id, tijdstip);
  `);

  seed(db);
}

function seed(db) {
  const tarief = db.prepare('INSERT INTO tarieven (sleutel,waarde,eenheid,label) VALUES (?,?,?,?)');
  [
    ['kwh_prijs',           0.35, 'EUR/kWh', 'Elektriciteitsprijs'],
    ['machine_per_uur',     0.13, 'EUR/u',   'Machinekost (globaal, terugval)'],
    ['marge_grens_uur',     3.00, 'u',       'Grens klein/groot (printtijd)'],
    ['marge_klein_pct',    18.00, '%',       'Winstmarge — klein (korter dan grens)'],
    ['marge_groot_pct',    10.00, '%',       'Winstmarge — groot (langer dan grens)'],
    ['faalfactor_pct',     10.00, '%',       'Faalfactor (op materiaalkost)'],
    ['voorbereiding_min',  10.00, 'min',     'Vaste voorbereidingstijd per print'],
    ['nabewerking_min',     5.00, 'min',     'Vaste nabewerkingstijd per print'],
    ['ontwerp_tarief',     25.00, 'EUR/u',   'Ontwerp op maat (regie)'],
    ['nabewerking_tarief', 20.00, 'EUR/u',   'Uitgebreide nabewerking (regie)'],
    ['arbeid_per_uur',     15.00, 'EUR/u',   'Arbeidskost (regie)'],
    ['bmcu_per_job',        0.10, 'EUR',     'BMCU-slijtage per multicolor job'],
  ].forEach(r => tarief.run(...r));

  const merk = db.prepare('INSERT INTO filament_merken (naam) VALUES (?)');
  ['Bambu Lab', 'AnyCubic', 'CaiLab', 'eSUN', 'Sunlu', 'PolyMaker', 'Azurefilm', 'Spectrum'].forEach(n => merk.run(n));

  const materiaal = db.prepare('INSERT INTO filament_materialen (naam) VALUES (?)');
  ['PLA', 'PLA+', 'PLA Pro', 'PLA Matte', 'PLA Matte HS', 'PLA Silk', 'PETG', 'PETG Matte'].forEach(n => materiaal.run(n));

  const kleur = db.prepare('INSERT INTO filament_kleuren (naam, hex) VALUES (?,?)');
  [
    ['Zwart', '#1a1a1a'], ['Wit', '#f5f5f0'], ['Grijs', '#808080'],
    ['Rood', '#d32f2f'], ['Oranje', '#f57c00'], ['Geel', '#fdd835'],
    ['Groen', '#43a047'], ['Blauw', '#1e88e5'], ['Paars', '#8e24aa'],
    ['Roze', '#ec407a'], ['Bruin', '#6d4c41'], ['Naturel', '#e8dcc0'],
    ['Transparant', '#e0e0e0'], ['Goud', '#d4af37'], ['Zilver', '#bcc6cc'],
    ['Koper', '#b87333'],
  ].forEach(r => kleur.run(...r));
}
