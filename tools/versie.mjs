// Verhoogt het laatste cijfer van "version" in de config.yaml van de add-on
// (bv. 0.13.2 -> 0.13.3) en schrijft het bestand terug als UTF-8 zonder BOM.
// Gebruik: node tools/versie.mjs erp_3d_print_ontwerp/config.yaml  -> print de nieuwe versie
import fs from 'fs';
const pad = process.argv[2];
let tekst = fs.readFileSync(pad, 'utf8').replace(/^﻿/, '');
const m = tekst.match(/^version:\s*"(\d+)\.(\d+)\.(\d+)"\s*$/m);
if (!m) { console.error(`Geen regel version: "x.y.z" gevonden in ${pad}`); process.exit(1); }
const nieuw = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
tekst = tekst.replace(m[0], `version: "${nieuw}"`);
fs.writeFileSync(pad, tekst, 'utf8');
console.log(nieuw);
