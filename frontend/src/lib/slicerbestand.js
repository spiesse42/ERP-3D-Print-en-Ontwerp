// 26-11: grote slicerbestanden (honderden MB) hoeven niet volledig naar het
// ERP. Het ERP leest enkel:
// - losse gcode: de kop en de staart (printtijd, grammen, kleuren, beeld)
// - geslicete 3mf (zip, ook met 20 platen): Metadata/slice_info.config,
//   project_settings.config, model_settings.config en plate_N(.png|_small.png)
// De browser stelt daarom een kleine versie samen: van een gcode de eerste
// en laatste 4 MB, van een 3mf een nieuwe zip met enkel die onderdelen (de
// gegevens worden letterlijk overgenomen, zonder uitpakken, en het grote
// bestand wordt nooit volledig ingeladen). Lukt dat niet, dan het origineel.
export const MAX_SLICER_MB = 200;     // limiet voor upload en bijlage (backend)
const STUK = 4 * 1024 * 1024;
const KLEIN = 16 * 1024 * 1024;

export const isGcode = b => /\.(gcode|gco|g)$/i.test(b?.name || '');
export const teGrootOmTeBewaren = b => !!b && b.size > MAX_SLICER_MB * 1024 * 1024;
const NODIG = /^Metadata\/(slice_info\.config|project_settings\.config|model_settings\.config|plate_\d+(_small)?\.png)$/;

async function bytes(b, van, tot) { return new DataView(await b.slice(van, tot).arrayBuffer()); }

// Centrale map van een zip (ook zip64) → [{ naam, methode, tijd, datum, crc, comp, uncomp, offset }]
async function zipInhoud(f) {
  const staartLen = Math.min(f.size, 65557 + 20);
  const staart = await bytes(f, f.size - staartLen, f.size);
  let e = -1;
  for (let i = staartLen - 22; i >= 0; i--) if (staart.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('geen zip');
  let aantal = staart.getUint16(e + 10, true), cdGrootte = staart.getUint32(e + 12, true), cdOffset = staart.getUint32(e + 16, true);
  if (aantal === 0xffff || cdGrootte === 0xffffffff || cdOffset === 0xffffffff) {
    const l = e - 20;
    if (l < 0 || staart.getUint32(l, true) !== 0x07064b50) throw new Error('zip64 zonder locator');
    const eocd64 = Number(staart.getBigUint64(l + 8, true));
    const z = await bytes(f, eocd64, eocd64 + 56);
    if (z.getUint32(0, true) !== 0x06064b50) throw new Error('zip64 kapot');
    aantal = Number(z.getBigUint64(32, true)); cdGrootte = Number(z.getBigUint64(40, true)); cdOffset = Number(z.getBigUint64(48, true));
  }
  const cd = await bytes(f, cdOffset, cdOffset + cdGrootte);
  const dec = new TextDecoder();
  const uit = [];
  for (let p = 0, n = 0; n < aantal; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('centrale map kapot');
    const nl = cd.getUint16(p + 28, true), xl = cd.getUint16(p + 30, true), cl = cd.getUint16(p + 32, true);
    const x = { naam: dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nl)), methode: cd.getUint16(p + 10, true),
      tijd: cd.getUint16(p + 12, true), datum: cd.getUint16(p + 14, true), crc: cd.getUint32(p + 16, true),
      comp: cd.getUint32(p + 20, true), uncomp: cd.getUint32(p + 24, true), offset: cd.getUint32(p + 42, true) };
    // zip64-extra (id 1): enkel de velden die 0xffffffff zijn, in deze volgorde
    for (let q = p + 46 + nl; q < p + 46 + nl + xl;) {
      const id = cd.getUint16(q, true), len = cd.getUint16(q + 2, true);
      if (id === 1) {
        let r = q + 4;
        if (x.uncomp === 0xffffffff) { x.uncomp = Number(cd.getBigUint64(r, true)); r += 8; }
        if (x.comp === 0xffffffff) { x.comp = Number(cd.getBigUint64(r, true)); r += 8; }
        if (x.offset === 0xffffffff) { x.offset = Number(cd.getBigUint64(r, true)); }
      }
      q += 4 + len;
    }
    uit.push(x);
    p += 46 + nl + xl + cl;
  }
  return uit;
}

async function kleine3mf(f) {
  const nodig = (await zipInhoud(f)).filter(x => NODIG.test(x.naam) && x.comp < 0xffffffff);
  if (!nodig.some(x => x.naam === 'Metadata/slice_info.config')) return f;   // laat de backend de melding geven
  const enc = new TextEncoder();
  const delen = [], centraal = [];
  let pos = 0;
  for (const x of nodig) {
    const kop = await bytes(f, x.offset, x.offset + 30);
    if (kop.getUint32(0, true) !== 0x04034b50) throw new Error('lokale kop kapot');
    const start = x.offset + 30 + kop.getUint16(26, true) + kop.getUint16(28, true);
    const naam = enc.encode(x.naam);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, x.methode, true);
    lh.setUint16(10, x.tijd, true); lh.setUint16(12, x.datum, true); lh.setUint32(14, x.crc, true);
    lh.setUint32(18, x.comp, true); lh.setUint32(22, x.uncomp, true); lh.setUint16(26, naam.length, true); lh.setUint16(28, 0, true);
    delen.push(lh.buffer, naam, f.slice(start, start + x.comp));
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, x.methode, true);
    ch.setUint16(12, x.tijd, true); ch.setUint16(14, x.datum, true); ch.setUint32(16, x.crc, true); ch.setUint32(20, x.comp, true);
    ch.setUint32(24, x.uncomp, true); ch.setUint16(28, naam.length, true); ch.setUint32(42, pos, true);
    centraal.push(ch.buffer, naam);
    pos += 30 + naam.length + x.comp;
  }
  const cdGrootte = centraal.reduce((s, d) => s + d.byteLength, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, nodig.length, true); eocd.setUint16(10, nodig.length, true);
  eocd.setUint32(12, cdGrootte, true); eocd.setUint32(16, pos, true);
  return new File([...delen, ...centraal, eocd.buffer], f.name, { type: 'application/zip' });
}

// Kleine versie om in te lezen (Promise<File>); klein genoeg → het origineel.
export async function slicerVoorUpload(bestand) {
  if (!bestand || bestand.size <= KLEIN) return bestand;
  if (isGcode(bestand)) return new File([bestand.slice(0, STUK), '\n', bestand.slice(bestand.size - STUK)], bestand.name, { type: 'text/plain' });
  try { return await kleine3mf(bestand); } catch { return bestand; }
}
