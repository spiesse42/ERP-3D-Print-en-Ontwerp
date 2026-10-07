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

- Onderdelen ook afboeken bij een klantdossier dat een product via "Uit product" print
  (nu enkel bij een verkoop uit voorraad).
- Kleur per bestelling: de webshop bewaart de gekozen kleur sinds 06-10 in
  `orders.items[].color` (webshop-PR "Kleurenpalet + kleurkeuze"); bij de koppeling
  meenemen naar de printopdracht (kleurenpalet in Sanity heeft per kleur ook het filament).
