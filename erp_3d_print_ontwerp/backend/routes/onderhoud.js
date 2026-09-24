// ═══════════════════════════════════════════════════════════════════════
// /api/onderhoud — versie, databank, backups (stap 8)
// ═══════════════════════════════════════════════════════════════════════
import { Router } from 'express';
import fs from 'fs';
import { DomeinFout } from '../domein/hulp.js';
import { info, lijstBackups, maakBackup, backupBestand } from '../domein/onderhoud.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const r = Router();
const fout = (res, e) => res.status(e.status || (e instanceof DomeinFout ? 400 : 500)).json({ error: e.message });

r.get('/', (req, res) => { try { res.json({ ...info(pkg.version), backups: lijstBackups() }); } catch (e) { fout(res, e); } });
r.post('/backups', async (req, res) => { try { res.status(201).json({ naam: await maakBackup('manueel'), backups: lijstBackups() }); } catch (e) { fout(res, e); } });
r.get('/backups/:naam', (req, res) => {
  try { res.download(backupBestand(req.params.naam), req.params.naam); } catch (e) { fout(res, e); }
});

export default r;
