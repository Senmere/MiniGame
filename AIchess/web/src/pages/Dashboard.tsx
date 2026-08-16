import { useEffect, useState } from 'react';
import { api, type Dashboard as Dash } from '../api/client.js';

export default function Dashboard() {
  const [data, setData] = useState<Dash | null>(null);
  const [err, setErr] = useState('');

  const load = () => api.dashboard().then(setData).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <h1>烧钱监控仪表盘</h1>
      <p className="sub">实时统计各模型调用次数、token 消耗与预估费用</p>

      {err && <div className="card" style={{ color: 'var(--red)' }}>加载失败: {err}</div>}

      <div className="stats">
        <div className="stat">
          <div className="v">{data?.totals.calls ?? 0}</div>
          <div className="k">总调用次数</div>
        </div>
        <div className="stat">
          <div className="v">{((data?.totals.input_tokens ?? 0) + (data?.totals.output_tokens ?? 0)).toLocaleString()}</div>
          <div className="k">总 Token</div>
        </div>
        <div className="stat">
          <div className="v">{(data?.totals.cost ?? 0).toFixed(4)}</div>
          <div className="k">预估费用(元)</div>
        </div>
        <div className="stat">
          <div className="v">{data?.byModel.length ?? 0}</div>
          <div className="k">使用中模型数</div>
        </div>
      </div>

      <div className="card">
        <h2>按模型明细</h2>
        {data && data.byModel.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>模型</th>
                <th>调用次数</th>
                <th>输入 Token</th>
                <th>输出 Token</th>
                <th>费用(元)</th>
              </tr>
            </thead>
            <tbody>
              {data.byModel.map((r) => (
                <tr key={r.model_id}>
                  <td>{r.model_name}</td>
                  <td>{r.calls}</td>
                  <td>{r.input_tokens.toLocaleString()}</td>
                  <td>{r.output_tokens.toLocaleString()}</td>
                  <td>{r.cost.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">暂无调用记录。前往「AvA 竞技场」或「AI 对话室」开始一场对局吧。</p>
        )}
      </div>
    </div>
  );
}
