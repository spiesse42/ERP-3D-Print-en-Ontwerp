// ═══════════════════════════════════════════════════════════════════════
// /api/onderhoud — versie, databank, backups (stap 8)
// ═══════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import fs from 'fs';
import { DomeinFout } from '../domein/hulp.js';
import { info, lijstBackups, maakBackup, backupBestand, bijlagenInfo, ruimSlicerbestandenOp } from '../domein/onderhoud.js';

// Versie: die van de add-on (build_deploy schrijft versie.json mee, 29-09),
// anders die van package.json (lokaal).
const leesJson = pad => { try { return JSON.parse(fs.readFileSync(new URL(pad, import.meta.url), 'utf8')); } catch { return null; } };
const pkg = { version: leesJson('../versie.json')?.versie || leesJson('../package.json')?.version };
const r = Router();
const fout = (res, e) => res.status(e.status || (e instanceof DomeinFout ? 400 : 500)).json({ error: e.message });

r.get('/', (req, res) => { try { res.json({ ...info(pkg.version), backups: lijstBackups(), bijlagen: bijlagenInfo(req.query.maanden) }); } catch (e) { fout(res, e); } });
// Slicerbestanden van lang afgesloten dossiers opruimen (29-09)
r.post('/slicer-opruimen', (req, res) => { try { res.json(ruimSlicerbestandenOp(req.body?.maanden)); } catch (e) { fout(res, e); } });
r.post('/backups', async (req, res) => { try { res.status(201).json({ naam: await maakBackup('manueel'), backups: lijstBackups() }); } catch (e) { fout(res, e); } });
r.get('/backups/:naam', (req, res) => {
  try { res.download(backupBestand(req.params.naam), req.params.naam); } catch (e) { fout(res, e); }
});

export default r;
