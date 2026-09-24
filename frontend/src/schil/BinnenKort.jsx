import { useLocation } from 'react-router-dom';
import { appVoorPad } from '../apps.js';
import { ControlePaneel } from './Weergaven.jsx';

// Scherm voor een app die nog niet gebouwd is (volgens de herziene roadmap).
export default function BinnenKort() {
  const { pathname } = useLocation();
  const app = appVoorPad(pathname);
  if (!app) return <NietGevonden />;
  return (
    <>
      <ControlePaneel kruimels={[{ label: app.naam }]} />
      <div className="page">
        <div className="panel"><div className="pbody">
          <p style={{ margin: 0 }}><b>{app.naam}</b> wordt gebouwd in <b>stap {app.stap}</b> van de roadmap.</p>
          <p className="note" style={{ marginBottom: 0 }}>Het menu bovenaan toont al hoe deze app ingedeeld wordt.</p>
        </div></div>
      </div>
    </>
  );
}

export function NietGevonden() {
  return (
    <>
      <ControlePaneel kruimels={[{ label: 'Niet gevonden' }]} />
      <div className="leeg"><b>Deze pagina bestaat niet.</b>Ga via het raster linksboven terug naar het startscherm.</div>
    </>
  );
}
