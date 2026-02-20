import type { Graph } from "@/lib/graph";
import type { RingCandidate } from "@/lib/output";

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

function canonicalCycle(nodes: string[]) {
  const n = nodes.length;
  let best = nodes;
  for (let s = 1; s < n; s++) {
    const rot = nodes.slice(s).concat(nodes.slice(0, s));
    if (rot.join("|") < best.join("|")) best = rot;
  }
  return best;
}

function cycleRisk(len: number, spanSeconds: number) {
  const base = len === 3 ? 89.3 : len === 4 ? 87.7 : 85.0;
  const hours = spanSeconds / 3600;
  const bonus = hours <= 1 ? 10 : hours <= 6 ? 6 : hours <= 24 ? 3 : 0;
  return clamp(base + bonus);
}

export function detectCycles35(graph: Graph): {
  rings: RingCandidate[];
  evidenceByAccount: Map<string, Set<string>>;
} {
  const rings: RingCandidate[] = [];
  const evidenceByAccount = new Map<string, Set<string>>();
  const add = (a: string, p: string) => {
    const s = evidenceByAccount.get(a) ?? new Set<string>();
    s.add(p);
    evidenceByAccount.set(a, s);
  };

  const nodes = [...graph.nodes].sort();
  const idx = new Map(nodes.map((id, i) => [id, i]));
  const seen = new Set<string>();

  for (const start of nodes) {
    const startIdx = idx.get(start)!;
    const path: string[] = [start];
    const visited = new Set<string>([start]);

    function dfs(u: string, depth: number) {
      if (depth > 5) return;
      const nbrs = graph.outNeighbors.get(u);
      if (!nbrs) return;

      for (const v of nbrs) {
        const vi = idx.get(v);
        if (vi === undefined) continue;
        if (vi < startIdx) continue;

        if (v === start) {
          if (depth >= 3 && depth <= 5) {
            const cyc = canonicalCycle(path.slice());
            const key = cyc.join("|");
            if (!seen.has(key)) {
              seen.add(key);

              let minT = Number.POSITIVE_INFINITY;
              let maxT = 0;
              for (let i = 0; i < cyc.length; i++) {
                const a = cyc[i];
                const b = cyc[(i + 1) % cyc.length];
                const arr = graph.edgeTx.get(`${a}|${b}`);
                if (arr && arr.length) {
                  minT = Math.min(minT, arr[0].t);
                  maxT = Math.max(maxT, arr[arr.length - 1].t);
                }
              }
              if (!Number.isFinite(minT)) { minT = 0; maxT = 0; }
              const span = Math.max(0, maxT - minT);

              rings.push({
                pattern_type: "cycle",
                member_accounts: [...cyc].sort(),
                risk_score: cycleRisk(cyc.length, span),
              });

              const pat = `cycle_length_${cyc.length}`;
              for (const a of cyc) add(a, pat);
              for (const a of cyc) add(a, "cycle");
            }
          }
          continue;
        }

        if (visited.has(v)) continue;
        visited.add(v);
        path.push(v);
        dfs(v, depth + 1);
        path.pop();
        visited.delete(v);
      }
    }

    dfs(start, 1);
  }

  return { rings, evidenceByAccount };
}