// ═══════════════════════════════════════════════════════════════════════
// DOCUMENTEN VAN EEN DOSSIER (stap 5b): offerte (versies) en werkbon
// ═══════════════════════════════════════════════════════════════════════
// Een concept volgt altijd de huidige dossierregels. Bij versturen (offerte)
// of definitief maken (werkbon, bij het afrekenen) wordt een MOMENTOPNAME
// bewaard: precies wat de klant kreeg, ook als het dossier nadien wijzigt.
import { getBedrijfsgegevens } from './hulp.js';
import { offerteStatus } from './status/offerte.js';
import { volgendNummer } from './nummering.js';
import { logGebeurtenis } from './historiek.js';

export function offertesVan(db, dossierId) {
  const rijen = db.prepare('SELECT * FROM offertes WHERE dossier_id = ? ORDER BY versie').all(dossierId);
  const hoogste = rijen.reduce((m, o) => Math.max(m, o.versie), 0);
  return rijen.map(o => {
    const m = o.momentopname ? JSON.parse(o.momentopname) : null;
    const { momentopname: _m, ...rest } = o;
    return { ...rest, status: offerteStatus(o, { nieuwereVersie: o.versie < hoogste && !o.aanvaard_op && !o.geweigerd_op }),
      weergave: nummerMetVersie(o), regels_api: m?.regels_api, document: m?.document };
  });
}
export const nummerMetVersie = d => (d.versie > 1 ? `${d.nummer} v${d.versie}` : d.nummer);

// De laatst verstuurde versie bepaalt de fase van het dossier.
export function laatsteVerstuurde(offertes) {
  return [...offertes].filter(o => o.verstuurd_op).sort((a, b) => b.versie - a.versie)[0] || null;
}

// Nieuwe werkbon (knop, Starten, offerte aanvaard of afrekenen zonder werkbon).
export function maakWerkbon(db, dossierId, { waarom = null } = {}) {
  if (db.prepare('SELECT 1 FROM werkbonnen WHERE dossier_id = ?').get(dossierId)) return null;
  const nummer = volgendNummer(db, 'WB');
  db.prepare('INSERT INTO werkbonnen (dossier_id, nummer) VALUES (?, ?)').run(dossierId, nummer);
  logGebeurtenis(db, 'dossier', dossierId, 'status', `Werkbon ${nummer} aangemaakt${waarom ? ` (${waarom})` : ''}`);
  return nummer;
}

export function werkbonVan(db, dossierId) {
  const w = db.prepare('SELECT * FROM werkbonnen WHERE dossier_id = ?').get(dossierId);
  if (!w) return null;
  const { momentopname, ...rest } = w;
  return { ...rest, weergave: nummerMetVersie(w), document: momentopname ? JSON.parse(momentopname).document : null };
}

// Wat er op het document komt: bedrijf, klant, dossier en de regels zoals
// de klant ze ziet (omschrijving, aantal, prijs per stuk, bedrag).
const STANDAARD_LABEL = { printen: 'Printwerk', ontwerp: 'Ontwerp', aanpassing: 'Aanpassing', extra: 'Extra kost' };
export function documentInhoud(db, dossier, berekening) {
  const regels = berekening.regels.map(r => {
    const b = r._berekend || {};
    const aantal = r.type === 'printen' || r.type === 'artikel' || (r.type === 'extra' && r.per_stuk) ? Number(r.aantal ?? 1) : 1;
    return {
      omschrijving: r.omschrijving || (r.type === 'artikel' ? r.naam : null) || STANDAARD_LABEL[r.type] || r.type,
      aantal, per_stuk: b.per_stuk ?? null, bedrag: b.eindbedrag ?? null,
      // printwerk: ter info op de werkbon (werkelijke of geschatte printtijd)
      uren: r.type === 'printen' ? Math.round((b.tijd_u ?? 0) * 100) / 100 : null,
    };
  });
  return {
    bedrijf: getBedrijfsgegevens(db),
    klant: dossier.klant_gegevens || null,
    dossier: { nummer: dossier.nummer, titel: dossier.titel },
    regels,
    totaal: berekening.totaal, btw_grondslag: berekening.btw_grondslag, vast: berekening.vast,
  };
}

export function geldigheidDagen(db) {
  const w = db.prepare(`SELECT waarde FROM instellingen WHERE sleutel = 'offerte_geldig_dagen'`).get()?.waarde;
  const n = parseInt(w, 10);
  return Number.isInteger(n) && n > 0 ? n : 30;
}
export function plusDagen(datum, dagen) {
  const d = new Date(`${datum}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dagen);
  return d.toISOString().slice(0, 10);
}
