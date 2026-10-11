// Foto van een printrun (11-10): bestand in de bijlagenmap (submap runs),
// naam in printruns.foto. Zelf toevoegen kan ook (route).
import fs from 'fs';
import path from 'path';
import { bijlagenMap } from '../db/index.js';

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
export const runFotoPad = naam => path.join(bijlagenMap(), 'runs', path.basename(naam));
export function bewaarRunFoto(db, runId, { type, data }) {
  if (!data?.length) return null;
  const naam = `run-${runId}-${Date.now()}${EXT[String(type).split(';')[0]] || '.jpg'}`;
  fs.mkdirSync(path.join(bijlagenMap(), 'runs'), { recursive: true });
  fs.writeFileSync(runFotoPad(naam), data);
  const oud = db.prepare('SELECT foto FROM printruns WHERE id = ?').get(runId)?.foto;
  db.prepare('UPDATE printruns SET foto = ? WHERE id = ?').run(naam, runId);
  if (oud) try { fs.unlinkSync(runFotoPad(oud)); } catch { /* al weg */ }
  return naam;
}
