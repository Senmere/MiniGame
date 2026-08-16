import { listModels, type ModelEntry } from './store.js';

export interface SampledSeat {
  seatIndex: number;        // 座位序号
  model: ModelEntry;        // 绑定的模型
}

/**
 * 从全局模型池抽取 N 个模型分配到座位。
 *  - 池总数 >= N: 无放回抽样，同局各 AI 模型互不重复
 *  - 池总数 <  N: 有放回抽样（允许重复），保证对局可启动
 */
export function sampleSeats(n: number): SampledSeat[] {
  const pool = listModels().filter((m) => m.enabled);
  if (pool.length === 0) throw new Error('模型池为空，请先在设置中添加可用模型');

  const seats: SampledSeat[] = [];
  if (pool.length >= n) {
    // 无放回抽样：Fisher-Yates
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (let i = 0; i < n; i++) seats.push({ seatIndex: i, model: shuffled[i] });
  } else {
    // 有放回抽样
    for (let i = 0; i < n; i++) {
      const model = pool[Math.floor(Math.random() * pool.length)];
      seats.push({ seatIndex: i, model });
    }
  }
  return seats;
}

export function pickWatcherModels(count: number): ModelEntry[] {
  const pool = listModels().filter((m) => m.enabled);
  if (pool.length === 0) return [];
  const out: ModelEntry[] = [];
  for (let i = 0; i < count; i++) {
    out.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return out;
}
