// Gedeelde "omgeving" van de schil:
// - meldingen (korte berichten onderaan, i.p.v. alert())
// - bevestigen (eigen venster, i.p.v. confirm())
// - navigatiebewaking (niet-opgeslagen wijzigingen → eerst vragen)
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icoon from './Icoon.jsx';

const Ctx = createContext(null);

export function OmgevingProvider({ children }) {
  const [meldingen, setMeldingen] = useState([]);
  const [vraag, setVraag] = useState(null);
  const vuilRef = useRef(false);
  const navigate = useNavigate();

  const melding = useCallback((tekst, soort = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setMeldingen(m => [...m.slice(-2), { id, tekst, soort }]);
    setTimeout(() => setMeldingen(m => m.filter(x => x.id !== id)), soort === 'fout' ? 6000 : 3000);
  }, []);

  const bevestig = useCallback((opties) => new Promise(resolve => {
    setVraag({ ...opties, resolve });
  }), []);

  const zetVuil = useCallback((v) => { vuilRef.current = !!v; }, []);

  // Navigeren binnen de app. Zijn er niet-opgeslagen wijzigingen, dan eerst vragen.
  const navigeer = useCallback(async (naar) => {
    if (vuilRef.current) {
      const ok = await bevestig({
        titel: 'Wijzigingen niet opgeslagen',
        tekst: 'Je hebt wijzigingen die nog niet opgeslagen zijn. Wil je ze verwerpen?',
        bevestigLabel: 'Verwerpen', gevaarlijk: true,
      });
      if (!ok) return false;
      vuilRef.current = false;
    }
    navigate(naar);
    return true;
  }, [bevestig, navigate]);

  // Tabblad sluiten of herladen met niet-opgeslagen wijzigingen.
  useEffect(() => {
    const h = (e) => { if (vuilRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  function sluitVraag(antwoord) {
    vraag?.resolve(antwoord);
    setVraag(null);
  }

  return (
    <Ctx.Provider value={{ melding, bevestig, zetVuil, navigeer }}>
      {children}
      {vraag && <BevestigVenster vraag={vraag} onAntwoord={sluitVraag} />}
      <div className="meldingen" role="status" aria-live="polite">
        {meldingen.map(m => (
          <div key={m.id} className={`melding${m.soort === 'fout' ? ' fout' : ''}`}>
            <span>{m.tekst}</span>
            <button type="button" aria-label="Sluiten" onClick={() => setMeldingen(x => x.filter(y => y.id !== m.id))}>
              <Icoon naam="kruis" maat={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useOmgeving() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useOmgeving buiten OmgevingProvider');
  return c;
}

function BevestigVenster({ vraag, onAntwoord }) {
  const okRef = useRef(null);
  useEffect(() => {
    okRef.current?.focus();
    const h = (e) => { if (e.key === 'Escape') onAntwoord(false); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onAntwoord]);
  return (
    <Dialoog titel={vraag.titel} onSluit={() => onAntwoord(false)}
      voet={<>
        <button type="button" className="btn" onClick={() => onAntwoord(false)}>{vraag.annuleerLabel || 'Annuleren'}</button>
        <button type="button" ref={okRef} className={`btn ${vraag.gevaarlijk ? 'danger' : 'primary'}`} onClick={() => onAntwoord(true)}>
          {vraag.bevestigLabel || 'OK'}
        </button>
      </>}>
      <p style={{ margin: 0 }}>{vraag.tekst}</p>
    </Dialoog>
  );
}

// Algemeen venster (ook gebruikt voor kleine formulieren, bv. een prijsgroep).
export function Dialoog({ titel, onSluit, voet, children, breed }) {
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onSluit(); }}>
      <div className={`dialoog${breed ? ' breed' : ''}`} role="dialog" aria-modal="true" aria-label={titel}>
        <header>
          <h2>{titel}</h2>
          <button type="button" className="btn ghost" aria-label="Sluiten" onClick={onSluit}><Icoon naam="kruis" maat={16} /></button>
        </header>
        <div className="inhoud">{children}</div>
        {voet && <footer>{voet}</footer>}
      </div>
    </div>
  );
}
