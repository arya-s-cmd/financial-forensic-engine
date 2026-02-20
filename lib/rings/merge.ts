import type { RingCandidate } from "@/lib/output";

/**
 * Light dedup/merge for near-duplicate detectors.
 * For this challenge we keep pattern types distinct; we only merge when the pattern_type matches.
 */
function jaccard(a: Set<string>, b: Set<string>) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

export function mergeRings(rings: RingCandidate[], J = 0.7): RingCandidate[] {
  const used = new Array(rings.length).fill(false);
  const out: RingCandidate[] = [];

  for (let i = 0; i < rings.length; i++) {
    if (used[i]) continue;

    const base = rings[i];
    const members = new Set(base.member_accounts);

    let bestRisk = base.risk_score;
    let bestMembers = base.member_accounts;

    for (let j = i + 1; j < rings.length; j++) {
      if (used[j]) continue;
      const r = rings[j];
      if (r.pattern_type !== base.pattern_type) continue;

      const js = jaccard(members, new Set(r.member_accounts));
      if (js >= J) {
        used[j] = true;
        if (r.risk_score > bestRisk) {
          bestRisk = r.risk_score;
          bestMembers = r.member_accounts;
        }
      }
    }

    out.push({ ...base, member_accounts: bestMembers, risk_score: bestRisk });
  }

  return out;
}
