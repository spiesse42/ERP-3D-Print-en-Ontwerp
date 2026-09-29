// ═══════════════════════════════════════════════════════════════════════
// DOSSIERS SAMENVOEGEN (29-09)
// ═══════════════════════════════════════════════════════════════════════
// Bv. drie bestellingen van dezelfde klant op verschillende dagen → één
// dossier. Naar het DOELdossier gaan van elk brondossier:
// - de regels (achteraan, in hun volgorde) → hun printopdrachten en runs
//   volgen vanzelf (die hangen aan de regel), net als de productiekost
// - de leveringen (pakbonnen; hun regels verwijzen naar dezelfde regels)
// - de bijlagen (foto's, slicerbestanden) en de notities
// Het brondossier blijft als verwijzing: fase "Samengevoegd", gearchiveerd,
// met zijn verstuurde offertes als historiek.
// Voorwaarden: alle dossiers open (niet afgerekend, gratis of geannuleerd),
// zelfde soort en zelfde klant, en geen aanvaarde offerte (de werkbon zou
// anders enkel de offerteprijs aanrekenen en de extra regels vergeten).
// Is een van de dossiers al gestart, dan is het doel dat ook: werkbon
// (klantopdracht) en printopdrachten voor de nieuwe regels.
import { DomeinFout } from './hulp.js';
import { logGebeurtenis } from './historiek.js';
import { leesDossier } from './dossiers.js';
import { maakWerkbon } from './documenten.js';
import { synchroniseer } from '../productie/opdrachten.js';

const aanvaard = d => d.offertes.find(o => o.aanvaard_op);

export function voegSamen(db, doelId, bronIds) {
  const ids = [...new Set((Array.isArray(bronIds) ? bronIds : []).map(Number))];
  if (!ids.length || ids.some(n => !Number.isInteger(n) || n <= 0)) throw new DomeinFout('Kies minstens één dossier om samen te voegen');
  if (ids.includes(doelId)) throw new DomeinFout('Een dossier kan niet met zichzelf samengevoegd worden');
  const doel = leesDossier(db, doelId);
  if (!doel) throw Object.assign(new DomeinFout('Dossier niet gevonden'), { status: 404 });
  if (!doel.acties.samenvoegen) throw new DomeinFout(`${doel.nummer} is afgerekend, gratis geleverd, geannuleerd of al samengevoegd: er kan niets meer bij.`);
  if (aanvaard(doel)) throw new DomeinFout(`${doel.nummer} heeft een aanvaarde offerte (${aanvaard(doel).weergave}): de werkbon rekent dan enkel die prijs aan. Maak eerst het antwoord op de offerte ongedaan (tab Offertes) en maak na het samenvoegen een nieuwe offerte.`);

  const bronnen = ids.map(id => {
    const b = leesDossier(db, id);
    if (!b) throw new DomeinFout(`Dossier ${id} niet gevonden`);
    if (!b.acties.samenvoegen) throw new DomeinFout(`${b.nummer} is afgerekend, gratis geleverd, geannuleerd of al samengevoegd.`);
    if (b.soort !== doel.soort) throw new DomeinFout(`${b.nummer} is van een ander soort dossier dan ${doel.nummer}.`);
    if ((b.klant_id ?? null) !== (doel.klant_id ?? null)) throw new DomeinFout(`${b.nummer} is van een andere klant dan ${doel.nummer}.`);
    if (aanvaard(b)) throw new DomeinFout(`${b.nummer} heeft een aanvaarde offerte (${aanvaard(b).weergave}). Maak eerst het antwoord op de offerte ongedaan.`);
    return b;
  });

  let volgorde = (db.prepare('SELECT MAX(volgorde) m FROM dossier_regels WHERE dossier_id = ?').get(doelId).m ?? -1) + 1;
  let gestart = doel.gestart_op;
  const notities = [doel.notities].filter(Boolean);
  const regelsVan = db.prepare('SELECT id FROM dossier_regels WHERE dossier_id = ? ORDER BY volgorde, id');
  const zetRegel = db.prepare('UPDATE dossier_regels SET dossier_id = ?, volgorde = ? WHERE id = ?');
  for (const b of bronnen) {
    const regels = regelsVan.all(b.id);
    for (const r of regels) zetRegel.run(doelId, volgorde++, r.id);
    const lev = db.prepare('UPDATE leveringen SET dossier_id = ? WHERE dossier_id = ?').run(doelId, b.id).changes;
    const bij = db.prepare(`UPDATE bijlagen SET entiteit_id = ? WHERE entiteit = 'dossier' AND entiteit_id = ?`).run(doelId, b.id).changes;
    if (b.gestart_op && (!gestart || b.gestart_op < gestart)) gestart = b.gestart_op;
    if (b.notities) notities.push(`Uit ${b.nummer} (${b.titel}):\n${b.notities}`);
    db.prepare(`UPDATE dossiers SET samengevoegd_op = date('now'), samengevoegd_in = ?, gearchiveerd = 1 WHERE id = ?`).run(doelId, b.id);
    const wat = [`${regels.length} regel${regels.length === 1 ? '' : 's'}`, lev && `${lev} levering${lev === 1 ? '' : 'en'}`, bij && `${bij} bijlage${bij === 1 ? '' : 'n'}`].filter(Boolean).join(', ');
    logGebeurtenis(db, 'dossier', b.id, 'status', `Samengevoegd in ${doel.nummer} (${wat}); gearchiveerd`);
    logGebeurtenis(db, 'dossier', doelId, 'status', `${b.nummer} "${b.titel}" hierin samengevoegd (${wat})`);
  }
  db.prepare('UPDATE dossiers SET gestart_op = ?, notities = ? WHERE id = ?').run(gestart, notities.join('\n\n') || null, doelId);
  // gestart → werkbon (klant) + printopdrachten voor regels die er nog geen hebben
  if (gestart) {
    if (doel.soort === 'klant') maakWerkbon(db, doelId, { waarom: 'dossiers samengevoegd' });
    synchroniseer(db, doelId);
  }
}
