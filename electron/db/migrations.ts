import type { Database as SqliteDatabase } from 'better-sqlite3'

export type Migration = {
  version: number
  name: string
  up: (sqlite: SqliteDatabase) => void
}

function ensureSchemaVersionsTable(sqlite: SqliteDatabase) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)
}

function getAppliedVersions(sqlite: SqliteDatabase): Set<number> {
  const rows = sqlite.prepare('SELECT version FROM schema_versions').all() as Array<{ version: number }>
  return new Set(rows.map((row) => row.version))
}

function tableColumns(sqlite: SqliteDatabase, table: string): string[] {
  try {
    const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return rows.map((row) => row.name)
  } catch {
    return []
  }
}

function tableExists(sqlite: SqliteDatabase, table: string): boolean {
  const row = sqlite.prepare('SELECT name FROM sqlite_master WHERE type=? AND name=?').get('table', table) as { name?: string } | undefined
  return !!row?.name
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'apply_logs.forced_column',
    up: (sqlite) => {
      if (!tableExists(sqlite, 'apply_logs')) return
      const columns = tableColumns(sqlite, 'apply_logs')
      if (!columns.includes('forced')) {
        sqlite.exec(`ALTER TABLE apply_logs ADD COLUMN forced INTEGER NOT NULL DEFAULT 0`)
      }
    },
  },
  {
    version: 2,
    name: 'prompt_caches_indexes',
    up: (sqlite) => {
      if (!tableExists(sqlite, 'prompt_caches')) return
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_prompt_caches_role ON prompt_caches(role);
        CREATE INDEX IF NOT EXISTS idx_prompt_caches_updated ON prompt_caches(updated_at);
      `)
    },
  },
  {
    version: 3,
    name: 'model_providers.api_key_base64',
    up: (sqlite) => {
      if (!tableExists(sqlite, 'model_providers')) return
      sqlite.exec(`ALTER TABLE model_providers DROP COLUMN api_key`)
      sqlite.exec(`ALTER TABLE model_providers ADD COLUMN api_key TEXT NOT NULL DEFAULT ''`)
    },
  },
  {
    version: 4,
    name: 'books.writing_constraint',
    up: (sqlite) => {
      if (!tableExists(sqlite, 'books')) return
      const columns = tableColumns(sqlite, 'books')
      if (!columns.includes('writing_constraint')) {
        sqlite.exec(`ALTER TABLE books ADD COLUMN writing_constraint TEXT NOT NULL DEFAULT ''`)
      }
    },
  },
  {
    version: 5,
    name: 'model_providers.token_limits',
    up: (sqlite) => {
      if (!tableExists(sqlite, 'model_providers')) return
      const columns = tableColumns(sqlite, 'model_providers')
      if (!columns.includes('max_output_tokens')) {
        sqlite.exec(`ALTER TABLE model_providers ADD COLUMN max_output_tokens INTEGER`)
      }
      if (!columns.includes('max_input_tokens')) {
        sqlite.exec(`ALTER TABLE model_providers ADD COLUMN max_input_tokens INTEGER`)
      }
    },
  },
  {
    // 历史迁移 v3/v4/v5 曾更名重写，导致部分旧库虽然记录了版本号，
    // 但当前版本的列补充迁移被跳过，model_providers 缺少 token 上限与缓存命中价列，
    // 写入时 INSERT 报 "no column named max_output_tokens" → 添加模型失败。
    // 这里用新的版本号兜底补齐所有 model_providers 已知列（幂等）。
    version: 6,
    name: 'model_providers.ensure_columns',
    up: (sqlite) => {
      if (!tableExists(sqlite, 'model_providers')) return
      const columns = tableColumns(sqlite, 'model_providers')
      const specs: Array<{ name: string; ddl: string }> = [
        { name: 'cached_input_price', ddl: `ALTER TABLE model_providers ADD COLUMN cached_input_price REAL` },
        { name: 'max_output_tokens', ddl: `ALTER TABLE model_providers ADD COLUMN max_output_tokens INTEGER` },
        { name: 'max_input_tokens', ddl: `ALTER TABLE model_providers ADD COLUMN max_input_tokens INTEGER` },
      ]
      for (const spec of specs) {
        if (!columns.includes(spec.name)) {
          try { sqlite.exec(spec.ddl) } catch {}
        }
      }
    },
  },
  {
    // 文风指纹：从范本提取量化文风特征，写作时作为硬约束注入，写完做吻合度校验。
    // 一本书可建多个指纹，isDefault 标记当前激活的一个。
    version: 7,
    name: 'style_fingerprints.create',
    up: (sqlite) => {
      if (tableExists(sqlite, 'style_fingerprints')) return
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS style_fingerprints (
          id TEXT PRIMARY KEY,
          book_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          samples TEXT NOT NULL DEFAULT '[]',
          metrics TEXT NOT NULL DEFAULT '{}',
          summary TEXT NOT NULL DEFAULT '',
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_style_fingerprints_book ON style_fingerprints(book_id);
      `)
    },
  },
  {
    version: 8,
    name: 'model_providers.add_sampling_params',
    up: (sqlite) => {
      // 无表守卫：全新库时 model_providers 还不存在（initTables 在其后运行），
      // 缺守卫会在首次启动就抛错，导致本版本及后续迁移（v9~v11）全部中断、永不执行，
      // 新装的库于是缺采样参数列，添加/编辑模型直接报 "no column named temperature"。
      if (!tableExists(sqlite, 'model_providers')) return
      const cols = tableColumns(sqlite, 'model_providers')
      if (!cols.includes('temperature')) {
        sqlite.exec('ALTER TABLE model_providers ADD COLUMN temperature REAL')
      }
      if (!cols.includes('top_p')) {
        sqlite.exec('ALTER TABLE model_providers ADD COLUMN top_p REAL')
      }
    },
  },
  {
    version: 9,
    name: 'model_providers.add_penalty_and_peak_pricing',
    up: (sqlite) => {
      if (!tableExists(sqlite, 'model_providers')) return
      const cols = tableColumns(sqlite, 'model_providers')
      if (!cols.includes('frequency_penalty')) {
        sqlite.exec('ALTER TABLE model_providers ADD COLUMN frequency_penalty REAL')
      }
      if (!cols.includes('presence_penalty')) {
        sqlite.exec('ALTER TABLE model_providers ADD COLUMN presence_penalty REAL')
      }
      if (!cols.includes('peak_input_price')) {
        sqlite.exec('ALTER TABLE model_providers ADD COLUMN peak_input_price REAL')
      }
      if (!cols.includes('peak_output_price')) {
        sqlite.exec('ALTER TABLE model_providers ADD COLUMN peak_output_price REAL')
      }
      if (!cols.includes('peak_days')) {
        sqlite.exec('ALTER TABLE model_providers ADD COLUMN peak_days TEXT')
      }
    },
  },
  {
    version: 10,
    name: 'model_providers.add_billing_rules',
    up: (sqlite) => {
      if (!tableExists(sqlite, 'model_providers')) return
      const cols = tableColumns(sqlite, 'model_providers')
      if (!cols.includes('billing_rules')) {
        sqlite.exec('ALTER TABLE model_providers ADD COLUMN billing_rules TEXT')
      }
    },
  },
  {
    version: 11,
    name: 'model_providers.add_merge_system_messages',
    up: (sqlite) => {
      if (!tableExists(sqlite, 'model_providers')) return
      const cols = tableColumns(sqlite, 'model_providers')
      if (!cols.includes('merge_system_messages')) {
        sqlite.exec('ALTER TABLE model_providers ADD COLUMN merge_system_messages INTEGER NOT NULL DEFAULT 0')
      }
    },
  },
]

export function runMigrations(sqlite: SqliteDatabase) {
  ensureSchemaVersionsTable(sqlite)
  const applied = getAppliedVersions(sqlite)
  const insertStmt = sqlite.prepare('INSERT INTO schema_versions (version, name, applied_at) VALUES (?, ?, ?)')
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue
    try {
      const runInTx = sqlite.transaction(() => {
        migration.up(sqlite)
        insertStmt.run(migration.version, migration.name, new Date().toISOString())
      })
      runInTx()
    } catch (err) {
      throw err
    }
  }
}

export function currentSchemaVersion(sqlite: SqliteDatabase): number {
  ensureSchemaVersionsTable(sqlite)
  const row = sqlite.prepare('SELECT MAX(version) as version FROM schema_versions').get() as { version: number | null } | undefined
  return row?.version ?? 0
}
