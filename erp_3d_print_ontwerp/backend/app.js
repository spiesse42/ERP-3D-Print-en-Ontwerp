// De Express-app zelf, los van het opstarten (server.js), zodat de tests
// dezelfde app kunnen starten tegen een testdatabank.
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import klanten from './routes/klanten.js';
import tarieven from './routes/tarieven.js';
import instellingen from './routes/instellingen.js';
import catalogus from './routes/catalogus.js';
import historiek from './routes/historiek.js';
import voorraad from './routes/voorraad.js';
import leveranciers from './routes/leveranciers.js';
import inkoop from './routes/inkoop.js';
import inlezen from './routes/inlezen.js';
import bijlagen from './routes/bijlagen.js';
import printers from './routes/printers.js';
import bereken from './routes/bereken.js';
import controles from './routes/controles.js';
import dossiers from './routes/dossiers.js';
import nummering from './routes/nummering.js';
import documenten from './routes/documenten.js';
import leveringen from './routes/leveringen.js';
import productie from './routes/productie.js';
import financien from './routes/financien.js';
import onderhoud from './routes/onderhoud.js';
import verkopen from './routes/verkopen.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export function maakApp() {
  const app = express();
  const isProduction = process.env.NODE_ENV === 'production';

  // Zelfde opzet als het oude pakket: via Home Assistant Ingress heeft de app
  // geen cross-origin API nodig. CORS enkel expliciet open voor de lokale
  // Vite-devserver tijdens ontwikkeling.
  if (!isProduction) {
    app.use(cors({
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    }));
  }
  app.use(express.json());

  // CSRF-bescherming voor muterende verzoeken — zelfde patroon als het oude
  // pakket (Ingress deelt dezelfde origin; verzoeken van andere sites geweigerd).
  // Enkel zinvol in PRODUCTIE: daar delen frontend en backend exact dezelfde
  // origin (HA Ingress), dus Origin- en Host-header horen altijd gelijk te
  // zijn — een mismatch betekent dan een echt cross-origin verzoek.
  // In ONTWIKKELING draait de Vite-devserver op een andere poort (5173) en
  // proxyt die naar hier (3010); de Host-header die de backend via die proxy
  // binnenkrijgt komt daardoor niet betrouwbaar overeen met de Origin-header
  // van de browser (afhankelijk van de proxy-instellingen), waardoor elk
  // opslaan/bewerken/verwijderen hier onterecht op geweigerd werd — de
  // cors()-whitelist hierboven (enkel de Vite-devserver toegestaan) geeft in
  // dev al voldoende bescherming, dus deze check slaat daar over.
  if (isProduction) {
    app.use((req, res, next) => {
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
      const origin = req.get('origin');
      if (!origin) return next();
      let originHost;
      try { originHost = new URL(origin).host; } catch {
        return res.status(403).json({ error: 'Ongeldige Origin-header.' });
      }
      if (originHost !== req.get('host')) {
        return res.status(403).json({ error: 'Cross-origin verzoek geweigerd.' });
      }
      next();
    });
  }

  if (process.env.NODE_ENV !== 'test') {
    app.use((req, res, next) => {
      console.log(`${req.method} ${req.url}`);
      next();
    });
  }

  app.use('/api/klanten',      klanten);
  app.use('/api/tarieven',     tarieven);
  app.use('/api/instellingen', instellingen);
  app.use('/api/historiek',    historiek);
  // Catalogus (merken/materialen/kleuren/prijsgroepen) op /api/filament.
  app.use('/api/filament',     catalogus);
  app.use('/api/voorraad',     voorraad);      // stap 3a
  app.use('/api/leveranciers', leveranciers);  // stap 3a/3b
  app.use('/api/inkoop/inlezen', inlezen);     // stap 3c (vóór /api/inkoop)
  app.use('/api/inkoop',       inkoop);        // stap 3b
  app.use('/api/bijlagen',     bijlagen);      // stap 3b
  app.use('/api/printers',     printers);      // stap 4
  app.use('/api/bereken',      bereken);       // stap 4 (rekenmotor)
  app.use('/api/controles',    controles);     // stap 4b (ontbrekende gegevens)
  app.use('/api/dossiers',     dossiers);      // stap 5a
  app.use('/api/nummering',    nummering);     // stap 5a
  app.use('/api',              documenten);    // stap 5b (offertes, werkbon, PDF, mail)
  app.use('/api',              leveringen);    // stap 5c (leveringen, pakbon)
  app.use('/api/productie',    productie);     // stap 6a (printers live, runs)
  app.use('/api/financien',    financien);     // stap 7
  app.use('/api/onderhoud',    onderhoud);     // stap 8 (backups)
  app.use('/api/verkopen',     verkopen);      // 26-09 (losse verkoop, bonnetjes)

  // Onbekende API-route: nette JSON-fout i.p.v. de index.html van de frontend.
  app.use('/api', (req, res) => res.status(404).json({ error: 'Onbekende API-route' }));

  // Frontend. index.html krijgt een <base href> met het Home Assistant
  // Ingress-pad (header X-Ingress-Path), zodat relatieve paden (./api,
  // ./assets) en diepe links zoals /klanten/12 overal kloppen, ook na een
  // herlaad van de pagina. Lokaal is dat gewoon "/".
  const frontendPath = path.join(__dirname, '..', 'frontend', 'dist');
  app.use(express.static(frontendPath, { index: false }));
  app.get('*', (req, res) => {
    let html;
    try { html = fs.readFileSync(path.join(frontendPath, 'index.html'), 'utf8'); }
    catch { return res.status(503).send('Frontend nog niet gebouwd (npm run build in frontend/).'); }
    const ingress = String(req.get('X-Ingress-Path') || '').replace(/[^A-Za-z0-9/_-]/g, '').replace(/\/+$/, '');
    res.type('html').send(html.replace('<base href="/" />', `<base href="${ingress}/" />`));
  });
  return app;
}
