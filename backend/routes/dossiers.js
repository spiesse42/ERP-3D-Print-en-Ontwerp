// ═══════════════════════════════════════════════════════════════════════
// /api/dossiers (stap 5a)
// ═══════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { getDb, bijlagenMap } from '../db/index.js';
import { DomeinFout, isFkFout } from '../domein/hulp.js';
import { logGebeurtenis, beschrijfWijzigingen, wisHistoriek } from '../domein/historiek.js';
import { volgendNummer } from '../domein/nummering.js';
import { annuleerVoorDossier, synchroniseer } from '../productie/opdrachten.js';
import { start } from '../domein/uitvoering.js';
import { maakWerkbon } from '../domein/documenten.js';
import { SOORTEN, leesKop, leesRegels, bewaarRegels, leesDossier, leesDossiers, leesAfrekening, datumOk, leesRegelsVan } from '../domein/dossiers.js';

const r = Router();

function metFouten(fn) {
  return (req, res) => {
    try { fn(req, res); } catch (e) {
      if (e instanceof DomeinFout) return res.status(400).json({ error: e.message });
      if (isFkFout(e)) return res.status(400).json({ error: 'Onbekende klant, printer, artikel of filament' });
      res.status(500).json({ error: e.message });
    }
  };
}
const idVan = req => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new DomeinFout('Ongeldig id');
  return id;
};
const euro = n => `€ ${Number(n).toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmj = d => d.split('-').reverse().join('-');
function haal(db, id) {
  const d = leesDossier(db, id);
  if (!d) throw Object.assign(new DomeinFout('Dossier niet gevonden'), { status: 404 });
  return d;
}
function klantBestaat(db, kop) {
  if (kop.klant_id && !db.prepare('SELECT 1 FROM klanten WHERE id = ?').get(kop.klant_id)) throw new DomeinFout('Onbekende klant');
}

r.get('/', metFouten((req, res) => {
  const k = req.query.klant ? Number(req.query.klant) : null;
  res.json(leesDossiers(getDb(), { archief: String(req.query.archief ?? '0'), klant_id: Number.isInteger(k) ? k : null }));
}));

r.get('/:id', (req, res) => {
  try { res.json(haal(getDb(), idVan(req))); }
  catch (e) { res.status(e.status || (e instanceof DomeinFout ? 400 : 500)).json({ error: e.message }); }
});

r.post('/', metFouten((req, res) => {
  const db = getDb();
  const kop = leesKop(req.body);
  const regels = leesRegels(req.body?.regels) || [];
  klantBestaat(db, kop);
  const id = db.transaction(() => {
    const nummer = volgendNummer(db, 'D');
    const n = Number(db.prepare('INSERT INTO dossiers (nummer, soort, klant_id, titel, notities) VALUES (?,?,?,?,?)')
      .run(nummer, kop.soort, kop.klant_id, kop.titel, kop.notities).lastInsertRowid);
    bewaarRegels(db, n, regels);
    logGebeurtenis(db, 'dossier', n, 'aangemaakt', null);
    return n;
  })();
  res.status(201).json(leesDossier(db, id));
}));

const LABELS = { soort: 'Soort', klant: 'Klant', titel: 'Titel', notities: 'Notities' };
r.put('/:id', (req, res) => {
  const db = getDb();
  try {
    const id = idVan(req);
    const oud = haal(db, id);
    const kop = leesKop(req.body);
    const regels = leesRegels(req.body?.regels);
    klantBestaat(db, kop);
    // Na afrekenen of annuleren ligt het dossier vast (enkel notities).
    if (!oud.acties.bewerken) {
      const verandert = kop.soort !== oud.soort || kop.klant_id !== oud.klant_id || kop.titel !== oud.titel || regels !== undefined;
      if (verandert) throw new DomeinFout(oud.fase === 'geannuleerd'
        ? 'Dit dossier is geannuleerd. Heropen het eerst.'
        : 'Dit dossier is afgerekend en ligt vast. Maak de afrekening eerst ongedaan als je nog iets moet wijzigen.');
    }
    db.transaction(() => {
      db.prepare('UPDATE dossiers SET soort=?, klant_id=?, titel=?, notities=? WHERE id=?').run(kop.soort, kop.klant_id, kop.titel, kop.notities, id);
      // printopdrachten volgen het soort van hun dossier
      if (kop.soort !== oud.soort) db.prepare('UPDATE printopdrachten SET soort = ? WHERE dossier_regel_id IN (SELECT id FROM dossier_regels WHERE dossier_id = ?)').run(kop.soort, id);
      const naamKlant = kid => (kid ? db.prepare(`SELECT COALESCE(NULLIF(bedrijfsnaam,''), TRIM(COALESCE(voornaam,'') || ' ' || COALESCE(naam,''))) n FROM klanten WHERE id = ?`).get(kid)?.n : null);
      const delen = [];
      const t = beschrijfWijzigingen({ ...oud, soort: SOORTEN[oud.soort], klant: naamKlant(oud.klant_id) },
        { ...kop, soort: SOORTEN[kop.soort], klant: naamKlant(kop.klant_id) }, LABELS);
      if (t) delen.push(t);
      if (regels !== undefined) {
        const voor = JSON.stringify(oud.regels.map(({ id: _i, ...x }) => x));
        bewaarRegels(db, id, regels);
        // gestart dossier: printopdrachten volgen de regels (25-09)
        synchroniseer(db, id, { oudeRegels: oud.regels });
        const na = leesDossier(db, id);
        if (JSON.stringify(na.regels.map(({ id: _i, ...x }) => x)) !== voor) {
          const tv = oud.berekening.totaal, tn = na.berekening.totaal;
          delen.push(`Regels gewijzigd (${na.regels.length} regel${na.regels.length === 1 ? '' : 's'}${tv !== tn && tv != null && tn != null ? `, totaal ${euro(tv)} → ${euro(tn)}` : ''})`);
        }
      }
      if (delen.length) logGebeurtenis(db, 'dossier', id, 'gewijzigd', delen.join('; '));
    })();
    res.json(leesDossier(db, id));
  } catch (e) {
    if (isFkFout(e)) return res.status(400).json({ error: 'Onbekende klant, printer, artikel of filament' });
    res.status(e.status || (e instanceof DomeinFout ? 400 : 500)).json({ error: e.message });
  }
});

// ── werkstroom ──────────────────────────────────────────────────────────
function actie(naam, fn) {
  return (req, res) => {
    const db = getDb();
    try {
      const id = idVan(req);
      const d = haal(db, id);
      if (!d.acties[naam]) throw new DomeinFout(NIET_TOEGELATEN[naam](d));
      db.transaction(() => fn(db, d, req.body || {}))();
      res.json(leesDossier(db, id));
    } catch (e) { res.status(e.status || (e instanceof DomeinFout ? 400 : 500)).json({ error: e.message }); }
  };
}
const NIET_TOEGELATEN = {
  afrekenen: d => (d.soort !== 'klant' ? 'Enkel een klantopdracht wordt afgerekend.'
    : ['afgerekend', 'betaald', 'geannuleerd'].includes(d.fase) ? 'Dit dossier is al afgerekend of geannuleerd.'
    : 'Voeg eerst regels toe.'),
  starten: d => (d.gestart_op ? 'Dit dossier is al gestart.'
    : !d.acties.bewerken ? 'Dit dossier is afgerekend of geannuleerd.'
    : !d.regels.length ? 'Voeg eerst regels toe.' : 'Er is niets te starten: geen printregels.'),
  betaald: () => 'Enkel een afgerekend dossier kan als betaald gemarkeerd worden.',
  betaling_ongedaan: () => 'Er is geen betaling om ongedaan te maken (een bonnetje is altijd meteen betaald).',
  afrekening_ongedaan: () => 'Dit dossier is niet afgerekend.',
  annuleren: d => (d.leveringen?.length ? 'Er is al geleverd voor dit dossier. Maak eerst de leveringen ongedaan.' : 'Een afgerekend dossier kan niet geannuleerd worden. Maak de afrekening eerst ongedaan.'),
  heropenen: () => 'Dit dossier is niet geannuleerd.',
};

// Afrekenen maakt de werkbon definitief (momentopname): met aanvaarde offerte
// het offertebedrag, anders het bedrag volgens de metingen.
r.post('/:id/starten', actie('starten', (db, d) => start(db, d.id)));

r.post('/:id/afrekenen', actie('afrekenen', (db, d0, body) => {
  // nog geen werkbon → eerst automatisch aanmaken (25-09)
  const d = !d0.werkbon && maakWerkbon(db, d0.id, { waarom: 'bij het afrekenen' }) ? leesDossier(db, d0.id) : d0;
  const wb = d.werkbon;
  if (!wb.volledig || !wb.concept_document) throw new DomeinFout('Niet alle regels van de werkbon kunnen berekend worden. Los dat eerst op (zie de regels).');
  const a = leesAfrekening(body, wb.bedrag);
  const momentopname = { regels_api: leesRegelsVan(db, d.id), document: wb.concept_document, basis: wb.basis, metingen_totaal: wb.berekening?.totaal ?? null };
  db.prepare('UPDATE werkbonnen SET definitief_op = ?, momentopname = ?, totaal = ? WHERE id = ?')
    .run(a.datum, JSON.stringify(momentopname), wb.bedrag, wb.id);
  // Een bonnetje = afgerekend én betaald in één keer (dagontvangsten).
  const betaald = a.soort === 'bonnetje' ? a.datum : null;
  db.prepare(`UPDATE dossiers SET afgerekend_soort=?, afgerekend_nummer=?, afgerekend_op=?, afgerekend_bedrag=?, betaald_op=? WHERE id=?`)
    .run(a.soort, a.nummer, a.datum, a.bedrag, betaald, d.id);
  logGebeurtenis(db, 'dossier', d.id, 'status', `Afgerekend in Accountable: ${a.soort} ${a.nummer} van ${dmj(a.datum)}, ${euro(a.bedrag)}${betaald ? ' (meteen betaald)' : ''}`);
}));
r.post('/:id/betaald', actie('betaald', (db, d, body) => {
  if (!datumOk(body.datum)) throw new DomeinFout('Vul een geldige datum in');
  db.prepare('UPDATE dossiers SET betaald_op = ? WHERE id = ?').run(body.datum, d.id);
  logGebeurtenis(db, 'dossier', d.id, 'status', `Betaald op ${dmj(body.datum)}`);
}));
r.post('/:id/betaling-ongedaan', actie('betaling_ongedaan', (db, d) => {
  db.prepare('UPDATE dossiers SET betaald_op = NULL WHERE id = ?').run(d.id);
  logGebeurtenis(db, 'dossier', d.id, 'status', 'Betaling ongedaan gemaakt');
}));
r.post('/:id/afrekening-ongedaan', actie('afrekening_ongedaan', (db, d) => {
  db.prepare(`UPDATE dossiers SET afgerekend_soort=NULL, afgerekend_nummer=NULL, afgerekend_op=NULL, afgerekend_bedrag=NULL, betaald_op=NULL WHERE id=?`).run(d.id);
  // De werkbon wordt weer een concept, als nieuwe versie (domeinmodel: wijzigen na afrekenen = nieuwe versie).
  if (d.werkbon?.definitief_op) db.prepare('UPDATE werkbonnen SET definitief_op = NULL, momentopname = NULL, totaal = NULL, versie = versie + 1 WHERE id = ?').run(d.werkbon.id);
  logGebeurtenis(db, 'dossier', d.id, 'status', `Afrekening ongedaan gemaakt (was ${d.afgerekend_soort} ${d.afgerekend_nummer}). Pas dit ook aan in Accountable.`);
}));
r.post('/:id/annuleren', actie('annuleren', (db, d) => {
  const n = annuleerVoorDossier(db, d.id);
  db.prepare(`UPDATE dossiers SET geannuleerd_op = date('now') WHERE id = ?`).run(d.id);
  logGebeurtenis(db, 'dossier', d.id, 'status', `Geannuleerd${n ? ` (${n} open printopdracht${n > 1 ? 'en' : ''} mee geannuleerd)` : ''}`);
}));
r.post('/:id/heropenen', actie('heropenen', (db, d) => {
  db.prepare('UPDATE dossiers SET geannuleerd_op = NULL WHERE id = ?').run(d.id);
  logGebeurtenis(db, 'dossier', d.id, 'status', 'Heropend');
  synchroniseer(db, d.id);
}));

r.patch('/:id/archief', metFouten((req, res) => {
  const db = getDb(); const id = idVan(req);
  const g = req.body?.gearchiveerd ? 1 : 0;
  const oud = db.prepare('SELECT gearchiveerd FROM dossiers WHERE id = ?').get(id);
  if (!oud) return res.status(404).json({ error: 'Dossier niet gevonden' });
  if (oud.gearchiveerd !== g) db.transaction(() => {
    db.prepare('UPDATE dossiers SET gearchiveerd = ? WHERE id = ?').run(g, id);
    logGebeurtenis(db, 'dossier', id, g ? 'gearchiveerd' : 'hersteld', null);
  })();
  res.json({ ok: true });
}));

// Echt verwijderen: enkel als er niet afgerekend is (anders archiveren).
r.delete('/:id', (req, res) => {
  const db = getDb();
  try {
    const id = idVan(req);
    const d = haal(db, id);
    if (!d.acties.verwijderen) throw new DomeinFout(d.leveringen.length ? 'Er is al geleverd voor dit dossier. Archiveer het in plaats van te verwijderen.'
      : d.productie?.aantal_opdrachten ? 'Er zijn printopdrachten voor dit dossier. Annuleer of archiveer het in plaats van te verwijderen.'
      : d.offertes.some(o => o.verstuurd_op)
      ? 'Er is al een offerte verstuurd voor dit dossier. Annuleer of archiveer het in plaats van te verwijderen.'
      : 'Een afgerekend dossier kan niet verwijderd worden. Archiveer het.');
    const bestanden = db.prepare(`SELECT pad FROM bijlagen WHERE entiteit = 'dossier' AND entiteit_id = ?`).all(id);
    db.transaction(() => {
      db.prepare('DELETE FROM dossiers WHERE id = ?').run(id);
      db.prepare(`DELETE FROM bijlagen WHERE entiteit = 'dossier' AND entiteit_id = ?`).run(id);
      wisHistoriek(db, 'dossier', id);
    })();
    for (const b of bestanden) { try { fs.unlinkSync(path.join(bijlagenMap(), b.pad)); } catch { /* al weg */ } }
    res.json({ ok: true });
  } catch (e) { res.status(e.status || (e instanceof DomeinFout ? 400 : 500)).json({ error: e.message }); }
});

export default r;
