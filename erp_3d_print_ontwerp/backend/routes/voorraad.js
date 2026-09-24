// ═══════════════════════════════════════════════════════════════════════
// /api/voorraad — artikelen, boekingen, mutaties, te bestellen, telling,
// categorieën (stap 3a)
// ═══════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import { getDb } from '../db/index.js';
import { DomeinFout, isFkFout, isUniekFout, rond } from '../domein/hulp.js';
import { logGebeurtenis, beschrijfWijzigingen, wisHistoriek } from '../domein/historiek.js';
import { leesArtikelen, leesArtikel, leesArtikelInvoer, leesLeveranciersInvoer, categoriePaden, maakArtikel, KOLOMMEN } from '../domein/artikelen.js';
import { boekIn, boekUit, corrigeer, teBestellen, REDENEN_IN, REDENEN_UIT } from '../domein/voorraad.js';

const r = Router();

// Eén foutafhandeling voor alle routes hier: regelfouten → 400 met uitleg.
function metFouten(fn) {
  return (req, res) => {
    try { fn(req, res); } catch (e) {
      if (e instanceof DomeinFout) return res.status(400).json({ error: e.message });
      if (isUniekFout(e)) return res.status(400).json({ error: uniekTekst(e) });
      if (isFkFout(e)) return res.status(400).json({ error: 'Onbekende prijsgroep, kleur, categorie of leverancier' });
      res.status(500).json({ error: e.message });
    }
  };
}
function uniekTekst(e) {
  const m = e.message;
  if (m.includes('artikelen.filament_type_id')) return 'Voor deze prijsgroep en kleur bestaat al een artikel';
  if (m.includes('artikelen.naam')) return 'Er bestaat al een artikel of dienst met deze naam';
  if (m.includes('artikel_leveranciers')) return 'Deze productcode van de leverancier is al aan een ander artikel gekoppeld';
  if (m.includes('categorieen')) return 'Er bestaat al een categorie met deze naam op die plaats';
  return 'Bestaat al';
}
const idVan = req => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new DomeinFout('Ongeldig id');
  return id;
};
const fmt = n => String(rond(n)).replace('.', ',');
const euro = n => `€ ${Number(n).toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

// ── Artikelen ─────────────────────────────────────────────────────────────
r.get('/artikelen', metFouten((req, res) => {
  const type = req.query.type || null;
  res.json(leesArtikelen(getDb(), { archief: String(req.query.archief ?? '0'), type }));
}));

r.get('/artikelen/:id', metFouten((req, res) => {
  const a = leesArtikel(getDb(), idVan(req));
  if (!a) return res.status(404).json({ error: 'Artikel niet gevonden' });
  res.json(a);
}));

// Labels voor de historiek. Id's worden eerst naar namen vertaald.
const LABELS = {
  type: 'Type', naam: 'Naam', prijsgroep: 'Prijsgroep', kleur: 'Kleur', categorie: 'Categorie',
  gekocht: 'Wordt gekocht', verkocht: 'Wordt verkocht', zelf: 'Printen we zelf', eenheid: 'Eenheid',
  verkoopprijs: 'Verkoopprijs', inkoopprijs: 'Inkoopprijs', marge_pct: 'Marge %', productieprijs: 'Productieprijs',
  vast: 'Vaste prijs', min_voorraad: 'Minimum', max_voorraad: 'Maximum', locatie: 'Locatie', notities: 'Notities',
};
function voorHistoriek(db, a) {
  const paden = categoriePaden(db);
  const pg = a.filament_type_id ? db.prepare(`SELECT m.naam || ' ' || mat.naam n FROM filament_types ft
    JOIN filament_merken m ON m.id = ft.merk_id JOIN filament_materialen mat ON mat.id = ft.materiaal_id WHERE ft.id = ?`).get(a.filament_type_id)?.n : null;
  const kleur = a.kleur_id ? db.prepare('SELECT naam FROM filament_kleuren WHERE id = ?').get(a.kleur_id)?.naam : null;
  const jn = v => (v ? 'ja' : 'nee');
  return {
    ...a, prijsgroep: pg, kleur, categorie: a.categorie_id ? paden.get(a.categorie_id) : null,
    gekocht: jn(a.wordt_gekocht), verkocht: jn(a.wordt_verkocht), zelf: jn(a.zelf_geprint), vast: jn(a.vaste_prijs),
  };
}

function bewaarLeveranciers(db, artikelId, lijst) {
  if (lijst === undefined) return false;
  const oud = db.prepare(`SELECT leverancier_id, productcode, omschrijving, laatste_prijs, levertijd_dagen, voorkeur
    FROM artikel_leveranciers WHERE artikel_id = ? ORDER BY voorkeur DESC, id`).all(artikelId);
  db.prepare('DELETE FROM artikel_leveranciers WHERE artikel_id = ?').run(artikelId);
  const ins = db.prepare(`INSERT INTO artikel_leveranciers (artikel_id, leverancier_id, productcode, omschrijving, laatste_prijs, levertijd_dagen, voorkeur)
    VALUES (?,?,?,?,?,?,?)`);
  for (const l of lijst) ins.run(artikelId, l.leverancier_id, l.productcode, l.omschrijving, l.laatste_prijs, l.levertijd_dagen, l.voorkeur);
  const sleutel = rijen => JSON.stringify([...rijen].map(l => [l.leverancier_id, l.productcode, l.omschrijving, l.laatste_prijs, l.levertijd_dagen, l.voorkeur]).sort());
  return sleutel(oud) !== sleutel(lijst);
}

const HERKOMST = { proefberekening: 'Aangemaakt vanuit de proefberekening', dossier: 'Aangemaakt vanuit een dossier' };

r.post('/artikelen', metFouten((req, res) => {
  const db = getDb();
  const a = leesArtikelInvoer(req.body);
  const lev = leesLeveranciersInvoer(req.body.leveranciers);
  // Herkomst voor de historiek, enkel uit een vaste lijst (geen vrije tekst).
  const tekst = HERKOMST[req.body?.herkomst] || null;
  const id = db.transaction(() => {
    const nieuw = maakArtikel(db, a, tekst);
    bewaarLeveranciers(db, nieuw, lev);
    return nieuw;
  })();
  res.status(201).json({ id });
}));

r.put('/artikelen/:id', metFouten((req, res) => {
  const db = getDb();
  const id = idVan(req);
  const oud = db.prepare('SELECT * FROM artikelen WHERE id = ?').get(id);
  if (!oud) return res.status(404).json({ error: 'Artikel niet gevonden' });
  const a = leesArtikelInvoer(req.body);
  const lev = leesLeveranciersInvoer(req.body.leveranciers);
  if (a.type !== oud.type) {
    const gebruikt = db.prepare('SELECT (SELECT COUNT(*) FROM voorraad_mutaties WHERE artikel_id = ?) + (SELECT COUNT(*) FROM aankoop_regels WHERE artikel_id = ?) n').get(id, id).n;
    if (gebruikt) throw new DomeinFout('Het type kan niet meer veranderen: er zijn al voorraadbewegingen of aankopen voor dit artikel');
  }
  db.transaction(() => {
    db.prepare(`UPDATE artikelen SET ${KOLOMMEN.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...KOLOMMEN.map(k => a[k]), id);
    const levGewijzigd = bewaarLeveranciers(db, id, lev);
    let tekst = beschrijfWijzigingen(voorHistoriek(db, oud), voorHistoriek(db, a), LABELS);
    if (levGewijzigd) tekst = [tekst, 'Leveranciersgegevens gewijzigd'].filter(Boolean).join('; ');
    if (tekst) logGebeurtenis(db, 'artikel', id, 'gewijzigd', tekst);
  })();
  res.json({ ok: true });
}));

r.patch('/artikelen/:id/archief', metFouten((req, res) => {
  const db = getDb();
  const id = idVan(req);
  const aan = req.body?.gearchiveerd ? 1 : 0;
  const oud = db.prepare('SELECT gearchiveerd FROM artikelen WHERE id = ?').get(id);
  if (!oud) return res.status(404).json({ error: 'Artikel niet gevonden' });
  if (oud.gearchiveerd === aan) return res.json({ ok: true });
  db.transaction(() => {
    db.prepare('UPDATE artikelen SET gearchiveerd = ? WHERE id = ?').run(aan, id);
    logGebeurtenis(db, 'artikel', id, aan ? 'gearchiveerd' : 'hersteld', null);
  })();
  res.json({ ok: true });
}));

// Echt verwijderen kan enkel zolang er niets naar het artikel verwijst
// (voorraad, aankopen). Anders: archiveren.
r.delete('/artikelen/:id', (req, res) => {
  const db = getDb();
  try {
    const id = idVan(req);
    const weg = db.transaction(() => {
      const n = db.prepare('DELETE FROM artikelen WHERE id = ?').run(id).changes;
      if (n) wisHistoriek(db, 'artikel', id);
      return n;
    })();
    if (!weg) return res.status(404).json({ error: 'Artikel niet gevonden' });
    res.json({ ok: true });
  } catch (e) {
    if (isFkFout(e)) return res.status(400).json({ error: 'Dit artikel heeft al voorraadbewegingen of aankopen. Archiveer het in plaats van te verwijderen.' });
    if (e instanceof DomeinFout) return res.status(400).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// ── Partijen en boekingen ────────────────────────────────────────────────
r.get('/artikelen/:id/partijen', metFouten((req, res) => {
  // herkomst: aankoop, of (stap 6c) de printopdracht/het dossier dat de stuks maakte
  res.json(getDb().prepare(`SELECT p.*, ak.nummer AS aankoop_nummer, ak.id AS aankoop_id, pd.dossier_id AS productie_dossier_id, pd.dossier_nummer AS productie_dossier_nummer
    FROM voorraad_partijen p
    LEFT JOIN aankoop_regels ar ON ar.id = p.aankoop_regel_id
    LEFT JOIN aankopen ak ON ak.id = ar.aankoop_id
    LEFT JOIN (SELECT m.partij_id, d.id AS dossier_id, d.nummer AS dossier_nummer FROM voorraad_mutaties m
      JOIN printopdrachten o ON o.id = m.bron_id JOIN dossier_regels r ON r.id = o.dossier_regel_id JOIN dossiers d ON d.id = r.dossier_id
      WHERE m.bron_type = 'printopdracht' AND m.reden = 'productie' AND m.aantal > 0) pd ON pd.partij_id = p.id
    WHERE p.artikel_id = ? ORDER BY (p.aantal_resterend > 0) DESC, p.ontvangen_op, p.id`).all(idVan(req)));
}));

// POST { richting: 'in' | 'uit' | 'corrigeer', aantal, reden?, prijs_per_eenheid?, datum?, locatie?, notitie? }
const REDEN_TEKST = { ontvangst: 'ontvangen', productie: 'geproduceerd', gebruik: 'gebruikt', levering: 'geleverd', correctie: 'correctie' };
r.post('/artikelen/:id/boeking', metFouten((req, res) => {
  const db = getDb();
  const id = idVan(req);
  const b = req.body || {};
  const notitie = b.notitie ? String(b.notitie).trim() || null : null;
  const resultaat = db.transaction(() => {
    let tekst;
    let uit;
    if (b.richting === 'in') {
      const reden = b.reden || 'ontvangst';
      if (!REDENEN_IN.includes(reden)) throw new DomeinFout('Ongeldige reden');
      const prijs = b.prijs_per_eenheid === '' || b.prijs_per_eenheid == null ? null : Number(String(b.prijs_per_eenheid).replace(',', '.'));
      uit = boekIn(db, { artikelId: id, aantal: b.aantal, prijs, datum: b.datum || null, locatie: b.locatie || null, reden, notitie });
      tekst = `+${fmt(uit.aantal)} ${REDEN_TEKST[reden]}${prijs != null ? ` aan ${euro(prijs)} per eenheid` : ''}`;
    } else if (b.richting === 'uit') {
      const reden = b.reden || 'gebruik';
      if (!REDENEN_UIT.includes(reden)) throw new DomeinFout('Ongeldige reden');
      uit = boekUit(db, { artikelId: id, aantal: b.aantal, reden, notitie });
      tekst = `−${fmt(uit.aantal)} ${REDEN_TEKST[reden]}`;
    } else if (b.richting === 'corrigeer') {
      uit = corrigeer(db, id, b.aantal, notitie);
      if (!uit.verschil) return { ...uit, ongewijzigd: true };
      tekst = `Aantal aangepast: ${fmt(uit.oud)} → ${fmt(uit.nieuw)}`;
    } else throw new DomeinFout('Richting moet in, uit of corrigeer zijn');
    logGebeurtenis(db, 'artikel', id, 'voorraad', notitie ? `${tekst} (${notitie})` : tekst);
    return uit;
  })();
  res.json(resultaat);
}));

// ── Mutaties (logboek) ───────────────────────────────────────────────────
r.get('/mutaties', metFouten((req, res) => {
  const db = getDb();
  const waar = [];
  const par = [];
  if (req.query.artikel_id) { waar.push('mu.artikel_id = ?'); par.push(Number(req.query.artikel_id)); }
  if (req.query.reden) { waar.push('mu.reden = ?'); par.push(String(req.query.reden)); }
  const limiet = Math.min(Math.max(parseInt(req.query.limiet, 10) || 500, 1), 5000);
  const rijen = db.prepare(`SELECT mu.*, a.type, a.naam, a.eenheid, m.naam merk, mat.naam materiaal, k.naam kleur, k.hex kleur_hex,
      p.prijs_per_eenheid
    FROM voorraad_mutaties mu
    JOIN artikelen a ON a.id = mu.artikel_id
    LEFT JOIN voorraad_partijen p ON p.id = mu.partij_id
    LEFT JOIN filament_types ft ON ft.id = a.filament_type_id
    LEFT JOIN filament_merken m ON m.id = ft.merk_id
    LEFT JOIN filament_materialen mat ON mat.id = ft.materiaal_id
    LEFT JOIN filament_kleuren k ON k.id = a.kleur_id
    ${waar.length ? 'WHERE ' + waar.join(' AND ') : ''}
    ORDER BY mu.tijdstip DESC, mu.id DESC LIMIT ?`).all(...par, limiet);
  res.json(rijen.map(m => ({ ...m, weergave: m.type === 'filament' ? `${m.merk} ${m.materiaal} · ${m.kleur}` : m.naam })));
}));

// ── Te bestellen ─────────────────────────────────────────────────────────
r.get('/te-bestellen', metFouten((req, res) => res.json(teBestellen(getDb()))));

// ── Voorraadtelling ──────────────────────────────────────────────────────
// POST { regels: [{ artikel_id, geteld }], notitie? } — alles of niets.
r.post('/telling', metFouten((req, res) => {
  const db = getDb();
  const regels = req.body?.regels;
  if (!Array.isArray(regels) || !regels.length) throw new DomeinFout('Geen getelde aantallen ontvangen');
  const notitie = String(req.body?.notitie || '').trim() || 'Voorraadtelling';
  const gezien = new Set();
  const uit = db.transaction(() => {
    const aangepast = [];
    for (const r0 of regels) {
      const artikelId = Number(r0?.artikel_id);
      if (!Number.isInteger(artikelId)) throw new DomeinFout('Ongeldig artikel in de telling');
      if (gezien.has(artikelId)) throw new DomeinFout('Een artikel staat twee keer in de telling');
      gezien.add(artikelId);
      if (r0.geteld === '' || r0.geteld == null) continue;
      const c = corrigeer(db, artikelId, r0.geteld, notitie);
      if (c.verschil) {
        logGebeurtenis(db, 'artikel', artikelId, 'voorraad', `Voorraadtelling: ${fmt(c.oud)} → ${fmt(c.nieuw)}`);
        aangepast.push({ artikel_id: artikelId, ...c });
      }
    }
    return aangepast;
  })();
  res.json({ aangepast: uit });
}));

// ── Categorieën (vrije boom) ─────────────────────────────────────────────
r.get('/categorieen', metFouten((req, res) => {
  const db = getDb();
  const paden = categoriePaden(db);
  const rijen = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM artikelen a WHERE a.categorie_id = c.id) AS artikelen,
      (SELECT COUNT(*) FROM categorieen k WHERE k.ouder_id = c.id) AS kinderen FROM categorieen c`).all();
  res.json(rijen.map(c => ({ ...c, pad: paden.get(c.id) })).sort((a, b) => a.pad.localeCompare(b.pad, 'nl', { sensitivity: 'base' })));
}));

function leesCategorie(db, body, id = null) {
  const naam = String(body?.naam || '').trim();
  if (!naam) throw new DomeinFout('Naam is verplicht');
  if (naam.includes('/')) throw new DomeinFout('Een categorienaam mag geen "/" bevatten');
  let ouder = body?.ouder_id === '' || body?.ouder_id == null ? null : Number(body.ouder_id);
  if (ouder !== null && !Number.isInteger(ouder)) throw new DomeinFout('Ongeldige bovenliggende categorie');
  // geen lus: de nieuwe ouder mag niet de categorie zelf of een van haar kinderen zijn
  for (let o = ouder, stap = 0; o !== null && id !== null; stap++) {
    if (o === id || stap > 50) throw new DomeinFout('Een categorie kan niet onder zichzelf of een eigen subcategorie staan');
    o = db.prepare('SELECT ouder_id FROM categorieen WHERE id = ?').get(o)?.ouder_id ?? null;
  }
  return { naam, ouder };
}

r.post('/categorieen', metFouten((req, res) => {
  const db = getDb();
  const c = leesCategorie(db, req.body);
  const id = db.prepare('INSERT INTO categorieen (naam, ouder_id) VALUES (?, ?)').run(c.naam, c.ouder).lastInsertRowid;
  res.status(201).json({ id, naam: c.naam, pad: categoriePaden(db).get(Number(id)) });
}));

r.put('/categorieen/:id', metFouten((req, res) => {
  const db = getDb();
  const id = idVan(req);
  const c = leesCategorie(db, req.body, id);
  const n = db.prepare('UPDATE categorieen SET naam = ?, ouder_id = ? WHERE id = ?').run(c.naam, c.ouder, id).changes;
  if (!n) return res.status(404).json({ error: 'Categorie niet gevonden' });
  res.json({ ok: true });
}));

r.delete('/categorieen/:id', metFouten((req, res) => {
  const db = getDb();
  const id = idVan(req);
  const c = db.prepare(`SELECT (SELECT COUNT(*) FROM artikelen WHERE categorie_id = ?) a, (SELECT COUNT(*) FROM categorieen WHERE ouder_id = ?) k`).get(id, id);
  if (c.k) throw new DomeinFout('Deze categorie heeft nog subcategorieën. Verplaats of verwijder die eerst.');
  if (c.a) throw new DomeinFout(`${c.a} artikel(en) gebruiken deze categorie. Kies eerst een andere categorie voor die artikelen.`);
  const n = db.prepare('DELETE FROM categorieen WHERE id = ?').run(id).changes;
  if (!n) return res.status(404).json({ error: 'Categorie niet gevonden' });
  res.json({ ok: true });
}));

export default r;
