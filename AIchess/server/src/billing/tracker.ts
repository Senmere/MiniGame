import { getDb } from '../db/index.js';

export interface CallLogInput {
  sessionId?: string;
  mode?: string;
  modelId: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  priceInput: number; // 元/千token
  priceOutput: number;
}

export function logCall(c: CallLogInput): void {
  const cost = ((c.inputTokens / 1000) * c.priceInput + (c.outputTokens / 1000) * c.priceOutput);
  getDb()
    .prepare(
      `INSERT INTO call_logs(session_id,mode,model_id,model_name,input_tokens,output_tokens,cost)
       VALUES(?,?,?,?,?,?,?)`,
    )
    .run(c.sessionId ?? null, c.mode ?? null, c.modelId, c.modelName, c.inputTokens, c.outputTokens, cost);
}

export interface DashboardRow {
  model_id: string;
  model_name: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

export function dashboard(): {
  byModel: DashboardRow[];
  totals: { calls: number; input_tokens: number; output_tokens: number; cost: number };
} {
  const byModel = getDb()
    .prepare(
      `SELECT model_id, model_name,
              COUNT(*) AS calls,
              COALESCE(SUM(input_tokens),0) AS input_tokens,
              COALESCE(SUM(output_tokens),0) AS output_tokens,
              COALESCE(SUM(cost),0) AS cost
       FROM call_logs
       GROUP BY model_id
       ORDER BY cost DESC`,
    )
    .all() as unknown as DashboardRow[];
  const totals = getDb()
    .prepare(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(input_tokens),0) AS input_tokens,
              COALESCE(SUM(output_tokens),0) AS output_tokens,
              COALESCE(SUM(cost),0) AS cost
       FROM call_logs`,
    )
    .get() as { calls: number; input_tokens: number; output_tokens: number; cost: number };
  return { byModel, totals };
}

export function sessionCost(sessionId: string): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(cost),0) AS cost FROM call_logs WHERE session_id = ?')
    .get(sessionId) as { cost: number };
  return row.cost;
}
