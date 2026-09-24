// Tijdelijke plaatshouder voor een scherm dat volgens de herziene roadmap
// opnieuw gebouwd wordt (sinds het nieuwe basisschema van stap 1).
export default function Herbouw({ titel, stap }) {
  return (
    <div>
      <div className="page-header">
        <h1>{titel}</h1>
      </div>
      <div className="card" style={{ maxWidth: 560 }}>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
          Dit scherm wordt herbouwd volgens het nieuwe domeinmodel en komt terug in {stap}.
          Het vorige scherm werkte met tabellen die in het nieuwe basisschema niet meer bestaan.
        </p>
      </div>
    </div>
  );
}
