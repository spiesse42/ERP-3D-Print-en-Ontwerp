// ═══════════════════════════════════════════════════════════════════════
// REGELMOTOR — gedeelde rekenmotor voor "regels" (ontwerp/aanpassing/
// printen/extra/artikel), oorspronkelijk opgesloten in offertes_v2.js maar
// generiek van aard: een functie van (db, regels-array, tarieven), zonder
// enige offerte-context nodig. Verplaatst hierheen zodat een werkbon
// (backend/routes/werkbonnen.js) exact dezelfde motor kan hergebruiken bij
// het aanmaken van een standalone werkbon (POST /werkbonnen) — expliciete
// conventie in deze codebase: geen aparte, tweede rekenmotor.
//
// offertes_v2.js importeert de namen die het zelf nog nodig heeft (zie
// import bovenaan dat bestand); de rest van deze module wordt enkel
// intern (tussen deze functies onderling) gebruikt.
// ═══════════════════════════════════════════════════════════════════════

// Valt terug op de standaardwaarde enkel als er écht niets bruikbaars werd
// meegegeven — niet bij een bewust ingevulde 0 (bv. "geen voorbereidingstijd
// nodig"). Met een gewone `||`-fallback ging zo'n ingevulde 0 altijd verloren
// en werd bij elke volgende opslag/heropening stilzwijgend de standaardwaarde
// teruggezet.
export function getalOfDefault(v, fallback) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

// Printer-wattage voor de energieschatting: het ingestelde gemiddeld verbruik
// per printer (Instellingen-tab) heeft voorrang — zelfde bron als KostenModal
// gebruikt voor de kWh-schatting bij printers zonder live meting. Enkel als
// dat niet is ingevuld, valt terug op de oude generieke Ender/Bambu-tarieven.
export function bepaalPrinterWatt(p, t) {
  if (p?.gem_verbruik_watt > 0) return p.gem_verbruik_watt;
  return p?.naam?.toLowerCase().includes('ender') ? getalOfDefault(t.ender_watt, 150) : getalOfDefault(t.bambu_watt, 120);
}

// Effectieve prijs/kg van 1 specifieke filamentrol — zelfde COALESCE-formule
// als filament.js (/rollen, /rollen/by-type): aankoopprijs van de rol zelf
// als die gekend is, anders de typeprijs.
export function haalRolEffectievePrijs(db, rolId) {
  const row = db.prepare(`
    SELECT COALESCE(
      r.aankoopprijs_eur / NULLIF(r.gewicht_gram_start, 0) * (CASE WHEN ft.eenheid = 'gram' THEN 1000.0 ELSE 1.0 END),
      ft.inkoop_prijs_per_kg
    ) as prijs_per_kg_effectief
    FROM filament_rollen r JOIN filament_types ft ON ft.id = r.filament_type_id
    WHERE r.id = ?
  `).get(rolId);
  return parseFloat(row?.prijs_per_kg_effectief) || 0;
}

// Materiaalkost voor multicolor-offertes: som per kleur van (gram/1000) ×
// effectieve rolprijs × faalfactor — zelfde berekening als de live preview
// in Offertes.jsx (berekenLive). Geeft null terug als er geen bruikbare
// per-kleur rollen zijn, zodat de aanroeper dan op de normale single-kleur
// berekening terugvalt.
export function berekenMultiMateriaalKost(db, filamentRollen, faalfactor, aantal) {
  if (!Array.isArray(filamentRollen) || !filamentRollen.some(fr => parseFloat(fr.gram) > 0)) return null;
  const som = filamentRollen.reduce((s, fr) => {
    const gram = parseFloat(fr.gram) || 0;
    if (gram <= 0 || !fr.filament_rol_id) return s;
    return s + (gram / 1000) * haalRolEffectievePrijs(db, fr.filament_rol_id) * faalfactor;
  }, 0);
  return som * (parseInt(aantal) || 1);
}

// Bepaalt de materiaal_kost_override voor één offerte: bij multicolor de som
// per kleur (zie hierboven); anders — indien een specifieke rol gekozen is —
// de effectieve rolprijs van die rol i.p.v. de generieke typeprijs. Geeft
// null terug als er niets specifieks gekozen is, zodat de normale
// typeprijs-berekening in berekenOfferte() als fallback dient.
export function bepaalMateriaalKostOverride(db, { is_multicolor, filament_rollen, filament_rol_id, geschat_gewicht_g, aantal }, faalfactor) {
  // is_multicolor komt als JS boolean (true/false) uit de nieuwe regels-flow
  // (checkbox in de frontend) maar als SQLite-integer (0/1) uit de legacy-
  // synthese — parseInt(true) geeft NaN (dus falsy!), dus hier bewust een
  // gewone truthy-check i.p.v. parseInt.
  //
  // Bugfix: bij multicolor MAG dit niet meteen `return`en, ook niet als
  // berekenMultiMateriaalKost() null teruggeeft (geen bruikbare kleurrijen
  // ingevuld) — anders wordt de hoofd-filament_rol_id hieronder nooit meer
  // bereikt en valt de aanroeper terug op de generieke TYPE-prijs i.p.v. de
  // effectieve prijs van de al gekozen specifieke rol. Dat gaf een ander
  // (te hoog/te laag) bedrag dan wat de live-preview in Offertes.jsx toont,
  // die dit wél al correct als "multicolor zónder kleurrijen → val terug op
  // de hoofdrol"-geval behandelt (zie materiaalKostRegelClient()).
  if (is_multicolor) {
    const multi = berekenMultiMateriaalKost(db, filament_rollen, faalfactor, aantal);
    if (multi != null) return multi;
  }
  if (filament_rol_id) {
    const prijs = haalRolEffectievePrijs(db, filament_rol_id);
    if (prijs > 0) {
      return (parseFloat(geschat_gewicht_g) / 1000) * prijs * faalfactor * (parseInt(aantal) || 1);
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// REGELS-GEBASEERDE BEREKENING (herontwerp — vrije lijst diensten/objecten
// i.p.v. 1 vast hoofdobject + vaste opsplitsing object/arbeid/kosten)
// ═══════════════════════════════════════════════════════════════════════
//
// Elke regel: { type, object_naam, aantal?, ...type-specifieke velden }.
// type ∈ 'ontwerp' | 'aanpassing' | 'printen' | 'extra' | 'artikel'.
// 'extra' en 'artikel' verwijzen optioneel naar een filament_type (categorie
// ≠ 'filament', Filament-tab) — diens vaste_prijs-vlag bepaalt of er marge
// op komt, exact dezelfde regel als vandaag al geldt voor offerte-artikelen
// (verzendkosten e.d.: vaste_prijs = geen marge, niet in BTW-grondslag).
export const REGEL_TYPE_LABELS = {
  ontwerp: 'Ontwerp',
  aanpassing: 'Aanpassing op bestaand ontwerp/bestand',
  printen: 'Printen',
  extra: 'Extra kosten/dienst',
  artikel: 'Artikel',
};

export function haalArtikelType(db, id) {
  if (!id) return null;
  return db.prepare('SELECT id, merk, materiaal, inkoop_prijs_per_kg, eenheid, vaste_prijs FROM filament_types WHERE id = ?').get(id);
}

// Berekent 1 regel — geeft { bedrag, vaste_prijs, tijd_u, detail? } terug.
// tijd_u telt enkel mee voor 'printen' (bepaalt samen met andere printen-
// regels de marge-drempel, zie berekenOfferteRegels).
export function berekenRegel(db, regel, t) {
  const type = regel.type;
  const aantal = parseInt(regel.aantal) || 1;

  if (type === 'ontwerp' || type === 'aanpassing') {
    const minuten = parseFloat(regel.minuten) || 0;
    const tarief = parseFloat(regel.tarief) || (type === 'ontwerp' ? (getalOfDefault(t.ontwerp_tarief, 15)) : (getalOfDefault(t.nabewerking_tarief, 15)));
    return { bedrag: minuten / 60 * tarief, vaste_prijs: false, tijd_u: 0 };
  }

  if (type === 'printen') {
    const faalfactor = 1 + (getalOfDefault(t.faalfactor_pct, 10)) / 100;
    const kwh_prijs = getalOfDefault(t.kwh_prijs, 0.35);
    const arbeid_per_uur = getalOfDefault(t.arbeid_per_uur, 15);

    let printer_watt = 120, machine_kost_per_uur = null;
    if (regel.printer_id) {
      const p = db.prepare('SELECT naam, gem_verbruik_watt, machine_kost_per_uur FROM printers WHERE id = ?').get(regel.printer_id);
      printer_watt = bepaalPrinterWatt(p, t);
      machine_kost_per_uur = p?.machine_kost_per_uur > 0 ? p.machine_kost_per_uur : null;
    }

    const materiaal_override = bepaalMateriaalKostOverride(db, {
      is_multicolor: regel.is_multicolor, filament_rollen: regel.filament_rollen || [],
      filament_rol_id: regel.filament_rol_id, geschat_gewicht_g: regel.geschat_gewicht_g, aantal,
    }, faalfactor);

    let filament_prijs_per_kg = 0;
    if (regel.filament_type_id) {
      const ft = db.prepare('SELECT inkoop_prijs_per_kg FROM filament_types WHERE id = ?').get(regel.filament_type_id);
      filament_prijs_per_kg = ft?.inkoop_prijs_per_kg || 0;
    }

    const totale_tijd_u = (parseInt(regel.geschatte_tijd_u) || 0) + (parseInt(regel.geschatte_tijd_min) || 0) / 60;
    const materiaal_kost = materiaal_override != null
      ? materiaal_override
      : (parseFloat(regel.geschat_gewicht_g) || 0) / 1000 * filament_prijs_per_kg * faalfactor * aantal;
    const energie_kost = (printer_watt / 1000) * totale_tijd_u * kwh_prijs * aantal;
    const machine_kost = totale_tijd_u * (machine_kost_per_uur != null ? machine_kost_per_uur : (getalOfDefault(t.machine_per_uur, 0.13))) * aantal;
    const arbeid_kost = ((parseInt(regel.voorbereiding_min) || 0) + (parseInt(regel.nabewerking_min) || 0)) / 60 * arbeid_per_uur;
    const bmcu = regel.is_multicolor ? (getalOfDefault(t.bmcu_per_job, 0.10)) : 0;

    return {
      bedrag: materiaal_kost + energie_kost + machine_kost + arbeid_kost + bmcu,
      vaste_prijs: false,
      tijd_u: totale_tijd_u * aantal,
      detail: { materiaal_kost, energie_kost, machine_kost, arbeid_kost, bmcu },
    };
  }

  if (type === 'extra') {
    const ft = haalArtikelType(db, regel.filament_type_id);
    return { bedrag: parseFloat(regel.bedrag) || 0, vaste_prijs: !!ft?.vaste_prijs, tijd_u: 0 };
  }

  if (type === 'artikel') {
    const ft = haalArtikelType(db, regel.filament_type_id);
    if (!ft) return { bedrag: 0, vaste_prijs: false, tijd_u: 0 };
    // Bugfix: 'artikel' hergebruikte de bovenste `aantal` (parseInt, bedoeld
    // voor het GEHEEL aantal kopieën van een 'printen'-regel) — maar bij
    // eenheid 'gram'/'ml' is een decimale hoeveelheid (bv. 12,5 gram) heel
    // normaal, en werd die stil afgekapt. Hier bewust een eigen parseFloat.
    const aantalArtikel = parseFloat(regel.aantal) || 1;
    const deler = ft.eenheid === 'gram' ? 1000 : 1;
    return { bedrag: (aantalArtikel / deler) * (ft.inkoop_prijs_per_kg || 0), vaste_prijs: !!ft.vaste_prijs, tijd_u: 0 };
  }

  return { bedrag: 0, vaste_prijs: false, tijd_u: 0 };
}

// Valideert de regels-array vóór opslag. Voorheen werd bv. een negatief
// aantal (tikfout, of niet-gevalideerde frontend-state) gewoon meegerekend
// in materiaal-/energie-/machinekost — de offerte-totaalprijs kon daardoor
// dalen of zelfs negatief worden, zonder enige foutmelding. De legacy
// offerte_artikelen-subroutes hadden al wel een "aantal > 0"-check; deze
// nieuwe regels-array nog niet.
export function valideerRegels(regels) {
  const GELDIGE_TYPES = ['ontwerp', 'aanpassing', 'printen', 'extra', 'artikel'];
  for (const regel of (regels || [])) {
    if (!GELDIGE_TYPES.includes(regel?.type)) {
      return `Ongeldig regeltype: "${regel?.type}"`;
    }
    if (regel.aantal !== undefined && regel.aantal !== null && regel.aantal !== '') {
      const n = parseFloat(regel.aantal);
      if (!Number.isFinite(n) || n <= 0) {
        return `Aantal moet groter zijn dan 0 (regel "${regel.object_naam || regel.type}")`;
      }
    }
    if (regel.handmatig_bedrag !== undefined && regel.handmatig_bedrag !== null && regel.handmatig_bedrag !== '') {
      const n = parseFloat(regel.handmatig_bedrag);
      if (!Number.isFinite(n) || n < 0) {
        return `Handmatig bedrag moet 0 of hoger zijn (regel "${regel.object_naam || regel.type}")`;
      }
    }
  }
  return null;
}

// Berekent de volledige offerte op basis van de regels-array. Marge-drempel
// (klein/groot tarief) wordt bepaald door de SOM van de geschatte tijd van
// alle 'printen'-regels samen — zelfde principe als vroeger met 1
// hoofdobject, nu opgeteld over eventueel meerdere printen-regels.
//
// Twee doorgangen: de marge (klein/groot%) hangt af van de totale printtijd,
// die zelf niet beïnvloed wordt door een handmatige bedrag-aanpassing —
// daarom eerst de "natuurlijke" (berekende) waarde per regel bepalen, dán
// pas de marge vaststellen, en pas dáárna een eventuele handmatig_bedrag-
// override toepassen. Zo'n override is het EINDBEDRAG (incl. marge, exact
// wat de gebruiker in de offerte-regel intypt) en wordt vóór de marge-
// vermenigvuldiging "teruggerekend" (gedeeld door de margefactor, behalve
// bij vaste-prijs-regels die toch al geen marge krijgen) zodat het bedrag
// dat straks overal getoond wordt (live-preview, PDF, detail) exact het
// ingetypte bedrag blijft, ook al zit er de normale marge-vermenigvuldiging
// nog overheen. BTW blijft normaal op deze regel berekend — een handmatige
// aanpassing is een prijscorrectie, geen vaste-prijs-artikel.
//
// Retourneert regels MET hun berekening ingebed (regel._berekend) — dat is
// precies wat er in regels_json bewaard wordt, zodat een latere PDF/detail-
// weergave die bevroren waarden gewoon uitleest i.p.v. te herberekenen.
export function berekenOfferteRegels(db, regels, t) {
  const natuurlijk = (regels || []).map(regel => berekenRegel(db, regel, t));
  const totale_tijd_u = natuurlijk.reduce((s, r) => s + (r.tijd_u || 0), 0);

  const marge_grens = getalOfDefault(t.marge_grens_uur, 4);
  const marge_pct = totale_tijd_u >= marge_grens ? (getalOfDefault(t.marge_groot_pct, 10)) : (getalOfDefault(t.marge_klein_pct, 18));
  const margeFactor = 1 + marge_pct / 100;

  let subtotaal_marge = 0, subtotaal_vast = 0;
  const berekend = (regels || []).map((regel, i) => {
    let r = natuurlijk[i];
    const override = parseFloat(regel.handmatig_bedrag);
    const heeftOverride = regel.handmatig_bedrag !== undefined && regel.handmatig_bedrag !== null
      && regel.handmatig_bedrag !== '' && Number.isFinite(override);
    if (heeftOverride) {
      r = { ...r, bedrag: r.vaste_prijs ? override : override / margeFactor, handmatig: true };
    }
    if (r.vaste_prijs) subtotaal_vast += r.bedrag; else subtotaal_marge += r.bedrag;
    return { ...regel, _berekend: r };
  });

  const verkoopprijs_basis = subtotaal_marge * margeFactor;
  const verkoopprijs = verkoopprijs_basis + subtotaal_vast;

  return {
    regels: berekend,
    subtotaal: Math.round((subtotaal_marge + subtotaal_vast) * 1000) / 1000,
    marge_pct,
    verkoopprijs_basis: Math.round(verkoopprijs_basis * 100) / 100,
    verkoopprijs: Math.round(verkoopprijs * 100) / 100,
    totale_tijd_u,
  };
}
