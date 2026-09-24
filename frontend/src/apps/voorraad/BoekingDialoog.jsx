import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import { aantal as fmtAantal, naarInvoer, uitInvoer, vandaag } from '../../lib/formaat.js';

// Voorraad boeken vanuit het artikelformulier:
//   in        → nieuwe partij (ontvangen of zelf geproduceerd)
//   uit       → eraf volgens FIFO (gebruik, levering, correctie)
//   corrigeer → naar een exact aantal (zoals "Update quantity" in Odoo)
const TITELS = { in: 'Voorraad erbij', uit: 'Voorraad eraf', corrigeer: 'Aantal aanpassen' };

export default function BoekingDialoog({ richting, artikel: a, onSluit, onKlaar }) {
  const { melding } = useOmgeving();
  const redenenIn = [a.wordt_gekocht && ['ontvangst', 'Ontvangen (gekocht)'], a.zelf_geprint && ['productie', 'Zelf geproduceerd']].filter(Boolean);
  const [f, setF] = useState({
    aantal: richting === 'corrigeer' ? naarInvoer(a.voorraad) : richting === 'uit' && a.type === 'filament' ? '1' : '',
    reden: richting === 'in' ? (redenenIn[0]?.[0] || 'ontvangst') : 'gebruik',
    prijs_per_eenheid: naarInvoer(a.gem_prijs ?? (a.zelf_geprint && !a.wordt_gekocht ? a.productieprijs : a.inkoopprijs)),
    datum: vandaag(),
    locatie: a.locatie || '',
    notitie: '',
  });
  const [bezig, setBezig] = useState(false);
  const zet = k => e => setF(x => ({ ...x, [k]: e.target.value }));
  const n = uitInvoer(f.aantal);
  const prijsFout = f.prijs_per_eenheid !== '' && Number.isNaN(uitInvoer(f.prijs_per_eenheid));
  const geldig = n !== null && !Number.isNaN(n) && (richting === 'corrigeer' ? n >= 0 : n > 0) && !prijsFout
    && !(richting === 'uit' && n > a.voorraad + 1e-9);

  async function bewaar() {
    setBezig(true);
    try {
      const r = await api.post(`/voorraad/artikelen/${a.id}/boeking`, {
        richting, aantal: n, reden: richting === 'corrigeer' ? undefined : f.reden,
        prijs_per_eenheid: richting === 'in' ? uitInvoer(f.prijs_per_eenheid) : undefined,
        datum: richting === 'in' ? f.datum : undefined, locatie: richting === 'in' ? f.locatie : undefined,
        notitie: f.notitie,
      });
      melding(r.ongewijzigd ? 'Aantal was al correct, niets geboekt.' : 'Voorraad geboekt.');
      onKlaar();
    } catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); }
  }

  return (
    <Dialoog titel={`${TITELS[richting]} · ${a.weergave}`} onSluit={onSluit}
      voet={<>
        <button type="button" className="btn" onClick={onSluit}>Annuleren</button>
        <button type="button" className="btn primary" disabled={!geldig || bezig} onClick={bewaar}>Boeken</button>
      </>}>
      <div className="fgrid">
        <div>
          <label htmlFor="b-aantal">{richting === 'corrigeer' ? 'Nieuw aantal (geteld)' : 'Aantal'}</label>
          <div className="unit">
            <input id="b-aantal" className={`inp num${f.aantal && !geldig && !prijsFout ? ' fout' : ''}`} inputMode="decimal" autoFocus
              value={f.aantal} onChange={zet('aantal')} onKeyDown={e => { if (e.key === 'Enter' && geldig) bewaar(); }} />
            <span>{a.eenheid}</span>
          </div>
        </div>
        <div>
          <span className="lbl">Nu op voorraad</span>
          <div className="num" style={{ padding: '6px 2px' }}>{fmtAantal(a.voorraad)} {a.eenheid}</div>
        </div>
        {richting === 'in' && <>
          {redenenIn.length > 1 && (
            <div>
              <label htmlFor="b-reden">Herkomst</label>
              <select id="b-reden" className="inp" value={f.reden} onChange={zet('reden')}>
                {redenenIn.map(([w, l]) => <option key={w} value={w}>{l}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="b-prijs">Prijs per {a.type === 'filament' ? 'rol' : 'eenheid'}</label>
            <div className="unit"><input id="b-prijs" className={`inp num${prijsFout ? ' fout' : ''}`} inputMode="decimal" value={f.prijs_per_eenheid} onChange={zet('prijs_per_eenheid')} placeholder="optioneel" /><span>€</span></div>
          </div>
          <div><label htmlFor="b-datum">Datum</label><input id="b-datum" type="date" className="inp" value={f.datum} onChange={zet('datum')} /></div>
          <div><label htmlFor="b-loc">Locatie</label><input id="b-loc" className="inp" value={f.locatie} onChange={zet('locatie')} placeholder="optioneel" /></div>
        </>}
        {richting === 'uit' && (
          <div>
            <label htmlFor="b-reden">Reden</label>
            <select id="b-reden" className="inp" value={f.reden} onChange={zet('reden')}>
              <option value="gebruik">Gebruikt / verbruikt</option>
              <option value="levering">Geleverd aan klant</option>
              <option value="correctie">Correctie (kapot, verloren, …)</option>
            </select>
          </div>
        )}
        <div style={{ gridColumn: '1/-1' }}>
          <label htmlFor="b-notitie">Notitie</label>
          <input id="b-notitie" className="inp" value={f.notitie} onChange={zet('notitie')} placeholder="optioneel" />
        </div>
      </div>
      {richting === 'uit' && <p className="note" style={{ marginBottom: 0 }}>Er wordt eerst uit de oudste partij genomen (FIFO).{n > a.voorraad + 1e-9 ? ' Er is niet genoeg voorraad.' : ''}</p>}
      {richting === 'corrigeer' && <p className="note" style={{ marginBottom: 0 }}>Meer dan nu: er komt een partij bij aan de laatst gekende prijs. Minder: er gaat af van de oudste partij.</p>}
    </Dialoog>
  );
}
