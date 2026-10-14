import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'blog.db');
const SCHEMA_PATH = path.join(process.cwd(), 'src', 'lib', 'schema.sql');

export type Db = DatabaseSync;

declare global {
  // eslint-disable-next-line no-var
  var __blogDb: DatabaseSync | undefined;
}

export function initSchema(db: DatabaseSync): void {
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

/** 建连接。用 Node 内置 node:sqlite，无需任何原生编译。 */
export function openDb(): DatabaseSync {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/** 开发环境复用同一个连接，避免热更新反复打开文件 */
export function getDb(): DatabaseSync {
  if (!globalThis.__blogDb) {
    const db = openDb();
    initSchema(db);
    globalThis.__blogDb = db;
  }
  return globalThis.__blogDb;
}

/** 事务包装：node:sqlite 没有内置 transaction helper，这里补一个最小实现 */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export const dbPath = DB_PATH;
