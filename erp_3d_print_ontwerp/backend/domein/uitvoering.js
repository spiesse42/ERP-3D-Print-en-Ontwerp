// ═══════════════════════════════════════════════════════════════════════
// UITVOERING STARTEN (automatische flow, 25-09-2026)
// ═══════════════════════════════════════════════════════════════════════
// Knop "Starten" op een dossier (keuze B), en automatisch bij "offerte
// aanvaard":
// - klantopdracht → werkbon (ook met enkel ontwerp/aanpassing)
// - elke printregel met printer → printopdracht (aantal en omschrijving van
//   de regel); eigen product / intern: enkel printopdrachten
// Daarna volgen de printopdrachten de regels (productie/opdrachten.js →
// synchroniseer).
import { logGebeurtenis } from './historiek.js';
import { maakWerkbon } from './documenten.js';
import { synchroniseer } from '../productie/opdrachten.js';

export function start(db, dossierId, { waarom = null } = {}) {
  const d = db.prepare('SELECT id, soort, gestart_op FROM dossiers WHERE id = ?').get(dossierId);
  if (!d) return;
  if (!d.gestart_op) {
    db.prepare(`UPDATE dossiers SET gestart_op = datetime('now') WHERE id = ?`).run(dossierId);
    logGebeurtenis(db, 'dossier', dossierId, 'status', `Uitvoering gestart${waarom ? ` (${waarom})` : ''}`);
  }
  if (d.soort === 'klant') maakWerkbon(db, dossierId, { waarom: waarom || 'Starten' });
  synchroniseer(db, dossierId);
}
