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
// - BMCU/AMS-slijtage bij ELKE print (1× per printregel)
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
      const prijs = getal(m.prijs_per_kg);
      if (gram > 0 && prijs === null) fouten.push(`Geen verkoopprijs per kg voor ${m.naam || 'het gekozen filament'}`);
      return { naam: m.naam, gram, prijs_per_kg: prijs, kost: gram / 1000 * (prijs ?? 0) * faal };
    });
    if (fouten.length) return { fout: fouten.join('. '), tijd_u: uren };
    const materiaal = materialen.reduce((s, m) => s + m.kost, 0);
    const energie = kwh !== null ? kwh * t.kwh_prijs : (p.verbruik_watt / 1000) * uren * t.kwh_prijs;
    const machine = uren * p.machine_per_uur;
    const voorb = of(regel.voorbereiding_min, t.voorbereiding_min);
    const nabew = of(regel.nabewerking_min, t.nabewerking_min);
    const arbeid = (voorb + nabew) / 60 * t.arbeid_per_uur;
    const bmcu = t.bmcu_per_job;
    return {
      met_marge: energie + machine + arbeid + bmcu,
      zonder_marge: materiaal,
      vaste_prijs: false,
      tijd_u: uren,
      detail: { materialen, materiaal, energie, energie_bron: kwh !== null ? 'gemeten' : 'geschat', machine, arbeid, voorbereiding_min: voorb, nabewerking_min: nabew, bmcu, uren },
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

  return { fout: `Onbekend soort regel: ${type}`, tijd_u: 0 };
}

export function bereken(regels, tarieven, { stand = 'schatting' } = {}) {
  const ontbreekt = NODIGE_TARIEVEN.filter(k => getal(tarieven?.[k]) === null);
  if (ontbreekt.length) throw new Error(`Tarieven ontbreken: ${ontbreekt.join(', ')}`);
  const t = Object.fromEntries(NODIGE_TARIEVEN.map(k => [k, getal(tarieven[k])]));

  // Doorgang 1: de "natuurlijke" berekening per regel + de totale printtijd,
  // die de marge bepaalt (een handmatig bedrag verandert de printtijd niet).
  const natuurlijk = (regels || []).map(r => berekenRegel(r, t, stand));
  const totale_tijd_u = natuurlijk.reduce((s, r) => s + (r.tijd_u || 0), 0);
  const marge_pct = totale_tijd_u >= t.marge_grens_uur ? t.marge_groot_pct : t.marge_klein_pct;
  const factor = 1 + marge_pct / 100;

  // Doorgang 2: handmatige eindbedragen, eindbedrag per regel, totalen.
  let met = 0, zonder = 0, vast = 0;
  const fouten = [];
  const uit = (regels || []).map((regel, i) => {
    let r = natuurlijk[i];
    if (r.fout) { fouten.push({ regel: i, fout: r.fout }); return { ...regel, _berekend: { fout: r.fout } }; }
    const hand = getal(regel.handmatig_bedrag);
    if (hand !== null) r = { ...r, natuurlijk_eindbedrag: r.met_marge * factor + r.zonder_marge, met_marge: 0, zonder_marge: hand, handmatig: true };
    const eind = r.met_marge * factor + r.zonder_marge;
    if (r.vaste_prijs) vast += eind; else { met += r.met_marge; zonder += r.zonder_marge; }
    return { ...regel, _berekend: { ...r, eindbedrag_exact: eind } };
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

  return {
    regels: uit,
    stand,
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
