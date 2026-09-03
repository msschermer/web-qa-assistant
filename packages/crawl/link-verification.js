/**
 * Which external destinations a server-side probe can honestly speak about.
 *
 * A large platform that answers an automated request with 400/403/429 is not
 * telling us the link is broken — it is telling us it does not serve robots.
 * The link works perfectly for the visitor who clicks it. Recording that as a
 * defect, or even as something to review, manufactures work out of our own
 * probe's limitation, which is exactly what this product exists not to do.
 *
 * So a rejection from one of these hosts is COVERAGE: a named, counted
 * statement about what we could not verify. It is never a finding.
 *
 * This list is deliberately small and conservative. It holds only hosts that
 * reject automated verification as a matter of policy, consistently, for
 * everyone — not sites that merely happened to be slow or return an error
 * during one crawl. An unknown host that rejects us stays `inconclusive` and
 * still surfaces, because there we genuinely do not know why.
 */

const UNVERIFIABLE_HOSTS = new Map([
  ['facebook.com', 'Facebook rejects automated requests'],
  ['instagram.com', 'Instagram rejects automated requests'],
  ['linkedin.com', 'LinkedIn rejects automated requests'],
  ['x.com', 'X rejects automated requests'],
  ['twitter.com', 'X (Twitter) rejects automated requests'],
  ['tiktok.com', 'TikTok rejects automated requests'],
  ['threads.net', 'Threads rejects automated requests'],
  ['pinterest.com', 'Pinterest rejects automated requests'],
  ['quora.com', 'Quora rejects automated requests'],
  ['reddit.com', 'Reddit rate-limits automated requests']
]);

/** The registrable-ish host, so `www.facebook.com` and `m.facebook.com` both
 * match `facebook.com` without pulling in a public-suffix dependency. */
export function hostKey(rawUrl) {
  let hostname;
  try { hostname = new URL(rawUrl).hostname.toLowerCase(); } catch { return ''; }
  const parts = hostname.replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  return parts.slice(-2).join('.');
}

/** True when this destination is known to refuse automated verification.
 * Only meaningful alongside a rejection status — a host on this list that
 * answers 200 is simply verified, and nothing here applies. */
export function isKnownUnverifiableHost(rawUrl) {
  return UNVERIFIABLE_HOSTS.has(hostKey(rawUrl));
}

/** Why we could not verify it, in words a client can read. */
export function unverifiableReason(rawUrl) {
  return UNVERIFIABLE_HOSTS.get(hostKey(rawUrl)) || '';
}

/** A rejection status is one that tells us about the probe rather than about
 * the resource. A 404 or a 5xx is a real answer; these are a closed door. */
export function isRejectionStatus(status) {
  const code = Number(status || 0);
  return code === 0 || code === 400 || code === 401 || code === 403 || code === 405 || code === 429 || code === 999;
}

/**
 * Accumulates unverifiable external destinations across a crawl so they can be
 * reported once, with counts, instead of once per anchor. A site-wide footer
 * link to one social profile is one coverage fact, not forty.
 */
export function createUnverifiableLedger() {
  const byTarget = new Map();
  return {
    /** Records one occurrence. Returns true when this destination is being
     * accounted as coverage (and so must not also become a finding). */
    record(targetUrl, status, sourceUrl) {
      if (!isKnownUnverifiableHost(targetUrl) || !isRejectionStatus(status)) return false;
      let entry = byTarget.get(targetUrl);
      if (!entry) {
        entry = { url: targetUrl, host: hostKey(targetUrl), reason: unverifiableReason(targetUrl), status: Number(status || 0), occurrences: 0, sources: new Set() };
        byTarget.set(targetUrl, entry);
      }
      entry.occurrences++;
      if (sourceUrl) entry.sources.add(sourceUrl);
      return true;
    },
    /** The coverage statement: what we could not verify, where it appears, and
     * why — counted by destination, not by anchor. */
    summary() {
      const destinations = [...byTarget.values()]
        .map((e) => ({ url: e.url, host: e.host, reason: e.reason, status: e.status, occurrences: e.occurrences, sourcePages: e.sources.size }))
        .sort((a, b) => b.occurrences - a.occurrences);
      return {
        destinationCount: destinations.length,
        occurrenceCount: destinations.reduce((n, d) => n + d.occurrences, 0),
        hosts: [...new Set(destinations.map((d) => d.host))].sort(),
        destinations
      };
    }
  };
}
