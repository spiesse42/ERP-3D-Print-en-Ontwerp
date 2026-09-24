import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useData } from '../../schil/useData.js';
import { useOmgeving, Dialoog } from '../../schil/Omgeving.jsx';
import { Laden, Fout } from '../../schil/Weergaven.jsx';
import { euro, naarInvoer } from '../../lib/formaat.js';

// Printers (stap 4): naam, machinetarief per uur (verplicht om te kunnen
// rekenen: geen terugval op een globaal tarief), gemiddeld verbruik (voor de
// schatting op offertes), actief. Home Assistant-koppeling volgt in stap 6.
const KOPPEL = ['koppeling', 'ha_prefix', 'watt_entity', 'kwh_entity', 'camera_entity', 'pauze_entity', 'hervat_entity', 'annuleer_entity'];
const LEEG = { naam: '', machine_per_uur: '', verbruik_watt: '', notities: '', koppeling: 'manueel', ha_prefix: '', watt_entity: '', kwh_entity: '', camera_entity: '', pauze_entity: '', hervat_entity: '', annuleer_entity: '' };
const KOPPELINGEN = [['manueel', 'Manueel (starten/stoppen met een knop)'], ['bambu_ha', 'Bambu Lab via Home Assistant'], ['anycubic_ha', 'Anycubic S1 MQTT Bridge via Home Assistant']];
const VOORBEELD = { bambu_ha: 'sensor.a1mini_0309…_', anycubic_ha: 'sensor.anycubic_s1_' };

export default function Printers() {
  const { data, fout, laden, herlaad } = useData('/printers');
  const { melding, bevestig } = useOmgeving();
  const [open, setOpen] = useState(null);     // null | 'nieuw' | printer
  const [form, setForm] = useState(LEEG);
  const [bezig, setBezig] = useState(false);
  const [test, setTest] = useState(null);
  const zet = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  function openen(p) {
    setOpen(p);
    setTest(null);
    setForm(p === 'nieuw' ? LEEG : { naam: p.naam, machine_per_uur: naarInvoer(p.machine_per_uur), verbruik_watt: naarInvoer(p.verbruik_watt), notities: p.notities || '',
      ...Object.fromEntries(KOPPEL.map(k => [k, p[k] || (k === 'koppeling' ? 'manueel' : '')])) });
  }
  async function opslaan() {
    setBezig(true);
    try {
      if (open === 'nieuw') await api.post('/printers', form); else await api.put(`/printers/${open.id}`, form);
      await herlaad(); setOpen(null); melding('Printer opgeslagen.');
    } catch (e) { melding(e.message, 'fout'); }
    finally { setBezig(false); }
  }
  async function testKoppeling() {
    setTest({ bezig: true });
    try { setTest(await api.post('/productie/koppeling-testen', form)); }
    catch (e) { setTest({ fout: e.message }); }
  }
  async function wisselActief() {
    const aan = !open.actief;
    if (!aan && !await bevestig({ titel: 'Printer deactiveren', tekst: `${open.naam} verdwijnt uit de keuzelijsten, maar blijft bewaard bij oude offertes en werkbonnen. Je kunt hem later opnieuw activeren.`, bevestigLabel: 'Deactiveren' })) return;
    try { await api.patch(`/printers/${open.id}/actief`, { actief: aan }); await herlaad(); setOpen(null); melding(aan ? 'Printer terug actief.' : 'Printer gedeactiveerd.'); }
    catch (e) { melding(e.message, 'fout'); }
  }

  if (fout) return <Fout tekst={fout} />;
  if (!data && laden) return <Laden />;
  const zonderTarief = data.filter(p => p.actief && (p.machine_per_uur == null || p.verbruik_watt == null));
  return (
    <div className="panel">
      <h3>Printers <button type="button" className="btn primary" onClick={() => openen('nieuw')}>Nieuw</button></h3>
      <div className="pbody">
        {zonderTarief.length > 0 && (
          <div className="waarschuwing" style={{ margin: '0 0 12px' }}>
            Vul het machinetarief en het verbruik in van: {zonderTarief.map(p => p.naam).join(', ')}. Zonder die gegevens kan de rekenmotor geen print op die printer berekenen.
          </div>
        )}
        <div className="tabelvak">
          <table className="mini">
            <thead><tr><th>Printer</th><th className="r">Machinetarief</th><th className="r">Gem. verbruik</th><th>Koppeling</th><th>Status</th></tr></thead>
            <tbody>
              {data.map(p => (
                <tr key={p.id} className={`clk${p.actief ? '' : ' op'}`} tabIndex={0} onClick={() => openen(p)} onKeyDown={e => { if (e.key === 'Enter') openen(p); }}>
                  <td><b>{p.naam}</b></td>
                  <td className="r num">{p.machine_per_uur == null ? <span className="badge b-warn">ontbreekt</span> : `${euro(p.machine_per_uur)}/u`}</td>
                  <td className="r num">{p.verbruik_watt == null ? <span className="badge b-warn">ontbreekt</span> : `${naarInvoer(p.verbruik_watt)} W`}</td>
                  <td className="sub">{{ manueel: 'manueel', bambu_ha: 'Bambu · HA', anycubic_ha: 'Anycubic · HA' }[p.koppeling] || 'manueel'}</td>
                  <td>{p.actief ? <span className="badge b-pos">Actief</span> : <span className="badge b-neutral">Gedeactiveerd</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginBottom: 0 }}>Het machinetarief (afschrijving, onderhoud, slijtage per printuur) wordt gebruikt voor elke print op die printer, zonder terugval. Het gemiddeld verbruik dient voor de schatting van de elektriciteit op een offerte. Met een koppeling via Home Assistant volgt het ERP de printer live (Productie) en meet het het werkelijke verbruik.</p>
      </div>
      {open && (
        <Dialoog titel={open === 'nieuw' ? 'Nieuwe printer' : open.naam} onSluit={() => setOpen(null)} breed
          voet={<>
            {open !== 'nieuw' && <button type="button" className="btn ghost" style={{ marginRight: 'auto' }} onClick={wisselActief}>{open.actief ? 'Deactiveren' : 'Terug activeren'}</button>}
            <button type="button" className="btn" onClick={() => setOpen(null)}>Annuleren</button>
            <button type="button" className="btn primary" disabled={bezig || !form.naam.trim()} onClick={opslaan}>Opslaan</button>
          </>}>
          <div className="fgrid">
            <div style={{ gridColumn: '1/-1' }}><label htmlFor="p-naam">Naam</label><input id="p-naam" className="inp" value={form.naam} onChange={zet('naam')} autoFocus /></div>
            <div><label htmlFor="p-tarief">Machinetarief</label><div className="unit"><input id="p-tarief" className="inp num" inputMode="decimal" value={form.machine_per_uur} onChange={zet('machine_per_uur')} placeholder="bv. 0,18" /><span>€/uur</span></div></div>
            <div><label htmlFor="p-watt">Gemiddeld verbruik</label><div className="unit"><input id="p-watt" className="inp num" inputMode="decimal" value={form.verbruik_watt} onChange={zet('verbruik_watt')} placeholder="bv. 95" /><span>watt</span></div></div>
            <div style={{ gridColumn: '1/-1' }}><label htmlFor="p-koppeling">Koppeling</label>
              <select id="p-koppeling" className="inp" value={form.koppeling} onChange={zet('koppeling')}>
                {KOPPELINGEN.map(([w, l]) => <option key={w} value={w}>{l}</option>)}
              </select></div>
            {form.koppeling !== 'manueel' && (
              <div style={{ gridColumn: '1/-1' }}><label htmlFor="p-prefix">Begin van de entiteitsnamen</label>
                <input id="p-prefix" className="inp mono" value={form.ha_prefix} onChange={zet('ha_prefix')} placeholder={`bv. ${VOORBEELD[form.koppeling]}`} />
                <div className="sub">Het deel vóór "printstatus", "nozzle_temperatuur" … zoals in het oude pakket. Status, voortgang en temperaturen volgen daaruit.</div></div>
            )}
            <div><label htmlFor="p-wattent">Wattmeter (stekker)</label><input id="p-wattent" className="inp mono" value={form.watt_entity} onChange={zet('watt_entity')} placeholder="sensor.stekker_power" /></div>
            <div><label htmlFor="p-kwhent">kWh-meter (stekker)</label><input id="p-kwhent" className="inp mono" value={form.kwh_entity} onChange={zet('kwh_entity')} placeholder="sensor.stekker_energy" /></div>
            {form.koppeling !== 'manueel' && <>
              <div><label htmlFor="p-cam">Camera</label><input id="p-cam" className="inp mono" value={form.camera_entity} onChange={zet('camera_entity')} placeholder="camera.…" /></div>
              <div><label htmlFor="p-pauze">Pauzeknop</label><input id="p-pauze" className="inp mono" value={form.pauze_entity} onChange={zet('pauze_entity')} placeholder="button.…_pauze" /></div>
              <div><label htmlFor="p-hervat">Hervatknop</label><input id="p-hervat" className="inp mono" value={form.hervat_entity} onChange={zet('hervat_entity')} placeholder="button.…_hervat" /></div>
              <div><label htmlFor="p-annuleer">Annuleerknop</label><input id="p-annuleer" className="inp mono" value={form.annuleer_entity} onChange={zet('annuleer_entity')} placeholder="button.…_stop" /></div>
            </>}
            {(form.koppeling !== 'manueel' || form.watt_entity || form.kwh_entity) && (
              <div style={{ gridColumn: '1/-1' }}>
                <button type="button" className="btn" onClick={testKoppeling} disabled={test?.bezig}>Koppeling testen</button>
                {test?.fout && <div className="regelfout">{test.fout}</div>}
                {test?.lezing && (
                  <div className="kopptest">
                    <div>Status nu: <b>{test.lezing.status}</b>{test.lezing.ruwe_status != null && <span className="sub"> ({test.lezing.ruwe_status})</span>}{test.lezing.watt != null && <> · {naarInvoer(test.lezing.watt)} W</>}{test.lezing.kwh_meter != null && <> · meter {naarInvoer(test.lezing.kwh_meter)} kWh</>}</div>
                    <div className="sub">{test.gevonden.length} entiteit(en) gevonden{test.ontbrekend.length ? `, ${test.ontbrekend.length} niet gevonden:` : '.'}</div>
                    {test.ontbrekend.length > 0 && <ul className="mono klein">{test.ontbrekend.map(x => <li key={x}>{x}</li>)}</ul>}
                    {test.ontbrekend.length > 0 && test.suggesties?.length > 0 && <details><summary className="sub">Entiteiten met dit begin in Home Assistant ({test.suggesties.length})</summary><ul className="mono klein">{test.suggesties.map(x => <li key={x}>{x}</li>)}</ul></details>}
                  </div>
                )}
              </div>
            )}
            <div style={{ gridColumn: '1/-1' }}><label htmlFor="p-not">Notities</label><textarea id="p-not" className="inp" rows={2} value={form.notities} onChange={zet('notities')} placeholder="bv. BMCU-370, bouwplaat 180 × 180 mm" /></div>
          </div>
        </Dialoog>
      )}
    </div>
  );
}
