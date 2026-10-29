// ═══════════════════════════════════════════════════════════════════════
// LETTERBESTELLINGEN (29-10) — bv. bubble letters voor een wederverkoper
// ═══════════════════════════════════════════════════════════════════════
// Een lijst inlezen zoals je ze krijgt, in twee vormen:
// - PER NAAM:   JULIETTE            of   EMMA: roze
//               J – Perzikkleur            LIAM: blauw, wit, blauw, wit
//               U – Lichtroze
// - PER KLEUR:  Cherry TTEGLLSLKB 10      of   Roze: A A E M M
// (afvinktekens "v", "✓", "ok" achteraan worden genegeerd; accenten blijven)
// → per letter × kleur een printregel uit het LETTERPROFIEL van het product
// (de eigen plaat van die letter, met het filament van die kleur). De kleur
// wordt een filament via: eerder gekozen (onthouden) → kleurenpalet van de
// webshop (label → filament) → zelf te kiezen. De bestelling (namen) wordt
// bewaard bij het dossier: overzicht per kleur + inpaklijst per naam.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { bijlagenMap } from '../db/index.js';
import { DomeinFout } from './hulp.js';
import { logGebeurtenis } from './historiek.js';
import { leesRegels, leesRegelsVan, bewaarRegels } from './dossiers.js';
import { filamentKaart, norm } from './webshopdossier.js';
import { artikelMetProfiel, isLetterProfiel, letterPlaat, normLetter, regelUitProfiel } from '../productie/printprofiel.js';

const STREEP = '[–—\\-:]';
const AFVINK = /(\s+(v|vv|✓|✔|ok|OK|Ok|V))+\s*$/u;
const tekens = t => Array.from(String(t).normalize('NFC')).filter(c => c.trim()).map(c => c.toLocaleUpperCase('nl-BE'));
const isHoofd = t => /^[\p{Lu}\p{N}\s'’&.\-]+$/u.test(t) && /\p{Lu}/u.test(t);
const heeftKlein = t => /\p{Ll}/u.test(t);
const kleurNaam = t => String(t).trim().replace(/\s+/g, ' ');

// tekst → { bron, namen: [{ naam, letters: [{ letter, kleur }] }] | null, items: [{ letter, kleur, aantal }], waarschuwingen }
export function leesLetterlijst(tekst) {
  const regels = String(tekst ?? '').split(/\r?\n/).map(l => l.replace(AFVINK, '').trim()).filter(Boolean);
  const namen = [];
  const perKleur = [];
  const waarschuwingen = [];
  let huidig = null;
  for (const l of regels) {
    // "J – Perzikkleur": één teken, streep, kleur
    let m = l.match(new RegExp(`^(\\S)\\s*${STREEP}\\s*(.+)$`, 'u'));
    if (m && /\p{L}/u.test(m[2]) && tekens(m[1]).length === 1 && (huidig || heeftKlein(m[2]))) {
      if (!huidig) { huidig = { naam: '?', letters: [] }; namen.push(huidig); }
      huidig.letters.push({ letter: tekens(m[1])[0], kleur: kleurNaam(m[2]) });
      continue;
    }
    // "Cherry TTEGLLSLKB 10" / "Roze: A A E M M" / "Lichtblauw — ZSKE… — 17": kleur (met kleine letters) + letters (hoofdletters)
    m = l.match(new RegExp(`^(.*?\\p{Ll}.*?)\\s*${STREEP}?\\s+([\\p{Lu}\\p{N}&!?'’.]+(?:\\s+[\\p{Lu}\\p{N}&!?'’.]+)*)(?:\\s*${STREEP}?\\s*(\\d+))?$`, 'u'));
    if (m && !isHoofd(m[1])) {
      // "TTEGLLSLKB 10" zonder streep: het laatste getal is het aantal
      const stukken = m[2].trim().split(/\s+/);
      let aantal = m[3];
      if (!aantal && stukken.length > 1 && /^\d+$/.test(stukken.at(-1))) aantal = stukken.pop();
      const letters = tekens(stukken.join(''));
      if (aantal && Number(aantal) !== letters.length) waarschuwingen.push(`${kleurNaam(m[1])}: ${letters.length} letters gelezen, maar het aantal zegt ${aantal}. Kijk de lijst na.`);
      perKleur.push({ kleur: kleurNaam(m[1].replace(new RegExp(`${STREEP}$`), '')), letters });
      continue;
    }
    // "EMMA: roze" / "LIAM: blauw, wit, blauw, wit"
    m = l.match(new RegExp(`^([^:–—]+?)\\s*[:–—]\\s*(.+)$`, 'u'));
    if (m && isHoofd(m[1]) && heeftKlein(m[2])) {
      const naam = m[1].trim(), letters = tekens(naam.replace(/\s+/g, ''));
      const kleuren = m[2].split(/\s*[,/;]\s*|\s+en\s+/).map(kleurNaam).filter(Boolean);
      if (kleuren.length !== 1 && kleuren.length !== letters.length) waarschuwingen.push(`${naam}: ${kleuren.length} kleuren voor ${letters.length} letters. Geef één kleur of een kleur per letter.`);
      namen.push({ naam, letters: letters.map((letter, i) => ({ letter, kleur: kleuren.length === 1 ? kleuren[0] : kleuren[i] ?? kleuren[kleuren.length - 1] })) });
      huidig = null;
      continue;
    }
    // "JULIETTE" (of "Juliette"): een naam, de letters volgen
    if (/^[\p{L}\p{N}\s'’&.\-]+$/u.test(l)) { huidig = { naam: l.trim().toLocaleUpperCase('nl-BE'), letters: [] }; namen.push(huidig); continue; }
    waarschuwingen.push(`Niet begrepen: "${l}"`);
  }
  for (const n of namen) {
    if (!n.letters.length) waarschuwingen.push(`${n.naam}: geen letters met een kleur gevonden.`);
    else if (n.naam !== '?' && tekens(n.naam.replace(/\s+/g, '')).join('') !== n.letters.map(x => x.letter).join('')) {
      waarschuwingen.push(`${n.naam}: de letters (${n.letters.map(x => x.letter).join('')}) komen niet overeen met de naam. Kijk de lijst na.`);
    }
  }
  if (namen.length && perKleur.length) waarschuwingen.push('De lijst mengt namen en kleuren; beide worden meegeteld.');
  // dezelfde kleur met andere hoofdletters ("Oat"/"oat") = één kleur: de schrijfwijze van de eerste keer
  const schrijf = new Map();
  const eén = k => { const s = k.toLowerCase(); if (!schrijf.has(s)) schrijf.set(s, k.charAt(0).toLocaleUpperCase('nl-BE') + k.slice(1)); return schrijf.get(s); };
  for (const n of namen) for (const x of n.letters) x.kleur = eén(x.kleur);
  for (const k of perKleur) k.kleur = eén(k.kleur);
  const teller = new Map();
  const tel = (letter, kleur) => { const k = `${letter}\u0000${kleur.toLowerCase()}`; const v = teller.get(k) || { letter, kleur, aantal: 0 }; v.aantal += 1; teller.set(k, v); };
  for (const n of namen) for (const x of n.letters) tel(x.letter, x.kleur);
  for (const k of perKleur) for (const letter of k.letters) tel(letter, k.kleur);
  const items = [...teller.values()].sort((a, b) => a.kleur.localeCompare(b.kleur, 'nl') || a.letter.localeCompare(b.letter, 'nl'));
  return { bron: namen.length ? 'naam' : 'kleur', namen: namen.filter(n => n.letters.length).length ? namen.filter(n => n.letters.length) : null, items, waarschuwingen };
}

// ── kleur → filament ─────────────────────────────────────────────────────
const ONTHOUD = 'letter_kleuren';   // instelling: { "oat": filament-id, … }
const onthouden = db => { try { return JSON.parse(db.prepare('SELECT waarde FROM instellingen WHERE sleutel = ?').get(ONTHOUD)?.waarde || '{}'); } catch { return {}; } };
function filamentNaam(db, id) {
  const r = db.prepare(`SELECT fm.naam merk, fmat.naam materiaal, k.naam kleur FROM artikelen a JOIN filament_types ft ON ft.id = a.filament_type_id
    JOIN filament_merken fm ON fm.id = ft.merk_id JOIN filament_materialen fmat ON fmat.id = ft.materiaal_id JOIN filament_kleuren k ON k.id = a.kleur_id
    WHERE a.id = ? AND a.type = 'filament'`).get(id);
  return r ? `${r.merk} ${r.materiaal} · ${r.kleur}` : null;
}
// palet: Map label/slug (kleine letters) → { filamentName } (webshop)
export function kleurenVoor(db, items, palet = new Map()) {
  const kaart = filamentKaart(db), eerder = onthouden(db);
  const labels = [...new Map(items.map(i => [i.kleur.toLowerCase(), i.kleur])).values()];
  return labels.map(label => {
    const k = label.toLowerCase();
    let id = eerder[k] && filamentNaam(db, eerder[k]) ? eerder[k] : null, bron = id ? 'onthouden' : null;
    const p = palet.get(k);
    if (!id && p?.filamentName) { id = kaart.get(norm(p.filamentName)) ?? null; if (id) bron = 'webshop'; }
    return { label, filament_id: id, filament: id ? filamentNaam(db, id) : null, bron, webshop: p?.filamentName || null,
      letters: items.filter(i => i.kleur.toLowerCase() === k).reduce((t, i) => t + i.aantal, 0) };
  });
}

// Wat er gelezen werd + per letter of er een plaat is + de kleuren
export function voorbeeldLetters(db, { tekst, artikel_id }, palet) {
  const a = artikel_id ? artikelMetProfiel(db, artikel_id) : null;
  if (!a || a.type !== 'artikel' || !a.zelf_geprint) throw new DomeinFout('Kies het product (een zelf geprint artikel met een letterprofiel).');
  if (!isLetterProfiel(a.profiel)) throw new DomeinFout(`${a.naam} heeft nog geen letterprofiel. Lees het 3mf-bestand in bij het artikel (Printprofiel → Uit slicerbestand → "Elke plaat is een letter").`);
  const l = leesLetterlijst(tekst);
  const items = l.items.map(i => ({ ...i, plaat: !!letterPlaat(a.profiel, i.letter) }));
  const zonder = [...new Set(items.filter(i => !i.plaat).map(i => i.letter))];
  return { ...l, items, product: a.naam, totaal: items.reduce((t, i) => t + i.aantal, 0), zonder_plaat: zonder, kleuren: kleurenVoor(db, items, palet) };
}

// Regels toevoegen aan een dossier. kleuren: { label: filament_id } (keuzes uit het voorbeeld)
export function voegLettersToe(db, dossier, { tekst, artikel_id, kleuren = {} }, palet) {
  const v = voorbeeldLetters(db, { tekst, artikel_id }, palet);
  if (!v.items.length) throw new DomeinFout('Geen letters gevonden in de lijst.');
  if (v.zonder_plaat.length) throw new DomeinFout(`Geen plaat in het letterprofiel voor: ${v.zonder_plaat.join(' ')}. Vul het profiel aan of pas de lijst aan.`);
  const keuze = new Map(v.kleuren.map(k => [k.label.toLowerCase(), Number(kleuren[k.label] ?? kleuren[k.label.toLowerCase()]) || k.filament_id || null]));
  const zonderFil = v.kleuren.filter(k => !keuze.get(k.label.toLowerCase()) || !filamentNaam(db, keuze.get(k.label.toLowerCase()))).map(k => k.label);
  if (zonderFil.length) throw new DomeinFout(`Kies het filament voor: ${zonderFil.join(', ')}.`);
  const a = artikelMetProfiel(db, artikel_id);
  // slicerbestand van het product: één kopie bij het dossier
  let slicer = null, kopie = null;
  const bl = a.profiel.slicer_bijlage_id ? db.prepare(`SELECT * FROM bijlagen WHERE id = ? AND entiteit = 'artikel'`).get(a.profiel.slicer_bijlage_id) : null;
  if (bl && fs.existsSync(path.join(bijlagenMap(), bl.pad))) {
    kopie = `dossier-${dossier.id}-${crypto.randomUUID()}${path.extname(bl.pad)}`;
    fs.copyFileSync(path.join(bijlagenMap(), bl.pad), path.join(bijlagenMap(), kopie));
  }
  try {
    return db.transaction(() => {
      if (kopie) slicer = Number(db.prepare('INSERT INTO bijlagen (entiteit, entiteit_id, bestandsnaam, pad, mimetype, grootte) VALUES (?,?,?,?,?,?)')
        .run('dossier', dossier.id, bl.bestandsnaam, kopie, bl.mimetype, bl.grootte).lastInsertRowid);
      const nieuw = v.items.map(i => {
        const pl = letterPlaat(a.profiel, i.letter);
        const r = regelUitProfiel(pl, i.aantal);
        const fil = keuze.get(i.kleur.toLowerCase());
        const gram = r.materialen.reduce((t, m) => t + (Number(m.gram) || 0), 0);
        return { type: 'printen', omschrijving: `${a.naam} ${i.letter} – ${i.kleur}`, aantal: i.aantal, printer_id: pl.printer_id ?? null,
          tijd_min: r.tijd_min, voorbereiding_min: r.voorbereiding_min, nabewerking_min: r.nabewerking_min, per_stuk: 1, per_plaat: r.per_plaat ?? 1,
          materialen: [{ artikel_id: fil, gram: Math.round(gram * 100) / 100 }], artikel_id: a.id,
          ...(slicer && pl.slicer_plaat ? { slicer_bijlage_id: slicer, slicer_plaat: pl.slicer_plaat } : {}) };
      });
      bewaarRegels(db, dossier.id, leesRegels([...leesRegelsVan(db, dossier.id), ...nieuw]));
      // de bestelling zelf (namen, kleuren) bij het dossier, voor de overzichten
      const oud = (() => { try { return JSON.parse(db.prepare('SELECT letters FROM dossiers WHERE id = ?').get(dossier.id)?.letters || '[]'); } catch { return []; } })();
      const kl = Object.fromEntries(v.kleuren.map(k => [k.label, { filament_id: keuze.get(k.label.toLowerCase()), filament: filamentNaam(db, keuze.get(k.label.toLowerCase())) }]));
      oud.push({ op: new Date().toISOString(), artikel_id: a.id, product: a.naam, bron: v.bron, namen: v.namen,
        items: v.items.map(({ letter, kleur, aantal }) => ({ letter, kleur, aantal, omschrijving: `${a.naam} ${letter} – ${kleur}` })), kleuren: kl });
      db.prepare('UPDATE dossiers SET letters = ? WHERE id = ?').run(JSON.stringify(oud), dossier.id);
      // kleurkeuzes onthouden voor de volgende keer
      const eerder = onthouden(db);
      for (const k of v.kleuren) eerder[k.label.toLowerCase()] = keuze.get(k.label.toLowerCase());
      db.prepare(`INSERT INTO instellingen (sleutel, waarde, label) VALUES (?, ?, 'Letters: kleur → filament') ON CONFLICT(sleutel) DO UPDATE SET waarde = excluded.waarde`).run(ONTHOUD, JSON.stringify(eerder));
      logGebeurtenis(db, 'dossier', dossier.id, 'gewijzigd', `${v.totaal} letters toegevoegd (${v.bron === 'naam' ? `${v.namen?.length ?? 0} namen` : `${v.kleuren.length} kleuren`}): ${nieuw.length} printregels`);
      return { regels: nieuw.length, letters: v.totaal };
    })();
  } catch (e) {
    if (kopie) try { fs.unlinkSync(path.join(bijlagenMap(), kopie)); } catch { /* al weg */ }
    throw e;
  }
}
