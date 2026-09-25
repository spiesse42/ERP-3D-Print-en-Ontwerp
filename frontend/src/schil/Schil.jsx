// De buitenste schil: links een vaste app-balk (pc; wens 25-09: één klik naar
// elke app), bovenaan appnaam + menu van de app, daaronder de pagina. Op gsm
// verdwijnt de app-balk en toont de knop Menu eerst alle apps, daarna het
// menu van de huidige app.
import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { APPS, appVoorPad } from '../apps.js';
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

  const naarApp = a => (a.menu[0]?.[0] ? `/${a.id}/${a.menu[0][0]}` : `/${a.id}`);
  const sluit = () => setMenuOpen(false);

  return (
    <div className="app" style={app ? { '--app-kleur': app.kleur } : undefined}>
      <nav className="zijbalk" aria-label="Apps">
        <Link naar="/" className={`home${!app ? ' on' : ''}`} aria-current={!app ? 'page' : undefined} title="Startscherm">
          <span className="ic"><Icoon naam="raster" maat={20} /></span><span>Start</span>
        </Link>
        <span className="scheiding" aria-hidden="true" />
        {APPS.map(a => (
          <Link key={a.id} naar={naarApp(a)} className={app?.id === a.id ? 'on' : ''} aria-current={app?.id === a.id ? 'page' : undefined}
            style={{ '--k': a.kleur }} title={a.naam}>
            <span className="ic"><Icoon naam={a.icoon} maat={20} /></span><span>{a.naam}</span>
          </Link>
        ))}
      </nav>
      <div className="app-kolom">
        <header className="topbar">
          <Link naar="/" className="home" aria-label="Naar het startscherm" onClickCapture={sluit}>
            <Icoon naam="raster" maat={20} />
          </Link>
          <span className="appname">{app ? app.naam : 'ERP 3D Print & Ontwerp'}</span>
          <button type="button" className="menuknop" aria-expanded={menuOpen} aria-controls="mobielmenu" onClick={() => setMenuOpen(o => !o)}>
            <Icoon naam="menu" /> Menu
          </button>
          {app && menu.length > 1 && (
            <nav aria-label={`Menu ${app.naam}`}>
              {menu.map(([sub, label]) => (
                <Link key={sub} naar={`/${app.id}${sub ? '/' + sub : ''}`} className={actief(sub) ? 'on' : ''}>{label}</Link>
              ))}
            </nav>
          )}
          <span className="spacer" />
          <span className="who" title="Spiesse">SP</span>
        </header>
        <div id="mobielmenu" className={`mobielmenu${menuOpen ? ' open' : ''}`}>
          <nav className="apps" aria-label="Apps">
            <Link naar="/" className={!app ? 'on' : ''} onClickCapture={sluit}><span className="ic" style={{ '--k': '#5c5347' }}><Icoon naam="raster" maat={18} /></span>Start</Link>
            {APPS.map(a => (
              <Link key={a.id} naar={naarApp(a)} className={app?.id === a.id ? 'on' : ''} style={{ '--k': a.kleur }} onClickCapture={sluit}>
                <span className="ic"><Icoon naam={a.icoon} maat={18} /></span>{a.naam}</Link>
            ))}
          </nav>
          {app && menu.length > 1 && (
            <nav className="sub" aria-label="Menu">
              <span className="kop">{app.naam}</span>
              {menu.map(([sub, label]) => (
                <Link key={sub} naar={`/${app.id}${sub ? '/' + sub : ''}`} className={actief(sub) ? 'on' : ''} onClickCapture={sluit}>{label}</Link>
              ))}
            </nav>
          )}
        </div>
        <main className="app-body">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
