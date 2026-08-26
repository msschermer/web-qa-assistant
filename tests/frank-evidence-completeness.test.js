import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { composeAttention } from '../packages/findings/compose.js';
import { buildEvidenceLedger, compactFrankPageLedger, ledgerDetailTier } from '../packages/findings/evidence-ledger.js';
import { buildEvidenceGraph } from '../packages/frank/evidence.js';
import { buildReviewBundle } from '../packages/ai/review-bundle.js';
import { IMPACT_CLASS_IDS } from '../packages/findings/impact.js';
import { buildBugReport } from '../packages/support/bug-report.js';

function materialFinding({
  id,
  ruleId,
  impactClass,
  title = ruleId,
  confidence = 'confirmed',
  count = 1,
  extra = {}
} = {}) {
  return {
    id,
    fingerprint: id,
    ruleId,
    title,
    detail: `${title} observed`,
    category: 'fix',
    severity: 'high',
    confidence,
    impactClass,
    targetability: extra.targetability || 'element',
    frankVisible: true,
    selector: extra.selector || `#${id}`,
    count,
    evidence: extra.evidence || title,
    embeddedContext: extra.embeddedContext,
    frameSelector: extra.frameSelector,
    extra: extra.embeddedContext ? { embeddedContext: extra.embeddedContext, frameSelector: extra.frameSelector } : undefined,
    link: extra.link
  };
}

function groupsAcrossClasses() {
  const classes = IMPACT_CLASS_IDS.filter((id) => id !== 'coverage').slice(0, 6);
  const findings = [];
  let n = 0;
  for (const cls of classes) {
    for (let g = 0; g < (cls === 'availability' || cls === 'accessibility' ? 3 : 2); g++) {
      n++;
      findings.push(materialFinding({
        id: `g${n}`,
        ruleId: `${cls}.rule-${g + 1}`,
        impactClass: cls,
        title: `${cls} issue ${g + 1}`
      }));
    }
  }
  // 6 classes * ~2-3 = 16 groups. availability 3 + discoverability 2 + a11y 3 + perf 2 + sec 2 + impl 2 = 14.
  findings.push(materialFinding({ id: 'g15', ruleId: 'discoverability.rule-3', impactClass: 'discoverability', title: 'discoverability issue 3' }));
  findings.push(materialFinding({ id: 'g16', ruleId: 'performance.rule-3', impactClass: 'performance', title: 'performance issue 3' }));
  return findings;
}

test('Frank ledger retains every material group while UI recommended order stays bounded', () => {
  const findings = groupsAcrossClasses();
  assert.equal(findings.length, 16);
  const composition = composeAttention(findings, { limit: 8 });
  assert.equal(composition.groups.length, 8);
  assert.equal(composition.allGroups.length, 16);
  const classes = new Set(composition.allGroups.map((g) => g.impactClass));
  assert.equal(classes.size, 6);

  const ledger = buildEvidenceLedger({ findings, coverage: { browser: 'complete' } }, { uiLimit: 8, composition, findings });
  assert.equal(ledger.uiShown, 8);
  assert.equal(ledger.materialGroupCount, 16);
  assert.equal(ledger.groups.length, 16);
  assert.equal(ledger.truncated, false);
  assert.equal(new Set(ledger.groups.map((g) => g.impactClass)).size, 6);
  assert.ok(ledger.groups.every((g) => g.ruleId && g.count >= 1 && g.confidence && g.targetability != null));

  const graph = buildEvidenceGraph({
    finding: findings[0],
    page: { url: 'https://example.com/', hostname: 'example.com', title: 'Example' },
    coverage: { browser: 'complete' },
    environment: { type: 'production' },
    evidenceLedger: ledger
  });
  const ledgerEvidence = graph.evidence.find((e) => e.kind === 'evidence-ledger');
  assert.ok(ledgerEvidence);
  assert.equal(ledgerEvidence.value.materialGroupCount, 16);
  assert.equal(ledgerEvidence.value.uiShown, 8);
  assert.equal(ledgerEvidence.value.groups.length, 16);
  assert.equal(graph.evidenceLedger.materialGroupCount, 16);
});

test('duplicate findings compress to one group with preserved counts', () => {
  const findings = [
    ...Array.from({ length: 50 }, (_, i) => materialFinding({
      id: `img-${i}`,
      ruleId: 'performance.browser.image-oversized',
      impactClass: 'performance',
      title: 'Image is substantially oversized'
    })),
    ...Array.from({ length: 20 }, (_, i) => materialFinding({
      id: `opener-${i}`,
      ruleId: 'security.blank-opener',
      impactClass: 'security',
      title: 'New-tab link can retain opener access'
    })),
    ...Array.from({ length: 10 }, (_, i) => materialFinding({
      id: `contrast-${i}`,
      ruleId: 'a11y.contrast',
      impactClass: 'accessibility',
      title: 'Text contrast is too low'
    })),
    ...Array.from({ length: 5 }, (_, i) => materialFinding({
      id: `link-${i}`,
      ruleId: 'navigation.link-404',
      impactClass: 'availability',
      title: 'Internal link points to a missing page',
      extra: { link: { url: `https://example.com/gone-${i}` } }
    }))
  ];
  const composition = composeAttention(findings, { limit: 8 });
  const ledger = buildEvidenceLedger({ findings }, { uiLimit: 8, composition, findings });
  const byRule = Object.fromEntries(ledger.groups.map((g) => [g.ruleId, g]));
  assert.equal(byRule['performance.browser.image-oversized'].count, 50);
  assert.equal(byRule['security.blank-opener'].count, 20);
  assert.equal(byRule['a11y.contrast'].count, 10);
  const broken = ledger.groups.filter((g) => g.ruleId === 'navigation.link-404');
  assert.equal(broken.length, 5);
  assert.ok(ledger.groups.length < findings.length);
  assert.equal(ledger.compression.rawFindingCount, 85);
});

test('same-origin frame findings keep source identity in the ledger', () => {
  const findings = [
    materialFinding({ id: 'top', ruleId: 'a11y.lang-missing', impactClass: 'accessibility', title: 'Document language is missing' }),
    materialFinding({
      id: 'f1',
      ruleId: 'a11y.lang-missing',
      impactClass: 'accessibility',
      title: 'Embedded document language is missing',
      extra: { embeddedContext: 'same-origin-iframe', frameSelector: 'iframe.so-1' }
    }),
    materialFinding({
      id: 'f2',
      ruleId: 'security.blank-opener',
      impactClass: 'security',
      title: 'New-tab link can retain opener access',
      extra: { embeddedContext: 'same-origin-iframe', frameSelector: 'iframe.so-2' }
    })
  ];
  const composition = composeAttention(findings, { limit: 8 });
  const ledger = buildEvidenceLedger({ findings }, { composition, findings });
  const framed = ledger.groups.filter((g) => g.scope === 'same-origin-iframe' || (g.frames || []).includes('same-origin-iframe'));
  assert.ok(framed.length >= 1);
  const graph = buildEvidenceGraph({
    finding: findings[1],
    page: { url: 'https://example.com/' },
    coverage: {},
    evidenceLedger: ledger
  });
  assert.ok(graph.evidence.some((e) => e.kind === 'frame-context'));
});

test('partial link coverage still supplies confirmed findings and the limitation to Frank', () => {
  const findings = [
    materialFinding({
      id: 'b1',
      ruleId: 'navigation.link-404',
      impactClass: 'availability',
      extra: { link: { url: 'https://example.com/a' } }
    }),
    materialFinding({
      id: 'b2',
      ruleId: 'navigation.link-404',
      impactClass: 'availability',
      extra: { link: { url: 'https://example.com/b' } }
    }),
    materialFinding({
      id: 'b3',
      ruleId: 'navigation.link-404',
      impactClass: 'availability',
      extra: { link: { url: 'https://example.com/c' } }
    }),
    ...Array.from({ length: 10 }, (_, i) => materialFinding({
      id: `inc-${i}`,
      ruleId: 'navigation.link-review-external',
      impactClass: 'coverage',
      confidence: 'inconclusive',
      title: 'External link could not be verified',
      extra: { link: { url: `https://cdn.example.net/x-${i}` } }
    }))
  ];
  const report = {
    findings,
    coverage: { browser: 'complete', links: 'partial' },
    linkAudit: {
      discovered: 100,
      eligible: 100,
      attempted: 80,
      checked: 80,
      verifiedHealthy: 67,
      confirmedIssues: 3,
      inconclusive: 10,
      unprobed: 20,
      scannerAborted: 0,
      probeBudgetPreventedCoverage: true
    }
  };
  const composition = composeAttention(findings, { limit: 8 });
  const ledger = buildEvidenceLedger(report, { composition, findings });
  assert.ok(ledger.coverage.degradedAreas.includes('links'));
  assert.equal(ledger.coverage.links.unprobed, 20);
  assert.equal(ledger.groups.filter((g) => g.ruleId === 'navigation.link-404').length, 3);
  assert.equal(ledger.inconclusive.find((r) => r.ruleId === 'navigation.link-review-external')?.count, 10);
  const graph = buildEvidenceGraph({
    finding: findings[0],
    page: { url: 'https://example.com/' },
    coverage: report.coverage,
    evidenceLedger: ledger,
    linkAudit: report.linkAudit
  });
  const coverageLedger = graph.evidence.find((e) => e.kind === 'coverage-ledger');
  assert.ok(coverageLedger);
  assert.equal(coverageLedger.value.links.unprobed, 20);
  assert.ok(coverageLedger.value.degradedAreas.includes('links'));
});

test('review bundle attention.groups can be UI-sized while allGroups/ledger keep the full set', () => {
  const findings = groupsAcrossClasses();
  const review = buildReviewBundle({
    page: { url: 'https://example.com/', hostname: 'example.com', title: 'Example', targetIntegrity: { state: 'reached' } },
    environment: { type: 'production' },
    coverage: { browser: 'complete', axe: 'complete', links: 'complete' },
    findings
  });
  assert.ok(review.attention.groups.length <= 12);
  assert.equal(review.attention.allGroups.length, 16);
  assert.equal(review.evidenceLedger.materialGroupCount, 16);
  assert.equal(review.evidenceLedger.groups.length, 16);
  assert.doesNotMatch(JSON.stringify(review), /<html|documentHtmlSample/);
});

test('Frank compact manifest keeps all 120 material groups without dropping the tail', () => {
  const classes = IMPACT_CLASS_IDS.filter((id) => id !== 'coverage');
  const findings = Array.from({ length: 120 }, (_, i) => materialFinding({
    id: `g${i}`,
    ruleId: `${classes[i % classes.length]}.synthetic-${i}`,
    impactClass: classes[i % classes.length],
    title: `Synthetic material issue ${i} with a verbose description that must not explode the Frank payload when 120 groups are present`
  }));
  const composition = composeAttention(findings, { limit: 8 });
  assert.equal(composition.groups.length, 8);
  assert.equal(composition.allGroups.length, 120);

  const ledger = buildEvidenceLedger({ findings, coverage: { browser: 'complete' } }, { uiLimit: 8, composition, findings });
  assert.equal(ledger.groups.length, 120);
  assert.equal(ledger.materialGroupCount, 120);
  assert.equal(ledger.groupsOmitted, 0);
  assert.equal(ledger.truncated, false);
  assert.equal(ledger.compression.groupsOmitted, 0);
  assert.equal(ledgerDetailTier(120), 'compact');
  assert.equal(ledger.compression.detailTier, 'compact');
  assert.ok(ledger.groups.every((g) => g.ruleId && g.impactClass && g.confidence && g.scope && Number(g.count) >= 1));
  assert.ok(ledger.groups.every((g) => !g.representativeSelectors && !g.representativeEvidence));

  const manifest = compactFrankPageLedger(ledger);
  assert.equal(manifest.groups.length, 120);
  assert.equal(manifest.groupsOmitted, 0);
  assert.equal(manifest.truncated, false);
  assert.ok(manifest.groups.every((g) => g.ruleId && g.impactClass && g.confidence && g.scope && Number(g.count) >= 1));
  const serialized = JSON.stringify(manifest);
  assert.ok(serialized.length < 80_000, `expected compact serialization, got ${serialized.length} bytes`);
  assert.ok(serialized.length / 120 < 600, `per-group payload too large: ${Math.round(serialized.length / 120)} bytes`);

  const graph = buildEvidenceGraph({
    finding: findings[119],
    page: { url: 'https://example.com/', hostname: 'example.com', title: 'Example' },
    coverage: { browser: 'complete' },
    environment: { type: 'production' },
    evidenceLedger: ledger
  });
  const ledgerEvidence = graph.evidence.find((e) => e.kind === 'evidence-ledger');
  assert.equal(ledgerEvidence.value.groups.length, 120);
  assert.equal(ledgerEvidence.value.groupsOmitted, 0);
  assert.equal(ledgerEvidence.value.groups[119].ruleId, findings[119].ruleId);

  const artifact = buildBugReport({
    version: '1.7.5',
    report: {
      page: { url: 'https://example.com/', title: 'Example' },
      coverage: { browser: 'complete' },
      findings,
      evidenceLedger: ledger,
      attention: { groups: composition.groups, materialGroupCount: 120 }
    }
  });
  assert.equal(artifact.evidenceLedger.groups.length, 120);
  assert.equal(artifact.evidenceLedger.groupsOmitted, 0);
  assert.equal(artifact.evidenceLedger.truncated, false);

  const review = buildReviewBundle({
    page: { url: 'https://example.com/', hostname: 'example.com', title: 'Example', targetIntegrity: { state: 'reached' } },
    environment: { type: 'production' },
    coverage: { browser: 'complete', axe: 'complete', links: 'complete' },
    findings
  });
  assert.ok(review.attention.groups.length <= 12);
  assert.equal(review.evidenceLedger.groups.length, 120);
  assert.equal(review.evidenceLedger.groupsOmitted, 0);
});

test('Frank packaging paths compact every material group instead of slicing at 80', () => {
  const localAi = fs.readFileSync('apps/extension/local-ai.js', 'utf8');
  const bugReport = fs.readFileSync('packages/support/bug-report.js', 'utf8');
  const frankEvidence = fs.readFileSync('packages/frank/evidence.js', 'utf8');
  assert.match(localAi, /compactFrankPageLedger/);
  assert.match(bugReport, /compactFrankPageLedger/);
  assert.doesNotMatch(localAi, /slice\(\s*0\s*,\s*80\s*\)/);
  assert.doesNotMatch(bugReport, /evidenceLedger\.groups \|\| \[\]\)\.slice\(\s*0\s*,\s*80/);
  assert.doesNotMatch(frankEvidence, /slice\(\s*0\s*,\s*80\s*\)/);
  assert.match(frankEvidence, /groupsOmitted:0/);
});

test('Frank ledger scope distinguishes same-origin iframe evidence from top-document', () => {
  const findings = [
    materialFinding({
      id: 'top-lang',
      ruleId: 'a11y.lang-missing',
      impactClass: 'accessibility',
      title: 'Document language is missing',
      extra: { evidence: 'html lang missing' }
    }),
    materialFinding({
      id: 'iframe-lang',
      ruleId: 'a11y.lang-missing-frame',
      impactClass: 'accessibility',
      title: 'Embedded document language is missing',
      extra: {
        embeddedContext: 'same-origin-iframe',
        frameSelector: 'iframe[title="lang-missing"]',
        evidence: 'iframe-html-lang-missing',
        selector: 'iframe[title="lang-missing"] >> html'
      }
    }),
    materialFinding({
      id: 'frame-link',
      ruleId: 'navigation.link-404',
      impactClass: 'availability',
      title: 'Internal link points to a missing page',
      extra: {
        link: { scope: 'same-origin-iframe', frames: ['same-origin-iframe'] }
      }
    })
  ];
  const composition = composeAttention(findings, { limit: 8 });
  const ledger = buildEvidenceLedger({ findings, coverage: { browser: 'complete' } }, { uiLimit: 8, composition, findings });
  const iframeGroup = ledger.groups.find((g) => g.ruleId === 'a11y.lang-missing-frame');
  const linkGroup = ledger.groups.find((g) => g.ruleId === 'navigation.link-404');
  assert.equal(iframeGroup.scope, 'same-origin-iframe');
  assert.ok((iframeGroup.frames || []).includes('same-origin-iframe'));
  assert.equal(linkGroup.scope, 'same-origin-iframe');
});
