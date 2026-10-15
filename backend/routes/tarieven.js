import { Router } from 'express';
import { getDb } from '../db/index.js';
import { getTarieven } from '../domein/hulp.js';
import { kostPerKg } from '../productie/kost.js';

const r = Router();

r.get('/', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM tarieven ORDER BY sleutel').all());
});

// 15-10: overzicht van de prijsopbouw met de eenheidsprijzen (afdrukbaar):
// tarieven, per printer stroom + machine per uur, per prijsgroep het
// filament per kg (prijs voor de klant en je kost).
r.get('/prijsopbouw', (req, res) => {
  const db = getDb();
  const t = getTarieven(db);
  const n = v => (v == null ? null : Number(v));
  const r4 = v => (v == null ? null : Math.round(v * 10000) / 10000);
  const tarieven = db.prepare('SELECT sleutel, waarde, eenheid, label FROM tarieven ORDER BY sleutel').all();
  const faal = 1 + (n(t.faalfactor_pct) || 0) / 100, opslag = n(t.materiaal_opslag_pct) || 0, nieuw = (n(t.winst_per_printuur) || 0) > 0;
  const printers = db.prepare('SELECT id, naam, machine_per_uur, verbruik_watt, actief FROM printers ORDER BY actief DESC, naam').all().map(p => {
    const stroom = p.verbruik_watt != null && t.kwh_prijs != null ? p.verbruik_watt / 1000 * t.kwh_prijs : null;
    return { ...p, actief: !!p.actief, stroom_per_uur: r4(stroom), kost_per_uur: stroom != null && p.machine_per_uur != null ? r4(stroom + p.machine_per_uur) : null };
  });
  const groepen = db.prepare(`SELECT ft.id, m.naam || ' ' || mat.naam AS naam, ft.verkoopprijs_per_kg, ft.rolgewicht_g FROM filament_types ft
    JOIN filament_merken m ON m.id = ft.merk_id JOIN filament_materialen mat ON mat.id = ft.materiaal_id ORDER BY naam`).all().map(g => {
    const inkoop = kostPerKg(db, { filament_type_id: g.id });
    const basis = nieuw && opslag > 0 && inkoop != null ? Math.max(g.verkoopprijs_per_kg ?? 0, inkoop * opslag / 100) : g.verkoopprijs_per_kg;
    return { naam: g.naam, verkoopprijs_per_kg: g.verkoopprijs_per_kg, inkoop_per_kg: r4(inkoop), inkoop_opslag_per_kg: inkoop != null && nieuw && opslag > 0 ? r4(inkoop * opslag / 100) : null,
      prijs_per_kg: basis == null ? null : r4(basis * faal), bron: basis == null ? null : basis === g.verkoopprijs_per_kg ? 'verkoopprijs' : 'inkoop × opslag' };
  });
  res.json({ tarieven, nieuw, printers, groepen });
});

// Meerdere tarieven in één keer (formulier met Opslaan/Verwerpen):
// body = { sleutel: waarde, ... }. Alles of niets.
r.put('/', (req, res) => {
  const db = getDb();
  const invoer = req.body && typeof req.body === 'object' ? Object.entries(req.body) : [];
  if (!invoer.length) return res.status(400).json({ error: 'Geen tarieven meegegeven' });
  const bestaand = new Set(db.prepare('SELECT sleutel FROM tarieven').all().map(t => t.sleutel));
  const rijen = [];
  for (const [sleutel, w] of invoer) {
    if (!bestaand.has(sleutel)) return res.status(404).json({ error: `Onbekend tarief: ${sleutel}` });
    const waarde = typeof w === 'number' ? w : parseFloat(String(w).replace(',', '.'));
    if (!Number.isFinite(waarde) || waarde < 0) return res.status(400).json({ error: `Ongeldige waarde voor ${sleutel}` });
    rijen.push([waarde, sleutel]);
  }
  const upd = db.prepare('UPDATE tarieven SET waarde = ? WHERE sleutel = ?');
  db.transaction(() => rijen.forEach(r => upd.run(...r)))();
  res.json({ ok: true, gewijzigd: rijen.length });
});

r.put('/:sleutel', (req, res) => {
  try {
    const db = getDb();
    const waarde = parseFloat(req.body.waarde);
    if (!Number.isFinite(waarde)) return res.status(400).json({ error: 'Waarde moet een getal zijn' });
    const info = db.prepare('UPDATE tarieven SET waarde = ? WHERE sleutel = ?').run(waarde, req.params.sleutel);
    if (info.changes === 0) return res.status(404).json({ error: 'Tarief niet gevonden' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default r;
