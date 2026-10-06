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

## In bespreking

- **Vaste producten uit de webshop in het ERP** (06-10-2026): hoe bestaande en nieuwe
  webshopproducten als artikel in het ERP komen (varianten/kleuren, productcode,
  foto, onderdelen zoals sleutelringen en verpakking, op voorraad of op bestelling,
  prijs en marge). Basis is gebouwd: printprofiel per stuk, stuks per plaat, Bijprinten.
  Koppelsleutel: Sanity-product (slug) + maatvariant (`sizeVariants[].label`); de webshop
  kent (nog) geen kleurvarianten. Producten kunnen uit Sanity ingelezen worden (project
  `o0bi0oux`, dataset `production`), Sanity blijft de bron voor naam, prijs en foto.
