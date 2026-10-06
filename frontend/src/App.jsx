import { lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { OmgevingProvider } from './schil/Omgeving.jsx';
import Schil from './schil/Schil.jsx';
import Startscherm from './schil/Startscherm.jsx';
import { NietGevonden } from './schil/BinnenKort.jsx';
// Elke tegel wordt pas geladen als je ze opent (29-09): de eerste keer openen
// (zeker op gsm via Home Assistant) gaat sneller dan met één groot bestand.
const KlantenLijst = lazy(() => import('./apps/klanten/KlantenLijst.jsx'));
const Mail = lazy(() => import('./apps/mail/Mail.jsx'));
const KlantFormulier = lazy(() => import('./apps/klanten/KlantFormulier.jsx'));
const Instellingen = lazy(() => import('./apps/instellingen/Instellingen.jsx'));
const ArtikelenLijst = lazy(() => import('./apps/voorraad/ArtikelenLijst.jsx'));
const ArtikelFormulier = lazy(() => import('./apps/voorraad/ArtikelFormulier.jsx'));
const TeBestellen = lazy(() => import('./apps/voorraad/TeBestellen.jsx'));
const Producten = lazy(() => import('./apps/voorraad/Producten.jsx'));
const Mutaties = lazy(() => import('./apps/voorraad/Mutaties.jsx'));
const Voorraadtelling = lazy(() => import('./apps/voorraad/Voorraadtelling.jsx'));
const Categorieen = lazy(() => import('./apps/voorraad/Categorieen.jsx'));
const AankopenLijst = lazy(() => import('./apps/inkoop/AankopenLijst.jsx'));
const AankoopFormulier = lazy(() => import('./apps/inkoop/AankoopFormulier.jsx'));
const LeveranciersLijst = lazy(() => import('./apps/inkoop/LeveranciersLijst.jsx'));
const LeverancierFormulier = lazy(() => import('./apps/inkoop/LeverancierFormulier.jsx'));
const FactuurInlezen = lazy(() => import('./apps/inkoop/FactuurInlezen.jsx'));
const DossiersLijst = lazy(() => import('./apps/dossiers/DossiersLijst.jsx'));
const DossierFormulier = lazy(() => import('./apps/dossiers/DossierFormulier.jsx'));
const OffertesLijst = lazy(() => import('./apps/dossiers/OffertesLijst.jsx'));
const LeveringenLijst = lazy(() => import('./apps/dossiers/LeveringenLijst.jsx'));
const PrintersLive = lazy(() => import('./apps/productie/PrintersLive.jsx'));
const RunsLijst = lazy(() => import('./apps/productie/RunsLijst.jsx'));
const Printopdrachten = lazy(() => import('./apps/productie/Printopdrachten.jsx'));
const FinOverzicht = lazy(() => import('./apps/financien/Overzicht.jsx'));
const FinOpvolging = lazy(() => import('./apps/financien/Opvolging.jsx'));
const FinMarges = lazy(() => import('./apps/financien/Marges.jsx'));
const FinStatistieken = lazy(() => import('./apps/financien/Statistieken.jsx'));
const AccountableImport = lazy(() => import('./apps/financien/AccountableImport.jsx'));
const VerkopenLijst = lazy(() => import('./apps/verkoop/VerkopenLijst.jsx'));
const VerkoopFormulier = lazy(() => import('./apps/verkoop/VerkoopFormulier.jsx'));

// De app kan onder een voorvoegsel draaien (Home Assistant Ingress). De
// backend zet dat voorvoegsel als <base href> in index.html; React Router
// gebruikt hetzelfde pad als basename. Lokaal is dat gewoon "/".
const basename = new URL(document.baseURI).pathname.replace(/\/$/, '') || '/';

export default function App() {
  return (
    <BrowserRouter basename={basename}>
      <OmgevingProvider>
        <Routes>
          <Route element={<Schil />}>
            <Route index element={<Startscherm />} />
            <Route path="mail" element={<Mail />} />
            <Route path="klanten" element={<KlantenLijst />} />
            <Route path="klanten/:id" element={<KlantFormulier />} />
            <Route path="instellingen" element={<Instellingen />} />
            <Route path="instellingen/:sectie" element={<Instellingen />} />
            <Route path="voorraad" element={<Navigate to="/voorraad/artikelen" replace />} />
            <Route path="voorraad/artikelen" element={<ArtikelenLijst />} />
            <Route path="voorraad/artikelen/:id" element={<ArtikelFormulier />} />
            <Route path="voorraad/te-bestellen" element={<TeBestellen />} />
            <Route path="voorraad/producten" element={<Producten />} />
            <Route path="voorraad/mutaties" element={<Mutaties />} />
            <Route path="voorraad/telling" element={<Voorraadtelling />} />
            <Route path="voorraad/categorieen" element={<Categorieen />} />
            <Route path="inkoop" element={<Navigate to="/inkoop/aankopen" replace />} />
            <Route path="inkoop/aankopen" element={<AankopenLijst />} />
            <Route path="inkoop/aankopen/:id" element={<AankoopFormulier />} />
            <Route path="inkoop/inlezen" element={<FactuurInlezen />} />
            <Route path="inkoop/leveranciers" element={<LeveranciersLijst />} />
            <Route path="inkoop/leveranciers/:id" element={<LeverancierFormulier />} />
            <Route path="dossiers" element={<DossiersLijst />} />
            <Route path="dossiers/offertes" element={<OffertesLijst />} />
            <Route path="dossiers/leveringen" element={<LeveringenLijst />} />
            <Route path="dossiers/:id" element={<DossierFormulier />} />
            <Route path="verkoop" element={<VerkopenLijst />} />
            <Route path="verkoop/:id" element={<VerkoopFormulier />} />
            <Route path="productie" element={<PrintersLive />} />
            <Route path="productie/opdrachten" element={<Printopdrachten />} />
            <Route path="productie/runs" element={<RunsLijst />} />
            <Route path="financien" element={<Navigate to="/financien/overzicht" replace />} />
            <Route path="financien/overzicht" element={<FinOverzicht />} />
            <Route path="financien/opvolging" element={<FinOpvolging />} />
            <Route path="financien/marges" element={<FinMarges />} />
            <Route path="financien/statistieken" element={<FinStatistieken />} />
            <Route path="financien/import" element={<AccountableImport />} />
            <Route path="*" element={<NietGevonden />} />
          </Route>
        </Routes>
      </OmgevingProvider>
    </BrowserRouter>
  );
}
