// ═══════════════════════════════════════════════════════════════════════
// TELLINGLIJST (23-11) — voorraad naar Excel voor een stocktelling, en de
// ingevulde lijst terug inlezen in het scherm Voorraadtelling
// ═══════════════════════════════════════════════════════════════════════
// Kolom "Geteld" is leeg (geel) om in te vullen of af te drukken; "Verschil"
// rekent Excel zelf. De kolom ID dient om de lijst terug in te lezen.
import ExcelJS from 'exceljs';
import { DomeinFout } from './hulp.js';
import { leesArtikelen } from './artikelen.js';

const KOP = ['ID', 'Artikel', 'Soort', 'Categorie', 'Locatie', 'Eenheid', 'Systeem', 'Geteld', 'Verschil', 'Waarde (€)'];

export async function tellingExcel(db, { datum }) {
  const waarde = db.prepare(`SELECT SUM(aantal_resterend * prijs_per_eenheid) w FROM voorraad_partijen WHERE artikel_id = ? AND aantal_resterend > 0 AND prijs_per_eenheid IS NOT NULL`);
  const lijst = leesArtikelen(db, { archief: '0' }).filter(a => a.type !== 'dienst')
    .sort((a, b) => (a.type === b.type ? 0 : a.type === 'filament' ? -1 : 1) || String(a.categorie || '').localeCompare(String(b.categorie || ''), 'nl') || String(a.weergave).localeCompare(String(b.weergave), 'nl'));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ERP 3D Print & Ontwerp';
  const ws = wb.addWorksheet('Telling', {
    views: [{ state: 'frozen', ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '3:3', margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: 'Pagina &P van &N' },
  });
  ws.getCell('A1').value = `Voorraadtelling ${datum.split('-').reverse().join('-')}`;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = 'Vul de kolom "Geteld" in. Leeg = niet geteld. Daarna: ERP → Voorraad → Voorraadtelling → "Telling inlezen".';
  ws.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };
  ws.getRow(3).values = KOP;
  ws.getRow(3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(3).eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16345A' } }; });
  [6, 42, 10, 18, 14, 9, 10, 10, 10, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  lijst.forEach((a, i) => {
    const r = 4 + i;
    const w = waarde.get(a.id)?.w;
    ws.getRow(r).values = [a.id, a.weergave, a.type === 'filament' ? 'Filament' : 'Artikel', a.categorie || '', a.locatie || '', a.eenheid || 'stuk',
      Math.round(Number(a.voorraad || 0) * 1000) / 1000, null, { formula: `IF(H${r}="","",H${r}-G${r})` }, w == null ? null : Math.round(w * 100) / 100];
    ws.getCell(`H${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF6CC' } };
    ws.getCell(`H${r}`).border = { bottom: { style: 'thin', color: { argb: 'FFBBBBBB' } } };
    ws.getCell(`J${r}`).numFmt = '#,##0.00';
  });
  const tot = 4 + lijst.length;
  ws.getCell(`I${tot}`).value = 'Totaal';
  ws.getCell(`I${tot}`).font = { bold: true };
  ws.getCell(`J${tot}`).value = { formula: `SUM(J4:J${tot - 1})` };
  ws.getCell(`J${tot}`).numFmt = '#,##0.00';
  ws.getCell(`J${tot}`).font = { bold: true };
  ws.autoFilter = { from: 'A3', to: `J${Math.max(3, tot - 1)}` };
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), aantal: lijst.length };
}

// Ingevulde lijst → [{ artikel_id, geteld }] (enkel ingevulde rijen).
// Zoekt de kolommen "ID" en "Geteld" in de kopregel (eerste 10 rijen).
export async function leesTellingExcel(db, buffer) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new DomeinFout('Dit is geen geldig Excel-bestand (.xlsx).'); }
  const ws = wb.worksheets[0];
  if (!ws) throw new DomeinFout('Het Excel-bestand heeft geen werkblad.');
  const tekst = v => String(v?.result ?? v?.text ?? v ?? '').trim();
  let kop = null, idK = null, telK = null;
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !kop; r++) {
    ws.getRow(r).eachCell((c, k) => {
      const t = tekst(c.value).toLowerCase();
      if (t === 'id') idK = k;
      if (t === 'geteld') telK = k;
    });
    if (idK && telK) kop = r; else { idK = null; telK = null; }
  }
  if (!kop) throw new DomeinFout('Kolommen "ID" en "Geteld" niet gevonden. Gebruik de lijst uit "Tellingslijst (Excel)".');
  const bestaat = db.prepare(`SELECT 1 FROM artikelen WHERE id = ? AND type != 'dienst'`);
  const uit = [], fouten = [];
  for (let r = kop + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const idT = tekst(row.getCell(idK).value), telT = tekst(row.getCell(telK).value);
    if (!idT || telT === '') continue;
    const id = Number(idT), n = Number(telT.replace(',', '.'));
    if (!Number.isInteger(id) || !bestaat.get(id)) { fouten.push(`rij ${r}: onbekend artikel (ID ${idT})`); continue; }
    if (!Number.isFinite(n) || n < 0) { fouten.push(`rij ${r}: "${telT}" is geen geldig aantal`); continue; }
    uit.push({ artikel_id: id, geteld: n });
  }
  return { regels: uit, fouten };
}
