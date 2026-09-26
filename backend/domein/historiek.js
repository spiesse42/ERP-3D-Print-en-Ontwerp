// Historiek ("chatter" onderaan elk formulier): gebeurtenissen en notities
// per record, in de tabel `gebeurtenissen` (migratie 001).
//
// Enkel entiteiten uit deze lijst zijn toegelaten, zodat de API niet voor
// willekeurige namen misbruikt kan worden. De lijst groeit per stap
// (aankoop, artikel, dossier, ...).
export const ENTITEITEN = {
  klant: 'klanten',
  artikel: 'artikelen',
  aankoop: 'aankopen',
  leverancier: 'leveranciers',
  printer: 'printers',
  dossier: 'dossiers',
  verkoop: 'verkopen',   // losse verkoop (26-09)
};

// 'voorraad' = een boeking of telling (stap 3a), zodat die ook in de
// historiek van het artikel staat, naast het volledige mutatielogboek.
// 'status' = een stap in een document (besteld, ontvangen, geannuleerd, ...), stap 3b.
export const SOORTEN = ['notitie', 'aangemaakt', 'gewijzigd', 'gearchiveerd', 'hersteld', 'voorraad', 'status'];

export function bestaatRecord(db, entiteit, id) {
  const tabel = ENTITEITEN[entiteit];
  if (!tabel) return false;
  return !!db.prepare(`SELECT 1 FROM ${tabel} WHERE id = ?`).get(id);
}

export function logGebeurtenis(db, entiteit, id, soort, tekst = null) {
  if (!ENTITEITEN[entiteit]) throw new Error(`Onbekende entiteit: ${entiteit}`);
  if (!SOORTEN.includes(soort)) throw new Error(`Onbekende soort gebeurtenis: ${soort}`);
  return db.prepare('INSERT INTO gebeurtenissen (entiteit, entiteit_id, soort, tekst) VALUES (?,?,?,?)')
    .run(entiteit, id, soort, tekst).lastInsertRowid;
}

export function leesHistoriek(db, entiteit, id) {
  return db.prepare(`
    SELECT id, tijdstip, soort, tekst FROM gebeurtenissen
    WHERE entiteit = ? AND entiteit_id = ?
    ORDER BY tijdstip DESC, id DESC
  `).all(entiteit, id);
}

export function wisHistoriek(db, entiteit, id) {
  db.prepare('DELETE FROM gebeurtenissen WHERE entiteit = ? AND entiteit_id = ?').run(entiteit, id);
}

// Maakt van een oude en nieuwe versie van een record een leesbare zin, bv.
// "Gemeente: Mol → Geel; E-mail toegevoegd". Enkel velden uit `labels`.
export function beschrijfWijzigingen(oud, nieuw, labels) {
  const delen = [];
  for (const [veld, label] of Object.entries(labels)) {
    const a = oud[veld] ?? '';
    const b = nieuw[veld] ?? '';
    if (String(a) === String(b)) continue;
    if (a === '') delen.push(`${label} ingevuld: ${b}`);
    else if (b === '') delen.push(`${label} gewist`);
    else delen.push(`${label}: ${a} → ${b}`);
  }
  return delen.join('; ');
}
