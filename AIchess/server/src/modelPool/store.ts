import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';

export interface ModelEntry {
  id: string;
  label: string;
  base_url: string;
  model_name: string;
  api_key: string;
  price_input: number;
  price_output: number;
  enabled: boolean;
  created_at: string;
}

export interface ModelInput {
  label: string;
  base_url: string;
  model_name: string;
  api_key: string;
  price_input?: number;
  price_output?: number;
  enabled?: boolean;
}

interface Row {
  id: string;
  label: string;
  base_url: string;
  model_name: string;
  api_key: string;
  price_input: number;
  price_output: number;
  enabled: number;
  created_at: string;
}

const rowToEntry = (r: Row): ModelEntry => ({
  ...r,
  enabled: !!r.enabled,
});

export function listModels(): ModelEntry[] {
  const rows = getDb()
    .prepare('SELECT * FROM models ORDER BY created_at DESC')
    .all() as unknown as Row[];
  return rows.map(rowToEntry);
}

export function getModel(id: string): ModelEntry | null {
  const row = getDb().prepare('SELECT * FROM models WHERE id = ?').get(id) as Row | undefined;
  return row ? rowToEntry(row) : null;
}

export function addModel(input: ModelInput): ModelEntry {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO models(id,label,base_url,model_name,api_key,price_input,price_output,enabled)
       VALUES(?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      input.label,
      input.base_url,
      input.model_name,
      input.api_key,
      input.price_input ?? 0,
      input.price_output ?? 0,
      input.enabled === false ? 0 : 1,
    );
  return getModel(id)!;
}

export function updateModel(id: string, input: Partial<ModelInput>): ModelEntry | null {
  const cur = getModel(id);
  if (!cur) return null;
  const next = { ...cur, ...input, enabled: input.enabled === undefined ? cur.enabled : input.enabled };
  getDb()
    .prepare(
      `UPDATE models SET label=?, base_url=?, model_name=?, api_key=?, price_input=?, price_output=?, enabled=? WHERE id=?`,
    )
    .run(
      next.label,
      next.base_url,
      next.model_name,
      next.api_key,
      next.price_input,
      next.price_output,
      next.enabled ? 1 : 0,
      id,
    );
  return getModel(id);
}

export function deleteModel(id: string): boolean {
  const r = getDb().prepare('DELETE FROM models WHERE id = ?').run(id);
  return r.changes > 0;
}
