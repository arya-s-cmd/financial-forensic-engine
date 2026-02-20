import type { Tx } from "@/lib/parse";

export type Graph = {
  nodes: Set<string>;

  // adjacency
  outNeighbors: Map<string, Set<string>>;
  inNeighbors: Map<string, Set<string>>;

  // transactions by node
  txIn: Map<string, Tx[]>;
  txOut: Map<string, Tx[]>;

  // edge tx list
  edgeTx: Map<string, Tx[]>; // key: `${sender}|${receiver}`

  // degrees (total tx count)
  degreeTotal: Map<string, number>;
};

function edgeKey(a: string, b: string) {
  return `${a}|${b}`;
}

export function buildGraph(txs: Tx[]): Graph {
  const nodes = new Set<string>();
  const outNeighbors = new Map<string, Set<string>>();
  const inNeighbors = new Map<string, Set<string>>();
  const txIn = new Map<string, Tx[]>();
  const txOut = new Map<string, Tx[]>();
  const edgeTx = new Map<string, Tx[]>();
  const degreeTotal = new Map<string, number>();

  const push = (m: Map<string, Tx[]>, k: string, tx: Tx) => {
    const a = m.get(k);
    if (a) a.push(tx);
    else m.set(k, [tx]);
  };

  const addNeighbor = (m: Map<string, Set<string>>, a: string, b: string) => {
    const s = m.get(a);
    if (s) s.add(b);
    else m.set(a, new Set([b]));
  };

  for (const tx of txs) {
    nodes.add(tx.sender_id);
    nodes.add(tx.receiver_id);

    push(txOut, tx.sender_id, tx);
    push(txIn, tx.receiver_id, tx);

    addNeighbor(outNeighbors, tx.sender_id, tx.receiver_id);
    addNeighbor(inNeighbors, tx.receiver_id, tx.sender_id);

    const ek = edgeKey(tx.sender_id, tx.receiver_id);
    const list = edgeTx.get(ek);
    if (list) list.push(tx);
    else edgeTx.set(ek, [tx]);

    degreeTotal.set(tx.sender_id, (degreeTotal.get(tx.sender_id) ?? 0) + 1);
    degreeTotal.set(tx.receiver_id, (degreeTotal.get(tx.receiver_id) ?? 0) + 1);
  }

  // sort per-node lists + per-edge lists deterministically
  for (const [k, arr] of txIn.entries()) arr.sort((a, b) => a.t - b.t);
  for (const [k, arr] of txOut.entries()) arr.sort((a, b) => a.t - b.t);
  for (const [k, arr] of edgeTx.entries()) arr.sort((a, b) => a.t - b.t);

  return { nodes, outNeighbors, inNeighbors, txIn, txOut, edgeTx, degreeTotal };
}