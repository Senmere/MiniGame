import type { FastifyInstance } from 'fastify';
import * as z from 'zod';
import {
  addModel,
  deleteModel,
  getModel,
  listModels,
  updateModel,
} from '../modelPool/store.js';
import { listGames } from '../games/registry.js';
import { dashboard } from '../billing/tracker.js';
import { getSetting, setSetting } from '../db/index.js';

const ModelSchema = z.object({
  label: z.string().min(1),
  base_url: z.string().min(1),
  model_name: z.string().min(1),
  api_key: z.string().min(1),
  price_input: z.number().default(0),
  price_output: z.number().default(0),
  enabled: z.boolean().default(true),
});

const SettingsSchema = z.object({
  watcherConfidenceRange: z
    .tuple([z.number(), z.number()])
    .optional(),
  watcherEvery: z.number().int().positive().optional(),
  moveDelayMs: z.number().int().nonnegative().optional(),
  chatThinkingDefault: z.boolean().optional(),
  chatTurnDelayMs: z.number().int().nonnegative().optional(),
});

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => ({ ok: true }));

  // ---- 模型池 ----
  app.get('/api/models', async () => listModels());

  app.post('/api/models', async (req, rep) => {
    const parsed = ModelSchema.safeParse(req.body);
    if (!parsed.success) return rep.code(400).send({ error: parsed.error.issues });
    return addModel(parsed.data);
  });

  app.put<{ Params: { id: string } }>('/api/models/:id', async (req, rep) => {
    const parsed = ModelSchema.partial().safeParse(req.body);
    if (!parsed.success) return rep.code(400).send({ error: parsed.error.issues });
    const m = updateModel(req.params.id, parsed.data);
    if (!m) return rep.code(404).send({ error: '未找到模型' });
    return m;
  });

  app.delete<{ Params: { id: string } }>('/api/models/:id', async (req) => ({
    deleted: deleteModel(req.params.id),
  }));

  // ---- 游戏列表 ----
  app.get('/api/games', async () => listGames());

  // ---- 全局设置 ----
  app.get('/api/settings', async () => {
    const raw = getSetting('runtime', '{}');
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  });

  app.post('/api/settings', async (req) => {
    const parsed = SettingsSchema.safeParse(req.body);
    const current = (() => {
      try {
        return JSON.parse(getSetting('runtime', '{}'));
      } catch {
        return {};
      }
    })();
    const next = parsed.success ? { ...current, ...parsed.data } : current;
    setSetting('runtime', JSON.stringify(next));
    return next;
  });

  // ---- 计费仪表盘 ----
  app.get('/api/dashboard', async () => dashboard());
}
