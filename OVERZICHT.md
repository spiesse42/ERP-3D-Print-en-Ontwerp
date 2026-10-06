# Overzicht — open punten en ideeën

Bijgehouden tijdens de ontwikkeling. Wat hier staat is (nog) niet gebouwd.

## On hold

- **Webshopkoppeling** (06-10-2026): bestellingen uit de webshop automatisch in het ERP
  (uit voorraad leveren of bijprinten), verzending opvolgen via **Sendcloud**.
  De webshop is eigen code (repo `spiesse42/3dprintenontwerp-webshop`: Next.js op Netlify,
  producten in **Sanity**, bestellingen in **Supabase** `orders.items` met `slug`,
  `quantity`, `price` en `variantLabel`, betalingen via Mollie, labels via Sendcloud).
  Bestellingen kunnen dus rechtstreeks uit Supabase gelezen worden (geen mail nodig).
  Wacht op: vaste producten in het ERP (zie hieronder).

## Gebouwd: vaste producten (06-10-2026)

- Printregel per stuk + stuks per plaat, printprofiel per product, Bijprinten.
- Webshopproducten ophalen uit Sanity (Voorraad → Producten → Webshop ophalen): per product
  en maatvariant een artikel; Sanity blijft de bron voor naam, prijs en foto.
- Onderdelen per stuk (sleutelring, zakje…), afgeboekt bij de verkoop.
- Overzicht Producten: kost per stuk (geschat of gemeten), marge, voorraad, verkocht.

## Ideeën / later

- Onderdelen ook afboeken bij een klantdossier dat een product via "Uit product" print
  (nu enkel bij een verkoop uit voorraad).
- Kleur per bestelling: bij de webshopkoppeling de gevraagde kleur (opmerking) meenemen
  naar de printopdracht.
