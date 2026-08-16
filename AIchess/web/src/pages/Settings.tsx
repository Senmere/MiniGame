import { useEffect, useState } from 'react';
import { api, type ModelEntry } from '../api/client.js';

const EMPTY: Partial<ModelEntry> = {
  label: '',
  base_url: 'https://api.deepseek.com/v1',
  model_name: '',
  api_key: '',
  price_input: 0,
  price_output: 0,
  enabled: true,
};

export default function Settings() {
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [form, setForm] = useState<Partial<ModelEntry>>(EMPTY);
  const [err, setErr] = useState('');
  const [settings, setSettings] = useState<Record<string, unknown>>({});

  const load = () => {
    api.listModels().then(setModels).catch((e) => setErr(e.message));
    api.getSettings().then(setSettings).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setErr('');
    try {
      await api.addModel(form);
      setForm(EMPTY);
      load();
    } catch (e) { setErr((e as Error).message); }
  };

  const remove = async (id: string) => {
    await api.deleteModel(id); load();
  };

  const toggleEnabled = async (m: ModelEntry) => {
    await api.updateModel(m.id, { enabled: !m.enabled }); load();
  };

  const saveSettings = async () => {
    const wcr = settings.watcherConfidenceRange as [number, number] | undefined;
    await api.saveSettings({
      watcherConfidenceRange: wcr,
      watcherEvery: Number(settings.watcherEvery ?? 1),
      moveDelayMs: Number(settings.moveDelayMs ?? 800),
      chatThinkingDefault: Boolean(settings.chatThinkingDefault),
      chatTurnDelayMs: Number(settings.chatTurnDelayMs ?? 900),
    });
    load();
  };

  return (
    <div>
      <h1>模型池与全局设置</h1>
      <p className="sub">添加多组 API Key + 模型，形成可配置模型池。设置永久保存，启动时按需抽样分配座位。</p>

      <div className="grid2">
        <div className="card">
          <h2>添加模型</h2>
          <div className="col">
            <div className="row">
              <label style={{ flex: 1 }}>可读名称
                <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="DeepSeek-主号" />
              </label>
              <label style={{ flex: 1.4 }}>Base URL (OpenAI 兼容)
                <input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
              </label>
            </div>
            <div className="row">
              <label style={{ flex: 1 }}>模型名
                <input value={form.model_name} onChange={(e) => setForm({ ...form, model_name: e.target.value })} placeholder="deepseek-chat" />
              </label>
              <label style={{ flex: 1.4 }}>API Key
                <input value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} placeholder="sk-..." />
              </label>
            </div>
            <div className="row">
              <label>输入价(元/千Token)
                <input type="number" step="0.0001" value={form.price_input} onChange={(e) => setForm({ ...form, price_input: Number(e.target.value) })} />
              </label>
              <label>输出价(元/千Token)
                <input type="number" step="0.0001" value={form.price_output} onChange={(e) => setForm({ ...form, price_output: Number(e.target.value) })} />
              </label>
              <button onClick={save}>添加到模型池</button>
            </div>
            {err && <div className="small" style={{ color: 'var(--red)' }}>{err}</div>}
          </div>
        </div>

        <div className="card">
          <h2>运行时参数</h2>
          <div className="col">
            <label>观战 AI 置信度范围 (a,b) · 默认干扰区间 [-0.2,-0.1]
              <input
                value={((settings.watcherConfidenceRange as [number, number] | undefined) ?? [-0.2, -0.1]).join(',')}
                onChange={(e) => setSettings({ ...settings, watcherConfidenceRange: e.target.value.split(',').map(Number) })}
              />
            </label>
            <label>每几步触发观战评论
              <input type="number" value={Number(settings.watcherEvery ?? 2)} onChange={(e) => setSettings({ ...settings, watcherEvery: Number(e.target.value) })} />
            </label>
            <label>走子间隔(ms) · AvA 竞技场
              <input type="number" value={Number(settings.moveDelayMs ?? 400)} onChange={(e) => setSettings({ ...settings, moveDelayMs: Number(e.target.value) })} />
            </label>
            <label>对话室默认发言间隔(ms) · AI Chat
              <input type="number" value={Number(settings.chatTurnDelayMs ?? 900)} onChange={(e) => setSettings({ ...settings, chatTurnDelayMs: Number(e.target.value) })} />
            </label>
            <label className="row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="checkbox"
                checked={Boolean(settings.chatThinkingDefault)}
                onChange={(e) => setSettings({ ...settings, chatThinkingDefault: e.target.checked })}
              />
              <span>对话室默认开启思考模式（需模型支持，如 deepseek-reasoner / v4）</span>
            </label>
            <button className="ghost" onClick={saveSettings}>保存设置</button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>当前模型池 ({models.length})</h2>
        {models.length === 0 ? (
          <p className="muted">模型池为空。添加至少一个模型即可开始对局（AvA 至少需要 2 个不重复模型，不足时自动有放回抽样）。</p>
        ) : (
          <table>
            <thead>
              <tr><th>名称</th><th>Base URL</th><th>模型</th><th>输入价</th><th>输出价</th><th>状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id}>
                  <td>{m.label}</td>
                  <td className="small muted">{m.base_url}</td>
                  <td><span className="badge">{m.model_name}</span></td>
                  <td>{m.price_input}</td>
                  <td>{m.price_output}</td>
                  <td>
                    <span className="tag" style={{ color: m.enabled ? 'var(--green)' : 'var(--muted)' }}>
                      {m.enabled ? '启用' : '停用'}
                    </span>
                  </td>
                  <td>
                    <button className="ghost" onClick={() => toggleEnabled(m)}>{m.enabled ? '停用' : '启用'}</button>{' '}
                    <button className="danger" onClick={() => remove(m.id)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
