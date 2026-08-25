import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const extensionPath = path.resolve(root, "dist", "extension").replace(/\\/g, "/");
const outPath = path.join(__dirname, "extension-accept-results.json");
const FIXTURE = process.env.WEBQA_ACCEPT_URL || "http://localhost:8787/links";

function summarize(report) {
  const findings = report?.findings || [];
  const attention = report?.attention || {};
  const linkRules = findings.filter(f => /navigation\.|fragment|link-/i.test(f.ruleId || ""));
  const perfRules = findings.filter(f => /performance\.|image-/i.test(f.ruleId || ""));
  const markupRules = findings.filter(f => /viewport|canonical|title|lang|correlation\./i.test(f.ruleId || ""));
  return {
    pageUrl: report?.page?.url,
    hostname: report?.page?.hostname,
    platform: report?.page?.platform || null,
    targetIntegrity: report?.page?.targetIntegrity?.state || null,
    connectedMode: report?.connectedMode || null,
    coverage: report?.coverage || null,
    linkAudit: {
      checked: report?.linkAudit?.checked,
      confirmedIssues: report?.linkAudit?.confirmedIssues,
      inconclusive: report?.linkAudit?.inconclusive,
      incompleteKinds: [...new Set((report?.linkAudit?.incompleteChecks || []).map(c => `${c.kind}:${c.reason || c.status || ""}`))].slice(0, 20),
      incompleteSample: (report?.linkAudit?.incompleteChecks || []).slice(0, 12).map(c => ({
        kind: c.kind, reason: c.reason, status: c.status,
        url: String(c.url || "").replace(/\/\/[^@]+@/, "//[redacted]@").split("?")[0]
      }))
    },
    attention: {
      materialGroupCount: attention.materialGroupCount,
      representedClasses: attention.representedClasses,
      groups: (attention.groups || []).map(g => ({
        title: g.title, impactClass: g.impactClass, instanceCount: g.instanceCount,
        rootCauseKey: g.rootCauseKey, leadId: g.leadId
      })),
      worthChecking: (attention.worthChecking || []).map(w => ({
        title: w.title, size: w.size, instanceCount: w.instanceCount, findingIds: w.findingIds
      }))
    },
    linkFindings: linkRules.map(f => ({
      ruleId: f.ruleId, title: f.title, confidence: f.confidence, count: f.count,
      occurrences: f.occurrences || f.link?.occurrences, prominence: f.link?.prominence,
      location: f.link?.location, internal: f.link?.internal, status: f.link?.status,
      rootCauseKey: f.rootCauseKey, targetability: f.targetability,
      url: String(f.link?.url || f.evidence || "").split("?")[0]
    })),
    perfFindings: perfRules.map(f => ({
      ruleId: f.ruleId, title: f.title, confidence: f.confidence,
      selector: f.selector, resourceUrl: String(f.resourceUrl || "").split("?")[0],
      rootCauseKey: f.rootCauseKey, targetability: f.targetability,
      lenses: f.lenses, platform: f.remediationContext || null
    })),
    markupFindings: markupRules.map(f => ({
      ruleId: f.ruleId, title: f.title, targetability: f.targetability,
      markupSnippet: f.markupSnippet || null, confidence: f.confidence
    })),
    findingRuleIds: findings.map(f => f.ruleId)
  };
}

function computeExtensionId(publicKeyBase64) {
  const der = Buffer.from(publicKeyBase64, "base64");
  const hash = crypto.createHash("sha256").update(der).digest();
  let id = "";
  for (let i = 0; i < 16; i++) {
    id += String.fromCharCode(97 + (hash[i] >> 4));
    id += String.fromCharCode(97 + (hash[i] & 0xf));
  }
  return id;
}

async function waitForServiceWorker(context, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const workers = context.serviceWorkers();
    const sw = workers.find(w => w.url().startsWith("chrome-extension://"));
    if (sw) return sw;
    const backgrounds = context.backgroundPages?.() || [];
    if (backgrounds.length) {
      // MV2 fallback — not expected for this extension
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`No extension service worker. workers=${JSON.stringify(context.serviceWorkers().map(w => w.url()))} pages=${JSON.stringify(context.pages().map(p => p.url()))}`);
}

async function main() {
  const userDataDir = process.env.WEBQA_ACCEPT_PROFILE
    ? path.resolve(process.env.WEBQA_ACCEPT_PROFILE)
    : path.join(__dirname, `.chrome-profile-${process.pid}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, "manifest.json"), "utf8"));
  const predictedId = computeExtensionId(manifest.key);

  if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) {
    throw new Error(`Missing extension at ${extensionPath}`);
  }

  const useSystemChrome = process.env.WEBQA_ACCEPT_SYSTEM_CHROME === "1";
  const chromeCandidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`
  ].filter(Boolean);
  const executablePath = useSystemChrome
    ? chromeCandidates.find((p) => fs.existsSync(p))
    : undefined;

  const launchOpts = {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--enable-extensions",
      "--no-first-run",
      "--disable-default-apps",
      "--disable-popup-blocking",
      "--allowlisted-extension-id=nhepchbhokdhepmcdmklnihdeenmlkal"
    ],
    viewport: { width: 1280, height: 900 },
    ignoreDefaultArgs: ["--disable-extensions", "--enable-automation"]
  };
  if (executablePath) launchOpts.executablePath = executablePath;

  console.error(JSON.stringify({
    launching: true,
    extensionPath,
    executablePath: executablePath || "playwright-chromium",
    predictedId,
    userDataDir
  }));

  const context = await chromium.launchPersistentContext(userDataDir, launchOpts);

  // Wake the MV3 service worker by opening an extension page.
  const boot = await context.newPage();
  await boot.goto(`chrome-extension://${predictedId}/sidepanel.html`, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(async () => {
    await boot.goto("about:blank").catch(() => {});
  });
  await boot.waitForTimeout(1500);

  const sw = await waitForServiceWorker(context, 45000);
  const extensionId = String(sw.url()).split("/")[2];

  // runtime.sendMessage from the SW does not deliver to the same SW's onMessage.
  // Drive SCAN/ENRICH/PREPARE_FRANK from an extension page instead.
  const panel = context.pages().find((p) => p.url().includes("sidepanel.html")) || await context.newPage();
  if (!panel.url().includes("sidepanel.html")) {
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: "domcontentloaded", timeout: 20000 });
  }

  const permissionGrant = await panel.evaluate(async () => {
    try {
      // Do not call permissions.request here — it opens a modal and hangs automation.
      const all = await chrome.permissions.getAll();
      const w3 = await chrome.permissions.contains({ origins: ["https://www.w3.org/*"] });
      const anyHttps = await chrome.permissions.contains({ origins: ["https://*/*"] });
      return { ok: w3 || anyHttps, already: true, w3, anyHttps, all };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  const page = await context.newPage();
  await page.goto(FIXTURE, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);

  const tabs = await panel.evaluate(async () => {
    const list = await chrome.tabs.query({});
    return list.map(t => ({ id: t.id, url: t.url, active: t.active, windowId: t.windowId }));
  });
  const tab = tabs.find(t => /localhost:8787|127\.0\.0\.1:8787/.test(t.url || "")) || tabs.find(t => t.active);
  if (!tab?.id) throw new Error(`No fixture tab found. Tabs=${JSON.stringify(tabs)}`);

  await panel.evaluate(async (tabId) => { await chrome.tabs.update(tabId, { active: true }); }, tab.id);

  const scan = await panel.evaluate(async (tabId) => {
    return await chrome.runtime.sendMessage({ type: "SCAN_TAB", tabId });
  }, tab.id);
  if (!scan?.report) throw new Error(`SCAN_TAB failed: ${JSON.stringify(scan ?? null)?.slice?.(0, 800)}`);

  const enriched = await panel.evaluate(async ({ tabId, report }) => {
    return await chrome.runtime.sendMessage({ type: "ENRICH", report, tabId });
  }, { tabId: tab.id, report: scan.report });
  if (!enriched?.report) throw new Error(`ENRICH failed: ${JSON.stringify(enriched ?? null)?.slice?.(0, 800)}`);

  const report = enriched.report;
  const summary = summarize(report);

  const frankTargets = [];
  const linkFinding = (report.findings || []).find(f => /link-404-external|fragment-missing/.test(f.ruleId || ""));
  const markupFinding = (report.findings || []).find(f => /viewport|title-missing|lang-missing/.test(f.ruleId || ""));
  for (const finding of [linkFinding, markupFinding].filter(Boolean)) {
    try {
      const frank = await panel.evaluate(async ({ tabId, finding, report }) => {
        return await chrome.runtime.sendMessage({ type: "PREPARE_FRANK", tabId, finding, report });
      }, { tabId: tab.id, finding, report });
      frankTargets.push({
        ruleId: finding.ruleId,
        ok: Boolean(frank?.ok && (frank?.plan || frank?.graph)),
        title: frank?.plan?.title || finding.title,
        steps: (frank?.plan?.steps || []).map(s => ({ type: s.type, headline: s.headline, hasCode: Boolean(s.code), targetId: s.targetId || "" })),
        assessment: frank?.plan?.assessment || null,
        targetability: finding.targetability || null,
        markupSnippet: finding.markupSnippet || null,
        error: frank?.error || null,
        diagnostic: frank?.diagnostic || null,
        keys: Object.keys(frank || {})
      });
    } catch (error) {
      frankTargets.push({ ruleId: finding.ruleId, ok: false, error: String(error?.message || error) });
    }
  }

  const payload = {
    scannedAt: new Date().toISOString(),
    extensionId,
    predictedId,
    permissionGrant,
    fixture: FIXTURE,
    summary,
    frankTargets,
    assertions: {
      hasExternal404: summary.linkFindings.some(f => f.ruleId === "navigation.link-404-external"),
      external404Collapsed: (() => {
        const rows = summary.linkFindings.filter(f => f.ruleId === "navigation.link-404-external");
        return rows.length === 1 && Number(rows[0].count || rows[0].occurrences || 0) >= 2;
      })(),
      hasFragmentMissing: summary.linkFindings.some(f => f.ruleId === "navigation.fragment-missing"),
      hasInternal404: summary.linkFindings.some(f => f.ruleId === "navigation.link-404"),
      hasMalformed: summary.linkFindings.some(f => f.ruleId === "navigation.link-malformed"),
      noBrokenLabeled403: !summary.linkFindings.some(f => String(f.ruleId).includes("403") || Number(f.status) === 403),
      inconclusiveHas403or429: (summary.linkAudit.incompleteSample || []).some(c => Number(c.status) === 403 || Number(c.status) === 429 || /403|429|destination-not-allowed/i.test(String(c.reason))),
      hasViewportFixed: summary.markupFindings.some(f => f.ruleId === "web.viewport-fixed"),
      hasImageOversized: summary.perfFindings.some(f => /image-oversized|lcp-heavy|lcp-image/.test(f.ruleId)),
      wordpressPlatform: summary.platform?.id === "wordpress",
      materialGroups: summary.attention.materialGroupCount,
      ssrfBlocked: (summary.linkAudit.incompleteSample || []).some(c => /destination-not-allowed|127\.0\.0\.1|10\.0\.0\.1/i.test(JSON.stringify(c)))
    }
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({ ok: true, outPath, assertions: payload.assertions, permissionGrant, linkFindings: summary.linkFindings, attentionGroups: summary.attention.groups, worthChecking: summary.attention.worthChecking, frankTargets }, null, 2));
  await context.close();
}

main().catch(async (error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.stack || error) }));
  process.exit(1);
});

