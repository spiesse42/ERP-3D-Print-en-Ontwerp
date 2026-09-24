// HTML → echte PDF via een headless Chromium (puppeteer-core), zoals in het
// oude pakket: geen browser-printdialoog, dus geen kop-/voettekst van de
// browser op het document.
//
// Nieuw (stap 5b): werkt ook LOKAAL op Windows/Mac door Chrome of Edge te
// zoeken. In de Home Assistant-add-on zet het Dockerfile
// PUPPETEER_EXECUTABLE_PATH (Alpine: apk add chromium); dat heeft voorrang.
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

function kandidaten() {
  const lokaal = process.env.LOCALAPPDATA;
  return [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    // Linux / add-on
    '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome',
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    lokaal && path.join(lokaal, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean);
}
export function vindBrowser() {
  return kandidaten().find(p => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

let browserBelofte = null;
async function browser() {
  if (!browserBelofte) {
    const executablePath = vindBrowser();
    if (!executablePath) {
      throw new Error('Geen Chrome, Edge of Chromium gevonden om de PDF te maken. Installeer Chrome of Edge, of zet PUPPETEER_EXECUTABLE_PATH (in de add-on: chromium in het Dockerfile).');
    }
    browserBelofte = puppeteer.launch({
      executablePath, headless: true,
      // --no-sandbox: de add-on-container draait als root
      args: process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
    }).then(b => { b.on('disconnected', () => { browserBelofte = null; }); return b; })
      .catch(e => { browserBelofte = null; throw e; });
  }
  return browserBelofte;
}

export async function htmlNaarPdf(html) {
  const b = await browser();
  const pagina = await b.newPage();
  try {
    await pagina.setContent(html, { waitUntil: 'load' });
    const data = await pagina.pdf({ format: 'A4', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
    return Buffer.from(data);   // recente puppeteer geeft een Uint8Array terug
  } finally {
    await pagina.close();
  }
}

export async function sluitBrowser() {
  if (browserBelofte) { const b = await browserBelofte.catch(() => null); browserBelofte = null; await b?.close(); }
}
