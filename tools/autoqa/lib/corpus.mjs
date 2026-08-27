import fs from 'node:fs';
import path from 'node:path';
import { QA_SITES_DIR } from './paths.mjs';

/** Corpus tiers intentionally authorized for ordinary AutoQA dogfood (not holdout). */
export const AUTHORIZED_CORPUS_TIERS = Object.freeze([
  'golden',
  'rotating',
  'adversarial',
  'discoveries'
]);

function loadJson(name) {
  const p = path.join(QA_SITES_DIR, name);
  if (!fs.existsSync(p)) return { sites: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function loadCorpus() {
  return {
    golden: loadJson('golden.json'),
    rotating: loadJson('rotating.json'),
    adversarial: loadJson('adversarial.json'),
    discoveries: loadJson('discoveries.json'),
    holdout: loadJson('holdout.json')
  };
}

function normalizeUrl(url) {
  try {
    const u = new URL(String(url || ''));
    u.hash = '';
    return u.href.replace(/\/$/, '') || u.origin;
  } catch {
    return String(url || '').replace(/\/$/, '');
  }
}

function isLocalFixtureOrigin(url) {
  try {
    const u = new URL(String(url || ''));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  } catch {
    return false;
  }
}

/**
 * Corpus membership (golden/rotating/adversarial/discoveries) is intentional
 * authorization for bounded AutoQA dogfood. Holdout remains reserved.
 */
export function findAuthorizedCorpusSite(url, corpus = loadCorpus()) {
  const want = normalizeUrl(url);
  for (const tier of AUTHORIZED_CORPUS_TIERS) {
    for (const site of corpus[tier]?.sites || []) {
      if (site?.quarantined) continue;
      if (normalizeUrl(site.url) === want) {
        return { ...site, tier: site.tier || tier, authorized: true };
      }
    }
  }
  return null;
}

/**
 * True when the URL is an approved AutoQA corpus member or a local fixture origin
 * already used by corpus files. Holdout and unknown public origins are false.
 */
export function isAuthorizedDogfoodUrl(url, corpus = loadCorpus()) {
  if (findAuthorizedCorpusSite(url, corpus)) return true;
  const want = normalizeUrl(url);
  for (const site of corpus.holdout?.sites || []) {
    if (normalizeUrl(site.url) === want) return false;
  }
  // Local fixture pages matching corpus path conventions are authorized when
  // AutoQA is exercising the golden/adversarial local suite.
  if (!isLocalFixtureOrigin(url)) return false;
  try {
    const u = new URL(String(url));
    return (
      u.pathname.startsWith('/qa-matrix/') ||
      u.pathname.startsWith('/benchmark-corpus/') ||
      u.pathname.startsWith('/corpus/') ||
      u.pathname.startsWith('/interstitial/') ||
      u.pathname.startsWith('/known-answer/')
    );
  } catch {
    return false;
  }
}

/**
 * Ordinary cycle selection: 3 golden + 3–5 rotating + optional affected URLs.
 * Never returns holdout sites to the engineering agent path.
 */
export function selectCycleTargets({
  goldenCount = 3,
  rotatingCount = 4,
  affected = [],
  seed = Date.now()
} = {}) {
  const corpus = loadCorpus();
  const rng = mulberry32(Number(seed) >>> 0);
  const pick = (list, n) => {
    const copy = [...(list.sites || list || [])].filter(s => !s.quarantined);
    shuffle(copy, rng);
    return copy.slice(0, Math.max(0, n));
  };
  const golden = pick(corpus.golden, goldenCount);
  const rotating = pick(corpus.rotating, rotatingCount);
  const affectedSites = (affected || []).map(url => ({
    id: `affected-${String(url).slice(0, 40)}`,
    url,
    tier: 'affected'
  }));
  return {
    sites: [...golden, ...rotating, ...affectedSites],
    holdoutReserved: (corpus.holdout.sites || []).length,
    seed: Number(seed) >>> 0
  };
}

export function selectHoldout({ count = 5, seed = Date.now() } = {}) {
  const corpus = loadCorpus();
  const rng = mulberry32(Number(seed) >>> 0);
  const copy = [...(corpus.holdout.sites || [])].filter(s => !s.quarantined);
  shuffle(copy, rng);
  return copy.slice(0, count);
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
