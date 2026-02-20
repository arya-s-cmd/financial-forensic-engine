import type { Graph } from "@/lib/graph";
import type { RingCandidate } from "@/lib/output";

const WINDOW_SEC = 72 * 3600;
const MIN_UNIQUE = 10;

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function amountConsistency(amounts: number[], tol = 0.08) {
  if (amounts.length < 6) return 0;
  const med = median(amounts);
  const band = Math.max(1, med * tol);
  const close = amounts.filter((x) => Math.abs(x - med) <= band).length;
  return close / Math.max(1, amounts.length);
}

type WindowHit = {
  l: number;
  r: number;
  uniq: number;
  minT: number;
  maxT: number;
  counterparties: Set<string>;
  amounts: number[];
};

function bestUniqueWindow<T extends { t: number; amount: number }>(
  list: T[],
  getCounterparty: (x: T) => string
): WindowHit | null {
  if (!list.length) return null;

  let l = 0;
  const counts = new Map<string, number>();
  const cpInWindow: string[] = [];

  let best: WindowHit | null = null;

  for (let r = 0; r < list.length; r++) {
    const cp = getCounterparty(list[r]);
    cpInWindow[r] = cp;
    counts.set(cp, (counts.get(cp) ?? 0) + 1);

    while (list[r].t - list[l].t > WINDOW_SEC) {
      const cpl = cpInWindow[l];
      const v = (counts.get(cpl) ?? 0) - 1;
      if (v <= 0) counts.delete(cpl);
      else counts.set(cpl, v);
      l++;
    }

    const uniq = counts.size;
    if (uniq >= MIN_UNIQUE) {
      const minT = list[l].t;
      const maxT = list[r].t;

      if (!best || uniq > best.uniq || (uniq === best.uniq && (maxT - minT) < (best.maxT - best.minT))) {
        const cps = new Set<string>();
        const amts: number[] = [];
        for (let i = l; i <= r; i++) {
          cps.add(getCounterparty(list[i]));
          amts.push(list[i].amount);
        }
        best = { l, r, uniq, minT, maxT, counterparties: cps, amounts: amts };
      }
    }
  }

  return best;
}

export function detectSmurfing(graph: Graph): {
  rings: RingCandidate[];
  evidenceByAccount: Map<string, Set<string>>;
} {
  const rings: RingCandidate[] = [];
  const evidenceByAccount = new Map<string, Set<string>>();

  const addPat = (acct: string, p: string) => {
    const s = evidenceByAccount.get(acct) ?? new Set<string>();
    s.add(p);
    evidenceByAccount.set(acct, s);
  };

  for (const hub of graph.nodes) {
    const inTx = graph.txIn.get(hub) ?? [];
    const outTx = graph.txOut.get(hub) ?? [];
    if (inTx.length < MIN_UNIQUE || outTx.length < MIN_UNIQUE) continue;

    const bestIn = bestUniqueWindow(inTx, (x) => x.sender_id);
    const bestOut = bestUniqueWindow(outTx, (x) => x.receiver_id);
    if (!bestIn || !bestOut) continue;

    const senders = bestIn.counterparties;
    const receivers = bestOut.counterparties;

    // Temporal tightness across both phases: union span within 72h
    const minT = Math.min(bestIn.minT, bestOut.minT);
    const maxT = Math.max(bestIn.maxT, bestOut.maxT);
    if (maxT - minT > WINDOW_SEC) continue;

    // Amount signature: incoming small-ish and similar-ish OR outgoing similar-ish
    const inCons = amountConsistency(bestIn.amounts, 0.08);
    const outCons = amountConsistency(bestOut.amounts, 0.08);
    const strongAmountSignature = (inCons >= 0.5) || (outCons >= 0.45);
    if (!strongAmountSignature) continue;

    // Cash-out node: a node receiving from many of the receivers in same 72h window, with low outbound.
    let cashout: string | null = null;
    let bestCashU = 0;

    for (const cand of graph.nodes) {
      const inToCand = graph.txIn.get(cand) ?? [];
      if (inToCand.length < MIN_UNIQUE) continue;

      // count unique senders among receivers within [minT, maxT]
      const uniqSenders = new Set<string>();
      for (const tx of inToCand) {
        if (tx.t < minT || tx.t > maxT) continue;
        if (receivers.has(tx.sender_id)) uniqSenders.add(tx.sender_id);
      }
      const u = uniqSenders.size;

      if (u >= MIN_UNIQUE) {
        const outCount = (graph.txOut.get(cand) ?? []).length;
        // cash-out tends to be sink-ish
        if (outCount <= 2) {
          if (u > bestCashU) {
            bestCashU = u;
            cashout = cand;
          }
        }
      }
    }

    // Build members in expected order: hub, senders (sorted), receivers (sorted), cashout (if any)
    const senderList = [...senders].sort();
    const receiverList = [...receivers].sort();

    const member_accounts = [hub, ...senderList, ...receiverList];
    if (cashout && !member_accounts.includes(cashout)) member_accounts.push(cashout);

    // Risk score (0..100): emphasize size + tightness + cashout + amount consistency
    const sizeScore = 70 + 1.2 * senders.size + 1.2 * receivers.size; // 10/10 => 94
    const amtBonus = 6 * Math.max(inCons, outCons); // up to +6
    const cashBonus = cashout ? 4 : 0;
    const risk_score = clamp(sizeScore + amtBonus + cashBonus);

    rings.push({
      pattern_type: "smurfing",
      member_accounts,
      risk_score: Number(risk_score.toFixed(1)),
    });

    // Evidence tags matching expected vocabulary
    addPat(hub, "smurfing_fan_in");
    addPat(hub, "smurfing_fan_out");
    addPat(hub, "temporal_72h");

    for (const s of senders) {
      addPat(s, "smurfing_fan_in");
      addPat(s, "temporal_72h");
    }

    for (const r of receivers) {
      addPat(r, "smurfing_fan_out");
      addPat(r, "temporal_72h");
    }

    if (cashout) {
      addPat(cashout, "smurfing_fan_out");
      addPat(cashout, "temporal_72h");
      addPat(cashout, "cash_out");
    }
  }

  return { rings, evidenceByAccount };
}
