/**
 * Release Judge — independent ACCEPT / REJECT / NEEDS_MORE_EVIDENCE.
 * Must not edit candidate code.
 */

export const JUDGE_DECISIONS = Object.freeze({
  ACCEPT: 'ACCEPT',
  REJECT: 'REJECT',
  NEEDS_MORE_EVIDENCE: 'NEEDS_MORE_EVIDENCE'
});

/**
 * @param {object} input
 * @param {object} input.invariants - Layer A result
 * @param {object} [input.frankCritic]
 * @param {object} [input.tests] - { passed, failed, total }
 * @param {object} [input.build] - { ok }
 * @param {object} [input.check] - { ok }
 * @param {object} [input.dogfood] - { completed, regressions, hardFailures }
 * @param {object} [input.candidate] - { intent, explainable, harmfulIntentional }
 * @param {object} [input.baseline] - optional comparator notes
 * @param {boolean} [input.bootstrapHarmless] - if true, ACCEPT is blocked unless explicitly allowed
 */
export function releaseJudge(input = {}) {
  const reasons = [];
  const risks = [];
  const invariants = input.invariants || { ok: false, hardFailures: [{ id: 'missing-invariants' }] };
  const tests = input.tests || {};
  const build = input.build || {};
  const check = input.check || {};
  const dogfood = input.dogfood || {};
  const critic = input.frankCritic || {};
  const candidate = input.candidate || {};

  if (!invariants.ok) {
    reasons.push(`hard invariants failed: ${(invariants.hardFailures || []).map(f => f.id).join(', ')}`);
  }
  if (tests.failed > 0) reasons.push(`tests failed: ${tests.failed}/${tests.total}`);
  if (build.ok === false) reasons.push('extension build failed');
  if (check.ok === false) reasons.push('npm run check failed');
  if (Array.isArray(dogfood.hardFailures) && dogfood.hardFailures.length) {
    reasons.push(`dogfood hard failures: ${dogfood.hardFailures.map(f => f.id || f).join(', ')}`);
  }
  if ((critic.issues || []).some(i => i.severity === 'critical')) {
    reasons.push('Frank Critic critical issue');
  }
  if (candidate.explainable === false) reasons.push('candidate not explainable');

  if (input.bootstrapHarmless && candidate.intent === 'bootstrap-proof') {
    // Harmless bootstrap should demonstrate REJECT + restore, not ship noise to main.
    return {
      decision: JUDGE_DECISIONS.REJECT,
      role: 'release-judge',
      reasons: ['bootstrap harmless candidate is intentionally rejected to prove restore'],
      risks: ['none — working tree must restore to preCycleSha'],
      comparedTo: {
        baseline: input.baseline?.tag || 'v1.7.5',
        head: input.baseline?.head || null
      },
      evaluatedAt: new Date().toISOString()
    };
  }

  if (reasons.length) {
    const needsMore = reasons.every(r => /dogfood|evidence|sample/i.test(r)) && invariants.ok && tests.failed === 0;
    return {
      decision: needsMore ? JUDGE_DECISIONS.NEEDS_MORE_EVIDENCE : JUDGE_DECISIONS.REJECT,
      role: 'release-judge',
      reasons,
      risks,
      comparedTo: {
        baseline: input.baseline?.tag || 'v1.7.5',
        head: input.baseline?.head || null
      },
      evaluatedAt: new Date().toISOString()
    };
  }

  if (!candidate.intent) {
    return {
      decision: JUDGE_DECISIONS.NEEDS_MORE_EVIDENCE,
      role: 'release-judge',
      reasons: ['candidate intent missing'],
      risks,
      evaluatedAt: new Date().toISOString()
    };
  }

  risks.push(...(candidate.knownRisks || []));
  return {
    decision: JUDGE_DECISIONS.ACCEPT,
    role: 'release-judge',
    reasons: [`candidate improves: ${candidate.intent}`],
    risks,
    comparedTo: {
      baseline: input.baseline?.tag || 'v1.7.5',
      head: input.baseline?.head || null
    },
    evaluatedAt: new Date().toISOString()
  };
}
