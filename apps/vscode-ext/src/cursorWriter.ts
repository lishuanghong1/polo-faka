import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface ParsedToken {
  email: string;
  accessToken: string;
}

/** 找 Cursor 的 globalStorage 目录 */
function getCursorConfigDir(): string | null {
  const platform = os.platform();
  let base: string;
  if (platform === 'win32') {
    base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'Cursor', 'User', 'globalStorage');
  } else if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage');
  } else {
    return path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage');
  }
}

function getStateDbPath(): string | null {
  const dir = getCursorConfigDir();
  return dir ? path.join(dir, 'state.vscdb') : null;
}

function getStorageJsonPath(): string | null {
  const dir = getCursorConfigDir();
  return dir ? path.join(dir, 'storage.json') : null;
}

/** 写 state.vscdb（SQLite） */
function writeStateDb(dbPath: string, email: string, token: string): void {
  // better-sqlite3 是原生模块，require 动态加载避免打包问题
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS ItemTable (key TEXT PRIMARY KEY, value BLOB NOT NULL)`);
  const upsert = db.prepare(`INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?, ?)`);
  const entries: [string, string][] = [
    ['cursorAuth/cachedSignUpType', 'Auth_0'],
    ['cursorAuth/cachedEmail', email],
    ['cursorAuth/accessToken', token],
    ['cursorAuth/refreshToken', token],
    ['cursor.email', email],
    ['cursor.accessToken', token],
  ];
  const run = db.transaction(() => {
    for (const [k, v] of entries) upsert.run(k, v);
  });
  run();
  db.close();
}

/** 写 storage.json */
function writeStorageJson(jsonPath: string, email: string, token: string): void {
  let root: Record<string, unknown> = {};
  if (fs.existsSync(jsonPath)) {
    try { root = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { /* ignore */ }
  } else {
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  }
  Object.assign(root, {
    'cursorAuth.cachedSignUpType': 'Auth_0',
    'cursorAuth.cachedEmail': email,
    'cursorAuth.accessToken': token,
    'cursorAuth.refreshToken': token,
    'cursor.email': email,
    'cursor.accessToken': token,
  });
  const tmp = jsonPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(root, null, 2), 'utf8');
  if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
  fs.renameSync(tmp, jsonPath);
}

/** 主入口：把账号写入 Cursor 本地配置 */
export function writeAccountToCursor(parsed: ParsedToken): void {
  const dbPath = getStateDbPath();
  const jsonPath = getStorageJsonPath();

  if (!dbPath || !jsonPath) {
    throw new Error('无法定位 Cursor 配置目录');
  }

  if (fs.existsSync(dbPath)) {
    writeStateDb(dbPath, parsed.email, parsed.accessToken);
  }
  writeStorageJson(jsonPath, parsed.email, parsed.accessToken);
}
