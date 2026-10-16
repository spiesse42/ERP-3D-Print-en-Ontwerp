// ═══════════════════════════════════════════════════════════════════════
// REKENMOTOR — één berekening voor offerte, werkbon en marge-analyse (stap 4)
// ═══════════════════════════════════════════════════════════════════════
// Zuivere functie: geen databank, geen Express. De invoer is al "verrijkt"
// (prijzen, printer, tarieven opgezocht door domein/berekening.js). De
// live-preview in de browser vraagt de berekening op via POST /api/bereken,
// zodat er nergens een tweede kopie van deze logica bestaat.
//
// Beslissingen (claude/domeinmodel-v2.md → "Rekenmotor", 24-09):
// - materiaal = gram ÷ 1000 × VERKOOPPRIJS/kg × faalfactor, ZONDER marge;
//   multicolor = één materiaalregel per kleur
// - machinekost = tarief van de gekozen printer, GEEN terugval
// - BMCU/AMS-slijtage bij ELKE print (1× per printregel; 06-10: met "stuks
//   per plaat" 1× per plaat, net als de standaard-voorbereiding)
// - tijd en gewicht zijn die van de HELE print (bv. een plaat met 10
//   sleutelhangers): energie, machine en BMCU worden NIET × aantal gerekend;
//   het aantal dient enkel voor de prijs per stuk
// - getrapte marge (klein/groot volgens de totale printtijd) enkel op
//   energie, machine, arbeid, BMCU, ontwerp/aanpassing (regie) en extra's
// - artikelen/eigen producten/diensten tegen hun verkoopprijs, geen marge;
//   vaste prijs (bv. verzending) = ook niet in de btw-grondslag
// - handmatig eindbedrag per regel: dat bedrag komt er exact zo uit
// - een ingevulde 0 blijft 0
//
// Regels (invoer):
//   { type: 'ontwerp' | 'aanpassing', minuten, tarief? }
//   { type: 'printen', aantal, printer: { naam, machine_per_uur, verbruik_watt },
//     materialen: [{ naam, gram, prijs_per_kg }], tijd_min,
//     voorbereiding_min?, nabewerking_min?, werkelijk?: { uren?, kwh? } }
//   { type: 'artikel', naam, aantal, prijs, vaste_prijs }
//   { type: 'extra', omschrijving, bedrag, per_stuk, aantal }
//   + optioneel handmatig_bedrag op elke regel
//
// stand: 'schatting' (offerte: watt × geschatte tijd) of 'werkelijk'
// (werkbon/marge-analyse: gemeten kWh en werkelijke uren waar gekend).

export const NODIGE_TARIEVEN = ['kwh_prijs', 'marge_grens_uur', 'marge_klein_pct', 'marge_groot_pct', 'faalfactor_pct',
  'voorbereiding_min', 'nabewerking_min', 'ontwerp_tarief', 'nabewerking_tarief', 'arbeid_per_uur', 'bmcu_per_job'];

// Getal of null ("niet ingevuld"). Een ingevulde 0 blijft 0.
export function getal(w) {
  if (w === null || w === undefined || w === '') return null;
  const n = typeof w === 'number' ? w : parseFloat(String(w).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
const of = (w, standaard) => { const n = getal(w); return n === null ? standaard : n; };
const r2 = x => Math.round(x * 100) / 100;
const r4 = x => Math.round(x * 10000) / 10000;

function berekenRegel(regel, t, stand) {
  const type = regel.type;
  if (type === 'ontwerp' || type === 'aanpassing') {
    const tarief = of(regel.tarief, type === 'ontwerp' ? t.ontwerp_tarief : t.nabewerking_tarief);
    return { met_marge: of(regel.minuten, 0) / 60 * tarief, zonder_marge: 0, vaste_prijs: false, tijd_u: 0, detail: { minuten: of(regel.minuten, 0), tarief } };
  }

  if (type === 'printen') {
    const fouten = [];
    const p = regel.printer;
    if (!p) fouten.push('Kies een printer');
    else if (getal(p.machine_per_uur) === null) fouten.push(`Vul het machinetarief van ${p.naam} in (Instellingen → Printers)`);
    const wer = stand === 'werkelijk' ? (regel.werkelijk || {}) : {};
    const uren = getal(wer.uren) ?? of(regel.tijd_min, 0) / 60;
    const kwh = getal(wer.kwh);
    if (p && kwh === null && getal(p.verbruik_watt) === null) fouten.push(`Vul het gemiddeld verbruik (watt) van ${p.naam} in (Instellingen → Printers)`);
    const faal = 1 + t.faalfactor_pct / 100;
    const materialen = (regel.materialen || []).map(m => {
      const gram = of(m.gram, 0);
      let prijs = getal(m.prijs_per_kg);
      // 08-10 printuurmodel: het hoogste van de verkoopprijs/kg en inkoop × opslag
      const ink = getal(m.inkoop_per_kg);
      if (t.nieuw && t.opslag > 0 && ink !== null && m.prijs_bron !== 'inkoop') prijs = Math.max(prijs ?? 0, ink * t.opslag / 100);
      if (gram > 0 && prijs === null) {
        fouten.push(m.prijs_bron === 'inkoop'
          ? `Geen inkoopprijs gekend voor ${m.naam || 'het gekozen filament'} (Voorraad → artikel → inkoopprijs, of ontvang een aankoop)`
          : `Geen verkoopprijs per kg voor ${m.naam || 'het gekozen filament'}`);
      }
      return { naam: m.naam, gram, prijs_per_kg: prijs, kost: gram / 1000 * (prijs ?? 0) * faal, ...(m.prijs_bron ? { prijs_bron: m.prijs_bron } : {}) };
    });
    if (fouten.length) return { fout: fouten.join('. '), tijd_u: uren };
    const materiaal = materialen.reduce((s, m) => s + m.kost, 0);
    const energie = kwh !== null ? kwh * t.kwh_prijs : (p.verbruik_watt / 1000) * uren * t.kwh_prijs;
    const machine = uren * p.machine_per_uur;
    // 06-10: stuks per plaat → aantal platen (elke plaat = een print)
    const pp = getal(regel.per_plaat);
    const platen = pp > 0 ? Math.max(1, Math.ceil(of(regel.aantal, 1) / pp - 1e-9)) : 1;
    const voorb = of(regel.voorbereiding_min, t.voorbereiding_min * platen);
    const nabew = of(regel.nabewerking_min, t.nabewerking_min);
    const arbeid = (voorb + nabew) / 60 * t.arbeid_per_uur;
    const bmcu = (getal(p.slijtage_per_print) ?? t.bmcu_per_job) * platen;
    // 08-10 printuurmodel: winst per printuur; boven de grens aan een lager pct
    const winst = t.nieuw ? t.winst_u * (Math.min(uren, t.winst_grens) + Math.max(0, uren - t.winst_grens) * t.winst_lang / 100) : 0;
    return {
      met_marge: energie + machine + arbeid + bmcu + winst,
      zonder_marge: materiaal,
      vaste_prijs: false,
      tijd_u: uren,
      detail: { materialen, materiaal, energie, energie_bron: kwh !== null ? 'gemeten' : 'geschat', machine, arbeid, voorbereiding_min: voorb, nabewerking_min: nabew, bmcu, winst, uren, platen },
    };
  }

  if (type === 'artikel') {
    const prijs = getal(regel.prijs);
    if (prijs === null) return { fout: regel.naam ? `Geen verkoopprijs voor ${regel.naam}` : 'Kies een artikel of dienst', tijd_u: 0 };
    const aantal = of(regel.aantal, 1);
    return { met_marge: 0, zonder_marge: aantal * prijs, vaste_prijs: !!regel.vaste_prijs, tijd_u: 0, detail: { aantal, prijs } };
  }

  if (type === 'extra') {
    const bedrag = of(regel.bedrag, 0);
    const aantal = regel.per_stuk ? of(regel.aantal, 1) : 1;
    return { met_marge: bedrag * aantal, zonder_marge: 0, vaste_prijs: false, tijd_u: 0, detail: { bedrag, aantal, per_stuk: !!regel.per_stuk } };
  }

  // 15-10: korting op het totaal van de andere regels (bedrag in doorgang 2)
  if (type === 'korting') return { met_marge: 0, zonder_marge: 0, vaste_prijs: false, tijd_u: 0, detail: { korting: regel.korting?.totaal || null } };

  return { fout: `Onbekend soort regel: ${type}`, tijd_u: 0 };
}

// Korting (15-10): { waarde, soort: 'pct' | 'eur' } op een basisbedrag; in €
// nooit meer dan de basis.
function kortingOp(k, basis) {
  const w = getal(k?.waarde);
  if (!w || basis <= 0) return 0;
  return k.soort === 'eur' ? Math.min(w, basis) : basis * Math.min(w, 100) / 100;
}

// Eén regel optellen in de prijsopbouw: de natuurlijke berekening per post;
// de (oude) marge apart. Een handmatig bedrag komt als correctie erbij.
function telPrijs(po, regel, r, factor, t) {
  const d = r.detail || {};
  po.marge += r.met_marge * (factor - 1);
  if (regel.type === 'printen') {
    po.materiaal += d.materiaal; po.energie += d.energie; po.machine += d.machine; po.arbeid += d.arbeid; po.bmcu += d.bmcu; po.winst += d.winst || 0;
    po.gram += (d.materialen || []).reduce((x, m) => x + m.gram, 0); po.uren += d.uren; po.platen += d.platen || 1;
    po.kwh += t.kwh_prijs > 0 ? d.energie / t.kwh_prijs : 0; po.arbeid_min += d.voorbereiding_min + d.nabewerking_min;
  } else if (regel.type === 'ontwerp' || regel.type === 'aanpassing') {
    po[regel.type] += r.met_marge; po[`${regel.type}_min`] += d.minuten || 0;
  } else if (regel.type === 'artikel') po.artikelen += r.zonder_marge;
  else if (regel.type === 'extra') po.extra += r.met_marge;
}

// model: 'nieuw' (standaard: printuurmodel zodra winst_per_printuur > 0) of
// 'oud' (08-10: de vroegere berekening met getrapte marge, ter vergelijking)
export function bereken(regels, tarieven, { stand = 'schatting', model = 'nieuw' } = {}) {
  const ontbreekt = NODIGE_TARIEVEN.filter(k => getal(tarieven?.[k]) === null);
  if (ontbreekt.length) throw new Error(`Tarieven ontbreken: ${ontbreekt.join(', ')}`);
  const t = Object.fromEntries(NODIGE_TARIEVEN.map(k => [k, getal(tarieven[k])]));
  // Printuurmodel (08-10): winst per printuur i.p.v. de getrapte marge, en
  // materiaal minstens inkoop × opslag. Uit (0) = de oude berekening.
  t.winst_u = of(tarieven.winst_per_printuur, 0);
  t.winst_grens = of(tarieven.winst_lang_grens_uur, 12);
  t.winst_lang = of(tarieven.winst_lang_pct, 100);
  t.opslag = of(tarieven.materiaal_opslag_pct, 0);
  t.nieuw = model !== 'oud' && t.winst_u > 0;

  // Doorgang 1: de "natuurlijke" berekening per regel + de totale printtijd,
  // die de marge bepaalt (een handmatig bedrag verandert de printtijd niet).
  const natuurlijk = (regels || []).map(r => berekenRegel(r, t, stand));
  const totale_tijd_u = natuurlijk.reduce((s, r) => s + (r.tijd_u || 0), 0);
  const marge_pct = t.nieuw ? 0 : totale_tijd_u >= t.marge_grens_uur ? t.marge_groot_pct : t.marge_klein_pct;
  const factor = 1 + marge_pct / 100;

  // Doorgang 2: handmatige eindbedragen, eindbedrag per regel, totalen.
  let met = 0, zonder = 0, vast = 0;
  const fouten = [];
  // 15-10: prijsopbouw over alle regels (wat de klant betaalt, per post)
  const po = { materiaal: 0, energie: 0, machine: 0, arbeid: 0, bmcu: 0, winst: 0, marge: 0, ontwerp: 0, aanpassing: 0, artikelen: 0, extra: 0, handmatig: 0,
    korting_materiaal: 0, korting_printuren: 0, korting_regels: 0, korting_totaal: 0,
    gram: 0, uren: 0, kwh: 0, platen: 0, arbeid_min: 0, ontwerp_min: 0, aanpassing_min: 0 };
  const uit = (regels || []).map((regel, i) => {
    let r = natuurlijk[i];
    if (r.fout) { fouten.push({ regel: i, fout: r.fout }); return { ...regel, _berekend: { fout: r.fout } }; }
    telPrijs(po, regel, r, factor, t);
    const hand = getal(regel.handmatig_bedrag);
    if (hand !== null) po.handmatig += hand - (r.met_marge * factor + r.zonder_marge);
    if (hand !== null) r = { ...r, natuurlijk_eindbedrag: r.met_marge * factor + r.zonder_marge, met_marge: 0, zonder_marge: hand, handmatig: true };
    // 15-10: kortingen per regel (een handmatig eindbedrag gaat voor)
    else if (regel.korting && regel.type !== 'korting') {
      const K = regel.korting, d = r.detail || {};
      const mat = regel.type === 'printen' ? kortingOp(K.materiaal, d.materiaal) : 0;
      const pu = regel.type === 'printen' ? kortingOp(K.printuren, (d.energie + d.machine + (d.winst || 0)) * factor) : 0;
      const reg = kortingOp(K.regel, r.met_marge * factor + r.zonder_marge - mat - pu);
      if (mat + pu + reg > 0) {
        r = { ...r, zonder_marge: r.zonder_marge - mat - pu - reg, korting: { materiaal: r4(mat), printuren: r4(pu), regel: r4(reg), totaal: r4(mat + pu + reg) } };
        po.korting_materiaal -= mat; po.korting_printuren -= pu; po.korting_regels -= reg;
      }
    }
    const eind = r.met_marge * factor + r.zonder_marge;
    if (r.vaste_prijs) vast += eind; else { met += r.met_marge; zonder += r.zonder_marge; }
    return { ...regel, _berekend: { ...r, eindbedrag_exact: eind } };
  });

  // 15-10: korting op het totaal: op wat de andere regels samen geven (zonder
  // vaste prijzen zoals verzending), als negatieve regel
  uit.forEach(x => {
    if (x.type !== 'korting' || x._berekend.fout) return;
    const k = kortingOp(x.korting?.totaal, met * factor + zonder);
    zonder -= k; po.korting_totaal -= k;
    x._berekend = { ...x._berekend, zonder_marge: -k, eindbedrag_exact: -k };
  });

  const btw_grondslag = r2(met * factor + zonder);
  const totaal = r2(met * factor + zonder + vast);

  // Eindbedrag per regel op de cent, zodat de regels samen EXACT het totaal
  // geven (belangrijk voor de PDF): het afrondingsverschil gaat naar de
  // grootste regel.
  const geldig = uit.filter(r => !r._berekend.fout);
  geldig.forEach(r => { r._berekend.eindbedrag = r2(r._berekend.eindbedrag_exact); });
  const verschil = r2(totaal - geldig.reduce((s, r) => s + r._berekend.eindbedrag, 0));
  if (verschil !== 0 && geldig.length) {
    const grootste = geldig.reduce((a, b) => (Math.abs(b._berekend.eindbedrag) > Math.abs(a._berekend.eindbedrag) ? b : a));
    grootste._berekend.eindbedrag = r2(grootste._berekend.eindbedrag + verschil);
  }
  geldig.forEach(r => {
    const a = r.type === 'printen' || r.type === 'artikel' || (r.type === 'extra' && r.per_stuk) ? of(r.aantal, 1) : 1;
    r._berekend.per_stuk = a > 0 ? r4(r._berekend.eindbedrag / a) : null;
  });

  const som = Object.entries(po).filter(([k]) => !['gram', 'uren', 'kwh', 'platen', 'arbeid_min', 'ontwerp_min', 'aanpassing_min'].includes(k)).reduce((x, [, v]) => x + v, 0);
  po.afronding = totaal - som;
  const prijsopbouw = Object.fromEntries(Object.entries(po).map(([k, v]) => [k, r4(v)]));

  return {
    regels: uit,
    prijsopbouw,
    stand,
    model: t.nieuw ? 'printuur' : 'marge',
    totale_tijd_u: r4(totale_tijd_u),
    marge_pct,
    kost_met_marge: r4(met),          // wat de marge krijgt (vóór marge)
    zonder_marge: r4(zonder),         // materiaal, artikelen, handmatige bedragen
    vast: r4(vast),                   // vaste prijs, buiten de btw-grondslag
    btw_grondslag,
    totaal,
    volledig: fouten.length === 0,
    fouten,
  };
}
