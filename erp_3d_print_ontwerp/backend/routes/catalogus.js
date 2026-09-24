// ═══════════════════════════════════════════════════════════════════════
// CATALOGUS — merken, materialen, kleuren en prijsgroepen (merk + type)
// ═══════════════════════════════════════════════════════════════════════
// Overgenomen uit de vroegere routes/filament.js (stap 1, 23-09-2026): enkel
// het catalogusdeel. Rollen en "te bestellen" zitten sinds stap 3a in
// routes/voorraad.js (partijen + mutaties). Blijft op /api/filament.

import { Router } from 'express';
import { getDb } from '../db/index.js';
import { isFkFout as isConstraintError, isUniekFout } from '../domein/hulp.js';

const r = Router();

const HEX_PATRONO = /^#[0-9a-fA-F]{6}$/;


// ── Kleine catalogi: merken, materialen, kleuren ────────────────────────────
// Elk hetzelfde patroon: lijst + toevoegen. Hier komen de 3 keuzelijsten van
// de catalogus (merk/type/kleur) uit, plus (voor merken/materialen) het
// "Materiaal"-tabblad in Instellingen. Naam-duplicaten worden hoofdletter-
// ongevoelig geweigerd met een duidelijke melding, zodat je niet per ongeluk
// "PLA" en "pla" naast elkaar krijgt.

function maakCatalogusRoutes(pad, tabel, naamLabel) {
  r.get(`/${pad}`, (req, res) => {
    const rows = getDb().prepare(`SELECT id, naam FROM ${tabel} ORDER BY naam COLLATE NOCASE`).all();
    res.json(rows);
  });

  r.post(`/${pad}`, (req, res) => {
    const naam = String(req.body.naam || '').trim();
    if (!naam) return res.status(400).json({ error: `${naamLabel} is verplicht` });
    const db = getDb();
    const bestaand = db.prepare(`SELECT naam FROM ${tabel} WHERE naam = ? COLLATE NOCASE`).get(naam);
    if (bestaand) return res.status(400).json({ error: `${naamLabel} "${bestaand.naam}" bestaat al` });
    try {
      const result = db.prepare(`INSERT INTO ${tabel} (naam) VALUES (?)`).run(naam);
      res.status(201).json({ id: result.lastInsertRowid, naam });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

maakCatalogusRoutes('merken', 'filament_merken', 'Merk');
maakCatalogusRoutes('materialen', 'filament_materialen', 'Type');

r.get('/kleuren', (req, res) => {
  const rows = getDb().prepare('SELECT id, naam, hex FROM filament_kleuren ORDER BY naam COLLATE NOCASE').all();
  res.json(rows);
});

r.post('/kleuren', (req, res) => {
  const naam = String(req.body.naam || '').trim();
  const hex = String(req.body.hex || '').trim();
  if (!naam) return res.status(400).json({ error: 'Kleurnaam is verplicht' });
  if (!HEX_PATRONO.test(hex)) return res.status(400).json({ error: 'Kleurcode moet een geldige hex-code zijn, bv. #FF8800' });
  const db = getDb();
  const bestaand = db.prepare('SELECT naam FROM filament_kleuren WHERE naam = ? COLLATE NOCASE').get(naam);
  if (bestaand) return res.status(400).json({ error: `Kleur "${bestaand.naam}" bestaat al` });
  try {
    const result = db.prepare('INSERT INTO filament_kleuren (naam, hex) VALUES (?,?)').run(naam, hex);
    res.status(201).json({ id: result.lastInsertRowid, naam, hex });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Filamenttypes (merk + materiaal → verkoopprijs/kg voor de
// kostenberekening) — beheerd via Instellingen → Materiaal, niet in Voorraad.
// De verkoopprijs/kg is bewust een rechtstreeks in te stellen waarde, geen
// inkoopprijs+marge: inkoopprijs varieert toch al per rol/bestelling (zie
// voorraad_partijen.prijs_per_eenheid) en dit maakt materiaal consistent met hoe
// de andere tarieven (machine, arbeid, ...) al werken — vaste, zelf te kiezen
// tarieven i.p.v. een berekening. Zie sessie-overleg voor de volledige afweging.

function valideerTypeBody(body) {
  const merkId = parseInt(body.merk_id, 10);
  const materiaalId = parseInt(body.materiaal_id, 10);
  if (!Number.isInteger(merkId)) return { fout: 'Merk is verplicht' };
  if (!Number.isInteger(materiaalId)) return { fout: 'Type is verplicht' };
  const prijs = parseFloat(body.verkoopprijs_per_kg);
  if (!Number.isFinite(prijs) || prijs < 0) return { fout: 'Verkoopprijs per kg moet een geldig, niet-negatief getal zijn' };
  let dichtheid = null;
  if (body.dichtheid_g_per_cm3 !== undefined && body.dichtheid_g_per_cm3 !== null && body.dichtheid_g_per_cm3 !== '') {
    dichtheid = parseFloat(body.dichtheid_g_per_cm3);
    if (!Number.isFinite(dichtheid) || dichtheid <= 0) return { fout: 'Dichtheid moet een geldig, positief getal zijn (of leeg)' };
  }
  let minRollen = null;
  if (body.min_rollen !== undefined && body.min_rollen !== null && body.min_rollen !== '') {
    minRollen = parseInt(body.min_rollen, 10);
    if (!Number.isInteger(minRollen) || minRollen < 0) return { fout: 'Minimum aantal rollen moet een geheel getal ≥ 0 zijn (of leeg = geen bestel-opvolging)' };
  }
  let maxRollen = null;
  if (body.max_rollen !== undefined && body.max_rollen !== null && body.max_rollen !== '') {
    maxRollen = parseInt(body.max_rollen, 10);
    if (!Number.isInteger(maxRollen) || maxRollen < 0) return { fout: 'Maximum aantal rollen moet een geheel getal ≥ 0 zijn (of leeg)' };
    if (minRollen !== null && maxRollen < minRollen) return { fout: 'Het maximum aantal rollen mag niet kleiner zijn dan het minimum' };
  }
  // Rolgewicht (migratie 003): standaard 1000 g, voor de kostprijs per kg.
  let rolgewicht = 1000;
  if (body.rolgewicht_g !== undefined && body.rolgewicht_g !== null && body.rolgewicht_g !== '') {
    rolgewicht = parseFloat(String(body.rolgewicht_g).replace(',', '.'));
    if (!Number.isFinite(rolgewicht) || rolgewicht <= 0) return { fout: 'Rolgewicht moet een getal groter dan 0 zijn (in gram)' };
  }
  return { merkId, materiaalId, prijs, dichtheid, minRollen, maxRollen, rolgewicht };
}

r.get('/types', (req, res) => {
  const rows = getDb().prepare(`
    SELECT ft.*, m.naam AS merk, mat.naam AS materiaal
    FROM filament_types ft
    JOIN filament_merken m ON m.id = ft.merk_id
    JOIN filament_materialen mat ON mat.id = ft.materiaal_id
    ORDER BY m.naam COLLATE NOCASE, mat.naam COLLATE NOCASE
  `).all();
  res.json(rows);
});

r.post('/types', (req, res) => {
  const v = valideerTypeBody(req.body);
  if (v.fout) return res.status(400).json({ error: v.fout });
  const { leverancier, notities } = req.body;
  const db = getDb();
  try {
    const result = db.prepare(`
      INSERT INTO filament_types (merk_id,materiaal_id,verkoopprijs_per_kg,dichtheid_g_per_cm3,leverancier,min_rollen,max_rollen,rolgewicht_g,notities)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(v.merkId, v.materiaalId, v.prijs, v.dichtheid, leverancier || null, v.minRollen, v.maxRollen, v.rolgewicht, notities || null);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (e) {
    if (isUniekFout(e)) {
      return res.status(400).json({ error: 'Voor deze combinatie van merk en type bestaat al een verkoopprijs — pas het bestaande record aan.' });
    }
    if (isConstraintError(e)) return res.status(400).json({ error: 'Onbekend merk of type' });
    res.status(500).json({ error: e.message });
  }
});

r.put('/types/:id', (req, res) => {
  const v = valideerTypeBody(req.body);
  if (v.fout) return res.status(400).json({ error: v.fout });
  const { leverancier, notities } = req.body;
  const db = getDb();
  try {
    const info = db.prepare(`
      UPDATE filament_types SET merk_id=?,materiaal_id=?,verkoopprijs_per_kg=?,dichtheid_g_per_cm3=?,leverancier=?,min_rollen=?,max_rollen=?,rolgewicht_g=?,notities=?
      WHERE id=?
    `).run(v.merkId, v.materiaalId, v.prijs, v.dichtheid, leverancier || null, v.minRollen, v.maxRollen, v.rolgewicht, notities || null, req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Niet gevonden' });
    res.json({ ok: true });
  } catch (e) {
    if (isUniekFout(e)) {
      return res.status(400).json({ error: 'Voor deze combinatie van merk en type bestaat al een verkoopprijs.' });
    }
    if (isConstraintError(e)) return res.status(400).json({ error: 'Onbekend merk of type' });
    res.status(500).json({ error: e.message });
  }
});

r.delete('/types/:id', (req, res) => {
  try {
    const info = getDb().prepare('DELETE FROM filament_types WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Niet gevonden' });
    res.json({ ok: true });
  } catch (e) {
    if (isConstraintError(e)) {
      return res.status(400).json({ error: 'Deze prijsgroep is nog gekoppeld aan artikelen in de catalogus — archiveer of verwijder die eerst.' });
    }
    res.status(500).json({ error: e.message });
  }
});

export default r;
