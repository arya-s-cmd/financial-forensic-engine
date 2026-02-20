import { NextRequest, NextResponse } from "next/server";
import { parseCsvStrict } from "@/lib/parse";
import { buildGraph } from "@/lib/graph";

import { detectSmurfing } from "@/lib/detect/smurfing";
import { detectCycles35 } from "@/lib/detect/cycles";
import { detectShellChains } from "@/lib/detect/shellChains";

import { adjustRingRisks, initAccountScores, applyWinModeScoring } from "@/lib/score";
import { mergeRings } from "@/lib/rings/merge";
import { buildDeterministicOutput, type RingCandidate } from "@/lib/output";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const t0 = Date.now();

  try {
    const body = await req.json().catch(() => ({} as any));
    const csvText = String(body.csvText ?? body.csv ?? "").trim();
    if (!csvText) {
      return NextResponse.json({ error: "Missing csvText in request body" }, { status: 400 });
    }

    const txs = parseCsvStrict(csvText);
    const g = buildGraph(txs);

    // detectors
    const smurf = detectSmurfing(g);
    const cycles = detectCycles35(g);
    const shells = detectShellChains(g);

    // merge rings
    let rings: RingCandidate[] = [
      ...smurf.rings,
      ...cycles.rings,
      ...shells.rings,
    ];

    // merge evidence
    const evidenceByAccount = new Map<string, Set<string>>();
    const mergeEv = (m: Map<string, Set<string>>) => {
      for (const [k, set] of m.entries()) {
        const cur = evidenceByAccount.get(k) ?? new Set<string>();
        for (const p of set) cur.add(p);
        evidenceByAccount.set(k, cur);
      }
    };
    mergeEv(smurf.evidenceByAccount);
    mergeEv(cycles.evidenceByAccount);
    mergeEv(shells.evidenceByAccount);

    // ring risk calibration (currently a no-op)
    rings = adjustRingRisks({ graph: g, rings });

    // dedup/merge overlapping rings into cases
    rings = mergeRings(rings, 0.6);

    // scoring
    const accountScores = initAccountScores(g.nodes);
    applyWinModeScoring({
      graph: g,
      rings,
      evidenceByAccount,
      accountScores,
    });

    const processingSeconds = (Date.now() - t0) / 1000;

    const out = buildDeterministicOutput({
      allNodes: g.nodes,
      rings,
      accountScores,
      processingSeconds,
    });

    return NextResponse.json(out);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Unknown error" },
      { status: 400 }
    );
  }
}