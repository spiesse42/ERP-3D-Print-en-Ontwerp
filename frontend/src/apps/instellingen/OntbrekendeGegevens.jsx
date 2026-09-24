import { useData } from '../../schil/useData.js';
import { Laden, Fout } from '../../schil/Weergaven.jsx';
import { Link } from '../../schil/Schil.jsx';

// Ontbrekende gegevens over het hele pakket (stap 4b): enkel wat een
// berekening of een klantdocument blokkeert of fout maakt. De controles
// zelf gebeuren in de backend (domein/controles.js).
export default function OntbrekendeGegevens() {
  const { data, fout, laden } = useData('/controles');
  if (fout) return <Fout tekst={fout} />;
  if (!data && laden) return <Laden />;
  const groepen = [...new Set(data.map(x => x.groep))];
  return (
    <div className="panel">
      <h3>Ontbrekende gegevens {data.length > 0 && <span className="badge b-warn">{data.length}</span>}</h3>
      <div className="pbody">
        {data.length === 0
          ? <div className="leeg"><b>Alles is ingevuld.</b>Er ontbreekt niets dat een berekening of een document tegenhoudt.</div>
          : groepen.map(g => (
            <section key={g} className="ontbreekt-groep">
              <h4>{g}</h4>
              <ul className="ontbreekt">
                {data.filter(x => x.groep === g).map((x, i) => (
                  <li key={i}><span>{x.tekst}</span><Link naar={x.naar} className="btn">{x.knop}</Link></li>
                ))}
              </ul>
            </section>
          ))}
        <p className="note" style={{ marginBottom: 0 }}>Hier staat enkel wat een berekening of een document voor een klant tegenhoudt of fout maakt. Er komen controles bij naarmate er apps bijkomen.</p>
      </div>
    </div>
  );
}
