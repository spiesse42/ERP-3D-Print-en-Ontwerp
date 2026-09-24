// Eenvoudige lijn-iconen (geen emoji), overal dezelfde stijl.
const PADEN = {
  raster: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  zoek: <><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
  lijst: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>,
  kaarten: <><rect x="3" y="4" width="7" height="7" rx="1"/><rect x="14" y="4" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="6" rx="1"/><rect x="14" y="14" width="7" height="6" rx="1"/></>,
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8z"/>,
  lagen: <><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/></>,
  kruis: <path d="M18 6 6 18M6 6l12 12"/>,
  map: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8 13h8"/></>,
  nozzle: <><path d="M7 3h10v6H7zM9 9h6l-2 5h-2z"/><path d="M5 20h14M8 17h8"/></>,
  kar: <><path d="M3 4h2l2.5 11h10L20 8H6.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/></>,
  spoel: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></>,
  mensen: <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.5a5 5 0 0 1 5.5 5"/></>,
  euro: <><path d="M18 6.5A7 7 0 1 0 18 17.5"/><path d="M4 10h9M4 14h9"/></>,
  tandwiel: <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></>,
  pen: <path d="M4 20h4L19 9l-4-4L4 16z"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  archief: <><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/></>,
  herstel: <><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></>,
  vuilbak: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></>,
  vink: <path d="m5 12 5 5 9-10"/>,
  let: <><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  pijlOp: <path d="m6 15 6-6 6 6"/>,
  pijlNeer: <path d="m6 9 6 6 6-6"/>,
  pijlLinks: <path d="M19 12H5M11 6l-6 6 6 6"/>,
  bericht: <path d="M4 5h16v11H8l-4 4z"/>,
};

export default function Icoon({ naam, maat = 18, dik = 2, ...rest }) {
  return (
    <svg width={maat} height={maat} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={dik}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {PADEN[naam]}
    </svg>
  );
}
