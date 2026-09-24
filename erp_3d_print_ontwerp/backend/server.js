import { initDb } from './db/index.js';
import { maakApp } from './app.js';
import { startWachter } from './productie/wachter.js';
import { startAutoBackup } from './domein/onderhoud.js';

// 3010 i.p.v. het gebruikelijkere 3000: op dell-test blokkeert Windows poort
// 3000 met EACCES (permission denied), vermoedelijk een Hyper-V/WSL2/Docker
// Desktop-poortreservering. Aanpasbaar via de PORT-omgevingsvariabele.
const PORT = process.env.PORT || 3010;

initDb();
maakApp().listen(PORT, '0.0.0.0', () => {
  console.log(`ERP 3D Print & Ontwerp draait op poort ${PORT}`);
  // Printerwachter (stap 6a): leest de printers via Home Assistant, ook
  // zonder open tabblad. PRINTERWACHTER=uit schakelt hem uit.
  if (process.env.PRINTERWACHTER !== 'uit') startWachter();
  // Automatische backup (stap 8): bij het opstarten en elke 24 u. BACKUP=uit schakelt uit.
  startAutoBackup();
});
