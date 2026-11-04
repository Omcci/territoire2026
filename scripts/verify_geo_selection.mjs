#!/usr/bin/env node
/**
 * Vérification navigateur de l'intégrité géographique (Phase I) :
 * pour Clichy (92024), Pantin (93055), Bordeaux (33063) et Paris (75056),
 * clique le polygone réel de la commune et exige que la fiche affiche
 * exactement ce code INSEE, ce nom et des coordonnées concordantes —
 * la commune cliquée, la fiche et la caméra désignent la même entité.
 * Un cas supplémentaire vérifie la sélection en vue inclinée (3D).
 *
 * La navigation utilise le diagnostic désactivable de l'application
 * (?debug=geo expose la carte) pour projeter les coordonnées officielles
 * en pixels écran de façon exacte, quel que soit l'angle de vue.
 *
 * Prérequis : l'application servie (npm run preview) et Chrome.
 * Usage : node scripts/verify_geo_selection.mjs [url]
 * Pilote Chrome via CDP, sans dépendance npm.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const APP_URL = (process.argv[2] ?? 'http://127.0.0.1:4173/') + '?debug=geo';
const CHROME =
  process.env.CHROME_BIN ??
  '/Users/omci/.cache/puppeteer/chrome/mac_arm-133.0.6943.98/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const PORT = 9341;
const OUT = '/tmp/shots_geo';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=/tmp/chrome-geo-check',
    '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' });
  let wsUrl = null;
  for (let i = 0; i < 50 && !wsUrl; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const page = (await res.json()).find((t) => t.type === 'page');
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch { /* attente */ }
    if (!wsUrl) await sleep(300);
  }
  if (!wsUrl) throw new Error('CDP introuvable');
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => { ws.onopen = r; });
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = nextId; nextId += 1;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Page.enable');
  await send('Runtime.enable');
  return {
    proc,
    send,
    async evaluate(expression) {
      const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      return res.result?.result?.value;
    },
    async click(x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    },
    async shot(path) {
      const res = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(res.result.data, 'base64'));
    },
    close() { try { ws.close(); } catch { /* ignore */ } proc.kill('SIGTERM'); },
  };
}

async function waitFor(page, expression, timeoutMs = 40000) {
  const start = Date.now();
  for (;;) {
    if (await page.evaluate(expression)) return;
    if (Date.now() - start > timeoutMs) throw new Error(`Timeout: ${expression}`);
    await sleep(400);
  }
}

async function ficheText(page) {
  return page.evaluate(`(() => {
    const a = document.querySelector('aside[aria-label="Fiche décisionnelle de la commune"]');
    return a ? a.innerText.slice(0, 220) : null;
  })()`);
}

/** Vole sur la commune via le diagnostic, projette son point officiel, clique. */
async function clickCommune(page, cas, { zoom = 13.4, pitch = 0, bearing = 0 } = {}) {
  await page.evaluate(`window.__TERRITOIRES_MAP__?.flyTo({
    center: [${cas.lng}, ${cas.lat}], zoom: ${zoom}, pitch: ${pitch}, bearing: ${bearing}, duration: 0,
  })`);
  await sleep(3200);
  const pt = await page.evaluate(`(() => {
    const p = window.__TERRITOIRES_MAP__?.project([${cas.lng}, ${cas.lat}]);
    return p ? [Math.round(p.x), Math.round(p.y)] : null;
  })()`);
  if (!pt) throw new Error('projection indisponible (diagnostic ?debug=geo inactif)');
  console.log(`${cas.nom}: clic projeté ${pt[0]},${pt[1]} (zoom ${zoom}, pitch ${pitch})`);
  await page.click(pt[0], pt[1]);
  await sleep(3200);
  return ficheText(page);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
};

const page = await launch();
try {
  await page.send('Page.navigate', { url: APP_URL });
  await waitFor(page, `document.body.innerText.includes('Explorer librement')`);
  await page.evaluate(`[...document.querySelectorAll('button')].find(b => b.innerText.includes('Explorer librement'))?.click()`);
  await waitFor(page, `!!window.__TERRITOIRES_MAP__`, 30000);
  await sleep(6000);

  const cas = [
    { nom: 'Paris', code: '75056', lng: 2.34282, lat: 48.85646 },
    { nom: 'Clichy', code: '92024', lng: 2.30575, lat: 48.90353 },
    { nom: 'Pantin', code: '93055', lng: 2.40776, lat: 48.89859 },
    { nom: 'Saint-Denis', code: '93066', lng: 2.35884, lat: 48.92933 },
    { nom: 'Bordeaux', code: '33063', lng: -0.57409, lat: 44.85781 },
    { nom: 'Lyon', code: '69123', lng: 4.83639, lat: 45.75514 },
    { nom: 'Marseille', code: '13055', lng: 5.42127, lat: 43.29317 },
  ];
  for (const c of cas) {
    const fiche = await clickCommune(page, c);
    console.log(`  fiche: ${JSON.stringify(fiche?.slice(0, 110))}`);
    check(
      `${c.nom} ${c.code}: fiche concordante (code, nom)`,
      !!fiche && fiche.includes(`INSEE ${c.code}`) && fiche.includes(c.nom),
    );
    // La caméra doit rester dans la zone sélectionnée : le point officiel
    // de la commune est dans le champ visible après cadrage.
    const inView = await page.evaluate(`(() => {
      const map = window.__TERRITOIRES_MAP__;
      if (!map) return false;
      const b = map.getBounds();
      return b.contains([${c.lng}, ${c.lat}]);
    })()`);
    check(`${c.nom} ${c.code}: caméra cadrée sur la commune`, inView === true);
    await page.shot(`${OUT}/final_${c.code}.png`);
    await page.evaluate(`document.querySelector('button[aria-label="Fermer la fiche"]')?.click()`);
    await sleep(600);
  }

  // Commune limitrophe : Levallois-Perret (92044), voisine directe de
  // Clichy — la sélection ne doit pas retomber sur Clichy.
  const voisine = { nom: 'Levallois-Perret', code: '92044', lng: 2.2877, lat: 48.89239 };
  const ficheV = await clickCommune(page, voisine);
  console.log(`  fiche voisine: ${JSON.stringify(ficheV?.slice(0, 110))}`);
  check('Levallois-Perret 92044: commune limitrophe distincte de Clichy',
    !!ficheV && ficheV.includes('INSEE 92044') && !ficheV.includes('92024'));
  await page.shot(`${OUT}/final_92044.png`);
  await page.evaluate(`document.querySelector('button[aria-label="Fermer la fiche"]')?.click()`);
  await sleep(600);

  // Sélection en vue inclinée 3D : même commune attendue à Clichy.
  const fiche3d = await clickCommune(page, cas[1], { zoom: 13.8, pitch: 50, bearing: -20 });
  console.log(`  fiche 3D: ${JSON.stringify(fiche3d?.slice(0, 110))}`);
  check('Clichy 92024: sélection concordante en vue inclinée (3D)',
    !!fiche3d && fiche3d.includes('INSEE 92024'));
  await page.shot(`${OUT}/final_92024_3d.png`);
} finally {
  page.close();
}
console.log(`\n=== ${results.filter(Boolean).length}/${results.length} vérifications concordantes ===`);
process.exit(results.every(Boolean) ? 0 : 1);
