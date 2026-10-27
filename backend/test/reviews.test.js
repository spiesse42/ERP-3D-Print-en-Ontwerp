// 27-10: reviewlink + QR onderaan de pakbon en het bonnetje.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, sluitDb, getDb } from '../db/index.js';
import { reviewInfo, qrSvg } from '../documenten/review.js';
import { bonnetjeHtml } from '../documenten/bonnetje.js';
import { pakbonHtml } from '../documenten/sjabloon.js';

before(() => initDb(':memory:'));
after(() => sluitDb());
const inhoud = { bedrijf: { naam: 'Test' }, klant: null, regels: [{ aantal: 1, omschrijving: 'X', per_stuk: 1, bedrag: 1 }], totaal: 1, vast: 0 };

test('R1. standaard de links van David; QR als SVG; blok op bonnetje en pakbon', () => {
  const r = reviewInfo(getDb());
  assert.equal(r.google, 'https://g.page/r/Cc__ktserRHWEBI/review');
  assert.equal(r.google_kort, 'g.page/r/Cc__ktserRHWEBI/review');
  assert.match(r.facebook, /facebook\.com\/profile\.php\?id=61591070623149/);
  assert.match(qrSvg('https://voorbeeld.be'), /^<svg[^>]*viewBox="-2 -2 \d+ \d+"/);
  assert.match(bonnetjeHtml({ inhoud, nummer: 'Bonnetje 2026-001', datum: '2026-10-27' }), /Tevreden over je bestelling\?[\s\S]*g\.page\/r\/Cc__ktserRHWEBI\/review/);
  assert.match(pakbonHtml({ nummer: 'PB-2026-001', datum: '2026-10-27', inhoud, regels: [], review: r }), /class="review"/);
});

test('R2. leeg = geen blok', () => {
  getDb().prepare(`UPDATE instellingen SET waarde = '' WHERE sleutel IN ('review_google', 'review_facebook')`).run();
  assert.equal(reviewInfo(getDb()), null);
  assert.doesNotMatch(bonnetjeHtml({ inhoud, nummer: 'Bonnetje 2026-002', datum: '2026-10-27' }), /class="review"/);
});
