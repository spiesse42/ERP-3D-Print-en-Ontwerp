# ERP 3D Print & Ontwerp — instructies voor Claude

## Communicatie met David
- In het Nederlands, concreet en kort.
- **Na elke aanpassing ALTIJD meegeven wat David zelf moet doen**, ook als dat "niets" is:
  - ERP gewijzigd → `build_deploy.bat` dubbelklikken (haalt zelf de nieuwste code op, test, bouwt, pusht), daarna in Home Assistant bij de add-on **Bijwerken**.
  - Enkel documentatie of `.bat`-bestanden gewijzigd → zeggen dat er niets bijgewerkt moet worden (een nieuwe `.bat` komt mee bij de volgende `build_deploy.bat`).
  - Webshop (repo `3dprintenontwerp-webshop`): enkel sitecode → Netlify zet het zelf live, niets te doen; schema van Sanity Studio gewijzigd → `update-webshop.bat` dubbelklikken; plus eventuele stappen in Sanity (Publish, webhook-filter).

## Werkwijze
- Wijzigingen via een PR op de ontwikkelbranch; David gaf toestemming om ERP-PR's zelf te mergen. Webshop-PR's merget David (of Claude na "merge maar").
- Backend: `cd backend && npm test`; frontend: `cd frontend && npm run build`.
- Open punten en ideeën: `OVERZICHT.md`.
