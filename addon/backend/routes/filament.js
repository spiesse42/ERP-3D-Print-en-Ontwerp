import { Router } from 'express';
import { getDb } from '../db.js';

const r = Router();

const HEX_PATRONO = /^#[0-9a-fA-F]{6}$/;

function isConstraintError(e) {
  return typeof e.message === 'string' && e.message.includes('FOREIGN KEY constraint failed');
}
function isUniqueError(e, kolom) {
  return typeof e.message === 'string' && e.message.includes('UNIQUE constraint failed') && e.message.includes(kolom);
}

// ── Kleine catalogi: merken, materialen, kleuren ────────────────────────────
// Elk hetzelfde patroon: lijst + toevoegen. Hier komen de 3 keuzelijsten van
// Voorraad (merk/type/kleur) uit, plus (voor merken/materialen) het
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
// filament_rollen.aankoopprijs_eur) en dit maakt materiaal consistent met hoe
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
  return { merkId, materiaalId, prijs, dichtheid, minRollen };
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
      INSERT INTO filament_types (merk_id,materiaal_id,verkoopprijs_per_kg,dichtheid_g_per_cm3,leverancier,min_rollen,notities)
      VALUES (?,?,?,?,?,?,?)
    `).run(v.merkId, v.materiaalId, v.prijs, v.dichtheid, leverancier || null, v.minRollen, notities || null);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (e) {
    if (isUniqueError(e, 'filament_types')) {
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
      UPDATE filament_types SET merk_id=?,materiaal_id=?,verkoopprijs_per_kg=?,dichtheid_g_per_cm3=?,leverancier=?,min_rollen=?,notities=?
      WHERE id=?
    `).run(v.merkId, v.materiaalId, v.prijs, v.dichtheid, leverancier || null, v.minRollen, notities || null, req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Niet gevonden' });
    res.json({ ok: true });
  } catch (e) {
    if (isUniqueError(e, 'filament_types')) {
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
      return res.status(400).json({ error: 'Dit merk+type heeft nog gekoppelde rollen in voorraad — verwijder die eerst.' });
    }
    res.status(500).json({ error: e.message });
  }
});

// ── Rollen ──────────────────────────────────────────────────────────────────

r.get('/rollen', (req, res) => {
  const db = getDb();
  let sql = `
    SELECT r.*, m.naam AS merk, mat.naam AS materiaal, ft.verkoopprijs_per_kg,
           k.naam AS kleur, k.hex AS kleur_hex
    FROM filament_rollen r
    JOIN filament_types ft ON ft.id = r.filament_type_id
    JOIN filament_merken m ON m.id = ft.merk_id
    JOIN filament_materialen mat ON mat.id = ft.materiaal_id
    JOIN filament_kleuren k ON k.id = r.kleur_id
  `;
  if (req.query.actief === '1') sql += ' WHERE r.actief = 1';
  else if (req.query.actief === '0') sql += ' WHERE r.actief = 0';
  sql += ' ORDER BY m.naam COLLATE NOCASE, mat.naam COLLATE NOCASE, k.naam COLLATE NOCASE';
  res.json(db.prepare(sql).all());
});

function valideerRolBody(body) {
  const filamentTypeId = parseInt(body.filament_type_id, 10);
  const kleurId = parseInt(body.kleur_id, 10);
  if (!Number.isInteger(filamentTypeId)) return 'Filamenttype (merk + type) is verplicht';
  if (!Number.isInteger(kleurId)) return 'Kleur is verplicht';
  return null;
}

// Maakt 1 of meerdere rollen in één atomische batch aan — i.p.v. de vroegere
// aanpak (frontend-lus van N losse POSTs, zie deel 22). Alle rollen uit
// dezelfde aanroep delen voortaan een batch_id (= het id van de eerst
// aangemaakte rol), zodat de Voorraad-lijst ze later gegroepeerd per
// "toevoegmoment" kan tonen i.p.v. plat door elkaar. `db.transaction()` zorgt
// dat bij een fout halverwege geen halve batch blijft staan.
r.post('/rollen', (req, res) => {
  const db = getDb();
  const fout = valideerRolBody(req.body);
  if (fout) return res.status(400).json({ error: fout });

  const filamentTypeId = parseInt(req.body.filament_type_id, 10);
  const kleurId = parseInt(req.body.kleur_id, 10);
  const { locatie, gekocht_op, aankoopprijs_eur } = req.body;
  let prijs = null;
  if (aankoopprijs_eur !== undefined && aankoopprijs_eur !== null && aankoopprijs_eur !== '') {
    prijs = parseFloat(aankoopprijs_eur);
    if (!Number.isFinite(prijs) || prijs < 0) return res.status(400).json({ error: 'Aankoopprijs moet een geldig, niet-negatief getal zijn (of leeg)' });
  }
  let aantal = 1;
  if (req.body.aantal !== undefined && req.body.aantal !== null && req.body.aantal !== '') {
    aantal = parseInt(req.body.aantal, 10);
    if (!Number.isInteger(aantal) || aantal < 1) return res.status(400).json({ error: 'Aantal moet een geheel getal ≥ 1 zijn' });
  }
  // Optioneel: koppeling naar een aankoopfactuur (Aankoopfacturen/OCR,
  // db_migration_v7.js) — leeg/ontbrekend blijft gewoon NULL, zoals voorheen.
  let factuurId = null;
  if (req.body.factuur_id !== undefined && req.body.factuur_id !== null && req.body.factuur_id !== '') {
    factuurId = parseInt(req.body.factuur_id, 10);
    if (!Number.isInteger(factuurId)) return res.status(400).json({ error: 'Ongeldige factuur-koppeling' });
  }

  const insert = db.prepare(`
    INSERT INTO filament_rollen
      (filament_type_id,kleur_id,aankoopprijs_eur,locatie,gekocht_op,actief,batch_id,factuur_id)
    VALUES (?,?,?,?,?,1,?,?)
  `);
  const zetBatchId = db.prepare(`UPDATE filament_rollen SET batch_id = ? WHERE id = ?`);

  const maakBatch = db.transaction((n) => {
    const eersteId = insert.run(filamentTypeId, kleurId, prijs, locatie || null, gekocht_op || null, null, factuurId).lastInsertRowid;
    zetBatchId.run(eersteId, eersteId);
    const ids = [eersteId];
    for (let i = 1; i < n; i++) {
      const id = insert.run(filamentTypeId, kleurId, prijs, locatie || null, gekocht_op || null, eersteId, factuurId).lastInsertRowid;
      ids.push(id);
    }
    return { eersteId, ids };
  });

  try {
    const { eersteId, ids } = maakBatch(aantal);
    res.status(201).json({ id: eersteId, batch_id: eersteId, ids });
  } catch (e) {
    if (isConstraintError(e)) return res.status(400).json({ error: 'Onbekend filamenttype, kleur of factuur' });
    res.status(500).json({ error: e.message });
  }
});

r.put('/rollen/:id', (req, res) => {
  const db = getDb();
  const fout = valideerRolBody(req.body);
  if (fout) return res.status(400).json({ error: fout });

  const filamentTypeId = parseInt(req.body.filament_type_id, 10);
  const kleurId = parseInt(req.body.kleur_id, 10);
  const { locatie, gekocht_op, aankoopprijs_eur, actief } = req.body;
  let prijs = null;
  if (aankoopprijs_eur !== undefined && aankoopprijs_eur !== null && aankoopprijs_eur !== '') {
    prijs = parseFloat(aankoopprijs_eur);
    if (!Number.isFinite(prijs) || prijs < 0) return res.status(400).json({ error: 'Aankoopprijs moet een geldig, niet-negatief getal zijn (of leeg)' });
  }

  try {
    const info = db.prepare(`
      UPDATE filament_rollen SET
        filament_type_id=?, kleur_id=?, aankoopprijs_eur=?, locatie=?, gekocht_op=?, actief=?
      WHERE id=?
    `).run(filamentTypeId, kleurId, prijs,
           locatie || null, gekocht_op || null, actief ? 1 : 0, req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Niet gevonden' });
    res.json({ ok: true });
  } catch (e) {
    if (isConstraintError(e)) return res.status(400).json({ error: 'Onbekend filamenttype of kleur' });
    res.status(500).json({ error: e.message });
  }
});

r.delete('/rollen/:id', (req, res) => {
  const info = getDb().prepare('DELETE FROM filament_rollen WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Niet gevonden' });
  res.json({ ok: true });
});

// ── Te bestellen — de ENE bron van waarheid. Elke actieve rol telt als 1,
// gegroepeerd per filamenttype + exacte kleur, tegen het instelbare
// min_rollen van het type. Een type zonder min_rollen (leeg) doet hier
// bewust nooit aan mee.
//
// Belangrijk: de telling (COUNT ... CASE) gebeurt over ALLE rollen van die
// combinatie, niet enkel de actieve — een eerdere versie filterde al op
// actief=1 vóór het groeperen (WHERE r.actief = 1), waardoor een combinatie
// waarvan ALLE rollen inactief/opgebruikt zijn helemaal geen rij meer had om
// op te groeperen en dus nooit meer in "te bestellen" verscheen, ook al is
// 0 rollen uiteraard altijd < min_rollen. Ontdekt op 2026-09-22 toen een
// batch met 1 rol volledig inactief gezet werd en niet in "te bestellen"
// verscheen ondanks min_rollen: 2.
r.get('/te-bestellen', (req, res) => {
  const rows = getDb().prepare(`
    SELECT ft.id AS filament_type_id, m.naam AS merk, mat.naam AS materiaal, ft.min_rollen,
           r.kleur_id, k.naam AS kleur, k.hex AS kleur_hex,
           COUNT(CASE WHEN r.actief = 1 THEN 1 END) AS aantal_rollen
    FROM filament_rollen r
    JOIN filament_types ft ON ft.id = r.filament_type_id
    JOIN filament_merken m ON m.id = ft.merk_id
    JOIN filament_materialen mat ON mat.id = ft.materiaal_id
    JOIN filament_kleuren k ON k.id = r.kleur_id
    GROUP BY ft.id, r.kleur_id
    HAVING ft.min_rollen IS NOT NULL AND aantal_rollen < ft.min_rollen
    ORDER BY m.naam COLLATE NOCASE, mat.naam COLLATE NOCASE, k.naam COLLATE NOCASE
  `).all();
  res.json(rows);
});

export default r;
