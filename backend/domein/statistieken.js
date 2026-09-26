// ═══════════════════════════════════════════════════════════════════════
// STATISTIEKEN (stap 7) — per jaar, per maand
// ═══════════════════════════════════════════════════════════════════════
// Enkel wat het ERP zelf meet of registreert:
// - dossiers aangemaakt / afgerekend, omzet
// - printruns (geslaagd / mislukt), printuren, kWh en energiekost (kWh-prijs)
// - per printer: runs, slaagpercentage, uren, kWh
// - filament: rollen leeggemeld per kleur
// - eigen producten: stuks geproduceerd per artikel
const r2 = v => Math.round((v || 0) * 100) / 100;
const r3 = v => Math.round((v || 0) * 1000) / 1000;
const UREN = `(julianday(r.geeindigd_op) - julianday(r.gestart_op)) * 24`;

export function statistieken(db, jaar) {
  const j = String(jaar);
  const kwhPrijs = db.prepare(`SELECT waarde FROM tarieven WHERE sleutel = 'kwh_prijs'`).get()?.waarde ?? 0;
  const maanden = Array.from({ length: 12 }, (_, i) => ({ maand: `${j}-${String(i + 1).padStart(2, '0')}`,
    dossiers: 0, afgerekend: 0, omzet: 0, runs: 0, geslaagd: 0, mislukt: 0, uren: 0, kwh: 0, rollen: 0 }));
  const zet = (maand, w) => { const m = maanden.find(x => x.maand === maand); if (m) for (const [k, v] of Object.entries(w)) m[k] += v || 0; };
  for (const r of db.prepare(`SELECT substr(aangemaakt_op, 1, 7) maand, COUNT(*) n FROM dossiers WHERE substr(aangemaakt_op, 1, 4) = ? GROUP BY maand`).all(j)) zet(r.maand, { dossiers: r.n });
  for (const r of db.prepare(`SELECT substr(afgerekend_op, 1, 7) maand, COUNT(*) n, SUM(afgerekend_bedrag) b FROM dossiers WHERE substr(afgerekend_op, 1, 4) = ? GROUP BY maand`).all(j)) zet(r.maand, { afgerekend: r.n, omzet: r.b });
  // losse verkopen (26-09) tellen mee in de omzet (niet als afgerekend dossier)
  for (const r of db.prepare(`SELECT substr(datum, 1, 7) maand, SUM(totaal) b FROM verkopen WHERE geannuleerd_op IS NULL AND substr(datum, 1, 4) = ? GROUP BY maand`).all(j)) zet(r.maand, { omzet: r.b });
  for (const r of db.prepare(`SELECT substr(r.gestart_op, 1, 7) maand, COUNT(*) n, SUM(r.uitkomst = 'klaar') ok, SUM(r.uitkomst IN ('mislukt','geannuleerd')) nok,
      SUM(${UREN}) u, SUM(r.kwh) kwh FROM printruns r WHERE r.uitkomst <> 'bezig' AND substr(r.gestart_op, 1, 4) = ? GROUP BY maand`).all(j)) {
    zet(r.maand, { runs: r.n, geslaagd: r.ok, mislukt: r.nok, uren: r.u, kwh: r.kwh });
  }
  for (const r of db.prepare(`SELECT substr(m.tijdstip, 1, 7) maand, -SUM(m.aantal) n FROM voorraad_mutaties m
      WHERE m.bron_type = 'printer' AND m.reden = 'gebruik' AND substr(m.tijdstip, 1, 4) = ? GROUP BY maand`).all(j)) zet(r.maand, { rollen: r.n });
  // teruggedraaide leegmeldingen aftrekken
  for (const r of db.prepare(`SELECT substr(m.tijdstip, 1, 7) maand, SUM(m.aantal) n FROM voorraad_mutaties m
      WHERE m.bron_type = 'rol_leeg_ongedaan' AND substr(m.tijdstip, 1, 4) = ? GROUP BY maand`).all(j)) zet(r.maand, { rollen: -r.n });
  const rijen = maanden.map(m => ({ ...m, omzet: r2(m.omzet), uren: r2(m.uren), kwh: r3(m.kwh), energiekost: r2(m.kwh * kwhPrijs), rollen: r3(m.rollen) }));
  const som = k => rijen.reduce((t, m) => t + m[k], 0);

  const printers = db.prepare(`SELECT p.id, p.naam, p.actief, COUNT(r.id) runs, COALESCE(SUM(r.uitkomst = 'klaar'), 0) geslaagd,
      COALESCE(SUM(r.uitkomst IN ('mislukt','geannuleerd')), 0) mislukt, COALESCE(SUM(${UREN}), 0) uren, COALESCE(SUM(r.kwh), 0) kwh
    FROM printers p LEFT JOIN printruns r ON r.printer_id = p.id AND r.uitkomst <> 'bezig' AND substr(r.gestart_op, 1, 4) = ?
    GROUP BY p.id ORDER BY runs DESC, p.naam`).all(j)
    .filter(p => p.actief || p.runs)
    .map(p => ({ ...p, uren: r2(p.uren), kwh: r3(p.kwh), energiekost: r2(p.kwh * kwhPrijs), slaagpct: p.runs ? Math.round(p.geslaagd / p.runs * 1000) / 10 : null }));

  const filament = db.prepare(`SELECT a.id, fm.naam || ' ' || mat.naam || ' · ' || k.naam AS naam, k.hex,
      -SUM(m.aantal) rollen
    FROM voorraad_mutaties m JOIN artikelen a ON a.id = m.artikel_id
    JOIN filament_types ft ON ft.id = a.filament_type_id JOIN filament_merken fm ON fm.id = ft.merk_id
    JOIN filament_materialen mat ON mat.id = ft.materiaal_id JOIN filament_kleuren k ON k.id = a.kleur_id
    WHERE m.bron_type IN ('printer', 'rol_leeg_ongedaan') AND substr(m.tijdstip, 1, 4) = ?
    GROUP BY a.id HAVING rollen > 0 ORDER BY rollen DESC, naam LIMIT 15`).all(j).map(f => ({ ...f, rollen: r3(f.rollen) }));

  const producten = db.prepare(`SELECT a.id, a.naam, SUM(o.aantal_goed) stuks, SUM(o.productiekost_stuk * o.aantal_goed) / SUM(o.aantal_goed) kost_stuk, a.verkoopprijs
    FROM printopdrachten o JOIN dossier_regels r ON r.id = o.dossier_regel_id JOIN dossiers d ON d.id = r.dossier_id AND d.soort = 'eigen'
    JOIN artikelen a ON a.id = r.artikel_id
    WHERE o.voltooid_op IS NOT NULL AND o.aantal_goed > 0 AND substr(o.voltooid_op, 1, 4) = ?
    GROUP BY a.id ORDER BY stuks DESC LIMIT 15`).all(j).map(p => ({ ...p, kost_stuk: p.kost_stuk == null ? null : Math.round(p.kost_stuk * 10000) / 10000 }));

  const klanten = db.prepare(`SELECT k.id, CASE WHEN k.type = 'zakelijk' AND NULLIF(k.bedrijfsnaam,'') IS NOT NULL THEN k.bedrijfsnaam
      ELSE TRIM(COALESCE(k.voornaam,'') || ' ' || COALESCE(k.naam,'')) END naam, COUNT(d.id) dossiers, SUM(d.afgerekend_bedrag) omzet
    FROM dossiers d JOIN klanten k ON k.id = d.klant_id WHERE d.afgerekend_op IS NOT NULL AND substr(d.afgerekend_op, 1, 4) = ?
    GROUP BY k.id ORDER BY omzet DESC LIMIT 10`).all(j).map(k => ({ ...k, omzet: r2(k.omzet) }));

  return {
    jaar: Number(jaar), kwh_prijs: kwhPrijs, maanden: rijen,
    totaal: { dossiers: som('dossiers'), afgerekend: som('afgerekend'), omzet: r2(som('omzet')), runs: som('runs'), geslaagd: som('geslaagd'), mislukt: som('mislukt'),
      uren: r2(som('uren')), kwh: r3(som('kwh')), energiekost: r2(som('energiekost')), rollen: r3(som('rollen')) },
    printers, filament, producten, klanten,
  };
}
