"use client";

import { useMemo, useRef, useState } from "react";

type UploadState =
  | { kind: "idle" }
  | { kind: "loaded"; fileName: string; sizeBytes: number; rowCountGuess: number }
  | { kind: "analyzing" }
  | { kind: "error"; message: string };

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB"];
  let b = bytes;
  let i = 0;
  while (b >= 1024 && i < units.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function countRowsGuess(csv: string) {
  // rough guess; avoids heavy parse here
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return Math.max(0, lines.length - 1);
}

export default function HomePage() {
  const [csvText, setCsvText] = useState<string>("");
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stats = useMemo(() => {
    if (state.kind !== "loaded") return null;
    return state;
  }, [state]);

  async function loadFile(file: File) {
    setState({ kind: "idle" });
    try {
      const text = await file.text();
      setCsvText(text);
      setState({
        kind: "loaded",
        fileName: file.name,
        sizeBytes: file.size,
        rowCountGuess: countRowsGuess(text),
      });
    } catch (e: any) {
      setState({ kind: "error", message: e?.message ?? "Failed to read file" });
    }
  }

  async function analyze() {
    if (!csvText.trim()) {
      setState({ kind: "error", message: "Upload or paste a CSV first." });
      return;
    }

    setState({ kind: "analyzing" });
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Analysis failed");

      sessionStorage.setItem("analysis_result", JSON.stringify(data));
      sessionStorage.setItem("csv_text", csvText);
      window.location.href = "/results";
    } catch (e: any) {
      setState({ kind: "error", message: e?.message ?? "Unknown error" });
    }
  }

  function loadSample() {
    const sample =
      "transaction_id,sender_id,receiver_id,amount,timestamp\n" +
      "tx1,A,B,50,2026-02-10 10:00:00\n" +
      "tx2,B,C,49,2026-02-10 10:10:00\n" +
      "tx3,C,A,48,2026-02-10 10:20:00\n";
    setCsvText(sample);
    setState({
      kind: "loaded",
      fileName: "sample.csv",
      sizeBytes: sample.length,
      rowCountGuess: countRowsGuess(sample),
    });
  }

  const disabled = state.kind === "analyzing";

  return (
    <main style={styles.shell}>
      <div style={styles.topbar}>
        <div>
          <div style={styles.brand}>Money Muling Detector</div>
          <div style={styles.subtitle}>
            Upload a transaction CSV and detect suspicious rings (cycles, smurfing, shell chains).
          </div>
        </div>
        <div style={styles.topbarActions}>
          <button style={{ ...styles.ghostBtn }} onClick={loadSample} disabled={disabled}>
            Load sample
          </button>
          <button
            style={{ ...styles.primaryBtn, opacity: disabled ? 0.6 : 1 }}
            onClick={analyze}
            disabled={disabled}
          >
            {state.kind === "analyzing" ? "Analyzing..." : "Analyze"}
          </button>
        </div>
      </div>

      <div style={styles.grid}>
        {/* Upload card */}
        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.cardTitle}>Upload CSV</div>
              <div style={styles.cardHint}>
                Required columns: <code>transaction_id,sender_id,receiver_id,amount,timestamp</code>
              </div>
            </div>
            <button
              style={styles.smallBtn}
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              title="Choose a file"
            >
              Choose file
            </button>
          </div>

          <div
            style={{
              ...styles.dropzone,
              borderColor: dragOver ? "#6aa6ff" : "#2a2f3a",
              background: dragOver ? "rgba(106,166,255,0.08)" : "rgba(255,255,255,0.03)",
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void loadFile(f);
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadFile(f);
              }}
              disabled={disabled}
            />

            <div style={styles.dropzoneInner}>
              <div style={styles.dropIcon}>⬆︎</div>
              <div style={styles.dropTitle}>Drag & drop your CSV here</div>
              <div style={styles.dropSub}>
                or click to browse. Keep it under ~10K rows for best performance.
              </div>

              {stats && (
                <div style={styles.filePill}>
                  <span style={{ fontWeight: 600 }}>{stats.fileName}</span>
                  <span style={{ opacity: 0.75 }}>
                    {formatBytes(stats.sizeBytes)} • ~{stats.rowCountGuess} rows
                  </span>
                </div>
              )}
            </div>
          </div>

          <div style={styles.warningRow}>
            <div style={styles.badge}>Format</div>
            <div style={styles.warningText}>
              Timestamp must be <code>YYYY-MM-DD HH:MM:SS</code>. If your file violates this, we reject it (by design).
            </div>
          </div>

          {state.kind === "error" && (
            <div style={styles.errorBox}>
              <div style={{ fontWeight: 700 }}>Error</div>
              <div style={{ opacity: 0.9 }}>{state.message}</div>
            </div>
          )}
        </section>

        {/* Paste card */}
        <section style={styles.card}>
          <div style={styles.cardHeader}>
            <div>
              <div style={styles.cardTitle}>Or paste CSV</div>
              <div style={styles.cardHint}>Useful for quick testing and debugging.</div>
            </div>
            <button
              style={styles.smallBtn}
              disabled={disabled}
              onClick={() => {
                setCsvText("");
                setState({ kind: "idle" });
              }}
              title="Clear"
            >
              Clear
            </button>
          </div>

          <textarea
            value={csvText}
            onChange={(e) => {
              const v = e.target.value;
              setCsvText(v);
              if (v.trim().length === 0) {
                setState({ kind: "idle" });
              } else if (state.kind !== "analyzing") {
                setState({
                  kind: "loaded",
                  fileName: "pasted.csv",
                  sizeBytes: v.length,
                  rowCountGuess: countRowsGuess(v),
                });
              }
            }}
            placeholder="transaction_id,sender_id,receiver_id,amount,timestamp
tx1,A,B,100,2026-02-10 10:00:00"
            style={styles.textarea}
            disabled={disabled}
          />

          <div style={styles.footerNote}>
            Tip: start with small CSVs, validate output stability, then scale.
          </div>
        </section>
      </div>

      <footer style={styles.footer}>
        <div style={{ opacity: 0.7 }}>
          Built for deterministic output + trap-resistant scoring. Don’t “demo” randomness.
        </div>
      </footer>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: "100vh",
    padding: 24,
    background:
      "radial-gradient(1200px 600px at 20% 10%, rgba(106,166,255,0.18), transparent 60%)," +
      "radial-gradient(900px 500px at 85% 25%, rgba(153,102,255,0.14), transparent 55%)," +
      "linear-gradient(180deg, #0b0d12 0%, #07080c 60%, #05060a 100%)",
    color: "#e8ecf3",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
  },
  topbar: {
    maxWidth: 1150,
    margin: "0 auto 18px auto",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  brand: { fontSize: 28, fontWeight: 800, letterSpacing: -0.6 },
  subtitle: { marginTop: 6, opacity: 0.78, lineHeight: 1.4, maxWidth: 720 },
  topbarActions: { display: "flex", gap: 10, alignItems: "center", marginTop: 4 },
  primaryBtn: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(106,166,255,0.45)",
    background: "linear-gradient(180deg, rgba(106,166,255,0.95), rgba(106,166,255,0.7))",
    color: "#08101f",
    fontWeight: 800,
    cursor: "pointer",
  },
  ghostBtn: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "#e8ecf3",
    fontWeight: 700,
    cursor: "pointer",
  },
  grid: {
    maxWidth: 1150,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "1.05fr 0.95fr",
    gap: 16,
  },
  card: {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    boxShadow: "0 14px 60px rgba(0,0,0,0.35)",
    padding: 16,
    overflow: "hidden",
  },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: 800, letterSpacing: 0.2 },
  cardHint: { marginTop: 6, opacity: 0.75, fontSize: 13, lineHeight: 1.4 },
  smallBtn: {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "#e8ecf3",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  dropzone: {
    marginTop: 14,
    borderRadius: 16,
    border: "1px dashed rgba(255,255,255,0.14)",
    padding: 18,
    cursor: "pointer",
    transition: "all 120ms ease",
  },
  dropzoneInner: { textAlign: "center", padding: "18px 8px" },
  dropIcon: { fontSize: 26, opacity: 0.85, marginBottom: 8 },
  dropTitle: { fontSize: 16, fontWeight: 800 },
  dropSub: { opacity: 0.7, marginTop: 6, lineHeight: 1.4, fontSize: 13 },
  filePill: {
    marginTop: 14,
    display: "inline-flex",
    gap: 10,
    alignItems: "center",
    padding: "8px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    fontSize: 13,
  },
  warningRow: { marginTop: 12, display: "flex", gap: 10, alignItems: "flex-start" },
  badge: {
    fontSize: 11,
    fontWeight: 900,
    padding: "4px 8px",
    borderRadius: 999,
    background: "rgba(255,180,90,0.12)",
    border: "1px solid rgba(255,180,90,0.22)",
    color: "#ffd9ad",
  },
  warningText: { opacity: 0.8, lineHeight: 1.45, fontSize: 13 },
  errorBox: {
    marginTop: 12,
    borderRadius: 14,
    padding: 12,
    border: "1px solid rgba(255,90,90,0.28)",
    background: "rgba(255,90,90,0.10)",
    color: "#ffd4d4",
  },
  textarea: {
    marginTop: 14,
    width: "100%",
    height: 360,
    resize: "vertical",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.25)",
    color: "#e8ecf3",
    padding: 12,
    outline: "none",
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: 12.5,
    lineHeight: 1.4,
  },
  footerNote: { marginTop: 10, opacity: 0.65, fontSize: 12.5 },
  footer: { maxWidth: 1150, margin: "18px auto 0 auto", paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" },
};
