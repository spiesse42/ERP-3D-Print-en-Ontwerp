// ═══════════════════════════════════════════════════════════════════════
// WEBSHOPBESTELLING → KLANT + KLANTDOSSIER (25-10)
// ═══════════════════════════════════════════════════════════════════════
// Voor een bestelling met iets om te printen (gepersonaliseerd, of niet op
// voorraad): de klant (op e-mailadres, anders nieuw) en een klantdossier met
// per gekozen lijn een printregel uit het printprofiel van het product:
// - het product zelf (artikel_id) → onderdelen mee in kost en levering
// - aantal, omschrijving met naam/kleur, filament van de gekozen kleur
//   (als dat filament in het ERP gekend is)
// - het slicerbestand van het product (kopie bij het dossier)
// - de prijs uit de webshop als eindbedrag (wat de klant betaald heeft)
// Geen printprofiel of geen artikel → de regel komt er toch, met een
// waarschuwing: het dossier is dan onvolledig tot dat aangevuld is.
// "Verkoop maken" neemt daarna het dossier mee i.p.v. de voorraad.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { bijlagenMap } from '../db/index.js';
import { DomeinFout } from './hulp.js';
import { logGebeurtenis } from './historiek.js';
import { volgendNummer } from './nummering.js';
import { leesRegels, bewaarRegels } from './dossiers.js';
import { leesBestellingen } from './webshopbestellingen.js';
import { artikelMetProfiel, platenVan, regelsUitProfiel } from '../productie/printprofiel.js';

const norm = t => String(t ?? '').toLowerCase().replace(/[—–·\-_,()]/g, ' ').replace(/\s+/g, ' ').trim();
const r2 = v => Math.round(v * 100) / 100;

// Welke lijnen standaard in het dossier horen: gepersonaliseerd, niet
// gekoppeld, of te weinig op voorraad.
export const moetPrinten = i => !!(i.tekst || i.lettertype || i.symbool) || !i.artikel || i.artikel.voorraad < i.aantal;

function filamentKaart(db) {
  const rijen = db.prepare(`SELECT a.id, fm.naam AS merk, fmat.naam AS materiaal, k.naam AS kleur FROM artikelen a
    JOIN filament_types ft ON ft.id = a.filament_type_id JOIN filament_merken fm ON fm.id = ft.merk_id
    JOIN filament_materialen fmat ON fmat.id = ft.materiaal_id JOIN filament_kleuren k ON k.id = a.kleur_id
    WHERE a.type = 'filament' AND a.gearchiveerd = 0`).all();
  return new Map(rijen.map(r => [norm(`${r.merk} ${r.materiaal} ${r.kleur}`), r.id]));
}

// "Maya Mathys" → voornaam Maya, naam Mathys; adres enkel bij levering aan huis
function klantUit(b) {
  const delen = String(b.klant_naam || '').trim().split(/\s+/).filter(Boolean);
  const naam = delen.length > 1 ? delen.slice(1).join(' ') : delen[0] || b.email || 'Webshopklant';
  const voornaam = delen.length > 1 ? delen[0] : null;
  const tel = String(b.telefoon || '').replace(/\s/g, '');
  const gsm = /^(\+?32|0)4/.test(tel) ? b.telefoon : null;
  const k = { type: 'particulier', naam, voornaam, email: b.email || null, gsm, telefoon: gsm ? null : b.telefoon || null,
    straat: null, huisnummer: null, postcode: null, gemeente: null, land: null };
  const afhaal = /afhaal|relay|pickup|locker|punt/i.test(`${b.verzending || ''}`);
  if (b.adres && !afhaal) {
    const [straat, plaats, land] = b.adres.split(',').map(x => x.trim());
    const s = String(straat || '').match(/^(.*?)\s+(\d+\S*)$/);
    k.straat = s ? s[1] : straat || null; k.huisnummer = s ? s[2] : null;
    const p = String(plaats || '').match(/^(\d{4,5})\s*(.*)$/);
    k.postcode = p ? p[1] : null; k.gemeente = p ? p[2] || null : plaats || null;
    k.land = land && /^[A-Z]{2}$/i.test(land) && land.toUpperCase() !== 'BE' ? land.toUpperCase() : null;
  }
  return k;
}

export function maakDossierUitBestelling(db, bestellingId, { items = null, kleuren = null } = {}) {
  const b = leesBestellingen(db, { alles: true, kleuren }).find(x => x.id === String(bestellingId));
  if (!b) throw Object.assign(new DomeinFout('Bestelling niet gevonden'), { status: 404 });
  if (b.dossier_id) throw new DomeinFout(`Deze bestelling heeft al een dossier (${b.dossier_nummer}).`);
  if (b.verkoop_id) throw new DomeinFout(`Deze bestelling is al verkocht (${b.verkoop_nummer}).`);
  const gekozen = Array.isArray(items) ? [...new Set(items.map(Number))].filter(i => Number.isInteger(i) && b.items[i]) : b.items.map((x, i) => (moetPrinten(x) ? i : null)).filter(i => i !== null);
  if (!gekozen.length) throw new DomeinFout('Kies minstens één lijn om te printen.');

  const waarschuwingen = [];
  const kopieen = [];   // aangemaakte bestanden: weg bij een fout
  try {
    return db.transaction(() => {
      // ── klant
      let klantId = b.klant_id, klantNieuw = false;
      if (!klantId) {
        const k = klantUit(b);
        const velden = Object.keys(k);
        klantId = Number(db.prepare(`INSERT INTO klanten (${velden.join(',')}) VALUES (${velden.map(() => '?').join(',')})`).run(...velden.map(v => k[v])).lastInsertRowid);
        logGebeurtenis(db, 'klant', klantId, 'aangemaakt', 'Uit een webshopbestelling');
        klantNieuw = true;
      }
      // ── dossier
      const datum = String(b.besteld_op).slice(0, 10).split('-').reverse().join('-');
      const nummer = volgendNummer(db, 'D');
      const fi = db.prepare('SELECT familie FROM klanten WHERE id = ?').get(klantId)?.familie ? 1 : 0;
      const notities = [`Webshopbestelling van ${datum}${b.verzending ? ` · ${b.verzending}` : ''}.`, b.opmerking ? `Opmerking: ${b.opmerking}` : null].filter(Boolean).join('\n');
      const dossierId = Number(db.prepare('INSERT INTO dossiers (nummer, soort, klant_id, titel, notities, filament_inkoop) VALUES (?,?,?,?,?,?)')
        .run(nummer, 'klant', klantId, `Webshop ${datum} — ${b.klant_naam || b.email || 'klant'}`, notities, fi).lastInsertRowid);

      // ── regels
      const filament = filamentKaart(db);
      const bijlageVan = new Map();   // artikel → bijlage-id bij het dossier
      const kopieer = (artikelId, bijlageId) => {
        if (bijlageVan.has(artikelId)) return bijlageVan.get(artikelId);
        const bl = db.prepare(`SELECT * FROM bijlagen WHERE id = ? AND entiteit = 'artikel'`).get(bijlageId);
        let id = null;
        if (bl && fs.existsSync(path.join(bijlagenMap(), bl.pad))) {
          const naam = `dossier-${dossierId}-${crypto.randomUUID()}${path.extname(bl.pad)}`;
          fs.copyFileSync(path.join(bijlagenMap(), bl.pad), path.join(bijlagenMap(), naam));
          kopieen.push(naam);
          id = Number(db.prepare('INSERT INTO bijlagen (entiteit, entiteit_id, bestandsnaam, pad, mimetype, grootte) VALUES (?,?,?,?,?,?)')
            .run('dossier', dossierId, bl.bestandsnaam, naam, bl.mimetype, bl.grootte).lastInsertRowid);
        }
        bijlageVan.set(artikelId, id);
        return id;
      };
      const regels = [];
      for (const idx of gekozen) {
        const i = b.items[idx];
        const extra = [i.lettertype && !norm(i.naam).includes(norm(i.lettertype)) ? `Lettertype: ${i.lettertype}` : null,
          i.symbool && i.symbool !== 'geen' && !norm(i.naam).includes(norm(i.symbool)) ? `Symbool: ${i.symbool}` : null].filter(Boolean);
        const omschrijving = [i.naam, ...extra].join(' · ');
        const bedrag = r2((Number(i.prijs) || 0) * (Number(i.aantal) || 1));
        const a = i.artikel ? artikelMetProfiel(db, i.artikel.id) : null;
        const zelf = a && a.type === 'artikel' && a.zelf_geprint;
        if (!a) waarschuwingen.push(`"${i.naam}" is niet gekoppeld aan een artikel (Voorraad → Producten → Webshop ophalen): vul de printregel zelf aan.`);
        else if (!zelf) waarschuwingen.push(`"${a.naam}" is geen zelf geprint artikel: vul de printregel zelf aan.`);
        else if (!a.profiel) waarschuwingen.push(`"${a.naam}" heeft nog geen printprofiel: maak er één (Voorraad → artikel → Printprofiel, of "Als printprofiel van het product bewaren" in het dossier).`);
        if (!zelf || !a.profiel) {
          regels.push({ type: 'printen', omschrijving, aantal: i.aantal, per_stuk: true, artikel_id: zelf ? a.id : null, handmatig_bedrag: bedrag, materialen: [] });
          continue;
        }
        const platen = platenVan(a.profiel);
        // filament van de gekozen kleur(en): enkel bij één plaat, en als elke kleur gekend is
        const kleurIds = (i.kleur_info || []).map(k => (k.filament ? filament.get(norm(k.filament)) : null));
        const kleurOk = platen.length === 1 && kleurIds.length > 0 && kleurIds.every(Boolean) && kleurIds.length === (platen[0].materialen || []).length;
        if (i.kleuren.length && !kleurOk) waarschuwingen.push(`"${a.naam}": kies het filament voor ${i.kleuren.join(' / ')} zelf (niet automatisch herkend).`);
        const slicer = a.profiel.slicer_bijlage_id ? kopieer(a.id, a.profiel.slicer_bijlage_id) : null;
        regelsUitProfiel(a.profiel, Number(i.aantal) || 1, omschrijving).forEach((x, k) => {
          const { laatste, ...r } = x;
          regels.push({ ...r, type: 'printen', aantal: i.aantal,
            materialen: kleurOk ? r.materialen.map((m, j) => ({ artikel_id: kleurIds[j], gram: m.gram })) : r.materialen,
            artikel_id: laatste ? a.id : null, handmatig_bedrag: laatste ? bedrag : 0,
            ...(slicer ? { slicer_bijlage_id: slicer, slicer_plaat: platen[k]?.slicer_plaat ?? null } : {}) });
        });
      }
      bewaarRegels(db, dossierId, leesRegels(regels));
      db.prepare('UPDATE webshop_bestellingen SET dossier_id = ?, dossier_items = ? WHERE id = ?').run(dossierId, JSON.stringify(gekozen), b.id);
      logGebeurtenis(db, 'dossier', dossierId, 'aangemaakt', `Uit de webshopbestelling van ${b.klant_naam || b.email || 'een klant'} (${datum})`);
      return { dossier_id: dossierId, nummer, klant_id: klantId, klant_nieuw: klantNieuw, waarschuwingen };
    })();
  } catch (e) {
    for (const n of kopieen) try { fs.unlinkSync(path.join(bijlagenMap(), n)); } catch { /* al weg */ }
    throw e;
  }
}
