import type { OutputJSON, FraudRing, SuspiciousAccount } from "@/types/output";

export type RingCandidate = {
  pattern_type: string; // cycle | smurfing | layered_shell (challenge vocabulary)
  member_accounts: string[]; // order is meaningful for layered shells and smurfing
  risk_score: number; // 0..100
};

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

function uniqPreserveOrder(xs: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

function ringSignature(r: RingCandidate): string {
  // signature ignores ordering for dedup purposes
  const members = [...new Set(r.member_accounts)].sort();
  return `${r.pattern_type}|${members.join(",")}`;
}

function patternRank(p: string): number {
  // Lower is earlier
  const order = [
    "cycle_length_3",
    "cycle_length_4",
    "cycle_length_5",
    "cycle",
    "smurfing_fan_in",
    "smurfing_fan_out",
    "temporal_72h",
    "layered_shell_chain",
    "source_funds",
    "low_activity_shell",
    "pre_cashout",
    "cash_out",
  ];
  const i = order.indexOf(p);
  return i === -1 ? 999 : i;
}

function orderPatterns(patterns: Set<string>): string[] {
  const arr = [...patterns];
  arr.sort((a, b) => {
    const ra = patternRank(a);
    const rb = patternRank(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
  return arr;
}

function patternPriority(pt: string): number {
  if (pt === "cycle") return 1;
  if (pt === "smurfing") return 2;
  if (pt === "layered_shell") return 3;
  return 9;
}

export function buildDeterministicOutput(params: {
  allNodes: Set<string>;
  rings: RingCandidate[];
  accountScores: Map<string, { score: number; patterns: Set<string>; ringId: string | null }>;
  processingSeconds: number;
}): OutputJSON {
  const { allNodes, rings, accountScores, processingSeconds } = params;

  // 1) Dedup rings by (pattern + members), keep highest risk
  const bestBySig = new Map<string, RingCandidate>();
  for (const r of rings) {
    const sig = ringSignature(r);
    const prev = bestBySig.get(sig);
    if (!prev || r.risk_score > prev.risk_score) bestBySig.set(sig, r);
  }

  // 2) Deterministic ring ordering: by pattern priority, then by member signature
  const ringList = [...bestBySig.values()];
  ringList.sort((a, b) => {
    const pa = patternPriority(a.pattern_type);
    const pb = patternPriority(b.pattern_type);
    if (pa !== pb) return pa - pb;

    const sa = [...new Set(a.member_accounts)].sort().join("|");
    const sb = [...new Set(b.member_accounts)].sort().join("|");
    return sa.localeCompare(sb);
  });

  const fraud_rings: FraudRing[] = ringList.map((r, idx) => {
    const ring_id = `RING_${String(idx + 1).padStart(3, "0")}`;
    const member_accounts =
      r.pattern_type === "cycle" ? [...new Set(r.member_accounts)].sort()
      : uniqPreserveOrder(r.member_accounts);

    return {
      ring_id,
      member_accounts,
      pattern_type: r.pattern_type,
      risk_score: clamp(Number(r.risk_score.toFixed(1))),
    };
  });

  // 3) Map member -> best ring (highest risk; tie-breaker deterministic by ring id)
  const memberToBestRing = new Map<string, { ring_id: string; risk: number }>();
  for (const ring of fraud_rings) {
    for (const m of ring.member_accounts) {
      const prev = memberToBestRing.get(m);
      if (!prev || ring.risk_score > prev.risk || (ring.risk_score === prev.risk && ring.ring_id < prev.ring_id)) {
        memberToBestRing.set(m, { ring_id: ring.ring_id, risk: ring.risk_score });
      }
    }
  }

  // 4) Suspicious accounts output
  const suspicious_accounts: SuspiciousAccount[] = [];

  for (const [account_id, v] of accountScores.entries()) {
    const suspicion_score = clamp(Number(v.score.toFixed(1)));
    if (suspicion_score < 60) continue;

    const bestRing = memberToBestRing.get(account_id);
    const ring_id = bestRing?.ring_id ?? v.ringId ?? null;

    const patterns = new Set<string>(v.patterns ?? []);
    if (patterns.size === 0) continue;

    suspicious_accounts.push({
      account_id,
      suspicion_score,
      detected_patterns: orderPatterns(patterns),
      ring_id,
    });
  }

  suspicious_accounts.sort(
    (a, b) => (b.suspicion_score - a.suspicion_score) || a.account_id.localeCompare(b.account_id)
  );

  return {
    suspicious_accounts,
    fraud_rings,
    summary: {
      total_accounts_analyzed: allNodes.size,
      suspicious_accounts_flagged: suspicious_accounts.length,
      fraud_rings_detected: fraud_rings.length,
      processing_time_seconds: Number(processingSeconds.toFixed(3)),
    },
  };
}
