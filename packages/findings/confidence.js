export const CONFIDENCE_LEVELS=['confirmed','corroborated','inferred','inconclusive'];

export function normalizeConfidence(value, fallback='confirmed'){
  const v=String(value||'').toLowerCase();
  return CONFIDENCE_LEVELS.includes(v)?v:fallback;
}

export function confidenceRank(value){
  return {confirmed:4,corroborated:3,inferred:2,inconclusive:1}[normalizeConfidence(value,'inconclusive')]||1;
}

export function verifiedFinding(finding={}, defaults={}){
  const confidence=normalizeConfidence(finding.confidence||defaults.confidence||'confirmed');
  const verification=finding.verification||defaults.verification||{};
  return {
    ...finding,
    confidence,
    verification:{
      state:verification.state||confidence,
      method:verification.method||defaults.method||'deterministic observation',
      attempts:Number(verification.attempts??defaults.attempts??1),
      evidence:Array.isArray(verification.evidence)?verification.evidence:[]
    }
  };
}

export function isSufficientlyVerified(finding={}){
  return normalizeConfidence(finding.confidence,'confirmed')!=='inconclusive';
}
