// De volledige, geordende lijst migraties. Een nieuwe migratie: bestand
// toevoegen in deze map en hieronder achteraan in de lijst zetten.
import * as m001 from './001_basis.js';
import * as m002 from './002_klant_naam_optioneel.js';
import * as m003 from './003_catalogus_odoo.js';
import * as m004 from './004_leveranciers.js';
import * as m005 from './005_printers.js';
import * as m006 from './006_dossiers.js';
import * as m007 from './007_offertes_werkbonnen.js';
import * as m008 from './008_leveringen.js';
import * as m009 from './009_printerkoppeling.js';
import * as m010 from './010_printopdrachten.js';
import * as m011 from './011_productiekost.js';

export const MIGRATIES = [m001, m002, m003, m004, m005, m006, m007, m008, m009, m010, m011];
