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

export interface GameInfo {
  id: string;
  name: string;
  minSeats: number;
  maxSeats: number;
}

export interface DashboardRow {
  model_id: string;
  model_name: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost: number;
}

export interface Dashboard {
  byModel: DashboardRow[];
  totals: { calls: number; input_tokens: number; output_tokens: number; cost: number };
}

async function j<T>(res: Promise<Response>): Promise<T> {
  const r = await res;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

export const api = {
  listModels: () => j<ModelEntry[]>(fetch('/api/models')),
  addModel: (body: Partial<ModelEntry>) =>
    j<ModelEntry>(fetch('/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
  updateModel: (id: string, body: Partial<ModelEntry>) =>
    j<ModelEntry>(fetch(`/api/models/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
  deleteModel: (id: string) =>
    j<{ deleted: boolean }>(fetch(`/api/models/${id}`, { method: 'DELETE' })),
  listGames: () => j<GameInfo[]>(fetch('/api/games')),
  getSettings: () => j<Record<string, unknown>>(fetch('/api/settings')),
  saveSettings: (body: Record<string, unknown>) =>
    j<Record<string, unknown>>(fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
  dashboard: () => j<Dashboard>(fetch('/api/dashboard')),
};
