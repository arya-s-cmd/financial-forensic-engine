export type PatternType = string;

export type FraudRing = {
  ring_id: string;
  pattern_type: PatternType; // allow merged labels e.g. "hub_fan_in_out"
  member_accounts: string[];
  risk_score: number; // 0..100
};

export type SuspiciousAccount = {
  account_id: string;
  suspicion_score: number; // 0..100
  ring_id: string | null;
  detected_patterns: string[];
};

export type OutputSummary = {
  total_accounts_analyzed: number;
  suspicious_accounts_flagged: number;
  fraud_rings_detected: number;
  processing_time_seconds: number;
};

export type OutputJSON = {
  summary: OutputSummary;
  fraud_rings: FraudRing[];
  suspicious_accounts: SuspiciousAccount[];
};