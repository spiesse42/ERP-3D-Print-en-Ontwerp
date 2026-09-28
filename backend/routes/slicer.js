// ═══════════════════════════════════════════════════════════════════════
// /api/slicer — geslicet 3mf-bestand lezen (28-09)
// ═══════════════════════════════════════════════════════════════════════
// POST /   bestand (.gcode.3mf) → platen met tijd, grammen, kleuren en een
//          voorstel voor printer en filament. Er wordt niets bewaard: de
//          regeleditor maakt er printregels van, die je daarna opslaat.
import { Router } from 'express';
import multer from 'multer';
import { getDb } from '../db/index.js';
import { DomeinFout } from '../domein/hulp.js';
import { leesSlicerBestand } from '../integraties/slicer.js';
import { koppelSlicer } from '../domein/slicer.js';

const r = Router();
const MAX_MB = 200;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } });

r.post('/', (req, res) => {
  upload.single('bestand')(req, res, async (fout) => {
    if (fout) return res.status(400).json({ error: fout.code === 'LIMIT_FILE_SIZE' ? `Bestand is groter dan ${MAX_MB} MB` : fout.message });
    if (!req.file) return res.status(400).json({ error: 'Kies een geslicet 3mf-bestand (.gcode.3mf) of een gcode uit Bambu Studio, OrcaSlicer of PrusaSlicer' });
    try {
      const naam = Buffer.from(req.file.originalname || '', 'latin1').toString('utf8');
      res.json(koppelSlicer(getDb(), await leesSlicerBestand(req.file.buffer, naam)));
    } catch (e) {
      res.status(e instanceof DomeinFout ? 400 : 500).json({ error: e.message });
    }
  });
});

export default r;
