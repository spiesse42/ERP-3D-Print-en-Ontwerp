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

## Gebouwd: webshopbestelling → klant + dossier (25-10-2026)

- Verkoop → Webshop → "Klant + dossier maken": klant op e-mailadres (anders nieuw, adres enkel
  bij levering aan huis), klantdossier met per gekozen lijn een printregel uit het printprofiel
  (slicerbestand, filament van de kleur als het gekend is, webshopprijs als eindbedrag).
  Zonder profiel of artikel: regel + waarschuwing. "Verkoop maken" neemt het dossier als één regel.

## Gebouwd: nieuw product uit een run (25-10-2026)

- Run koppelen → "Nieuw product": artikel + printprofiel (tijd en filament van de plaat ÷ stuks)
  + dossier Voorraad met printopdracht; de run hangt eraan, bevestigen = stuks in voorraad.

## Gebouwd: letterbestellingen (29-10-2026)

- Klantfiche → Prijsafspraken (vaste prijs per artikel per klant, bv. € 1,75 per letter).
- Letterprofiel: Printprofiel → Uit slicerbestand → "Elke plaat is een letter" (letter uit de plaatnaam).
- Dossier → "Letters…": lijst per naam of per kleur plakken → controle (kleur → filament via
  het webshoppalet, onthouden) → printregels per letter × kleur. Tab Letters: per kleur met
  voortgang, inpaklijst per naam, afdrukken.

## Ideeën / later

- ~~Onderdelen bij een klantdossier dat een product print~~ — gebouwd 24-10 (prijs + levering).
- Kleur per bestelling: de webshop bewaart de gekozen kleur sinds 06-10 in
  `orders.items[].color` (webshop-PR "Kleurenpalet + kleurkeuze"); bij de koppeling
  meenemen naar de printopdracht (kleurenpalet in Sanity heeft per kleur ook het filament).

## Nazicht 24-10-2026 — voorstellen (nog niet gebouwd)

1. ~~Onderdelen afboeken bij afrekenen zonder pakbon~~ — gebouwd 24-10 (het geprinte deel gaat mee op de automatische pakbon).
2. ~~Printregel bewaren als printprofiel van het product~~ — gebouwd 24-10 (knop bij de printregel, slicerbestand mee).
3. Voorraad → Mutaties: kolom "Bron" met een link naar de verkoop, levering, printopdracht of aankoop.
4. ~~Eén kost per stuk~~ — gebouwd 24-10 (gemeten, anders geschat, anders zelf ingevuld; artikel, Artikelen, Producten).
5. Productie → "Printers" (live) heet hetzelfde als Instellingen → "Printers" (instellingen):
   eerste hernoemen naar "Live" of "Printers nu".
6. Webshopbestelling met een kleurkeuze → filament meegeven aan de printopdracht.
7. Opruimen: oude, ongebruikte frontendbestanden (`frontend/src/pages/*`, `App.css`, `index.css`).
