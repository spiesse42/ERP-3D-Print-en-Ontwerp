// Migratie 029 — eenmalig opruimen (07-10): geplande printopdrachten van regels
// die al (volledig) geleverd zijn vervallen. Synchroniseert elk lopend dossier.
import { synchroniseer } from '../../productie/opdrachten.js';

export const versie = 29;
export const naam = 'geplande opdrachten van geleverde regels opruimen';

export function up(db) {
  const ids = db.prepare(`SELECT DISTINCT d.id FROM dossiers d JOIN dossier_regels r ON r.dossier_id = d.id
    JOIN levering_regels lr ON lr.dossier_regel_id = r.id
    WHERE d.gestart_op IS NOT NULL AND d.geannuleerd_op IS NULL AND r.type = 'printen'`).all();
  for (const { id } of ids) synchroniseer(db, id);
}
