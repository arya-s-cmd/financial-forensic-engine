"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { OutputJSON, SuspiciousAccount } from "@/types/output";

type SortKey = "score" | "account" | "ring";
type LayoutMode = "cose" | "concentric" | "breadthfirst";

function downloadText(filename: string, text: string, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ResultsPage() {
  const [data, setData] = useState<OutputJSON | null>(null);
  const [graph, setGraph] = useState<{ nodes: any[]; edges: any[] } | null>(null);

  const [q, setQ] = useState("");
  const [minScore, setMinScore] = useState(1);
  const [selectedRing, setSelectedRing] = useState<string | "ALL">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("score");

  // Graph readability controls
  const [showOnlyFocused, setShowOnlyFocused] = useState(true);
  const [showSuspiciousOnly, setShowSuspiciousOnly] = useState(false);
  const [minEdgeTxCount, setMinEdgeTxCount] = useState(1);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("concentric");

  const graphDivRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  // Load analysis JSON + CSV text, then fetch graph elements
  useEffect(() => {
    const raw = sessionStorage.getItem("analysis_result");
    const csv = sessionStorage.getItem("csv_text");

    if (raw) {
      const parsed: OutputJSON = JSON.parse(raw);
      setData(parsed);

      // Better default focus:
      // pick the highest-risk ring that actually contains suspicious accounts,
      // otherwise fall back to the top ring.
      if (parsed.fraud_rings.length > 0) {
        const suspiciousRingIds = new Set(
          parsed.suspicious_accounts.map((a) => a.ring_id).filter((x): x is string => !!x)
        );

        const sortedRings = [...parsed.fraud_rings].sort(
          (a, b) => (b.risk_score - a.risk_score) || a.ring_id.localeCompare(b.ring_id)
        );

        const best =
          sortedRings.find((r) => suspiciousRingIds.has(r.ring_id)) ?? sortedRings[0];

        setSelectedRing(best?.ring_id ?? "ALL");
      } else {
        setSelectedRing("ALL");
      }
    }

    if (csv) {
      fetch("/api/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText: csv }),
      })
        .then((r) => r.json())
        .then((d) => setGraph(d))
        .catch(() => setGraph(null));
    }
  }, []);

  const jsonText = useMemo(() => (data ? JSON.stringify(data, null, 2) : ""), [data]);

  const suspiciousById = useMemo(() => {
    const m = new Map<string, SuspiciousAccount>();
    if (!data) return m;
    for (const a of data.suspicious_accounts) m.set(a.account_id, a);
    return m;
  }, [data]);

  const selectedRingObj = useMemo(() => {
    if (!data || selectedRing === "ALL") return null;
    return data.fraud_rings.find((r) => r.ring_id === selectedRing) ?? null;
  }, [data, selectedRing]);

  const focusedSuspiciousCount = useMemo(() => {
    if (!data || selectedRing === "ALL") return null;
    return data.suspicious_accounts.filter((a) => a.ring_id === selectedRing).length;
  }, [data, selectedRing]);

  // IMPORTANT CHANGE:
  // suspicious table should NOT be filtered by selected ring (ring focus is for graph only).
  const filteredAccounts = useMemo(() => {
    if (!data) return [];
    const qq = q.trim().toLowerCase();

    let arr = data.suspicious_accounts.filter((a) => a.suspicion_score >= minScore);

    if (qq) {
      arr = arr.filter((a) => {
        const hay = [a.account_id, a.ring_id ?? "", ...(a.detected_patterns ?? []), String(a.suspicion_score)]
          .join(" ")
          .toLowerCase();
        return hay.includes(qq);
      });
    }

    arr = [...arr];
    arr.sort((a, b) => {
      if (sortKey === "score")
        return (b.suspicion_score - a.suspicion_score) || a.account_id.localeCompare(b.account_id);
      if (sortKey === "account") return a.account_id.localeCompare(b.account_id);
      return String(a.ring_id ?? "").localeCompare(String(b.ring_id ?? "")) || (b.suspicion_score - a.suspicion_score);
    });

    return arr;
  }, [data, q, minScore, sortKey]);

  // IMPORTANT CHANGE:
  // ring table should NOT be filtered by selected ring (selection just highlights & focuses graph).
  const filteredRings = useMemo(() => {
    if (!data) return [];
    const qq = q.trim().toLowerCase();
    let arr = data.fraud_rings;

    if (qq) {
      arr = arr.filter((r) => {
        const hay = [r.ring_id, r.pattern_type, String(r.risk_score), ...r.member_accounts].join(" ").toLowerCase();
        return hay.includes(qq);
      });
    }

    return [...arr].sort((a, b) => (b.risk_score - a.risk_score) || a.ring_id.localeCompare(b.ring_id));
  }, [data, q]);

  function runLayout(mode: LayoutMode) {
    const cy = cyRef.current as any;
    if (!cy) return;

    const layout =
      mode === "cose"
        ? { name: "cose", animate: false, fit: true, padding: 40 }
        : mode === "concentric"
        ? {
            name: "concentric",
            animate: false,
            fit: true,
            padding: 40,
            concentric: (n: any) => n.degree(),
            levelWidth: () => 1,
          }
        : { name: "breadthfirst", animate: false, fit: true, padding: 40, directed: true };

    cy.layout(layout).run();
    cy.fit(undefined, 30);
  }

  // Build Cytoscape once graph is loaded
  useEffect(() => {
    if (!graph || !graphDivRef.current || !data) return;

    // destroy any existing instance
    if (cyRef.current) {
      cyRef.current.destroy();
      cyRef.current = null;
    }

    // Enrich nodes: score + label controlled by focus
    const nodes = graph.nodes.map((n) => {
      const id = n?.data?.id;
      const s = suspiciousById.get(id);
      return {
        ...n,
        data: {
          ...n.data,
          score: s?.suspicion_score ?? 0,
          label: "",
        },
      };
    });

    const edges = graph.edges.map((e) => ({
      ...e,
      data: {
        ...e.data,
        tx_count: Number(e?.data?.tx_count ?? 1),
        total_amount: e?.data?.total_amount ?? undefined,
      },
    }));

    const cy = cytoscape({
      container: graphDivRef.current,
      elements: [...nodes, ...edges],
      layout: { name: "concentric", animate: false, fit: true, padding: 40, concentric: (n: any) => n.degree(), levelWidth: () => 1 } as any,
      style: [
        // NODES
        {
          selector: "node",
          style: {
            label: "data(label)",
            "font-size": 10,
            "text-opacity": 0.95,
            "text-outline-width": 2,
            "text-outline-opacity": 0.35,

            width: "mapData(score, 0, 100, 14, 44)",
            height: "mapData(score, 0, 100, 14, 44)",

            // score gradient: muted -> hot
            "background-color": "mapData(score, 0, 100, #6b7280, #ef4444)",
            "border-color": "mapData(score, 0, 100, #334155, #fb7185)",

            "border-width": 1,
            "background-opacity": 0.95,
          },
        },

        // EDGES
        {
          selector: "edge",
          style: {
            width: "mapData(tx_count, 1, 20, 0.8, 4.5)",
            "curve-style": "bezier",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.7,
            "line-opacity": 0.35,
            "line-color": "#94a3b8",
            "target-arrow-color": "#94a3b8",
          },
        },

        // DIM + FOCUS
        { selector: ".dim", style: { opacity: 0.08 } },

        { selector: ".ringNode", style: { "border-width": 5, "border-color": "#60a5fa" } },
        { selector: ".ringEdge", style: { width: 6, "line-opacity": 0.95, "line-color": "#60a5fa", "target-arrow-color": "#60a5fa", "arrow-scale": 1.0 } },

        { selector: ".suspicious", style: { "border-width": 4, "border-color": "#f59e0b" } },
      ] as any,
    });

    // Hover tooltip (node)
    cy.on("mouseover", "node", (evt: any) => {
      const n = evt.target;
      const id = n.id();
      const a = suspiciousById.get(id);
      const tip = a
        ? `${id}\nscore: ${a.suspicion_score}\nring: ${a.ring_id ?? "-"}\npatterns: ${(a.detected_patterns ?? []).join(", ")}`
        : id;
      (graphDivRef.current as any).title = tip;
    });

    // Hover tooltip (edge)
    cy.on("mouseover", "edge", (evt: any) => {
      const e = evt.target;
      const tip =
        `${e.source().id()} → ${e.target().id()}\n` +
        `tx_count: ${e.data("tx_count")}\n` +
        `total_amount: ${e.data("total_amount") ?? "-"}`;
      (graphDivRef.current as any).title = tip;
    });

    cyRef.current = cy;

    // Apply chosen layout mode (default concentric)
    runLayout(layoutMode);

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, data, suspiciousById]);

  // Apply focus/filter rules whenever selection or controls change
  useEffect(() => {
    const cy = cyRef.current as any;
    if (!cy || !data) return;

    cy.elements().removeClass("dim ringNode ringEdge suspicious");
    cy.nodes().forEach((n: any) => n.data("label", ""));

    // Suspicious outline
    for (const a of data.suspicious_accounts) {
      cy.getElementById(a.account_id).addClass("suspicious");
    }

    // Edge threshold
    cy.edges().forEach((e: any) => {
      const c = Number(e.data("tx_count") ?? 1);
      e.style("display", c >= minEdgeTxCount ? "element" : "none");
    });

    // Suspicious-only (graph)
    if (showSuspiciousOnly) {
      const suspiciousSet = new Set(data.suspicious_accounts.map((a) => a.account_id));
      cy.nodes().forEach((n: any) => n.style("display", suspiciousSet.has(n.id()) ? "element" : "none"));
    } else {
      cy.nodes().forEach((n: any) => n.style("display", "element"));
    }

    if (selectedRing === "ALL") {
      if (showOnlyFocused) {
        const suspiciousSet = new Set(data.suspicious_accounts.map((a) => a.account_id));
        cy.nodes().forEach((n: any) => {
          if (!suspiciousSet.has(n.id())) n.addClass("dim");
        });
        cy.edges().forEach((e: any) => e.addClass("dim"));
      }
      cy.fit(undefined, 30);
      return;
    }

    const ring = data.fraud_rings.find((r) => r.ring_id === selectedRing);
    if (!ring) return;

    const memberSet = new Set(ring.member_accounts);

    const ringNodes = cy.nodes().filter((n: any) => memberSet.has(n.id()));
    const ringEdges = cy.edges().filter((e: any) => memberSet.has(e.source().id()) && memberSet.has(e.target().id()));

    // Label only focused ring nodes
    ringNodes.forEach((n: any) => n.data("label", n.id()));

    if (showOnlyFocused) {
      cy.elements().not(ringNodes).not(ringEdges).addClass("dim");
    }

    ringNodes.addClass("ringNode");
    ringEdges.addClass("ringEdge");

    cy.fit(ringNodes.union(ringEdges), 40);
  }, [selectedRing, data, showOnlyFocused, showSuspiciousOnly, minEdgeTxCount]);

  // Re-run layout when dropdown changes
  useEffect(() => {
    if (!cyRef.current) return;
    runLayout(layoutMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutMode]);

  if (!data) {
    return (
      <main style={styles.shell}>
        <div style={styles.container}>
          <div style={styles.headerRow}>
            <div>
              <div style={styles.h1}>Results</div>
              <div style={styles.sub}>No analysis found. Go back to upload a CSV.</div>
            </div>
            <a href="/" style={{ ...styles.primaryBtn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Back to upload
            </a>
          </div>
        </div>
      </main>
    );
  }

  const kpis = [
    { label: "Accounts analyzed", value: data.summary.total_accounts_analyzed },
    { label: "Suspicious accounts", value: data.summary.suspicious_accounts_flagged },
    { label: "Fraud rings", value: data.summary.fraud_rings_detected },
    { label: "Processing time (s)", value: data.summary.processing_time_seconds },
  ];

  return (
    <main style={styles.shell}>
      <div style={styles.container}>
        <div style={styles.headerRow}>
          <div>
            <div style={styles.h1}>Forensics Dashboard</div>
            <div style={styles.sub}>Risk is encoded visually: bigger + redder nodes = higher suspicion. Blue = focused ring.</div>
          </div>

          <div style={styles.headerActions}>
            <button style={styles.ghostBtn} onClick={() => downloadText("results.json", jsonText)} title="Download JSON (submission-ready)">
              Download JSON
            </button>
            <a href="/" style={{ ...styles.primaryBtn, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              New upload
            </a>
          </div>
        </div>

        <section style={styles.kpiGrid}>
          {kpis.map((k) => (
            <div key={k.label} style={styles.kpiCard}>
              <div style={styles.kpiLabel}>{k.label}</div>
              <div style={styles.kpiValue}>{k.value}</div>
            </div>
          ))}
        </section>

        <section style={styles.controlsCard}>
          <div style={styles.controlsRow}>
            <div style={{ flex: 1 }}>
              <div style={styles.controlLabel}>Search</div>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Account, ring ID, pattern…" style={styles.input} />
            </div>

            <div style={{ width: 260 }}>
              <div style={styles.controlLabel}>Ring focus</div>
              <select value={selectedRing} onChange={(e) => setSelectedRing(e.target.value as any)} style={styles.input} title="Focus one ring to make the graph readable">
                <option value="ALL">All rings</option>
                {data.fraud_rings
                  .slice()
                  .sort((a, b) => (b.risk_score - a.risk_score) || a.ring_id.localeCompare(b.ring_id))
                  .map((r) => (
                    <option key={r.ring_id} value={r.ring_id}>
                      {r.ring_id} • {r.pattern_type} • risk {r.risk_score}
                    </option>
                  ))}
              </select>
            </div>

            <div style={{ width: 200 }}>
              <div style={styles.controlLabel}>Min suspicion</div>
              <input type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} style={styles.input} />
            </div>

            <div style={{ width: 220 }}>
              <div style={styles.controlLabel}>Sort accounts</div>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} style={styles.input}>
                <option value="score">Score (desc)</option>
                <option value="account">Account (A→Z)</option>
                <option value="ring">Ring ID</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10, alignItems: "flex-end" }}>
            <label style={styles.checkbox} title="Dims everything outside the selected ring for clarity">
              <input type="checkbox" checked={showOnlyFocused} onChange={(e) => setShowOnlyFocused(e.target.checked)} />
              Focus view
            </label>

            <label style={styles.checkbox} title="Shows only suspicious nodes (removes normal nodes)">
              <input type="checkbox" checked={showSuspiciousOnly} onChange={(e) => setShowSuspiciousOnly(e.target.checked)} />
              Suspicious only
            </label>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }} title="Hide low-signal edges to reduce noise">
              <span style={{ opacity: 0.75, fontSize: 12.5 }}>Min edge tx_count</span>
              <input
                type="number"
                min={1}
                max={50}
                value={minEdgeTxCount}
                onChange={(e) => setMinEdgeTxCount(Number(e.target.value))}
                style={{ ...styles.input, width: 110 }}
              />
            </div>

            <div style={{ width: 240 }}>
              <div style={styles.controlLabel}>Layout</div>
              <select
                value={layoutMode}
                onChange={(e) => setLayoutMode(e.target.value as LayoutMode)}
                style={styles.input}
                title="Changes drawing only (visual). Does not affect fraud detection."
              >
                <option value="concentric">Hub view</option>
                <option value="cose">Auto (force)</option>
                <option value="breadthfirst">Flow view</option>
              </select>
            </div>

            <button
              style={styles.smallBtn}
              onClick={() => {
                setSelectedRing("ALL");
                setQ("");
                setMinScore(1);
                setSortKey("score");
                setShowOnlyFocused(true);
                setShowSuspiciousOnly(false);
                setMinEdgeTxCount(1);
                setLayoutMode("concentric");
              }}
            >
              Reset
            </button>
          </div>

          <div style={styles.controlsNote}>
            Legend: <b>Red + large</b> = high suspicion. <b>Amber outline</b> = suspicious. <b>Blue</b> = focused ring. Hover nodes/edges for evidence.
          </div>
        </section>

        <section style={styles.twoCol}>
          <div style={styles.bigCard}>
            <div style={styles.cardTop}>
              <div>
                <div style={styles.cardTitle}>Transaction Graph</div>
                <div style={styles.cardHint}>Hover nodes/edges to see evidence. Focus a ring to avoid clutter.</div>
              </div>

              <div style={styles.pillRow}>
                <div style={styles.pill}>
                  Focus: <b style={{ marginLeft: 6 }}>{selectedRing === "ALL" ? "All" : selectedRing}</b>
                </div>
              </div>
            </div>

            <div style={styles.detailBox}>
              {selectedRingObj ? (
                <>
                  <div style={{ fontWeight: 900 }}>
                    {selectedRingObj.ring_id} • {selectedRingObj.pattern_type} • risk {selectedRingObj.risk_score}
                  </div>
                  <div style={{ opacity: 0.75, marginTop: 6 }}>Members: {selectedRingObj.member_accounts.length}</div>
                  {focusedSuspiciousCount !== null && (
                    <div style={{ opacity: 0.72, marginTop: 6, fontSize: 12.5 }}>
                      Suspicious accounts in focused ring: <b>{focusedSuspiciousCount}</b>
                      {focusedSuspiciousCount === 0 ? " (likely suppressed as legitimate unless hard evidence exists)" : ""}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ opacity: 0.75 }}>Select a ring to see its structure and why it’s risky.</div>
              )}
            </div>

            <div style={styles.graphStage}>
              <div ref={graphDivRef} style={{ width: "100%", height: "100%" }} />
              {!graph && (
                <div style={styles.graphOverlay}>
                  <div style={styles.graphIcon}>⟠</div>
                  <div style={{ fontWeight: 900, fontSize: 14.5 }}>Loading graph…</div>
                </div>
              )}
            </div>
          </div>

          <div style={styles.stack}>
            <div style={styles.card}>
              <div style={styles.cardTop}>
                <div>
                  <div style={styles.cardTitle}>Fraud Rings</div>
                  <div style={styles.cardHint}>Click a ring to focus. Sorted by risk.</div>
                </div>
                <div style={styles.pill}>{filteredRings.length} rings</div>
              </div>

              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Ring</th>
                      <th style={styles.th}>Pattern</th>
                      <th style={styles.thRight}>Risk</th>
                      <th style={styles.th}>Members</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRings.map((r) => {
                      const active = selectedRing === r.ring_id;
                      return (
                        <tr
                          key={r.ring_id}
                          onClick={() => setSelectedRing(active ? "ALL" : r.ring_id)}
                          style={{
                            ...styles.tr,
                            background: active ? "rgba(96,165,250,0.10)" : "transparent",
                            cursor: "pointer",
                          }}
                        >
                          <td style={styles.tdMono}>{r.ring_id}</td>
                          <td style={styles.td}>{r.pattern_type}</td>
                          <td style={styles.tdRight}>{r.risk_score}</td>
                          <td style={styles.td} title={r.member_accounts.join(", ")}>
                            {r.member_accounts.length}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredRings.length === 0 && (
                      <tr>
                        <td style={styles.td} colSpan={4}>
                          No rings detected.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={styles.card}>
              <div style={styles.cardTop}>
                <div>
                  <div style={styles.cardTitle}>Suspicious Accounts</div>
                  <div style={styles.cardHint}>Top 200 shown. (This list does NOT change when you focus a ring.)</div>
                </div>
                <div style={styles.pill}>{filteredAccounts.length}</div>
              </div>

              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Account</th>
                      <th style={styles.thRight}>Score</th>
                      <th style={styles.th}>Ring</th>
                      <th style={styles.th}>Patterns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAccounts.slice(0, 200).map((a) => (
                      <tr
                        key={a.account_id}
                        style={{
                          ...styles.tr,
                          background: selectedRing !== "ALL" && a.ring_id === selectedRing ? "rgba(96,165,250,0.06)" : "transparent",
                        }}
                        title={selectedRing !== "ALL" && a.ring_id === selectedRing ? "In focused ring" : undefined}
                      >
                        <td style={styles.tdMono}>{a.account_id}</td>
                        <td style={styles.tdRight}>{a.suspicion_score}</td>
                        <td style={styles.tdMono}>{a.ring_id ?? "-"}</td>
                        <td style={styles.td} title={a.detected_patterns.join(", ")}>
                          {a.detected_patterns.slice(0, 2).join(", ")}
                          {a.detected_patterns.length > 2 ? ` (+${a.detected_patterns.length - 2})` : ""}
                        </td>
                      </tr>
                    ))}
                    {filteredAccounts.length === 0 && (
                      <tr>
                        <td style={styles.td} colSpan={4}>
                          No suspicious accounts detected.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer", opacity: 0.85 }}>Raw JSON</summary>
                <pre style={styles.pre}>{jsonText}</pre>
              </details>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: "100vh",
    padding: 24,
    background:
      "radial-gradient(1200px 600px at 20% 10%, rgba(96,165,250,0.16), transparent 60%)," +
      "radial-gradient(900px 500px at 85% 25%, rgba(168,85,247,0.12), transparent 55%)," +
      "linear-gradient(180deg, #0b0d12 0%, #07080c 60%, #05060a 100%)",
    color: "#e8ecf3",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
  },
  container: { maxWidth: 1250, margin: "0 auto" },

  headerRow: {
    position: "sticky",
    top: 0,
    zIndex: 5,
    padding: "10px 0 14px 0",
    marginBottom: 14,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: 14,
    backdropFilter: "blur(10px)",
    background: "linear-gradient(180deg, rgba(11,13,18,0.92), rgba(11,13,18,0.75))",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  },
  h1: { fontSize: 26, fontWeight: 900, letterSpacing: -0.5 },
  sub: { marginTop: 6, opacity: 0.75, lineHeight: 1.45, maxWidth: 760 },
  headerActions: { display: "flex", gap: 10, alignItems: "center" },

  primaryBtn: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(96,165,250,0.45)",
    background: "linear-gradient(180deg, rgba(96,165,250,0.95), rgba(96,165,250,0.7))",
    color: "#08101f",
    fontWeight: 900,
    cursor: "pointer",
  },
  ghostBtn: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "#e8ecf3",
    fontWeight: 800,
    cursor: "pointer",
  },

  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 12,
    marginBottom: 12,
  },
  kpiCard: {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: 14,
    boxShadow: "0 14px 60px rgba(0,0,0,0.35)",
  },
  kpiLabel: { opacity: 0.75, fontSize: 12.5 },
  kpiValue: { marginTop: 8, fontSize: 22, fontWeight: 900 },

  controlsCard: {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: 14,
    marginBottom: 12,
    boxShadow: "0 14px 60px rgba(0,0,0,0.35)",
  },
  controlsRow: { display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" },
  controlLabel: { opacity: 0.75, fontSize: 12.5, marginBottom: 6 },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.25)",
    color: "#e8ecf3",
    outline: "none",
  },
  controlsNote: { marginTop: 10, opacity: 0.65, fontSize: 12.5 },

  checkbox: {
    display: "inline-flex",
    gap: 8,
    alignItems: "center",
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    fontSize: 12.5,
    opacity: 0.95,
  },

  twoCol: { display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 12, alignItems: "start" },
  bigCard: {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: 14,
    boxShadow: "0 14px 60px rgba(0,0,0,0.35)",
  },
  stack: { display: "flex", flexDirection: "column", gap: 12 },

  card: {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: 14,
    boxShadow: "0 14px 60px rgba(0,0,0,0.35)",
  },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 },
  cardTitle: { fontSize: 14.5, fontWeight: 900, letterSpacing: 0.2 },
  cardHint: { marginTop: 6, opacity: 0.72, fontSize: 12.5, lineHeight: 1.4 },
  pillRow: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" },
  pill: {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    fontSize: 12.5,
    opacity: 0.95,
    whiteSpace: "nowrap",
  },
  smallBtn: {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "#e8ecf3",
    fontWeight: 800,
    cursor: "pointer",
  },

  detailBox: {
    marginTop: 8,
    marginBottom: 10,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(0,0,0,0.22)",
    padding: 12,
  },

  graphStage: {
    height: 560,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background:
      "radial-gradient(900px 400px at 40% 30%, rgba(96,165,250,0.10), transparent 60%), rgba(0,0,0,0.22)",
    overflow: "hidden",
    position: "relative",
  },
  graphOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    textAlign: "center",
    pointerEvents: "none",
  },
  graphIcon: { fontSize: 28, opacity: 0.9, marginBottom: 10 },

  tableWrap: {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(0,0,0,0.22)",
    overflow: "auto",
    maxHeight: 320,
  },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12.8 },
  th: {
    textAlign: "left",
    padding: "10px 10px",
    position: "sticky",
    top: 0,
    background: "rgba(11,13,18,0.9)",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  thRight: {
    textAlign: "right",
    padding: "10px 10px",
    position: "sticky",
    top: 0,
    background: "rgba(11,13,18,0.9)",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  tr: { borderBottom: "1px solid rgba(255,255,255,0.06)" },
  td: { padding: "10px 10px", opacity: 0.92 },
  tdRight: { padding: "10px 10px", textAlign: "right", opacity: 0.92 },
  tdMono: {
    padding: "10px 10px",
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    opacity: 0.95,
  },
  pre: {
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(0,0,0,0.25)",
    overflow: "auto",
    maxHeight: 420,
    fontSize: 12,
  },
};