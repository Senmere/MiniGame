import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveSchemaPath(): string {
  const candidates = [
    join(__dirname, 'schema.sql'),                       // 打包后与 index.js 同目录（dist/db/）
    join(__dirname, '..', '..', 'src', 'db', 'schema.sql'), // tsc 只出 js，schema 仍在 src
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error('找不到 schema.sql，候选路径：' + candidates.join('; '));
}

let _db: DatabaseSync | null = null;

/**
 * 使用 Node 24 内置的 node:sqlite（DatabaseSync），API 与 better-sqlite3 几乎一致，
 * 但无需原生编译，规避本机无构建工具 + C 盘空间紧张的问题。
 * 启动需 --experimental-sqlite 标志（见 package.json start 脚本 / NODE_OPTIONS）。
 */
export function getDb(): DatabaseSync {
  if (_db) return _db;
  const dbPath = process.env.DB_PATH ?? join(process.cwd(), 'data', 'arena.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  _db = new DatabaseSync(dbPath);
  _db.exec('PRAGMA journal_mode = WAL;');
  const schema = readFileSync(resolveSchemaPath(), 'utf8');
  _db.exec(schema);
  return _db;
}

// ---- settings ----
export function getSetting(key: string, fallback = ''): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    )
    .run(key, value);
}
