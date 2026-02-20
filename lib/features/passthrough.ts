import type { Graph } from "@/lib/graph";

export type PassThroughMetrics = {
  is_pass_through_fast: boolean;
  median_hold_hours: number;
  amount_similarity: number;
  matched_flow_count: number;
};

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function computePassThrough(
  graph: Graph,
  params?: { MAX_GAP_HOURS?: number; AMOUNT_TOL?: number; MIN_MATCHES?: number; FAST_HOLD_HOURS?: number }
) {
  const MAX_GAP_HOURS = params?.MAX_GAP_HOURS ?? 24;
  const AMOUNT_TOL = params?.AMOUNT_TOL ?? 0.10;
  const MIN_MATCHES = params?.MIN_MATCHES ?? 3;
  const FAST_HOLD_HOURS = params?.FAST_HOLD_HOURS ?? 6;

  const out = new Map<string, PassThroughMetrics>();

  for (const acct of graph.nodes) {
    const inTx = graph.txIn.get(acct) ?? [];
    const outTx = graph.txOut.get(acct) ?? [];

    if (inTx.length < 3 || outTx.length < 3) {
      out.set(acct, {
        is_pass_through_fast: false,
        median_hold_hours: 0,
        amount_similarity: 1,
        matched_flow_count: 0,
      });
      continue;
    }

    const medIn = median(inTx.map((t) => t.amount));
    const medOut = median(outTx.map((t) => t.amount));
    const denom = Math.max(1e-9, Math.max(medIn, medOut));
    const amountSim = clamp01(Math.abs(medIn - medOut) / denom);

    let j = 0;
    let matches = 0;
    const holds: number[] = [];

    for (let i = 0; i < inTx.length; i++) {
      const tin = inTx[i].t;
      const ain = inTx[i].amount;

      while (j < outTx.length && outTx[j].t < tin) j++;

      let found = -1;
      const scanLimit = Math.min(outTx.length, j + 12);

      for (let k = j; k < scanLimit; k++) {
        const tout = outTx[k].t;
        const gapH = (tout - tin) / 3600;
        if (gapH > MAX_GAP_HOURS) break;

        const aout = outTx[k].amount;
        const rel = Math.abs(aout - ain) / Math.max(1e-9, Math.max(aout, ain));
        if (rel <= AMOUNT_TOL) {
          found = k;
          holds.push(gapH);
          matches++;
          break;
        }
      }

      if (found !== -1) j = found + 1;
    }

    const medHold = median(holds);
    const isFast = matches >= MIN_MATCHES && amountSim <= 0.12 && medHold > 0 && medHold <= FAST_HOLD_HOURS;

    out.set(acct, {
      is_pass_through_fast: isFast,
      median_hold_hours: Number(medHold.toFixed(2)),
      amount_similarity: Number(amountSim.toFixed(3)),
      matched_flow_count: matches,
    });
  }

  return out;
}