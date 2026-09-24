import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { OmgevingProvider } from './schil/Omgeving.jsx';
import Schil from './schil/Schil.jsx';
import Startscherm from './schil/Startscherm.jsx';
import { NietGevonden } from './schil/BinnenKort.jsx';
import KlantenLijst from './apps/klanten/KlantenLijst.jsx';
import KlantFormulier from './apps/klanten/KlantFormulier.jsx';
import Instellingen from './apps/instellingen/Instellingen.jsx';
import ArtikelenLijst from './apps/voorraad/ArtikelenLijst.jsx';
import ArtikelFormulier from './apps/voorraad/ArtikelFormulier.jsx';
import TeBestellen from './apps/voorraad/TeBestellen.jsx';
import Mutaties from './apps/voorraad/Mutaties.jsx';
import Voorraadtelling from './apps/voorraad/Voorraadtelling.jsx';
import Categorieen from './apps/voorraad/Categorieen.jsx';
import AankopenLijst from './apps/inkoop/AankopenLijst.jsx';
import AankoopFormulier from './apps/inkoop/AankoopFormulier.jsx';
import LeveranciersLijst from './apps/inkoop/LeveranciersLijst.jsx';
import LeverancierFormulier from './apps/inkoop/LeverancierFormulier.jsx';
import FactuurInlezen from './apps/inkoop/FactuurInlezen.jsx';
import DossiersLijst from './apps/dossiers/DossiersLijst.jsx';
import DossierFormulier from './apps/dossiers/DossierFormulier.jsx';
import OffertesLijst from './apps/dossiers/OffertesLijst.jsx';
import LeveringenLijst from './apps/dossiers/LeveringenLijst.jsx';
import PrintersLive from './apps/productie/PrintersLive.jsx';
import RunsLijst from './apps/productie/RunsLijst.jsx';
import Printopdrachten from './apps/productie/Printopdrachten.jsx';
import FinOverzicht from './apps/financien/Overzicht.jsx';
import FinOpvolging from './apps/financien/Opvolging.jsx';
import FinMarges from './apps/financien/Marges.jsx';
import FinStatistieken from './apps/financien/Statistieken.jsx';
import AccountableImport from './apps/financien/AccountableImport.jsx';

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
            <Route path="klanten" element={<KlantenLijst />} />
            <Route path="klanten/:id" element={<KlantFormulier />} />
            <Route path="instellingen" element={<Instellingen />} />
            <Route path="instellingen/:sectie" element={<Instellingen />} />
            <Route path="voorraad" element={<Navigate to="/voorraad/artikelen" replace />} />
            <Route path="voorraad/artikelen" element={<ArtikelenLijst />} />
            <Route path="voorraad/artikelen/:id" element={<ArtikelFormulier />} />
            <Route path="voorraad/te-bestellen" element={<TeBestellen />} />
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
