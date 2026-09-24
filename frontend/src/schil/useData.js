import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Gegevens ophalen met laad-/foutstatus en een herlaad-functie.
// Eén patroon voor alle schermen, i.p.v. overal eigen useEffect-code.
export function useData(pad) {
  const [data, setData] = useState(null);
  const [fout, setFout] = useState(null);
  const [laden, setLaden] = useState(true);

  const herlaad = useCallback(async () => {
    if (!pad) { setData(null); setLaden(false); return null; }
    setLaden(true);
    try {
      const d = await api.get(pad);
      setData(d); setFout(null);
      return d;
    } catch (e) {
      setFout(e.message);
      return null;
    } finally {
      setLaden(false);
    }
  }, [pad]);

  useEffect(() => { herlaad(); }, [herlaad]);
  return { data, fout, laden, herlaad, setData };
}

// Per-kijker voorkeur (bv. lijst of kaarten) die een herlaad overleeft.
export function onthoud(sleutel, standaard) {
  try { const v = localStorage.getItem(sleutel); return v ?? standaard; } catch { return standaard; }
}
export function bewaar(sleutel, waarde) {
  try { localStorage.setItem(sleutel, waarde); } catch { /* geen opslag beschikbaar */ }
}
