# ERP 3D Print & Ontwerp

Eigen ERP voor 3Dplezier met een Odoo-achtige schil: dossiers (offerte, werkbon, leveringen, afrekening via Accountable), productie (printers via Home Assistant, printopdrachten, runs), inkoop (ook facturen inlezen met Gemini of UBL), voorraad en financiën. Het draait als **Home Assistant-add-on**, naast het oude pakket "3D Print ERP".

## Lokaal (Windows)

| Script | Wat het doet |
|---|---|
| `install.bat` | dependencies van backend en frontend installeren (opnieuw na elke update met nieuwe packages) |
| `dev.bat` | backend (poort 3010) en frontend (poort 5173) starten → http://localhost:5173 |
| `test.bat` | de backendtests draaien |
| `build_deploy.bat` | tests → frontend bouwen → kopie naar `erp_3d_print_ontwerp/` (de add-on) → versie +1 → commit & push naar GitHub |

Lokale instellingen voor koppelingen: als omgevingsvariabelen (nooit in de databank), bv. `setx GEMINI_API_KEY "…"`, `setx HA_URL "http://192.168.1.50:8123"`, `setx HA_TOKEN "…"`, `setx SMTP_USER "…"`, `setx SMTP_PASS "…"`. Daarna `dev.bat` opnieuw starten.

## Eerste keer naar GitHub en Home Assistant

1. Maak op GitHub een **privé** repository aan, bv. `ERP-3D-Print-en-Ontwerp` (andere naam? pas dan ook `repository.json` en `erp_3d_print_ontwerp/config.yaml` → `url` aan).
2. In deze map, eenmalig (opdrachtprompt):
   ```
   git init
   git branch -M main
   git remote add origin https://github.com/spiesse42/ERP-3D-Print-en-Ontwerp.git
   ```
3. `build_deploy.bat` draaien. De `.gitignore` houdt de databank, bijlagen, backups, `node_modules` en pdf's in de hoofdmap buiten GitHub; het script stopt als er toch een databank in `erp_3d_print_ontwerp/` terechtkomt.
4. Home Assistant → Instellingen → Add-ons → Add-on store → ⋮ → **Repositories** → de URL van de repo toevoegen. Bij een privé-repo: een GitHub-token in de URL (`https://<token>@github.com/…`), of maak de repo publiek (er staat geen data in).
5. **ERP 3D Print & Ontwerp** → Installeren → Configuratie (zie hieronder) → Starten → "In zijbalk tonen".

## Configuratie van de add-on

| Optie | Wat |
|---|---|
| `gemini_api_key` | sleutel voor Factuur inlezen (PDF/foto). UBL-bestanden hebben hem niet nodig. |
| `gemini_model` | leeg = standaard |
| `smtp_user`, `smtp_pass`, `smtp_from` | Gmail-adres en app-wachtwoord om offertes, werkbonnen en pakbonnen te mailen |
| `tijdzone` | standaard `Europe/Brussels` |

Home Assistant zelf (printers, camera, kWh-meters) werkt in de add-on zonder token (via de Supervisor).

## Gegevens en backups

- Alles staat in de datamap van de add-on (`/data`): `erp.db` (databank), `bijlagen/`, `backups/`. Die map zit mee in de gewone back-ups van Home Assistant.
- Het ERP maakt elke dag zelf een backup van de databank (de laatste 14 blijven), en met de hand via **Instellingen → Onderhoud** (de laatste 20). Daar kun je ze ook downloaden.
- **Terugzetten**: download de gewenste backup (Instellingen → Onderhoud), hernoem hem naar `terugzetten.db` en zet hem in de map van de add-on: `addon_configs/…_erp_3d_print_ontwerp` (bereikbaar via de add-on "Samba share" of "Advanced SSH & Web Terminal"). Herstart de add-on: de huidige databank gaat eerst naar `backups/` (naam `erp-voor-terugzetten-…`), daarna wordt de backup gebruikt. Of zet een volledige Home Assistant-back-up terug.

## Overschakelen van het oude pakket

1. Beide add-ons draaien naast elkaar (andere naam, andere poort, eigen databank).
2. In het nieuwe pakket: Instellingen invullen (bedrijf, tarieven, printers + koppeling, nummering met het volgende nummer), voorraad en lopende dossiers met de hand ingeven.
3. Werkt alles, dan het oude pakket stoppen en als archief laten staan.

## Als de add-on niet verschijnt of niet start

- **Verschijnt niet in de Add-on store:** Instellingen → Systeem → Logboeken → "Supervisor". Een fout over `config.yaml` betekent meestal een ongeldig teken in dat bestand; het moet gewone ASCII-tekst blijven (geen accenten). Daarna ⋮ → "Controleren op updates" / "Herladen".
- **Installeren of bouwen mislukt:** het logboek van de Supervisor toont de Docker-fout.
- **Start niet of Ingress toont een fout:** tabblad "Logboek" van de add-on.
