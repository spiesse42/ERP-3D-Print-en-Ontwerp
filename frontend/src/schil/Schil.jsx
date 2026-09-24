// De buitenste schil: bovenbalk (raster-knop, appnaam, menu van de app) en
// daaronder de inhoud van de pagina. Geen vaste zijbalk, zoals in Odoo.
import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { appVoorPad } from '../apps.js';
import { useOmgeving } from './Omgeving.jsx';
import Icoon from './Icoon.jsx';

// Interne link die de navigatiebewaking respecteert (niet-opgeslagen werk).
export function Link({ naar, children, className, ...rest }) {
  const { navigeer } = useOmgeving();
  const href = naar.startsWith('/') ? `.${naar}` : naar;
  return (
    <a href={href} className={className} {...rest}
      onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigeer(naar); }}>
      {children}
    </a>
  );
}

export default function Schil() {
  const { pathname } = useLocation();
  const app = appVoorPad(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = app?.menu || [];
  const actief = (sub) => {
    const pad = `/${app.id}${sub ? '/' + sub : ''}`;
    if (sub) return pathname.startsWith(pad);
    // Het hoofdmenu ('') is actief tenzij een ander menu-item van deze app past
    // (bv. /dossiers/offertes → enkel "Offertes").
    const ander = menu.some(([s]) => s && pathname.startsWith(`/${app.id}/${s}`));
    return !ander && (pathname === pad || pathname.startsWith(pad + '/'));
  };

  return (
    <div className="app">
      <header className="topbar">
        <Link naar="/" className="home" aria-label="Naar het startscherm" onClickCapture={() => setMenuOpen(false)}>
          <Icoon naam="raster" maat={20} />
        </Link>
        <span className="appname">{app ? app.naam : 'ERP 3D Print & Ontwerp'}</span>
        {app && menu.length > 1 && (
          <button type="button" className="menuknop" aria-expanded={menuOpen} aria-controls="mobielmenu" onClick={() => setMenuOpen(o => !o)}>
            <Icoon naam="menu" /> Menu
          </button>
        )}
        {app && (
          <nav aria-label={`Menu ${app.naam}`}>
            {menu.map(([sub, label]) => (
              <Link key={sub} naar={`/${app.id}${sub ? '/' + sub : ''}`} className={actief(sub) ? 'on' : ''}>{label}</Link>
            ))}
          </nav>
        )}
        <span className="spacer" />
        <span className="who" title="Spiesse">SP</span>
      </header>
      {app && menu.length > 1 && (
        <nav id="mobielmenu" className={`mobielmenu${menuOpen ? ' open' : ''}`} aria-label="Menu">
          {menu.map(([sub, label]) => (
            <Link key={sub} naar={`/${app.id}${sub ? '/' + sub : ''}`} className={actief(sub) ? 'on' : ''}
              onClickCapture={() => setMenuOpen(false)}>{label}</Link>
          ))}
        </nav>
      )}
      <main className="app-body">
        <Outlet />
      </main>
    </div>
  );
}
