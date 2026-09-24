// Relatief pad: werkt zowel lokaal als via Home Assistant Ingress, omdat de
// backend een <base href> in index.html zet (zie backend/app.js). Daardoor
// wijst './api' altijd naar de API-root, ook vanaf een diepe pagina zoals
// /klanten/12.
export const BASE = './api';

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* leeg antwoord */ }
  if (!res.ok) throw new Error(data?.error || `Serverfout (${res.status})`);
  return data;
}

// Multipart-upload (bestand + velden). Geen Content-Type zelf zetten: de
// browser voegt de juiste boundary toe.
async function requestFormData(path, formData) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', body: formData });
  let data = null;
  try { data = await res.json(); } catch { /* leeg antwoord */ }
  if (!res.ok) throw new Error(data?.error || `Serverfout (${res.status})`);
  return data;
}

export const api = {
  get:    (path)       => request('GET', path),
  post:   (path, body) => request('POST', path, body ?? {}),
  put:    (path, body) => request('PUT', path, body ?? {}),
  patch:  (path, body) => request('PATCH', path, body ?? {}),
  delete: (path)       => request('DELETE', path),
  upload: (path, fd)   => requestFormData(path, fd),
};
