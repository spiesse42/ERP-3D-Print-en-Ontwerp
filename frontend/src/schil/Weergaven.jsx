// Herbruikbare Odoo-bouwstenen voor lijsten en formulieren.
import { Fragment } from 'react';
import Icoon from './Icoon.jsx';
import { Link } from './Schil.jsx';
import { useOmgeving } from './Omgeving.jsx';

/* ── Controlepaneel: kruimelpad, zoekbalk met facetten, acties, filters ── */
// kruimels: [{ label, naar? , mono? }]  (laatste = huidige pagina)
// facetten: [{ label, icoon: 'filter'|'lagen', onWeg }]
export function ControlePaneel({ kruimels, zoek, onZoek, facetten = [], acties, filters, teller, weergave, onWeergave, rechts }) {
  const rechterDeel = (
    <div className="right">
      {filters && <div className="filters">{filters}</div>}
      {rechts}
      {teller != null && <span className="pager num">{teller}</span>}
      {onWeergave && (
        <div className="views" role="group" aria-label="Weergave">
          <button type="button" aria-pressed={weergave === 'lijst'} aria-label="Lijst" onClick={() => onWeergave('lijst')}><Icoon naam="lijst" /></button>
          <button type="button" aria-pressed={weergave === 'kaarten'} aria-label="Kaarten" onClick={() => onWeergave('kaarten')}><Icoon naam="kaarten" /></button>
        </div>
      )}
      {/* Wens 24-09: acties zoals "Nieuw" helemaal rechts. */}
      {acties && <div className="actions">{acties}</div>}
    </div>
  );
  return (
    <div className="cp">
      <div className="crumbs">
        {kruimels.map((k, i) => (
          <Fragment key={i}>
            {i < kruimels.length - 1
              ? <><Link naar={k.naar}>{k.label}</Link><span className="sep">/</span></>
              : <span className={`cur${k.mono ? ' mono' : ''}`}>{k.label}</span>}
          </Fragment>
        ))}
      </div>
      {onZoek ? (
        <>
          <div className="search">
            <Icoon naam="zoek" maat={16} />
            {facetten.map((f, i) => (
              <span className="facet" key={i}>
                <span className="k"><Icoon naam={f.icoon || 'filter'} maat={12} dik={2.5} /></span>
                <span className="v">{f.label}</span>
                <button type="button" aria-label={`${f.label} weghalen`} onClick={f.onWeg}><Icoon naam="kruis" maat={12} dik={2.5} /></button>
              </span>
            ))}
            <input id="zoek" type="search" value={zoek} onChange={e => onZoek(e.target.value)} placeholder="Zoeken…" aria-label="Zoeken" />
          </div>
          {rechterDeel}
        </>
      ) : (
        // Formulier of pagina zonder zoekbalk: alles op één rij.
        rechterDeel
      )}
    </div>
  );
}

export function Chip({ aan, onClick, children }) {
  return <button type="button" className="chip" aria-pressed={!!aan} onClick={onClick}>{children}</button>;
}

/* ── Lijstweergave (op gsm: kaartjes) ── */
// kolommen: [{ kop, cel: rij => node, klasse?, sorteer?: rij => waarde }]
// groepen:  [{ titel, rijen }]  of rijen zonder groepering
// kaart:    rij => { titel, rechts, regel, onder, badge }  (voor de gsm-weergave)
export function Lijst({ kolommen, groepen, sleutel, onOpen, kaart, sortering, onSorteer, leeg }) {
  const totaal = groepen.reduce((s, g) => s + g.rijen.length, 0);
  if (!totaal) return <div className="leeg">{leeg}</div>;
  return (
    <div className="listwrap">
      <table className="list">
        <thead>
          <tr>
            {kolommen.map((k, i) => (
              <th key={i} className={k.klasse || ''} aria-sort={sortering?.kolom === i ? (sortering.op ? 'ascending' : 'descending') : undefined}>
                {k.sorteer && onSorteer
                  ? <button type="button" onClick={() => onSorteer(i)}>{k.kop}{sortering?.kolom === i && <Icoon naam={sortering.op ? 'pijlOp' : 'pijlNeer'} maat={12} />}</button>
                  : k.kop}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groepen.map((g, gi) => (
            <Fragment key={gi}>
              {g.titel && <tr className="grp"><td colSpan={kolommen.length}>{g.titel} <span className="sub">({g.rijen.length})</span></td></tr>}
              {g.rijen.map(r => (
                <tr key={sleutel(r)} className="row" tabIndex={0}
                  onClick={() => onOpen(r)} onKeyDown={e => { if (e.key === 'Enter') onOpen(r); }}>
                  {kolommen.map((k, i) => <td key={i} className={k.klasse || ''}>{k.cel(r)}</td>)}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
      <div className="cards">
        {groepen.map((g, gi) => (
          <Fragment key={gi}>
            {g.titel && <div className="grp">{g.titel} ({g.rijen.length})</div>}
            {g.rijen.map(r => {
              const c = kaart(r);
              return (
                <button type="button" key={sleutel(r)} className="mcard" onClick={() => onOpen(r)}>
                  <span className="l1"><b>{c.titel}</b><span>{c.rechts}</span></span>
                  {c.regel && <span>{c.regel}</span>}
                  <span className="l1"><span className="sub">{c.onder}</span>{c.badge}</span>
                </button>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/* ── Kanban met kolommen (bv. dossiers per fase) ── */
// kolommen: [{ id, titel, rijen }]; kaart(r) → { titel, regel, rechts, badges }
export function Kanban({ kolommen, sleutel, onOpen, kaart, leeg }) {
  if (!kolommen.some(k => k.rijen.length)) return <div className="leeg">{leeg}</div>;
  return (
    <div className="kanban">
      {kolommen.map(k => (
        <section key={k.id} className="kolom" aria-label={k.titel}>
          <h3>{k.titel} <span className="sub num">{k.rijen.length}</span></h3>
          {k.rijen.map(r => {
            const c = kaart(r);
            return (
              <button type="button" key={sleutel(r)} className="kkaart" onClick={() => onOpen(r)}>
                <span className="l1"><b>{c.titel}</b>{c.rechts}</span>
                {c.regel && <span className="sub">{c.regel}</span>}
                {c.badges && <span className="badges" style={{ marginTop: 0 }}>{c.badges}</span>}
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}

/* ── Kaartweergave (kanban zonder kolommen) ── */
export function Kaarten({ rijen, sleutel, onOpen, kaart, leeg }) {
  if (!rijen.length) return <div className="leeg">{leeg}</div>;
  return (
    <div className="cgrid">
      {rijen.map(r => {
        const c = kaart(r);
        return (
          <button type="button" key={sleutel(r)} className="ccard" onClick={() => onOpen(r)}>
            <span className="avatar" style={{ background: c.kleur }}>{c.initialen}</span>
            <span className="inhoud">
              <b>{c.titel}</b>
              <span className="sub">{c.regel}</span>
              {c.badges && <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{c.badges}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Formulier ── */
// Actiebalk boven het kader: enkel nog voor werkstroomknoppen en de
// statusbalk (dossiers, stap 5). Opslaan/archiveren staan in het kader zelf.
export function FormActies({ links, rechts }) {
  return <div className="form-actions"><div className="btns">{links}</div><div>{rechts}</div></div>;
}

// Knoppen van een record, rechts bovenaan IN het formulierkader (wens 23-09):
// - iets gewijzigd (of nieuw record) → Opslaan + Verwerpen
// - anders → Archiveren/Herstellen + Verwijderen
// Links in dezelfde balk: de knop terug naar het overzicht (wens 24-09,
// `terug = { label, naar }`), het label "Gearchiveerd" en eventueel `links`.
// De balk blijft bovenaan staan tijdens het scrollen (lange formulieren, gsm).
export function FormKnoppen({ vuil, nieuw, bezig, onOpslaan, onVerwerp, gearchiveerd, onArchiveer, onVerwijder, links, terug }) {
  const { navigeer } = useOmgeving();
  return (
    <div className="sheet-bar">
      <div className="links">
        {terug && (
          <button type="button" className="btn terug" onClick={() => navigeer(terug.naar)} title={`Terug naar ${terug.label.toLowerCase()}`}>
            <Icoon naam="pijlLinks" maat={16} /> {terug.label}
          </button>
        )}
        {!!gearchiveerd && <span className="lint">Gearchiveerd</span>}
        {links}
      </div>
      <div className="btns">
        {vuil || nieuw ? <>
          <button type="button" className="btn primary" disabled={bezig} onClick={onOpslaan}>{bezig ? 'Bezig…' : 'Opslaan'}</button>
          <button type="button" className="btn" disabled={bezig} onClick={onVerwerp}>Verwerpen</button>
        </> : <>
          {onArchiveer && (gearchiveerd
            ? <button type="button" className="btn" onClick={() => onArchiveer(false)}><Icoon naam="herstel" maat={16} /> Herstellen</button>
            : <button type="button" className="btn ghost" onClick={() => onArchiveer(true)}><Icoon naam="archief" maat={16} /> Archiveren</button>)}
          {onVerwijder && <button type="button" className="btn ghost" onClick={onVerwijder}><Icoon naam="vuilbak" maat={16} /> Verwijderen</button>}
        </>}
      </div>
    </div>
  );
}

export function Statusbalk({ stappen, huidig }) {
  return (
    <div className="statusbar" aria-label="Status">
      {stappen.map((s, i) => (
        <span key={s} className={`${i < huidig ? 'done' : ''}${i === huidig ? ' cur' : ''}`} aria-current={i === huidig ? 'step' : undefined}>{s}</span>
      ))}
    </div>
  );
}

export function SlimmeKnop({ icoon, getal, label, onClick, naar }) {
  const inhoud = <><Icoon naam={icoon} maat={20} /><span><span className="n">{getal}</span><span className="l">{label}</span></span></>;
  return naar ? <Link naar={naar}>{inhoud}</Link> : <button type="button" onClick={onClick}>{inhoud}</button>;
}

export function Veld({ label, id, hint, children }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div>{children}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Tabs({ tabs, actief, onKies }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={actief === id} onClick={() => onKies(id)}>{label}</button>
      ))}
    </div>
  );
}

export function Laden() { return <div className="laden">Laden…</div>; }
export function Fout({ tekst }) { return <div className="foutvak" role="alert">{tekst}</div>; }

// Initialen + vaste kleur per naam (avatars in kaarten).
const AVATARKLEUREN = ['#c2531a', '#3a6ea8', '#8a5a2b', '#2f7a6a', '#7a4f86', '#6b7d3a', '#a4430f', '#5c5347'];
export function initialen(naam) {
  return String(naam || '?').split(/\s+/).filter(w => /^[\p{L}\d]/u.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
}
export function avatarKleur(tekst) {
  let h = 0; for (const c of String(tekst)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATARKLEUREN[h % AVATARKLEUREN.length];
}
