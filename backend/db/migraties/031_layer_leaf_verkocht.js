// Migratie 031 — eenmalig (10-10): de zelf geprinte artikels in de categorie
// "Layer & Leaf" (geïmporteerd uit een Patreon-download toen een verkoopprijs
// nog verplicht was) krijgen "wordt verkocht" aan. Een prijs is niet meer verplicht.
export const versie = 31;
export const naam = 'Layer & Leaf: wordt verkocht';

export function up(db) {
  db.prepare(`UPDATE artikelen SET wordt_verkocht = 1 WHERE type = 'artikel' AND wordt_verkocht = 0 AND categorie_id IN
    (SELECT id FROM categorieen WHERE lower(replace(replace(naam, ' ', ''), '&', 'and')) IN ('layerandleaf', 'layerleaf'))`).run();
}
