// Doorlopende nummering voor INTERNE documenten (aankopen, dossiers,
// offertes, werkbonnen, pakbonnen). Eén teller per reeks per jaar, opgehoogd
// in dezelfde transactie als het aanmaken van het document, dus geen dubbele
// nummers. Facturen en bonnetjes nummert Accountable, niet het ERP.
//
// Formaten (beslist 25-09): zoals in het oude pakket, met per reeks een
// instelbaar "volgende nummer" zodat je bij de overschakeling verder telt.
import { DomeinFout } from './hulp.js';

// tabel/kolom: waar de uitgegeven nummers staan (om te weigeren dat je het
// volgende nummer lager zet dan wat al bestaat).
export const REEKSEN = {
  D:   { naam: 'Dossier',  cijfers: 3, tabel: 'dossiers', kolom: 'nummer' },
  OFF: { naam: 'Offerte',  cijfers: 3, tabel: 'offertes', kolom: 'nummer' },
  WB:  { naam: 'Werkbon',  cijfers: 4, tabel: 'werkbonnen', kolom: 'nummer' },
  PB:  { naam: 'Pakbon',   cijfers: 3, tabel: 'leveringen', kolom: 'nummer' },
  AK:  { naam: 'Aankoop',  cijfers: 4, tabel: 'aankopen', kolom: 'nummer' },
};

export function volgendNummer(db, reeks, { jaar = new Date().getFullYear(), cijfers } = {}) {
  if (!/^[A-Z]{1,4}$/.test(reeks)) throw new Error(`Ongeldige reeks: ${reeks}`);
  const c = cijfers ?? REEKSEN[reeks]?.cijfers ?? 4;
  const verhoog = db.transaction(() => {
    db.prepare(`
      INSERT INTO nummering (reeks, jaar, laatste) VALUES (?, ?, 1)
      ON CONFLICT (reeks, jaar) DO UPDATE SET laatste = laatste + 1
    `).run(reeks, jaar);
    return db.prepare('SELECT laatste FROM nummering WHERE reeks = ? AND jaar = ?').get(reeks, jaar).laatste;
  });
  const n = verhoog();
  return `${reeks}-${jaar}-${String(n).padStart(c, '0')}`;
}

// Hoogste nummer dat voor dit jaar echt in gebruik is (0 als er geen is).
function hoogsteUitgegeven(db, reeks, jaar) {
  const r = REEKSEN[reeks];
  if (!r?.tabel) return 0;
  const prefix = `${reeks}-${jaar}-`;
  const rijen = db.prepare(`SELECT ${r.kolom} AS n FROM ${r.tabel} WHERE ${r.kolom} LIKE ?`).all(`${prefix}%`);
  return rijen.reduce((m, x) => Math.max(m, parseInt(String(x.n).slice(prefix.length), 10) || 0), 0);
}

export function overzicht(db, jaar = new Date().getFullYear()) {
  return Object.entries(REEKSEN).map(([reeks, r]) => {
    const laatste = db.prepare('SELECT laatste FROM nummering WHERE reeks = ? AND jaar = ?').get(reeks, jaar)?.laatste ?? 0;
    const volgend = laatste + 1;
    return { reeks, naam: r.naam, jaar, laatste, volgend, voorbeeld: `${reeks}-${jaar}-${String(volgend).padStart(r.cijfers, '0')}`,
      minimum: hoogsteUitgegeven(db, reeks, jaar) + 1 };
  });
}

// Het volgende nummer van een reeks (voor dit jaar) instellen, bv. om verder
// te tellen waar het oude pakket stopte. Nooit lager dan wat al bestaat.
export function zetVolgend(db, reeks, volgend, jaar = new Date().getFullYear()) {
  if (!REEKSEN[reeks]) throw new DomeinFout('Onbekende reeks');
  const n = Number(volgend);
  if (!Number.isInteger(n) || n < 1 || n > 999999) throw new DomeinFout('Het volgende nummer moet een geheel getal vanaf 1 zijn');
  const min = hoogsteUitgegeven(db, reeks, jaar) + 1;
  if (n < min) throw new DomeinFout(`Het volgende nummer kan niet lager dan ${min}: ${REEKSEN[reeks].naam.toLowerCase()} ${reeks}-${jaar}-${String(min - 1).padStart(REEKSEN[reeks].cijfers, '0')} bestaat al`);
  db.prepare(`INSERT INTO nummering (reeks, jaar, laatste) VALUES (?, ?, ?)
    ON CONFLICT (reeks, jaar) DO UPDATE SET laatste = excluded.laatste`).run(reeks, jaar, n - 1);
}
