import { NextRequest, NextResponse } from "next/server";
import { parseCsvStrict } from "@/lib/parse";
import { buildGraph } from "@/lib/graph";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const csvText = String(body.csvText ?? body.csv ?? "").trim();
    if (!csvText) return NextResponse.json({ error: "Missing csvText" }, { status: 400 });

    const txs = parseCsvStrict(csvText);
    const g = buildGraph(txs);

    const nodes = [...g.nodes].sort().map((id) => ({ data: { id } }));

    const edges: any[] = [];
    for (const [k, arr] of g.edgeTx.entries()) {
      const [source, target] = k.split("|");
      let total = 0;
      for (const tx of arr) total += tx.amount;

      edges.push({
        data: {
          id: `${source}__${target}`,
          source,
          target,
          tx_count: arr.length,
          total_amount: Number(total.toFixed(2)),
        },
      });
    }

    return NextResponse.json({ nodes, edges });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 400 });
  }
}