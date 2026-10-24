# Overzicht — open punten en ideeën

Bijgehouden tijdens de ontwikkeling. Wat hier staat is (nog) niet gebouwd.

## Gebouwd: webshopbestellingen (07-10-2026)

- Verkoop → **Webshop**: het ERP haalt de betaalde bestellingen zelf op uit Supabase (geen
  wijziging aan de webshop, geen Netlify-build). Per regel het gekoppelde artikel, voorraad,
  gekozen kleur(en) en Bijprinten; "Verkoop maken" vult een nieuwe verkoop in en zet de
  bestelling op afgehandeld. Instellen: `supabase_url` + `supabase_key` in de add-on.

## Gebouwd: vaste producten (06-10-2026)

- Printregel per stuk + stuks per plaat, printprofiel per product, Bijprinten.
- Webshopproducten ophalen uit Sanity (Voorraad → Producten → Webshop ophalen): per product
  en maatvariant een artikel; Sanity blijft de bron voor naam, prijs en foto.
- Onderdelen per stuk (sleutelring, zakje…), afgeboekt bij de verkoop.
- Overzicht Producten: kost per stuk (geschat of gemeten), marge, voorraad, verkocht.

## Ideeën / later

- ~~Onderdelen bij een klantdossier dat een product print~~ — gebouwd 24-10 (prijs + levering).
- Kleur per bestelling: de webshop bewaart de gekozen kleur sinds 06-10 in
  `orders.items[].color` (webshop-PR "Kleurenpalet + kleurkeuze"); bij de koppeling
  meenemen naar de printopdracht (kleurenpalet in Sanity heeft per kleur ook het filament).

## Nazicht 24-10-2026 — voorstellen (nog niet gebouwd)

1. Onderdelen afboeken bij afrekenen zonder pakbon (nu enkel bij een levering/pakbon).
2. Printregel uit een slicerbestand in een dossier bewaren als printprofiel van het product
   (knop "Als printprofiel van het product bewaren").
3. Voorraad → Mutaties: kolom "Bron" met een link naar de verkoop, levering, printopdracht of aankoop.
4. Kostbegrippen op het artikel samenbrengen: "Productieprijs" (handmatig) naast "Productiekost
   (gemeten)" en "Kost / stuk" (Producten) → één kost per stuk: gemeten, anders geschat, anders handmatig.
5. Productie → "Printers" (live) heet hetzelfde als Instellingen → "Printers" (instellingen):
   eerste hernoemen naar "Live" of "Printers nu".
6. Webshopbestelling met een kleurkeuze → filament meegeven aan de printopdracht.
7. Opruimen: oude, ongebruikte frontendbestanden (`frontend/src/pages/*`, `App.css`, `index.css`).
