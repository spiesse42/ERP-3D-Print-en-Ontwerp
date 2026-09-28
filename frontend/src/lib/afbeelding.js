// Afbeelding verkleinen in de browser (28-09): een data-URI of bestand →
// kleine PNG-data-URI (langste zijde max. `maat` px), voor de afbeelding van
// een printregel op offerte en werkbon. Transparantie blijft (PNG).
export async function verklein(bron, maat = 240) {
  const url = typeof bron === 'string' ? bron : await new Promise((ok, fout) => {
    const r = new FileReader();
    r.onload = () => ok(r.result); r.onerror = () => fout(new Error('Afbeelding kon niet gelezen worden'));
    r.readAsDataURL(bron);
  });
  const img = await new Promise((ok, fout) => {
    const i = new Image();
    i.onload = () => ok(i); i.onerror = () => fout(new Error('Geen geldige afbeelding (png, jpg of webp)'));
    i.src = url;
  });
  const schaal = Math.min(1, maat / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * schaal));
  c.height = Math.max(1, Math.round(img.naturalHeight * schaal));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
