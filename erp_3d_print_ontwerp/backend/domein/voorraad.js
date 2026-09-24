// ═══════════════════════════════════════════════════════════════════════
// VOORRAAD — partijen + mutaties (claude/domeinmodel-v2.md)
// ═══════════════════════════════════════════════════════════════════════
// Alle voorraadbewegingen lopen via deze functies, nergens anders:
//   boekIn      nieuwe partij (+ mutatie): ontvangst, productie, correctie
//   boekUit     eraf volgens FIFO (oudste partij eerst): gebruik, levering, correctie
//   corrigeer   naar een exact aantal (voorraadtelling, "aantal aanpassen")
//   teBestellen één berekening voor "te bestellen / te produceren"
// Elke functie verwacht dat de oproeper een transactie rond het geheel zet
// als er meerdere stappen samen moeten slagen (de routes doen dat).

import { DomeinFout, rond } from './hulp.js';
import { leesArtikelen } from './artikelen.js';

export const REDENEN_IN = ['ontvangst', 'productie', 'correctie'];
export const REDENEN_UIT = ['gebruik', 'levering', 'correctie'];

function positief(aantal) {
  const n = typeof aantal === 'number' ? aantal : parseFloat(String(aantal ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) throw new DomeinFout('Aantal moet groter zijn dan 0');
  return rond(n);
}

function artikelMetVoorraad(db, artikelId) {
  const a = db.prepare('SELECT id, type FROM artikelen WHERE id = ?').get(artikelId);
  if (!a) throw new DomeinFout('Artikel niet gevonden');
  if (a.type === 'dienst') throw new DomeinFout('Een dienst heeft geen voorraad');
  return a;
}

export function voorraadVan(db, artikelId) {
  return rond(db.prepare('SELECT COALESCE(SUM(aantal_resterend), 0) v FROM voorraad_partijen WHERE artikel_id = ?').get(artikelId).v);
}

// Laatst gekende prijs per eenheid: jongste partij met een prijs, anders de
// inkoopprijs (of productieprijs) op het artikel. Gebruikt als een correctie
// er stuks bij zet, zodat de voorraadwaarde blijft kloppen.
export function laatstePrijs(db, artikelId) {
  const p = db.prepare(`SELECT prijs_per_eenheid FROM voorraad_partijen
    WHERE artikel_id = ? AND prijs_per_eenheid IS NOT NULL ORDER BY ontvangen_op DESC, id DESC LIMIT 1`).get(artikelId);
  if (p) return p.prijs_per_eenheid;
  const a = db.prepare('SELECT inkoopprijs, productieprijs FROM artikelen WHERE id = ?').get(artikelId);
  return a?.inkoopprijs ?? a?.productieprijs ?? null;
}

export function boekIn(db, { artikelId, aantal, prijs = null, datum = null, locatie = null,
  reden = 'ontvangst', notitie = null, aankoopRegelId = null, bronType = null, bronId = null }) {
  artikelMetVoorraad(db, artikelId);
  const n = positief(aantal);
  if (!REDENEN_IN.includes(reden)) throw new DomeinFout(`Onbekende reden: ${reden}`);
  if (prijs !== null && (!Number.isFinite(prijs) || prijs < 0)) throw new DomeinFout('Prijs per eenheid moet een getal ≥ 0 zijn');
  if (datum !== null && !/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw new DomeinFout('Datum moet de vorm JJJJ-MM-DD hebben');
  const partijId = db.prepare(`INSERT INTO voorraad_partijen
      (artikel_id, aankoop_regel_id, ontvangen_op, aantal_ontvangen, aantal_resterend, prijs_per_eenheid, locatie)
      VALUES (?, ?, COALESCE(?, date('now')), ?, ?, ?, ?)`)
    .run(artikelId, aankoopRegelId, datum, n, n, prijs, locatie).lastInsertRowid;
  db.prepare(`INSERT INTO voorraad_mutaties (artikel_id, partij_id, aantal, reden, bron_type, bron_id, notitie)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(artikelId, partijId, n, reden, bronType, bronId, notitie);
  return { partijId, aantal: n };
}

// Eraf volgens FIFO: eerst de oudste partij (ontvangstdatum, dan volgorde
// van invoer). Eén mutatie per aangesproken partij, zodat je later ziet uit
// welke partij (en dus aan welke prijs) er verbruikt is.
export function boekUit(db, { artikelId, aantal, reden = 'gebruik', notitie = null, bronType = null, bronId = null }) {
  artikelMetVoorraad(db, artikelId);
  const n = positief(aantal);
  if (!REDENEN_UIT.includes(reden)) throw new DomeinFout(`Onbekende reden: ${reden}`);
  const beschikbaar = voorraadVan(db, artikelId);
  if (n > beschikbaar + 1e-9) {
    throw new DomeinFout(`Onvoldoende voorraad: ${String(beschikbaar).replace('.', ',')} beschikbaar, ${String(n).replace('.', ',')} gevraagd`);
  }
  const partijen = db.prepare(`SELECT id, aantal_resterend FROM voorraad_partijen
    WHERE artikel_id = ? AND aantal_resterend > 0 ORDER BY ontvangen_op, id`).all(artikelId);
  const zet = db.prepare('UPDATE voorraad_partijen SET aantal_resterend = ? WHERE id = ?');
  const mut = db.prepare(`INSERT INTO voorraad_mutaties (artikel_id, partij_id, aantal, reden, bron_type, bron_id, notitie)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  let rest = n;
  const verdeling = [];
  for (const p of partijen) {
    if (rest <= 1e-9) break;
    const neem = rond(Math.min(rest, p.aantal_resterend));
    zet.run(rond(p.aantal_resterend - neem), p.id);
    mut.run(artikelId, p.id, -neem, reden, bronType, bronId, notitie);
    verdeling.push({ partijId: p.id, aantal: neem });
    rest = rond(rest - neem);
  }
  return { aantal: n, verdeling };
}

// Naar een exact aantal. Meer → nieuwe partij (reden correctie, aan de
// laatst gekende prijs); minder → FIFO eraf. Geeft het verschil terug.
export function corrigeer(db, artikelId, nieuwAantal, notitie = null) {
  artikelMetVoorraad(db, artikelId);
  const doel = typeof nieuwAantal === 'number' ? nieuwAantal : parseFloat(String(nieuwAantal ?? '').replace(',', '.'));
  if (!Number.isFinite(doel) || doel < 0) throw new DomeinFout('Het getelde aantal moet een getal ≥ 0 zijn');
  const oud = voorraadVan(db, artikelId);
  const verschil = rond(doel - oud);
  if (verschil > 0) boekIn(db, { artikelId, aantal: verschil, prijs: laatstePrijs(db, artikelId), reden: 'correctie', notitie });
  else if (verschil < 0) boekUit(db, { artikelId, aantal: -verschil, reden: 'correctie', notitie });
  return { oud, nieuw: rond(doel), verschil };
}

// "Te bestellen / te produceren" — één berekening voor het hele pakket.
// Een artikel staat erop als (voorraad + nog openstaand besteld + in
// productie) < minimum.
// Voorstel = aanvullen tot het maximum (of tot het minimum als er geen
// maximum is). Filament: minimum/maximum van de prijsgroep, tenzij het
// artikel (de kleur) een eigen waarde heeft.
export function teBestellen(db) {
  return leesArtikelen(db, { archief: '0' })
    .filter(a => a.type !== 'dienst' && a.min_eff != null && a.voorraad + a.besteld + a.in_productie < a.min_eff - 1e-9)
    .map(a => {
      const doel = a.max_eff ?? a.min_eff;
      let voorstel = Math.max(doel - a.voorraad - a.besteld - a.in_productie, 0);
      voorstel = (a.type === 'filament' || a.eenheid === 'stuks') ? Math.ceil(voorstel - 1e-9) : rond(voorstel);
      const lev = db.prepare(`SELECT al.*, l.naam AS leverancier FROM artikel_leveranciers al
        JOIN leveranciers l ON l.id = al.leverancier_id
        WHERE al.artikel_id = ? ORDER BY al.voorkeur DESC, al.id LIMIT 1`).get(a.id);
      return {
        ...a,
        actie: a.zelf_geprint && !a.wordt_gekocht ? 'produceren' : 'bestellen',
        voorstel,
        leverancier_id: lev?.leverancier_id ?? null,
        leverancier: lev?.leverancier ?? null,
        leverancier_code: lev?.productcode ?? null,
        leverancier_prijs: lev?.laatste_prijs ?? null,
      };
    });
}
