-- 全局设置 / 模型池 / 计费记录

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,              -- 用户可读名称，如 "DeepSeek-主号"
  base_url TEXT NOT NULL,           -- OpenAI 兼容端点，如 https://api.deepseek.com/v1
  model_name TEXT NOT NULL,         -- 模型标识，如 deepseek-chat
  api_key TEXT NOT NULL,            -- API Key
  price_input REAL DEFAULT 0,       -- 每千 token 输入单价（元）
  price_output REAL DEFAULT 0,     -- 每千 token 输出单价（元）
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT DEFAULT (datetime('now','localtime')),
  session_id TEXT,                  -- 所属对局/房间
  mode TEXT,                        -- ava | chat | watcher | pva
  model_id TEXT,
  model_name TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost REAL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_call_logs_model ON call_logs(model_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_ts ON call_logs(ts);
