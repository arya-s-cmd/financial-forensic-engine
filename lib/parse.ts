import Papa from "papaparse";

export type Tx = {
  transaction_id?: string;
  sender_id: string;
  receiver_id: string;
  amount: number;
  t: number; // epoch seconds
};

function norm(s: string) {
  return s.trim().toLowerCase();
}

function parseTimeToEpochSeconds(v: any): number {
  if (v === null || v === undefined) throw new Error("Missing timestamp");
  const s = String(v).trim();
  if (!s) throw new Error("Empty timestamp");

  // numeric?
  const num = Number(s);
  if (Number.isFinite(num)) {
    // ms vs seconds heuristic
    if (num > 1e12) return Math.floor(num / 1000);
    if (num > 1e9) return Math.floor(num);
  }

  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) throw new Error(`Invalid timestamp: ${s}`);
  return Math.floor(ms / 1000);
}

export function parseCsvStrict(csvText: string): Tx[] {
  if (!csvText || !csvText.trim()) throw new Error("CSV is empty");

  const res = Papa.parse<Record<string, any>>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (res.errors?.length) {
    throw new Error(`CSV parse error: ${res.errors[0].message}`);
  }

  const rows = res.data ?? [];
  if (!rows.length) throw new Error("CSV has no rows");

  // header detection (robust to header casing/spacing)
  const rawHeaders = Object.keys(rows[0] ?? {});
  const normToRaw = new Map<string, string>();
  for (const h of rawHeaders) normToRaw.set(norm(h), h);

  const pick = (cands: string[]) => {
    for (const c of cands) {
      const raw = normToRaw.get(c);
      if (raw) return raw; // return actual header key
    }
    return null;
  };

  const senderKey = pick(["sender_id", "sender", "from", "src", "source"]);
  const receiverKey = pick(["receiver_id", "receiver", "to", "dst", "target"]);
  const amountKey = pick(["amount", "amt", "value"]);
  const timeKey = pick(["timestamp", "time", "datetime", "date"]);
  const idKey = pick(["transaction_id", "tx_id", "id"]);

  const headers = rawHeaders.map(norm);

  if (!senderKey || !receiverKey || !amountKey || !timeKey) {
    throw new Error(
      `Missing required columns. Need sender/receiver/amount/timestamp. Found: ${headers.join(", ")}`
    );
  }

  const out: Tx[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const sender_id = String(r[senderKey] ?? "").trim();
    const receiver_id = String(r[receiverKey] ?? "").trim();
    if (!sender_id || !receiver_id) throw new Error(`Row ${i + 2}: missing sender/receiver`);

    const amount = Number(String(r[amountKey] ?? "").trim());
    if (!Number.isFinite(amount)) throw new Error(`Row ${i + 2}: invalid amount`);
    if (amount <= 0) throw new Error(`Row ${i + 2}: amount must be > 0`);

    const t = parseTimeToEpochSeconds(r[timeKey]);

    const tx: Tx = { sender_id, receiver_id, amount, t };
    if (idKey && r[idKey] != null && String(r[idKey]).trim()) tx.transaction_id = String(r[idKey]).trim();

    out.push(tx);
  }

  // deterministic sort
  out.sort((a, b) => (a.t - b.t) || a.sender_id.localeCompare(b.sender_id) || a.receiver_id.localeCompare(b.receiver_id));
  return out;
}