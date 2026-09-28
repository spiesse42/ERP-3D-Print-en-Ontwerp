// ═══════════════════════════════════════════════════════════════════════
// SLICERBESTAND → voorstel voor printregels (28-09)
// ═══════════════════════════════════════════════════════════════════════
// Per filamentslot uit de slicer een keuze zoals de regeleditor ze kent:
// 'a:<artikel>' (filament met kleur) of 'p:<prijsgroep>' (enkel merk + type).
// - type: de langste materiaalnaam die in het profiel staat ("eSUN PLA+ @BBL
//   A1" → PLA+, "Bambu PLA Matte" → PLA Matte), anders het type (PLA, PETG)
// - prijsgroep: merk (filament_vendor of begin van het profiel) + type;
//   onbekend merk ("Generic") maar maar één prijsgroep met dat type → die,
//   als voorstel om na te kijken (zeker: false)
// - kleur: het filamentartikel van die prijsgroep met de dichtste kleur
//   (hex van de kleur), enkel als die echt dichtbij ligt
// Printer: het printermodel uit de slicer tegen de naam van je printers.
const norm = s => String(s ?? '').toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '');
const rgb = hex => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const afstand = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const MAX_KLEURAFSTAND = 60;

export function koppelSlicer(db, gelezen) {
  const merken = db.prepare('SELECT id, naam FROM filament_merken').all();
  const materialen = db.prepare('SELECT id, naam FROM filament_materialen').all();
  const groepen = db.prepare('SELECT id, merk_id, materiaal_id FROM filament_types').all();
  const kleuren = db.prepare(`SELECT a.id, a.filament_type_id, k.hex FROM artikelen a JOIN filament_kleuren k ON k.id = a.kleur_id
    WHERE a.type = 'filament' AND a.gearchiveerd = 0`).all();

  function keuze(f) {
    const profiel = norm(String(f.profiel ?? '').split('@')[0]);
    const materiaal = materialen.filter(m => norm(m.naam).startsWith(norm(f.type)) && profiel.includes(norm(m.naam)))
      .sort((a, b) => norm(b.naam).length - norm(a.naam).length)[0]
      || materialen.find(m => norm(m.naam) === norm(f.type));
    if (!materiaal) return { keuze: null, zeker: false };
    const merk = merken.find(m => norm(m.naam) && (norm(m.naam) === norm(f.merk) || profiel.startsWith(norm(m.naam))));
    let groep = merk && groepen.find(g => g.merk_id === merk.id && g.materiaal_id === materiaal.id);
    let zeker = !!groep;
    if (!groep) {
      const metType = groepen.filter(g => g.materiaal_id === materiaal.id);
      if (metType.length !== 1) return { keuze: null, zeker: false };
      [groep] = metType;
    }
    const doel = rgb(f.kleur);
    const beste = doel && kleuren.filter(a => a.filament_type_id === groep.id && rgb(a.hex))
      .map(a => ({ a, d: afstand(doel, rgb(a.hex)) })).sort((x, y) => x.d - y.d)[0];
    if (beste && beste.d <= MAX_KLEURAFSTAND) return { keuze: `a:${beste.a.id}`, zeker };
    return { keuze: `p:${groep.id}`, zeker };
  }

  const printers = db.prepare('SELECT id, naam FROM printers WHERE actief = 1').all();
  const printer = gelezen.printer_model ? printers.find(p => norm(p.naam) === norm(gelezen.printer_model)) : null;
  return {
    ...gelezen,
    printer_id: printer?.id ?? null,
    platen: gelezen.platen.map(p => ({ ...p, filamenten: p.filamenten.map(f => ({ ...f, ...keuze(f) })) })),
  };
}
