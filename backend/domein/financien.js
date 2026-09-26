// ═══════════════════════════════════════════════════════════════════════
// FINANCIËN (stap 7) — overzicht, opvolging, marges, drempels bijberoep
// ═══════════════════════════════════════════════════════════════════════
// Accountable blijft de boekhouding (domeinmodel, optie A). Dit zijn
// RICHTWAARDEN uit wat het ERP kent:
// - omzet      = afgerekende klantdossiers (bedrag van de afrekening), op de
//                datum van de afrekening (factuur of bonnetje), + losse
//                verkopen (26-09, tegel Verkoop; niet de ongedane)
// - ontvangen  = dezelfde bedragen op de betaaldatum (kasstelsel)
// - aankopen   = bestelde/ontvangen, niet-geannuleerde aankopen (incl. btw,
//                incl. kostregels zoals verzending), op de documentdatum
// - winst      = omzet − aankopen. Kosten die enkel in Accountable staan
//                (abonnementen, …) ontbreken hier: enkel een richtwaarde.
// Drempels (instelbaar, Instellingen → Bedrijfsgegevens): btw-vrijstelling
// kleine onderneming (omzet) en sociale bijdragen bijberoep (winst), pro
// rata in het jaar van de startdatum — zoals het oude pakket.
const r2 = v => Math.round((v || 0) * 100) / 100;

export const STANDAARD_DREMPELS = { omzet: 25000, winst: 1881.76 };

function instelling(db, sleutel) {
  const w = db.prepare('SELECT waarde FROM instellingen WHERE sleutel = ?').get(sleutel)?.waarde;
  return w == null || w === '' ? null : w;
}
const getal = w => { const n = parseFloat(String(w ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

const AANKOOP_BEDRAG = `(SELECT COALESCE(SUM(r.aantal * COALESCE(r.prijs_per_eenheid, 0)), 0) FROM aankoop_regels r WHERE r.aankoop_id = a.id)`;

export function beschikbareJaren(db) {
  const jaren = new Set([new Date().getFullYear()]);
  for (const r of db.prepare(`SELECT DISTINCT substr(afgerekend_op, 1, 4) j FROM dossiers WHERE afgerekend_op IS NOT NULL
    UNION SELECT DISTINCT substr(datum, 1, 4) FROM aankopen WHERE besteld_op IS NOT NULL
    UNION SELECT DISTINCT substr(datum, 1, 4) FROM verkopen WHERE geannuleerd_op IS NULL`).all()) if (r.j) jaren.add(Number(r.j));
  return [...jaren].sort((a, b) => b - a);
}

export function drempels(db, jaar, { omzet, winst }) {
  const start = instelling(db, 'bedrijf_startdatum');
  const dOmzet = getal(instelling(db, 'drempel_omzet_jaar')) ?? STANDAARD_DREMPELS.omzet;
  const dWinst = getal(instelling(db, 'drempel_winst_jaar')) ?? STANDAARD_DREMPELS.winst;
  const schrikkel = (jaar % 4 === 0 && jaar % 100 !== 0) || jaar % 400 === 0;
  const dagenInJaar = schrikkel ? 366 : 365;
  let dagen = dagenInJaar;
  if (start && /^\d{4}-\d{2}-\d{2}$/.test(start) && Number(start.slice(0, 4)) === jaar) {
    dagen = Math.round((Date.UTC(jaar, 11, 31) - Date.parse(`${start}T00:00:00Z`)) / 864e5) + 1;
  }
  const ratio = Math.min(1, Math.max(0, dagen / dagenInJaar));
  const lijn = (bedrag, vol) => {
    const drempel = r2(vol * ratio);
    return { bedrag: r2(bedrag), drempel, drempel_vol: vol, pct: drempel > 0 ? Math.round(bedrag / drempel * 1000) / 10 : null };
  };
  return { startdatum: start, pro_rata: ratio < 1, dagen, dagen_in_jaar: dagenInJaar, omzet: lijn(omzet, dOmzet), winst: lijn(winst, dWinst) };
}

export function jaarOverzicht(db, jaar) {
  const j = String(jaar);
  const maanden = Array.from({ length: 12 }, (_, i) => ({ maand: `${j}-${String(i + 1).padStart(2, '0')}`, omzet: 0, facturen: 0, bonnetjes: 0, ontvangen: 0, aankopen: 0 }));
  const zet = (maand, k, v) => { const m = maanden.find(x => x.maand === maand); if (m) m[k] += v || 0; };
  for (const r of db.prepare(`SELECT substr(afgerekend_op, 1, 7) maand, afgerekend_soort asoort, COUNT(*) n, SUM(afgerekend_bedrag) b FROM dossiers
    WHERE afgerekend_op IS NOT NULL AND substr(afgerekend_op, 1, 4) = ? GROUP BY maand, afgerekend_soort`).all(j)) {
    zet(r.maand, 'omzet', r.b); zet(r.maand, r.asoort === 'bonnetje' ? 'bonnetjes' : 'facturen', r.n);
  }
  // losse verkoop = bonnetje: omzet én meteen ontvangen
  for (const r of db.prepare(`SELECT substr(datum, 1, 7) maand, COUNT(*) n, SUM(totaal) b FROM verkopen
    WHERE geannuleerd_op IS NULL AND substr(datum, 1, 4) = ? GROUP BY maand`).all(j)) {
    zet(r.maand, 'omzet', r.b); zet(r.maand, 'bonnetjes', r.n); zet(r.maand, 'ontvangen', r.b);
  }
  for (const r of db.prepare(`SELECT substr(betaald_op, 1, 7) maand, SUM(afgerekend_bedrag) b FROM dossiers
    WHERE betaald_op IS NOT NULL AND afgerekend_op IS NOT NULL AND substr(betaald_op, 1, 4) = ? GROUP BY maand`).all(j)) zet(r.maand, 'ontvangen', r.b);
  for (const r of db.prepare(`SELECT substr(a.datum, 1, 7) maand, SUM(${AANKOOP_BEDRAG}) b FROM aankopen a
    WHERE a.besteld_op IS NOT NULL AND a.geannuleerd_op IS NULL AND substr(a.datum, 1, 4) = ? GROUP BY maand`).all(j)) zet(r.maand, 'aankopen', r.b);
  const rijen = maanden.map(m => ({ ...m, omzet: r2(m.omzet), ontvangen: r2(m.ontvangen), aankopen: r2(m.aankopen), saldo: r2(m.ontvangen - m.aankopen) }));
  const som = k => r2(rijen.reduce((t, m) => t + m[k], 0));
  const totaal = { omzet: som('omzet'), ontvangen: som('ontvangen'), aankopen: som('aankopen'), saldo: som('saldo'), facturen: som('facturen'), bonnetjes: som('bonnetjes') };
  const winst = r2(totaal.omzet - totaal.aankopen);
  // gratis geleverd (25-09): geen omzet; aantal, waarde en echte kost apart
  const gr = marges(db, jaar).rijen.filter(x => x.afgerekend_soort === 'gratis');
  const gratis = { aantal: gr.length, waarde: r2(gr.reduce((t, x) => t + (x.waarde || 0), 0)), kost: r2(gr.reduce((t, x) => t + x.kost, 0)),
    arbeid: r2(gr.reduce((t, x) => t + x.arbeid, 0)), onvolledig: gr.some(x => x.onvolledig) };
  return { jaar: Number(jaar), jaren: beschikbareJaren(db), maanden: rijen, totaal: { ...totaal, winst }, gratis, drempels: drempels(db, Number(jaar), { omzet: totaal.omzet, winst }) };
}

const KLANTNAAM = `CASE WHEN k.type = 'zakelijk' AND NULLIF(k.bedrijfsnaam,'') IS NOT NULL THEN k.bedrijfsnaam
  ELSE TRIM(COALESCE(k.voornaam,'') || ' ' || COALESCE(k.naam,'')) END`;

// Opvolging: facturen die nog niet betaald zijn (met ouderdom) en
// klantopdrachten die klaar zijn maar nog niet afgerekend.
export function opvolging(db, leesDossiers) {
  const vandaag = Date.parse(new Date().toISOString().slice(0, 10));
  const onbetaald = db.prepare(`SELECT d.id, d.nummer, d.titel, d.afgerekend_nummer, d.afgerekend_op, d.afgerekend_bedrag, d.klant_id, ${KLANTNAAM} klant, k.email
    FROM dossiers d LEFT JOIN klanten k ON k.id = d.klant_id
    WHERE d.afgerekend_op IS NOT NULL AND d.betaald_op IS NULL ORDER BY d.afgerekend_op`).all()
    .map(d => ({ ...d, dagen_open: Math.max(0, Math.round((vandaag - Date.parse(d.afgerekend_op)) / 864e5)) }));
  const teAfrekenen = leesDossiers().filter(d => d.soort === 'klant' && ['klaar', 'deels', 'geleverd'].includes(d.fase))
    .map(d => ({ id: d.id, nummer: d.nummer, titel: d.titel, klant: d.klant, klant_id: d.klant_id, fase: d.fase, totaal: d.totaal, volledig: d.volledig }));
  return {
    onbetaald, onbetaald_totaal: r2(onbetaald.reduce((t, d) => t + (d.afgerekend_bedrag || 0), 0)),
    te_afrekenen: teAfrekenen, te_afrekenen_totaal: r2(teAfrekenen.reduce((t, d) => t + (d.totaal || 0), 0)),
  };
}

// Marge per afgerekend klantdossier: afgerekend bedrag tegenover de ECHTE
// kost die het ERP kent:
// - printwerk: productiekost van de voltooide printopdrachten (filament aan
//   inkoopprijs, elektriciteit, machine, BMCU, mislukte pogingen), arbeid apart
// - geleverde artikelen uit voorraad: de partijprijs van wat uitgeboekt werd
// Onvolledig = een printregel zonder gemeten productiekost, of een geleverd
// artikel zonder partijprijs.
export function marges(db, jaar) {
  // ook "gratis geleverd" (25-09): bedrag € 0, soort 'gratis', waarde = werkbon
  const dossiers = db.prepare(`SELECT d.id, d.nummer, d.titel, COALESCE(d.afgerekend_op, d.gratis_op) AS afgerekend_op,
      CASE WHEN d.gratis_op IS NOT NULL THEN 0 ELSE d.afgerekend_bedrag END AS afgerekend_bedrag,
      CASE WHEN d.gratis_op IS NOT NULL THEN 'gratis' ELSE d.afgerekend_soort END AS afgerekend_soort, d.gratis_waarde AS waarde, ${KLANTNAAM} klant
    FROM dossiers d LEFT JOIN klanten k ON k.id = d.klant_id
    WHERE (d.afgerekend_op IS NOT NULL OR d.gratis_op IS NOT NULL) AND substr(COALESCE(d.afgerekend_op, d.gratis_op), 1, 4) = ?
    ORDER BY COALESCE(d.afgerekend_op, d.gratis_op) DESC, d.id DESC`).all(String(jaar));
  const printregels = db.prepare(`SELECT id, aantal FROM dossier_regels WHERE dossier_id = ? AND type = 'printen'`);
  const opdrachten = db.prepare(`SELECT productiekost_stuk, arbeid_stuk, aantal_goed, kost_onvolledig, kost_ontbreekt FROM printopdrachten
    WHERE dossier_regel_id = ? AND voltooid_op IS NOT NULL`);
  const artikelKost = db.prepare(`SELECT SUM(-m.aantal * p.prijs_per_eenheid) kost, SUM(CASE WHEN p.prijs_per_eenheid IS NULL THEN 1 ELSE 0 END) zonder_prijs
    FROM voorraad_mutaties m JOIN levering_regels lr ON lr.id = m.bron_id JOIN leveringen l ON l.id = lr.levering_id
    LEFT JOIN voorraad_partijen p ON p.id = m.partij_id
    WHERE m.bron_type = 'levering_regel' AND m.aantal < 0 AND l.dossier_id = ?`);
  const rijen = dossiers.map(d => {
    let print = 0, arbeid = 0, onvolledig = false;
    const redenen = new Set();
    for (const r of printregels.all(d.id)) {
      const ops = opdrachten.all(r.id).filter(o => o.productiekost_stuk != null);
      if (!ops.length) { onvolledig = true; redenen.add('printwerk zonder metingen'); continue; }
      for (const o of ops) {
        print += o.productiekost_stuk * o.aantal_goed; arbeid += (o.arbeid_stuk || 0) * o.aantal_goed;
        if (o.kost_onvolledig) { onvolledig = true; redenen.add(o.kost_ontbreekt ? `ontbreekt: ${o.kost_ontbreekt}` : 'productiekost onvolledig'); }
      }
    }
    const a = artikelKost.get(d.id);
    if (a?.zonder_prijs) { onvolledig = true; redenen.add('artikel zonder inkoopprijs'); }
    const kost = r2(print + (a?.kost || 0));
    const marge = r2(d.afgerekend_bedrag - kost);
    const margeArbeid = r2(marge - arbeid);
    return { ...d, kost_print: r2(print), kost_artikelen: r2(a?.kost || 0), kost, arbeid: r2(arbeid), marge, marge_met_arbeid: margeArbeid,
      marge_pct: d.afgerekend_bedrag > 0 ? Math.round(marge / d.afgerekend_bedrag * 1000) / 10 : null,
      onvolledig, redenen: [...redenen] };
  });
  // losse verkopen (26-09): kost = partijprijs van wat uitgeboekt werd
  const verkoopKost = db.prepare(`SELECT SUM(-m.aantal * p.prijs_per_eenheid) kost, SUM(CASE WHEN p.prijs_per_eenheid IS NULL THEN 1 ELSE 0 END) zonder_prijs
    FROM voorraad_mutaties m JOIN verkoop_regels vr ON vr.id = m.bron_id LEFT JOIN voorraad_partijen p ON p.id = m.partij_id
    WHERE m.bron_type = 'verkoop_regel' AND m.reden = 'levering' AND m.aantal < 0 AND vr.verkoop_id = ?`);
  for (const v of db.prepare(`SELECT v.id, v.nummer AS afrekening, v.datum AS afgerekend_op, v.totaal AS afgerekend_bedrag, v.omschrijving, ${KLANTNAAM} klant
      FROM verkopen v LEFT JOIN klanten k ON k.id = v.klant_id WHERE v.geannuleerd_op IS NULL AND substr(v.datum, 1, 4) = ?`).all(String(jaar))) {
    const a = verkoopKost.get(v.id);
    const kost = r2(a?.kost || 0);
    const marge = r2(v.afgerekend_bedrag - kost);
    rijen.push({ id: `v${v.id}`, verkoop_id: v.id, nummer: v.afrekening, titel: v.omschrijving || 'Losse verkoop', afgerekend_op: v.afgerekend_op,
      afgerekend_bedrag: v.afgerekend_bedrag, afgerekend_soort: 'verkoop', waarde: null, klant: v.klant, kost_print: 0, kost_artikelen: kost, kost, arbeid: 0,
      marge, marge_met_arbeid: marge, marge_pct: v.afgerekend_bedrag > 0 ? Math.round(marge / v.afgerekend_bedrag * 1000) / 10 : null,
      onvolledig: !!a?.zonder_prijs, redenen: a?.zonder_prijs ? ['artikel zonder inkoopprijs'] : [] });
  }
  rijen.sort((x, y) => String(y.afgerekend_op).localeCompare(String(x.afgerekend_op)));
  const som = k => r2(rijen.reduce((t, x) => t + (x[k] || 0), 0));
  return { jaar: Number(jaar), rijen, totaal: { bedrag: som('afgerekend_bedrag'), kost: som('kost'), arbeid: som('arbeid'), marge: som('marge'), marge_met_arbeid: som('marge_met_arbeid') } };
}
