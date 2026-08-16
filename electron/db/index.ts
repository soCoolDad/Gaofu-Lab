import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { copyFile, unlink } from 'node:fs/promises'
import { app } from 'electron'
import { createRequire } from 'node:module'

// __filename polyfill 必须在 better-sqlite3 加载前执行
// ESM 中 import 会提升，所以用 createRequire 动态加载
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
globalThis.__filename = __filename

const require = createRequire(import.meta.url)

// 动态加载 better-sqlite3（避免 ESM import 提升问题）
const Database = require('better-sqlite3')
type SqliteDatabase = any
import { drizzle } from 'drizzle-orm/better-sqlite3'

import * as schema from './schema'
import { runMigrations } from './migrations'

// 在开发模式用固定路径，避免 app.getPath('userData') 的 Chromium 路径问题
const isDev = process.env.NODE_ENV !== 'production'
const DB_DIR = isDev
  ? path.join(process.cwd(), '.ainovel-data')
  : path.join(app.getPath('userData'), 'data')
const DB_PATH = path.join(DB_DIR, 'ainovel.db')

/** 获取数据库文件路径（供 IPC 导出等功能使用） */
export function getDbPath(): string {
  return DB_PATH
}

let db: ReturnType<typeof drizzle> | null = null
let sqliteDb: SqliteDatabase | null = null
let schemaReady = false

export function getDb() {
  if (db) {
    if (sqliteDb && !schemaReady) {
      ensureLatestSchema(sqliteDb)
      initTables(sqliteDb)
      schemaReady = true
    }
    return db
  }
  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true })
  }

  const sqlite = new Database(DB_PATH)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  sqliteDb = sqlite
  db = drizzle(sqlite, { schema })

  // 初始化表
  ensureLatestSchema(sqlite)
  initTables(sqlite)
  schemaReady = true

  return db
}

export function getSqlite(): SqliteDatabase {
  if (!sqliteDb) {
    getDb()
  }
  if (!sqliteDb) throw new Error('SQLite 尚未初始化')
  return sqliteDb
}

function initTables(sqlite: SqliteDatabase) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      detail TEXT NOT NULL DEFAULT '',
      cover TEXT,
      writing_style TEXT NOT NULL DEFAULT '',
      writing_pov TEXT NOT NULL DEFAULT '',
      writing_word_count_target TEXT NOT NULL DEFAULT '',
      writing_taboo TEXT NOT NULL DEFAULT '',
      writing_constraint TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS volumes (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      outline TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      volume_id TEXT REFERENCES volumes(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      summary TEXT,
      outline TEXT,
      content TEXT NOT NULL DEFAULT '',
      word_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS book_setting_entries (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outlines (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'book',
      target_id TEXT,
      content TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS world_lines (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'custom',
      parent_id TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS model_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'custom',
      api_key TEXT NOT NULL DEFAULT '',
      base_url TEXT,
      model_name TEXT NOT NULL DEFAULT '',
      input_price REAL,
      output_price REAL,
      cached_input_price REAL,
      max_output_tokens INTEGER,
      max_input_tokens INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS token_usage_logs (
      id TEXT PRIMARY KEY,
      book_id TEXT REFERENCES books(id) ON DELETE SET NULL,
      chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
      volume_id TEXT REFERENCES volumes(id) ON DELETE SET NULL,
      model_id TEXT REFERENCES model_providers(id) ON DELETE SET NULL,
      action TEXT NOT NULL DEFAULT 'chat',
      context_type TEXT NOT NULL DEFAULT 'chat',
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cached_prompt_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      calls INTEGER NOT NULL DEFAULT 1,
      book_title TEXT,
      request_text TEXT,
      system_request_text TEXT,
      user_request_text TEXT,
      response_text TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS context_caches (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      cache_type TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      token_estimate INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(book_id, cache_type)
    );

    CREATE TABLE IF NOT EXISTS prompt_caches (
      id TEXT PRIMARY KEY,
      cache_key TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT '',
      tier TEXT NOT NULL DEFAULT 'fixed',
      book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
      prompt_hash TEXT NOT NULL,
      token_estimate INTEGER NOT NULL DEFAULT 0,
      hit_count INTEGER NOT NULL DEFAULT 0,
      last_hit_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS apply_logs (
      id TEXT PRIMARY KEY,
      book_id TEXT REFERENCES books(id) ON DELETE SET NULL,
      plan_id TEXT,
      step_id TEXT,
      employee_type TEXT,
      result_type TEXT NOT NULL DEFAULT '',
      apply_mode TEXT NOT NULL DEFAULT 'none',
      target_summary TEXT,
      review_status TEXT,
      review_high INTEGER NOT NULL DEFAULT 0,
      review_warn INTEGER NOT NULL DEFAULT 0,
      review_info INTEGER NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL DEFAULT 'success',
      forced INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_chat_messages (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL DEFAULT 'global',
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      raw_content TEXT,
      display_content TEXT,
      usage TEXT,
      structured_data TEXT,
      context_type TEXT,
      chapter_id TEXT,
      volume_id TEXT,
      can_apply INTEGER NOT NULL DEFAULT 0,
      context_snapshot TEXT,
      cache_usage TEXT,
      generated_result TEXT,
      delete_plan TEXT,
      agent_plan TEXT,
      agent_progress TEXT,
      actual_context_resources TEXT,
      context_groups TEXT,
      awaiting_plan_confirmation INTEGER NOT NULL DEFAULT 0,
      plan_step_results TEXT,
      plan_request TEXT,
      stopped INTEGER NOT NULL DEFAULT 0,
      resume_after_apply INTEGER NOT NULL DEFAULT 0,
      auto_resumed INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chapter_snapshots (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      volume_id TEXT REFERENCES volumes(id) ON DELETE SET NULL,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      chapter_order INTEGER NOT NULL DEFAULT 0,
      story_time TEXT,
      snapshot_data TEXT NOT NULL DEFAULT '',
      is_valid INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS book_memory (
      book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
      data TEXT NOT NULL DEFAULT '',
      updated_through_chapter_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS book_memory_versions (
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      chapter_order INTEGER NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (book_id, chapter_order)
    );

    CREATE TABLE IF NOT EXISTS timeline_clips (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      clip_type TEXT NOT NULL DEFAULT 'character',
      entity_id TEXT NOT NULL,
      entity_name TEXT NOT NULL DEFAULT '',
      paragraph_start INTEGER NOT NULL DEFAULT 0,
      paragraph_end INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      snapshot_id TEXT REFERENCES chapter_snapshots(id) ON DELETE SET NULL,
      prev_clip_id TEXT REFERENCES timeline_clips(id),
      next_clip_id TEXT REFERENCES timeline_clips(id),
      storyline_group TEXT NOT NULL DEFAULT 'main',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_settings (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_dialogue_rooms (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      situation TEXT NOT NULL DEFAULT '',
      chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
      default_model_id TEXT REFERENCES model_providers(id) ON DELETE SET NULL,
      inject_writing_settings INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_dialogue_runs (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES role_dialogue_rooms(id) ON DELETE CASCADE,
      run_number INTEGER NOT NULL DEFAULT 1,
      character_ids_snapshot TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'idle',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_dialogue_snippets (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES role_dialogue_runs(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL DEFAULT 1,
      character_ids TEXT NOT NULL DEFAULT '[]',
      messages TEXT NOT NULL DEFAULT '[]',
      versions TEXT NOT NULL DEFAULT '[]',
      regenerate_count INTEGER NOT NULL DEFAULT 0,
      author_fact_update TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_dialogue_character_models (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      character_id TEXT NOT NULL REFERENCES book_setting_entries(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL REFERENCES model_providers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(book_id, character_id)
    );

    CREATE TABLE IF NOT EXISTS chat_room_rooms (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      default_model_id TEXT REFERENCES model_providers(id) ON DELETE SET NULL,
      speaking_mode TEXT NOT NULL DEFAULT 'sequential',
      history_limit INTEGER NOT NULL DEFAULT 50,
      display_limit INTEGER NOT NULL DEFAULT 15,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_room_participants (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES chat_room_rooms(id) ON DELETE CASCADE,
      character_id TEXT NOT NULL,
      character_name TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_room_messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES chat_room_rooms(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL DEFAULT 1,
      role TEXT NOT NULL DEFAULT 'director',
      character_id TEXT,
      character_name TEXT,
      content TEXT NOT NULL DEFAULT '',
      model_id TEXT,
      model_messages TEXT,
      usage TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_room_character_models (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      character_id TEXT NOT NULL,
      model_id TEXT NOT NULL REFERENCES model_providers(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(book_id, character_id)
    );

    CREATE INDEX IF NOT EXISTS idx_chapter_snapshots_chapter ON chapter_snapshots(book_id, chapter_id);
    CREATE INDEX IF NOT EXISTS idx_chapter_snapshots_order ON chapter_snapshots(book_id, chapter_order);
    CREATE INDEX IF NOT EXISTS idx_book_memory_versions_order ON book_memory_versions(book_id, chapter_order);
    CREATE INDEX IF NOT EXISTS idx_timeline_clips_chapter ON timeline_clips(book_id, chapter_id);
    CREATE INDEX IF NOT EXISTS idx_timeline_clips_entity ON timeline_clips(book_id, clip_type, entity_id);

    CREATE INDEX IF NOT EXISTS idx_context_caches_book_type ON context_caches(book_id, cache_type);
    CREATE INDEX IF NOT EXISTS idx_book_setting_entries_book_type ON book_setting_entries(book_id, type);
    CREATE INDEX IF NOT EXISTS idx_apply_logs_book_created ON apply_logs(book_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_apply_logs_plan ON apply_logs(plan_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_caches_role ON prompt_caches(role);
    CREATE INDEX IF NOT EXISTS idx_prompt_caches_updated ON prompt_caches(updated_at);
    CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_book ON ai_chat_messages(book_id, sort_order);

    CREATE INDEX IF NOT EXISTS idx_role_dialogue_rooms_book ON role_dialogue_rooms(book_id);
    CREATE INDEX IF NOT EXISTS idx_role_dialogue_runs_room ON role_dialogue_runs(room_id, run_number);
    CREATE INDEX IF NOT EXISTS idx_role_dialogue_snippets_run ON role_dialogue_snippets(run_id, "order");
    CREATE INDEX IF NOT EXISTS idx_role_dialogue_character_models_book ON role_dialogue_character_models(book_id, character_id);

    CREATE INDEX IF NOT EXISTS idx_chat_room_rooms_book ON chat_room_rooms(book_id);
    CREATE INDEX IF NOT EXISTS idx_chat_room_participants_room ON chat_room_participants(room_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_chat_room_messages_room ON chat_room_messages(room_id, "order");
    CREATE INDEX IF NOT EXISTS idx_chat_room_character_models_book ON chat_room_character_models(book_id, character_id);
  `)
}

function tableColumns(sqlite: SqliteDatabase, table: string): string[] {
  try {
    const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[]
    return rows.map((row) => row.name)
  } catch {
    return []
  }
}

function dropTables(sqlite: SqliteDatabase, tableNames: string[]) {
  sqlite.exec('PRAGMA foreign_keys = OFF')
  for (const table of tableNames) {
    sqlite.exec(`DROP TABLE IF EXISTS ${table}`)
  }
  sqlite.exec('PRAGMA foreign_keys = ON')
}

function bookSchemaMatches(sqlite: SqliteDatabase) {
  const columns = tableColumns(sqlite, 'books')
  if (columns.length === 0) return true
  // 遗留字段：employee_assignments / assigned_employee_id 出现则重建 books 表
  return columns.includes('detail') && !columns.includes('assigned_employee_id') && !columns.includes('employee_assignments')
}

function tokenLogSchemaMatches(sqlite: SqliteDatabase) {
  const columns = tableColumns(sqlite, 'token_usage_logs')
  if (columns.length === 0) return true
  return columns.includes('system_request_text')
    && columns.includes('user_request_text')
    && columns.includes('reasoning_tokens')
}

function ensureLatestSchema(sqlite: SqliteDatabase) {
  if (!bookSchemaMatches(sqlite)) {
    resetBookTables(sqlite)
    return
  }
  if (!tokenLogSchemaMatches(sqlite)) {
    dropTables(sqlite, ['token_usage_logs'])
  }
  try { sqlite.exec('DROP TABLE IF EXISTS employee_agents') } catch {}
  // token_usage_logs：如存在旧的 employee_id 列，重建以彻底清除
  const tokenColumns = tableColumns(sqlite, 'token_usage_logs')
  if (tokenColumns.includes('employee_id')) {
    dropTables(sqlite, ['token_usage_logs'])
  }
  // books 表补列（正文写作设置字段）：existing DB 没有这些字段时补齐
  try {
    ensureBooksWritingColumns(sqlite)
  } catch {
  }
  // ai_chat_messages 补列：自动续跑机制新增的两个字段
  try {
    ensureAiChatMessagesColumns(sqlite)
  } catch {
  }
  // token_usage_logs 补列：book_title 书名快照（旧库无此列时补齐，绝不重建表以免丢失历史消耗记录）
  try {
    ensureTokenLogColumns(sqlite)
  } catch {
  }
  try {
    runMigrations(sqlite)
  } catch {
    ensureApplyLogsColumns(sqlite)
  }
  // 聊天室补列：发言方式 / 调用模型上下文（旧库无这些列时补齐）
  try {
    ensureChatRoomColumns(sqlite)
  } catch {
  }
  // 剧情预演"总结片段"补列：kind / summaryView / summaryViewCharacterId / summaryCoveredSnippetIds
  try {
    ensureRoleDialogueSummaryColumns(sqlite)
  } catch {
  }
}

// 为 books 表补齐"正文写作设置"字段（旧库无这些列时执行）
function ensureBooksWritingColumns(sqlite: SqliteDatabase) {
  const columns = tableColumns(sqlite, 'books')
  if (columns.length === 0) return
  const specs: Array<{ name: string; ddl: string }> = [
    { name: 'writing_style', ddl: `ALTER TABLE books ADD COLUMN writing_style TEXT NOT NULL DEFAULT ''` },
    { name: 'writing_pov', ddl: `ALTER TABLE books ADD COLUMN writing_pov TEXT NOT NULL DEFAULT ''` },
    { name: 'writing_word_count_target', ddl: `ALTER TABLE books ADD COLUMN writing_word_count_target TEXT NOT NULL DEFAULT ''` },
    { name: 'writing_taboo', ddl: `ALTER TABLE books ADD COLUMN writing_taboo TEXT NOT NULL DEFAULT ''` },
    { name: 'writing_constraint', ddl: `ALTER TABLE books ADD COLUMN writing_constraint TEXT NOT NULL DEFAULT ''` },
  ]
  for (const spec of specs) {
    if (!columns.includes(spec.name)) {
      try { sqlite.exec(spec.ddl) } catch {}
    }
  }
}

function ensureApplyLogsColumns(sqlite: SqliteDatabase) {
  const columns = tableColumns(sqlite, 'apply_logs')
  if (columns.length === 0) return
  if (!columns.includes('forced')) {
    try {
      sqlite.exec(`ALTER TABLE apply_logs ADD COLUMN forced INTEGER NOT NULL DEFAULT 0`)
    } catch {}
  }
}

// 为 ai_chat_messages 补齐"自动续跑机制"新增的字段（旧库无这些列时执行）
function ensureAiChatMessagesColumns(sqlite: SqliteDatabase) {
  const columns = tableColumns(sqlite, 'ai_chat_messages')
  if (columns.length === 0) return
  const specs: Array<{ name: string; ddl: string }> = [
    { name: 'resume_after_apply', ddl: `ALTER TABLE ai_chat_messages ADD COLUMN resume_after_apply INTEGER NOT NULL DEFAULT 0` },
    { name: 'auto_resumed', ddl: `ALTER TABLE ai_chat_messages ADD COLUMN auto_resumed INTEGER NOT NULL DEFAULT 0` },
  ]
  for (const spec of specs) {
    if (!columns.includes(spec.name)) {
      try { sqlite.exec(spec.ddl) } catch {}
    }
  }
}

// token_usage_logs 补列：book_title 书名快照。旧库无此列时 ALTER 补齐，绝不重建表（否则丢失历史消耗记录）。
function ensureTokenLogColumns(sqlite: SqliteDatabase) {
  const columns = tableColumns(sqlite, 'token_usage_logs')
  if (columns.length === 0) return
  if (!columns.includes('book_title')) {
    try { sqlite.exec(`ALTER TABLE token_usage_logs ADD COLUMN book_title TEXT`) } catch {}
  }
  // 模型调用次数：旧库无此列时 ALTER 补齐，NOT NULL DEFAULT 1 会回填历史记录（每次运行计 1 次）
  if (!columns.includes('calls')) {
    try { sqlite.exec(`ALTER TABLE token_usage_logs ADD COLUMN calls INTEGER NOT NULL DEFAULT 1`) } catch {}
  }
}

// 聊天室补列：speaking_mode（发言方式）/ model_messages（调用模型的 messages 上下文）
function ensureChatRoomColumns(sqlite: SqliteDatabase) {
  const roomsCols = tableColumns(sqlite, 'chat_room_rooms')
  if (roomsCols.length > 0 && !roomsCols.includes('speaking_mode')) {
    try { sqlite.exec(`ALTER TABLE chat_room_rooms ADD COLUMN speaking_mode TEXT NOT NULL DEFAULT 'sequential'`) } catch {}
  }
  if (roomsCols.length > 0 && !roomsCols.includes('history_limit')) {
    try { sqlite.exec(`ALTER TABLE chat_room_rooms ADD COLUMN history_limit INTEGER NOT NULL DEFAULT 50`) } catch {}
  }
  if (roomsCols.length > 0 && !roomsCols.includes('display_limit')) {
    try { sqlite.exec(`ALTER TABLE chat_room_rooms ADD COLUMN display_limit INTEGER NOT NULL DEFAULT 15`) } catch {}
  }
  const msgCols = tableColumns(sqlite, 'chat_room_messages')
  if (msgCols.length > 0 && !msgCols.includes('model_messages')) {
    try { sqlite.exec(`ALTER TABLE chat_room_messages ADD COLUMN model_messages TEXT`) } catch {}
  }
  if (msgCols.length > 0 && !msgCols.includes('usage')) {
    try { sqlite.exec(`ALTER TABLE chat_room_messages ADD COLUMN usage TEXT`) } catch {}
  }
  // 结果提示独立列：与 role-dialogue 的 errorNotice 字段对齐，
  // 让已生成内容 + 错误信息同时保留（之前错误路径直接覆盖 content 导致部分产出被吞掉）。
  if (msgCols.length > 0 && !msgCols.includes('error_notice')) {
    try { sqlite.exec(`ALTER TABLE chat_room_messages ADD COLUMN error_notice TEXT`) } catch {}
  }
  // 推理模型的"思考过程"完整文本：让"用户能看模型思考"功能在刷新页面后仍可看。
  if (msgCols.length > 0 && !msgCols.includes('reasoning')) {
    try { sqlite.exec(`ALTER TABLE chat_room_messages ADD COLUMN reasoning TEXT`) } catch {}
  }
}

// 剧情预演"总结片段"补列：旧库无这些列时 ALTER 补齐
function ensureRoleDialogueSummaryColumns(sqlite: SqliteDatabase) {
  const cols = tableColumns(sqlite, 'role_dialogue_snippets')
  if (cols.length === 0) return
  const specs: Array<{ name: string; ddl: string }> = [
    { name: 'kind', ddl: `ALTER TABLE role_dialogue_snippets ADD COLUMN kind TEXT NOT NULL DEFAULT 'snippet'` },
    { name: 'summary_view', ddl: `ALTER TABLE role_dialogue_snippets ADD COLUMN summary_view TEXT` },
    { name: 'summary_view_character_id', ddl: `ALTER TABLE role_dialogue_snippets ADD COLUMN summary_view_character_id TEXT` },
    { name: 'summary_covered_snippet_ids', ddl: `ALTER TABLE role_dialogue_snippets ADD COLUMN summary_covered_snippet_ids TEXT NOT NULL DEFAULT '[]'` },
  ]
  for (const spec of specs) {
    if (!cols.includes(spec.name)) {
      try { sqlite.exec(spec.ddl) } catch {}
    }
  }
}

function resetBookTables(sqlite: SqliteDatabase) {
  // 顺序：子表在前，父表在后（虽然外键已 OFF，但保持顺序一致性）
  dropTables(sqlite, [
    'ai_chat_messages',
    'context_caches',
    'prompt_caches',
    'apply_logs',
    'token_usage_logs',
    'tags',
    'world_lines',
    'outlines',
    'timeline_clips',
    'chapter_snapshots',
    'book_memory_versions',
    'book_memory',
    'book_setting_entries',
    'chapters',
    'volumes',
    'role_dialogue_character_models',
    'role_dialogue_snippets',
    'role_dialogue_runs',
    'role_dialogue_rooms',
    'chat_room_character_models',
    'chat_room_messages',
    'chat_room_participants',
    'chat_room_rooms',
    'books',
  ])
}

function resetAllTables(sqlite: SqliteDatabase) {
  dropTables(sqlite, [
    'ai_chat_messages',
    'context_caches',
    'prompt_caches',
    'apply_logs',
    'token_usage_logs',
    'tags',
    'world_lines',
    'outlines',
    'timeline_clips',
    'chapter_snapshots',
    'book_memory_versions',
    'book_memory',
    'book_setting_entries',
    'chapters',
    'volumes',
    'role_dialogue_character_models',
    'role_dialogue_snippets',
    'role_dialogue_runs',
    'role_dialogue_rooms',
    'chat_room_character_models',
    'chat_room_messages',
    'chat_room_participants',
    'chat_room_rooms',
    'books',
    'model_providers',
  ])
}

function requireSqliteDb() {
  getDb()
  if (!sqliteDb) throw new Error('数据库未初始化')
  return sqliteDb
}

export function resetBooksDatabase() {
  const sqlite = requireSqliteDb()
  resetBookTables(sqlite)
  initTables(sqlite)
  schemaReady = true
}

export function resetAllDatabase() {
  const sqlite = requireSqliteDb()
  resetAllTables(sqlite)
  initTables(sqlite)
  schemaReady = true
}

/** 关闭当前数据库连接并重置单例（用于整库导入前释放文件句柄） */
export function closeDb() {
  try { sqliteDb?.close() } catch {}
  sqliteDb = null
  db = null
  schemaReady = false
}

/**
 * 从外部 .db 文件导入整库：校验有效性 → 刷盘 WAL → 关闭当前连接 → 覆写当前库文件。
 * 导入后需重启应用以重新加载单例并运行表迁移。
 */
export async function importDatabase(srcPath: string): Promise<{ success: boolean; reason?: string }> {
  try {
    // 1. 校验是有效的稿府 Lab 数据库（含 books 表）
    const probe = new Database(srcPath, { readonly: true, fileMustExist: true })
    try { probe.pragma('wal_checkpoint(TRUNCATE)') } catch {}
    const hasBooks = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='books'").get()
    probe.close()
    if (!hasBooks) return { success: false, reason: 'invalid_db' }

    // 2. 关闭当前连接（释放文件句柄，便于覆写）
    closeDb()

    // 3. 清理当前库可能残留的 WAL / SHM 文件
    for (const suffix of ['', '-wal', '-shm']) {
      try { await unlink(DB_PATH + suffix) } catch {}
    }

    // 4. 覆写当前库文件
    await copyFile(srcPath, DB_PATH)
    return { success: true }
  } catch (e) {
    return { success: false, reason: String(e) }
  }
}


