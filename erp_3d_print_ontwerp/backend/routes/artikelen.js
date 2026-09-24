import { Router } from 'express';
import { getDb } from '../db.js';

const r = Router();

function isConstraintError(e) {
  return typeof e.message === 'string' && e.message.includes('FOREIGN KEY constraint failed');
}
function isUniqueError(e) {
  return typeof e.message === 'string' && e.message.includes('UNIQUE constraint failed');
}

// ── Artikelen (onderdelen + eindproducten + diensten) ───────────────────────
// Generiek, los van Filament/Voorraad — dat blijft filament-specifiek
// (merk/type/kleur/verkoopprijs-per-kg). Eén gedeelde catalogus met een
// categorie-vlag: 'onderdeel' (losse component, met voorraad — bv.
// sleutelhanger-ringetjes), 'eindproduct' (afgewerkt, verkoopklaar product,
// met voorraad — bv. voor de webshop, sinds db_migration_v5.js) of 'dienst'
// (prijslijst zonder voorraad — bv. verzendkosten, ontwerp op maat).
// 'onderdeel' en 'eindproduct' gebruiken allebei hetzelfde per-eenheid +
// batch_id-patroon als filament_rollen (zie db_migration_v4.js) voor hun
// voorraad — een 'dienst' heeft geen voorraadrijen.
const CATEGORIEN_MET_VOORRAAD = ['onderdeel', 'eindproduct'];

// Prijsmodel per categorie (bevestigd 2026-09-22, zie db_migration_v6.js):
// - onderdeel    → inkoopprijs + marge_pct VERPLICHT (de frontend rekent
//                  hiermee een voorstel-verkoopprijs voor, maar de
//                  uiteindelijk opgeslagen `verkoopprijs` komt hier gewoon
//                  binnen als een normaal veld — de backend legt géén
//                  rekenkundige relatie op, dat zou de "manueel
//                  overschrijfbaar"-afspraak breken).
// - eindproduct  → enkel verkoopprijs verplicht; productieprijs optioneel en
//                  zuiver informatief (geen koppeling met de verkoopprijs).
// - dienst       → ongewijzigd, enkel verkoopprijs (+ evt. vaste_prijs).
// inkoopprijs/marge_pct/productieprijs worden voor een niet-toepasselijke
// categorie altijd op NULL gezet, ongeacht wat er in de body meekomt — zo
// kan een categoriewissel in de UI nooit een verouderde waarde laten
// "hangen" in de databank.
function valideerTypeBody(body) {
  const naam = String(body.naam || '').trim();
  if (!naam) return { fout: 'Naam is verplicht' };
  const categorie = body.categorie;
  if (!['onderdeel', 'eindproduct', 'dienst'].includes(categorie)) {
    return { fout: 'Categorie moet \'onderdeel\', \'eindproduct\' of \'dienst\' zijn' };
  }
  const verkoopprijs = parseFloat(body.verkoopprijs);
  if (!Number.isFinite(verkoopprijs) || verkoopprijs < 0) return { fout: 'Verkoopprijs moet een geldig, niet-negatief getal zijn' };

  let inkoopprijs = null;
  let margePct = null;
  if (categorie === 'onderdeel') {
    inkoopprijs = parseFloat(body.inkoopprijs);
    if (!Number.isFinite(inkoopprijs) || inkoopprijs < 0) return { fout: 'Inkoopprijs is verplicht bij een onderdeel en moet een geldig, niet-negatief getal zijn' };
    margePct = parseFloat(body.marge_pct);
    if (!Number.isFinite(margePct) || margePct < 0) return { fout: 'Marge% is verplicht bij een onderdeel en moet een geldig, niet-negatief getal zijn' };
  }

  let productieprijs = null;
  if (categorie === 'eindproduct' && body.productieprijs !== undefined && body.productieprijs !== null && body.productieprijs !== '') {
    productieprijs = parseFloat(body.productieprijs);
    if (!Number.isFinite(productieprijs) || productieprijs < 0) return { fout: 'Productieprijs moet een geldig, niet-negatief getal zijn (of leeg)' };
  }

  let minAantal = null;
  if (body.min_aantal !== undefined && body.min_aantal !== null && body.min_aantal !== '') {
    minAantal = parseInt(body.min_aantal, 10);
    if (!Number.isInteger(minAantal) || minAantal < 0) return { fout: 'Minimum aantal moet een geheel getal ≥ 0 zijn (of leeg = geen bestel-opvolging)' };
  }
  return { naam, categorie, verkoopprijs, inkoopprijs, margePct, productieprijs, minAantal, vastePrijs: !!body.vaste_prijs };
}

r.get('/types', (req, res) => {
  const rows = getDb().prepare(`SELECT * FROM artikel_types ORDER BY categorie, naam COLLATE NOCASE`).all();
  res.json(rows);
});

r.post('/types', (req, res) => {
  const v = valideerTypeBody(req.body);
  if (v.fout) return res.status(400).json({ error: v.fout });
  const { eenheid, notities } = req.body;
  const db = getDb();
  const bestaand = db.prepare('SELECT naam FROM artikel_types WHERE naam = ? COLLATE NOCASE').get(v.naam);
  if (bestaand) return res.status(400).json({ error: `Artikel "${bestaand.naam}" bestaat al` });
  try {
    const result = db.prepare(`
      INSERT INTO artikel_types (naam,categorie,eenheid,verkoopprijs,inkoopprijs,marge_pct,productieprijs,vaste_prijs,min_aantal,notities)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(v.naam, v.categorie, eenheid || null, v.verkoopprijs, v.inkoopprijs, v.margePct, v.productieprijs, v.vastePrijs ? 1 : 0, v.minAantal, notities || null);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (e) {
    if (isUniqueError(e)) return res.status(400).json({ error: 'Dit artikel bestaat al' });
    res.status(500).json({ error: e.message });
  }
});

r.put('/types/:id', (req, res) => {
  const v = valideerTypeBody(req.body);
  if (v.fout) return res.status(400).json({ error: v.fout });
  const { eenheid, notities } = req.body;
  const db = getDb();
  const bestaand = db.prepare('SELECT id, naam FROM artikel_types WHERE naam = ? COLLATE NOCASE').get(v.naam);
  if (bestaand && bestaand.id !== Number(req.params.id)) {
    return res.status(400).json({ error: `Artikel "${bestaand.naam}" bestaat al` });
  }
  try {
    const info = db.prepare(`
      UPDATE artikel_types SET naam=?,categorie=?,eenheid=?,verkoopprijs=?,inkoopprijs=?,marge_pct=?,productieprijs=?,vaste_prijs=?,min_aantal=?,notities=?
      WHERE id=?
    `).run(v.naam, v.categorie, eenheid || null, v.verkoopprijs, v.inkoopprijs, v.margePct, v.productieprijs, v.vastePrijs ? 1 : 0, v.minAantal, notities || null, req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Niet gevonden' });
    res.json({ ok: true });
  } catch (e) {
    if (isUniqueError(e)) return res.status(400).json({ error: 'Dit artikel bestaat al' });
    res.status(500).json({ error: e.message });
  }
});

r.delete('/types/:id', (req, res) => {
  try {
    const info = getDb().prepare('DELETE FROM artikel_types WHERE id = ?').run(req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Niet gevonden' });
    res.json({ ok: true });
  } catch (e) {
    if (isConstraintError(e)) {
      return res.status(400).json({ error: 'Dit artikel heeft nog voorraad — verwijder die eerst.' });
    }
    res.status(500).json({ error: e.message });
  }
});

// ── Voorraad (enkel voor categorie 'onderdeel') ─────────────────────────────

r.get('/voorraad', (req, res) => {
  const db = getDb();
  let sql = `
    SELECT v.*, t.naam, t.categorie, t.eenheid, t.verkoopprijs, t.vaste_prijs, t.min_aantal
    FROM artikel_voorraad v
    JOIN artikel_types t ON t.id = v.artikel_type_id
  `;
  if (req.query.actief === '1') sql += ' WHERE v.actief = 1';
  else if (req.query.actief === '0') sql += ' WHERE v.actief = 0';
  sql += ' ORDER BY t.naam COLLATE NOCASE';
  res.json(db.prepare(sql).all());
});

function valideerVoorraadBody(body) {
  const artikelTypeId = parseInt(body.artikel_type_id, 10);
  if (!Number.isInteger(artikelTypeId)) return 'Artikel is verplicht';
  return null;
}

// Zelfde atomische batch-aanpak als filament_rollen (zie routes/filament.js):
// 1 of meerdere identieke stuks in 1 transactie, delen een batch_id.
r.post('/voorraad', (req, res) => {
  const db = getDb();
  const fout = valideerVoorraadBody(req.body);
  if (fout) return res.status(400).json({ error: fout });

  const artikelTypeId = parseInt(req.body.artikel_type_id, 10);
  const type = db.prepare('SELECT categorie FROM artikel_types WHERE id = ?').get(artikelTypeId);
  if (!type) return res.status(400).json({ error: 'Onbekend artikel' });
  if (!CATEGORIEN_MET_VOORRAAD.includes(type.categorie)) {
    return res.status(400).json({ error: 'Een dienst heeft geen voorraad' });
  }

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
    INSERT INTO artikel_voorraad (artikel_type_id,aankoopprijs_eur,locatie,gekocht_op,actief,batch_id,factuur_id)
    VALUES (?,?,?,?,1,?,?)
  `);
  const zetBatchId = db.prepare(`UPDATE artikel_voorraad SET batch_id = ? WHERE id = ?`);

  const maakBatch = db.transaction((n) => {
    const eersteId = insert.run(artikelTypeId, prijs, locatie || null, gekocht_op || null, null, factuurId).lastInsertRowid;
    zetBatchId.run(eersteId, eersteId);
    const ids = [eersteId];
    for (let i = 1; i < n; i++) {
      const id = insert.run(artikelTypeId, prijs, locatie || null, gekocht_op || null, eersteId, factuurId).lastInsertRowid;
      ids.push(id);
    }
    return { eersteId, ids };
  });

  try {
    const { eersteId, ids } = maakBatch(aantal);
    res.status(201).json({ id: eersteId, batch_id: eersteId, ids });
  } catch (e) {
    if (isConstraintError(e)) return res.status(400).json({ error: 'Onbekend artikel of factuur' });
    res.status(500).json({ error: e.message });
  }
});

r.put('/voorraad/:id', (req, res) => {
  const db = getDb();
  const fout = valideerVoorraadBody(req.body);
  if (fout) return res.status(400).json({ error: fout });

  const artikelTypeId = parseInt(req.body.artikel_type_id, 10);
  const { locatie, gekocht_op, aankoopprijs_eur, actief } = req.body;
  let prijs = null;
  if (aankoopprijs_eur !== undefined && aankoopprijs_eur !== null && aankoopprijs_eur !== '') {
    prijs = parseFloat(aankoopprijs_eur);
    if (!Number.isFinite(prijs) || prijs < 0) return res.status(400).json({ error: 'Aankoopprijs moet een geldig, niet-negatief getal zijn (of leeg)' });
  }

  try {
    const info = db.prepare(`
      UPDATE artikel_voorraad SET
        artikel_type_id=?, aankoopprijs_eur=?, locatie=?, gekocht_op=?, actief=?
      WHERE id=?
    `).run(artikelTypeId, prijs, locatie || null, gekocht_op || null, actief ? 1 : 0, req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Niet gevonden' });
    res.json({ ok: true });
  } catch (e) {
    if (isConstraintError(e)) return res.status(400).json({ error: 'Onbekend artikel' });
    res.status(500).json({ error: e.message });
  }
});

r.delete('/voorraad/:id', (req, res) => {
  const info = getDb().prepare('DELETE FROM artikel_voorraad WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Niet gevonden' });
  res.json({ ok: true });
});

// ── Te bestellen — zelfde logica als filament: elke actieve eenheid telt als
// 1, tegen het instelbare min_aantal. Enkel categorieën mét voorraad
// ('onderdeel', 'eindproduct') doen mee — een dienst heeft geen voorraad,
// dus ook geen bestel-opvolging.
//
// Zelfde fix als filament.js (2026-09-22): de telling gebeurt over ALLE
// voorraadrijen van dat artikel, niet enkel de actieve — anders verdwijnt een
// artikel waarvan alle eenheden inactief zijn volledig uit de groepering en
// dus ook uit "te bestellen", ook al is 0 < min_aantal per definitie waar.
r.get('/te-bestellen', (req, res) => {
  const rows = getDb().prepare(`
    SELECT t.id AS artikel_type_id, t.naam, t.categorie, t.min_aantal,
           COUNT(CASE WHEN v.actief = 1 THEN 1 END) AS aantal
    FROM artikel_voorraad v
    JOIN artikel_types t ON t.id = v.artikel_type_id
    WHERE t.categorie IN ('onderdeel','eindproduct')
    GROUP BY t.id
    HAVING t.min_aantal IS NOT NULL AND aantal < t.min_aantal
    ORDER BY t.naam COLLATE NOCASE
  `).all();
  res.json(rows);
});

export default r;
