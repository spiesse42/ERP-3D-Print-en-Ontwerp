// Migratie 041 — reviewlinks (27-10): Google-bedrijfsprofiel en Facebook,
// voor de QR-code onderaan de pakbon en het bonnetje. Aanpasbaar in
// Instellingen → Bedrijfsgegevens; leeg = geen reviewblok.
export const versie = 41;
export const naam = 'instellingen review_google + review_facebook';
export function up(db) {
  const ins = db.prepare('INSERT OR IGNORE INTO instellingen (sleutel, waarde, label) VALUES (?,?,?)');
  ins.run('review_google', 'https://g.page/r/Cc__ktserRHWEBI/review', 'Reviewlink Google');
  ins.run('review_facebook', 'https://www.facebook.com/profile.php?id=61591070623149&sk=reviews', 'Reviewlink Facebook');
}
