# Financial Forensics Graph Engine (Money Muling Detection)

A security-focused **graph analytics engine** that detects **money muling / laundering structures** in transaction networks using **graph theory + temporal signals + role-aware scoring**.

Built like a real detection system: **explainable detections**, **false-positive control**, and **deterministic outputs** (reproducible results).

---

## Why this matters (Security / Fraud / Threat Hunting)

Money muling is adversarial movement of funds through a network to obscure provenance—similar to attacker pivoting across infrastructure to hide origin. This project demonstrates practical detection engineering skills:
- Translating adversarial behavior into **graph + temporal** signals
- Building **explainable** detections (what triggered the flag)
- Designing for **precision** (trap resistance) instead of naive “high-degree = fraud”

---

## What it detects

### 1) Circular Fund Routing (Cycles)
Detects directed cycles of length **3–5** (A → B → C → A). All accounts in the cycle are flagged as a ring.

### 2) Smurfing (Fan-in + Fan-out + Temporal Window)
Detects:
- **Fan-in**: ≥10 unique senders → aggregator  
- **Fan-out**: aggregator → ≥10 unique receivers  
- **Temporal**: activity clustered within **72 hours**  
Evidence tags: `smurfing_fan_in`, `smurfing_fan_out`, `temporal_72h` (+ optional `cash_out`)

### 3) Layered Shell Networks (Multi-hop Chains)
Detects **3+ hop** chains where intermediate accounts have **2–3 total transactions** (low-activity shells), plus propagation constraints to reduce false positives.  
Evidence tags: `layered_shell_chain` + role tags (`source_funds`, `low_activity_shell`, `pre_cashout`, `cash_out`)

---

## Architecture

### High-Level Diagram (ASCII)

    +-------------------+        +-------------------------+
    |   User / Analyst  |        |        Web UI          |
    | (CSV Upload, UI)  +------->+  Next.js (App Router)  |
    +-------------------+        +-----------+------------+
                                            |
                                            | POST /api/analyze
                                            v
                               +------------+-------------+
                               |            API           |
                               |   Parse -> Graph ->      |
                               |   Detect -> Merge ->     |
                               |   Score -> Output        |
                               +------------+-------------+
                                            |
                                            v
                               +------------+-------------+
                               |   results.json download  |
                               | rings + suspicious accts |
                               +---------------------------+

### Pipeline (Data Flow)
1. **CSV ingestion** → strict schema validation & timestamp normalization  
2. **Graph construction** → adjacency + per-node/per-edge time-ordered transaction streams  
3. **Pattern detection** → cycles, smurfing (72h), layered shells (low-activity intermediates)  
4. **Ring consolidation** → dedup/merge near-duplicates deterministically  
5. **Explainability + scoring** → evidence tags + role-based suspicion scoring  
6. **Output** → ring list + suspicious accounts list + summary  

---

## Output (Investigator-Friendly)

### Fraud Rings
Each ring includes:
- `ring_id`
- `pattern_type` (`cycle` | `smurfing` | `layered_shell`)
- `member_accounts[]`
- `risk_score` (0–100)

### Suspicious Accounts
Each flagged account includes:
- `account_id`
- `suspicion_score` (0–100 float)
- `detected_patterns[]` (evidence tags)
- `ring_id`

---

## False Positive Control (Trap Resistance)

High-degree hubs can be legitimate (payroll, merchants, exchanges). This engine avoids naive flags by requiring:
- **Structure + time** (not only degree)
- **Role constraints** (low-activity intermediates for shell networks)
- **Propagation constraints** (time/amount adjacency in chains)

---

## How to Use
1. Open the app  
2. Upload a CSV with columns:  
   - `transaction_id`, `sender_id`, `receiver_id`, `amount`, `timestamp`  
3. Review:  
   - highlighted rings in the graph  
   - ring summary table  
   - suspicious accounts + evidence tags  
4. Download the JSON output  

---

## Security / Detection Engineering Highlights
- Graph-based anomaly detection & adversarial pattern reasoning  
- Temporal feature engineering (windowed bursts, propagation constraints)  
- Explainable detections for investigation workflows  
- Deterministic outputs for reproducibility and debugging  
- Precision-oriented design (trap-aware false positive suppression)  

---

## Known Limitations / Next Improvements
- Improve cashout inference to handle alternate cashout shapes (hub→cashout vs receiver→cashout)  
- Add regression tests comparing output JSON against labeled expected outputs  
- Add configurable thresholds (MIN_UNIQUE, window size, hop constraints) via ENV/UI  
