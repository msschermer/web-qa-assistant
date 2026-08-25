import express from 'express';
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyTargetIntegrityReport } from '../../packages/integrity/apply-report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.RENDERER_PORT || 8790);
app.use(express.json({ limit: '30kb' }));

function chromiumCandidates(){
  const env=process.env.CHROMIUM_EXECUTABLE_PATH;
  const list=[env];
  if(process.platform==='win32'){
    const pf=process.env.PROGRAMFILES, pf86=process.env['PROGRAMFILES(X86)'], local=process.env.LOCALAPPDATA;
    list.push(
      local&&path.join(local,'Google','Chrome','Application','chrome.exe'),
      pf&&path.join(pf,'Google','Chrome','Application','chrome.exe'),
      pf86&&path.join(pf86,'Google','Chrome','Application','chrome.exe'),
      pf&&path.join(pf,'Microsoft','Edge','Application','msedge.exe'),
      pf86&&path.join(pf86,'Microsoft','Edge','Application','msedge.exe')
    );
  }else if(process.platform==='darwin'){
    list.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium');
  }else{
    list.push('/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/usr/bin/google-chrome-stable');
  }
  try{list.unshift(chromium.executablePath())}catch{}
  return [...new Set(list.filter(Boolean))];
}
function resolvedChromium(){
  return chromiumCandidates().find(p=>fs.existsSync(p))||'';
}

let browserPromise;
function browser() {
  if (!browserPromise) {
    const executablePath=resolvedChromium();
    if(!executablePath) throw new Error('Chromium is not available. Install Playwright Chromium or set CHROMIUM_EXECUTABLE_PATH.');
    browserPromise = chromium.launch({
      executablePath,
      headless: true,
      proxy: process.env.EGRESS_PROXY_URL ? { server: process.env.EGRESS_PROXY_URL } : undefined,
      args: [
        '--disable-dev-shm-usage','--no-first-run','--disable-background-networking',
        ...(typeof process.getuid==='function'&&process.getuid()===0?['--no-sandbox']:[])
      ]
    }).then(instance=>{
      instance.on('disconnected',()=>{browserPromise=null;});
      return instance;
    }).catch(error=>{browserPromise=null;throw error;});
  }
  return browserPromise;
}
function isPrivateProbeHost(host){
  const h=String(host||'').toLowerCase();
  if(!h||h==='localhost'||h.endsWith('.local')||h.endsWith('.internal')||h.endsWith('.localhost'))return true;
  if(/^127\./.test(h)||/^10\./.test(h)||/^192\.168\./.test(h)||/^169\.254\./.test(h)||/^0\.0\.0\.0$/.test(h))return true;
  if(/^\[?::1\]?$/.test(h)||/^\[?fc/i.test(h)||/^\[?fd/i.test(h)||/^\[?fe80:/i.test(h))return true;
  const m=/^172\.(\d+)\./.exec(h);return!!(m&&Number(m[1])>=16&&Number(m[1])<=31);
}
function sanitizeProbeUrl(raw){
  try{
    const u=new URL(String(raw||''));
    if(!/^https?:$/.test(u.protocol))return null;
    if(u.username||u.password)return null;
    if(isPrivateProbeHost(u.hostname))return null;
    u.hash='';
    return u.toString();
  }catch{return null}
}
async function openPage(url) {
  const b = await browser();
  const context = await b.newContext({ ignoreHTTPSErrors: false, javaScriptEnabled: true, acceptDownloads: false, serviceWorkers: 'block', viewport: { width: 1365, height: 850 } });
  const page = await context.newPage();
  await page.route('**/*', route => {
    const u = route.request().url();
    if (!/^https?:/i.test(u)) return route.abort('blockedbyclient');
    if (['media'].includes(route.request().resourceType())) return route.abort('blockedbyclient');
    return route.continue();
  });
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
  await page.waitForTimeout(900);
  return { context, page, response };
}
async function targetContext(page, selector) {
  if (!selector) return null;
  try {
    return await page.locator(selector).first().evaluate((el, sel) => {
      const clip = (value, max = 1400) => { const s = String(value ?? '').replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max - 1) + '…' : s; };
      const style = getComputedStyle(el); const rect = el.getBoundingClientRect();
      return { found: true, tag: el.tagName.toLowerCase(), selector: sel, markup: clip(el.outerHTML), text: clip(el.innerText || el.textContent, 500), rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }, styles: { color: style.color, backgroundColor: style.backgroundColor, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, display: style.display, position: style.position } };
    }, selector);
  } catch { return null; }
}

app.get('/health', (req, res) => res.json({ ok: true, service: 'renderer', frankSnapshots: true, chromiumAvailable: Boolean(resolvedChromium()) }));
app.post('/scan', async (req, res) => {
  if (!authorized(req)) return res.status(403).json({ ok: false, error: 'Forbidden' });
  const url = String(req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: 'Only HTTP and HTTPS URLs are supported.' });
  let opened;
  try {
    opened = await openPage(url);
    const { page, response } = opened;
    await page.addScriptTag({ path: path.resolve(__dirname, '../../node_modules/axe-core/axe.min.js') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../../packages/integrity/target-integrity.browser.js') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../../packages/rules/image-purpose.js') });
    await page.addScriptTag({ path: path.resolve(__dirname, '../../packages/rules/browser-rules.js') });
    const report = await page.evaluate(async () => {
      try { await window.WebQARules.preparePerformanceSignals?.(); } catch {}
      const local = window.WebQARules.run(); let axe = null; let links = { findings: [], checked: 0 };
      try { axe = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } }); } catch {}
      try { links = await window.WebQARules.auditLinks({ limit: 30, concurrency: 6, timeoutMs: 3000, retryTimeoutMs: 6000, budgetMs: 10000 }); } catch {}
      return { local, axe, links };
    });
    const { local, axe, links } = report;
    // Privileged probe for external destinations the page context could not classify (CORS).
    const externalCandidates = Array.isArray(links?.externalCandidates) ? links.externalCandidates.slice(0, 12) : [];
    if (externalCandidates.length) {
      const probeRows = [];
      for (const candidate of externalCandidates) {
        const started = Date.now();
        const probeUrl = sanitizeProbeUrl(candidate.url);
        if (!probeUrl) {
          probeRows.push({ url: candidate.url, status: 0, error: 'destination-not-allowed', durationMs: 0 });
          continue;
        }
        try {
          const res = await opened.context.request.get(probeUrl, { timeout: 4500, maxRedirects: 8, failOnStatusCode: false });
          probeRows.push({ url: candidate.url, status: res.status(), finalUrl: res.url(), redirected: res.url() !== probeUrl, durationMs: Date.now() - started });
        } catch (error) {
          probeRows.push({ url: candidate.url, status: 0, error: String(error?.message || error), durationMs: Date.now() - started });
        }
      }
      const applied = await page.evaluate(({ candidates, rows }) => window.WebQARules.applyExternalProbeResults(candidates, rows), { candidates: externalCandidates, rows: probeRows });
      if (applied?.findings?.length) links.findings = [...(links.findings || []), ...applied.findings];
      if (applied?.resolvedUrls?.length) {
        const resolved = new Set(applied.resolvedUrls);
        links.incompleteChecks = (links.incompleteChecks || []).filter(c => !(c.kind === 'external-link' && resolved.has(c.url)));
        links.incompleteChecks.push(...(applied.incompleteChecks || []));
        links.inconclusive = links.incompleteChecks.length;
        links.confirmedIssues = (links.findings || []).length;
        links.status = links.incompleteChecks.length ? 'partial' : 'complete';
      }
    }
    const merged = await page.evaluate(({ local, axe, links }) => window.WebQARules.merge(local, axe, links), { local, axe, links });
    merged.page.httpStatus = response?.status() || null;
    merged.page.finalUrl = page.url();
    merged.page.requestedUrl = url;
    merged.coverage.renderer = 'complete';
    const html = await page.content();
    merged.page.documentHtmlSample = html.slice(0, 80000);
    const finalized = applyTargetIntegrityReport(merged, { requestedUrl: url, html });
    res.json({ ok: true, report: finalized });
  } catch (e) { res.status(422).json({ ok: false, error: `Unable to render public page: ${e.message}` }); }
  finally { if (opened) await opened.context.close(); }
});

app.post('/snapshot', async (req, res) => {
  if (!authorized(req)) return res.status(403).json({ ok: false, error: 'Forbidden' });
  const url = String(req.body?.url || '').trim();
  const selector = String(req.body?.selector || '').trim().slice(0, 1200);
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ ok: false, error: 'Only HTTP and HTTPS URLs are supported.' });
  let opened;
  try {
    opened = await openPage(url);
    const { page } = opened;
    let context = null;
    if (selector) {
      const loc = page.locator(selector).first();
      if (await loc.count()) {
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(160);
        context = await targetContext(page, selector);
        await page.evaluate(sel => {
          let el = null; try { el = document.querySelector(sel); } catch {}
          if (!el) return;
          const rect = el.getBoundingClientRect();
          const spot = document.createElement('div');
          spot.id = '__web_qa_frank_snapshot_spot';
          spot.style.cssText = `position:fixed;pointer-events:none;z-index:2147483647;left:${Math.max(2,rect.left-6)}px;top:${Math.max(2,rect.top-6)}px;width:${Math.max(8,rect.width+12)}px;height:${Math.max(8,rect.height+12)}px;border:3px solid #E9EEF4;border-radius:4px;box-shadow:0 0 0 99999px rgba(10,15,22,.70),0 0 0 6px rgba(11,94,138,.28);`;
          document.documentElement.appendChild(spot);
        }, selector);
      }
    }
    const image = await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled' });
    res.json({ ok: true, image: `data:image/png;base64,${image.toString('base64')}`, targetContext: context, finalUrl: page.url() });
  } catch (e) { res.status(422).json({ ok: false, error: `Unable to capture Frank view: ${e.message}` }); }
  finally { if (opened) await opened.context.close(); }
});

app.listen(port, () => console.log(`renderer listening on ${port}`));
