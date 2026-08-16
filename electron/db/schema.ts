import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

// ==================== 书籍 ====================
export const books = sqliteTable('books', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  detail: text('detail').notNull().default(''),
  cover: text('cover'),
  // 正文写作设置：由"正文写作设置"面板维护，同时作为写手上下文的"书籍信息"扩展
  writingStyle: text('writing_style').notNull().default(''),
  writingPov: text('writing_pov').notNull().default(''),
  writingWordCountTarget: text('writing_word_count_target').notNull().default(''),
  writingTaboo: text('writing_taboo').notNull().default(''),
  writingConstraint: text('writing_constraint').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ==================== 分卷 ====================
export const volumes = sqliteTable('volumes', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  outline: text('outline'),
  sortOrder: integer('sort_order').notNull().default(0),
})

// ==================== 章节 ====================
export const chapters = sqliteTable('chapters', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  volumeId: text('volume_id').references(() => volumes.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  summary: text('summary'),
  outline: text('outline'),
  content: text('content').notNull().default(''),
  wordCount: integer('word_count').notNull().default(0),
  status: text('status').notNull().default('draft'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ==================== 通用作品设定 ====================
export const bookSettingEntries = sqliteTable('book_setting_entries', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  detail: text('detail').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ==================== 大纲 ====================
export const outlines = sqliteTable('outlines', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  type: text('type').notNull().default('book'),
  targetId: text('target_id'),
  content: text('content').notNull().default(''),
  updatedAt: text('updated_at').notNull(),
})

// ==================== 世界线 ====================
export const worldLines = sqliteTable('world_lines', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  color: text('color'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ==================== 标签 ====================
export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  bookId: text('book_id').references(() => books.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull().default('custom'),
  parentId: text('parent_id'),
  sortOrder: integer('sort_order').notNull().default(0),
})

// ==================== AI 员工 ====================
// employee_agents 表已移除；所有分析师配置（systemPrompt / outputRules / temperature）均为硬编码。

// ==================== 模型配置 ====================
export const modelProviders = sqliteTable('model_providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  provider: text('provider').notNull().default('custom'),
  apiKey: text('api_key').notNull().default(''),
  baseUrl: text('base_url'),
  modelName: text('model_name').notNull().default(''),
  inputPrice: real('input_price'),
  outputPrice: real('output_price'),
  cachedInputPrice: real('cached_input_price'),
  /** 输出 Token 上限（对应 API 的 max_tokens）。null = 使用后端默认 16384。防止长 JSON（如章节正文）被 provider 默认上限截断。 */
  maxOutputTokens: integer('max_output_tokens'),
  /** 输入上下文 Token 软上限。发送给模型的上下文总 token 估算超过此值时，自动丢弃最早的聊天历史（防超模型上下文窗口）。0/null = 不限制。 */
  maxContextTokens: integer('max_input_tokens'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ==================== Token 使用日志 ====================
export const tokenUsageLogs = sqliteTable('token_usage_logs', {
  id: text('id').primaryKey(),
  bookId: text('book_id').references(() => books.id, { onDelete: 'set null' }),
  chapterId: text('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  volumeId: text('volume_id').references(() => volumes.id, { onDelete: 'set null' }),
  modelId: text('model_id').references(() => modelProviders.id, { onDelete: 'set null' }),
  action: text('action').notNull().default('chat'),
  contextType: text('context_type').notNull().default('chat'),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  cachedPromptTokens: integer('cached_prompt_tokens').notNull().default(0),
  reasoningTokens: integer('reasoning_tokens').notNull().default(0),
  cost: real('cost').notNull().default(0),
  // 模型调用次数：一次运行（聊天/写作）通常含多轮模型请求（意图分析 + 主循环各轮 + 工具内部子调用）
  calls: integer('calls').notNull().default(1),
  // 书名快照：写入时保存，删除书籍后 book_id 会被置 NULL，但书名保留，便于前端区分"作品已删除"
  bookTitle: text('book_title'),
  requestText: text('request_text'),
  systemRequestText: text('system_request_text'),
  userRequestText: text('user_request_text'),
  responseText: text('response_text'),
  createdAt: text('created_at').notNull(),
})

// ==================== 上下文原文缓存 ====================
export const contextCaches = sqliteTable('context_caches', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  cacheType: text('cache_type').notNull(),
  sourceHash: text('source_hash').notNull(),
  content: text('content').notNull().default(''),
  tokenEstimate: integer('token_estimate').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ==================== Prompt 缓存 ====================
export const promptCaches = sqliteTable('prompt_caches', {
  id: text('id').primaryKey(),
  cacheKey: text('cache_key').notNull().unique(),
  role: text('role').notNull().default(''),
  tier: text('tier').notNull().default('fixed'),
  bookId: text('book_id').references(() => books.id, { onDelete: 'cascade' }),
  promptHash: text('prompt_hash').notNull(),
  tokenEstimate: integer('token_estimate').notNull().default(0),
  hitCount: integer('hit_count').notNull().default(0),
  lastHitAt: text('last_hit_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ==================== AI 聊天消息 ====================
export const aiChatMessages = sqliteTable('ai_chat_messages', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull().default('global'),
  role: text('role').notNull(),
  content: text('content').notNull().default(''),
  rawContent: text('raw_content'),
  displayContent: text('display_content'),
  usage: text('usage'),
  structuredData: text('structured_data'),
  contextType: text('context_type'),
  chapterId: text('chapter_id'),
  volumeId: text('volume_id'),
  canApply: integer('can_apply').notNull().default(0),
  contextSnapshot: text('context_snapshot'),
  cacheUsage: text('cache_usage'),
  generatedResult: text('generated_result'),
  deletePlan: text('delete_plan'),
  agentPlan: text('agent_plan'),
  agentProgress: text('agent_progress'),
  actualContextResources: text('actual_context_resources'),
  contextGroups: text('context_groups'),
  awaitingPlanConfirmation: integer('awaiting_plan_confirmation').notNull().default(0),
  planStepResults: text('plan_step_results'),
  planRequest: text('plan_request'),
  stopped: integer('stopped').notNull().default(0),
  // 自动续跑机制：
  // - resumeAfterApply=1 表示该 AI 消息里模型调用了 mark_resume_after_apply，
  //   用户把本消息所有 PendingWrite 都应用完毕后，前端会自动发送"已应用结果，请继续。"
  // - autoResumed=1 表示该 user 消息是由前端"自动续跑"机制发出的，非用户手动输入。
  resumeAfterApply: integer('resume_after_apply').notNull().default(0),
  autoResumed: integer('auto_resumed').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
})

// ==================== AI（「知卷」）设置 ====================
// 单例行：id 固定为 'default'，data 为 AiSettingsValues 的 JSON 序列化。
// 这些设置此前存于渲染进程 localStorage，现统一收归 SQLite，便于随数据库整体导出/迁移。
export const aiSettings = sqliteTable('ai_settings', {
  id: text('id').primaryKey(),
  data: text('data').notNull().default('{}'),
  updatedAt: text('updated_at').notNull(),
})

// ==================== 应用日志 ====================
export const applyLogs = sqliteTable('apply_logs', {
  id: text('id').primaryKey(),
  bookId: text('book_id').references(() => books.id, { onDelete: 'set null' }),
  planId: text('plan_id'),
  stepId: text('step_id'),
  employeeType: text('employee_type'),
  resultType: text('result_type').notNull().default(''),
  applyMode: text('apply_mode').notNull().default('none'),
  targetSummary: text('target_summary'),
  reviewStatus: text('review_status'),
  reviewHigh: integer('review_high').notNull().default(0),
  reviewWarn: integer('review_warn').notNull().default(0),
  reviewInfo: integer('review_info').notNull().default(0),
  outcome: text('outcome').notNull().default('success'),
  forced: integer('forced', { mode: 'boolean' }).notNull().default(false),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
})

// ==================== 章节快照 ====================
export const chapterSnapshots = sqliteTable('chapter_snapshots', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  volumeId: text('volume_id').references(() => volumes.id, { onDelete: 'set null' }),
  chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  chapterOrder: integer('chapter_order').notNull().default(0),
  storyTime: text('story_time'),
  snapshotData: text('snapshot_data').notNull().default(''),
  isValid: integer('is_valid', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ==================== 书籍总记忆 ====================
// 每本书一行，存"全书聚合记忆"（角色 currentState + 各种 trace + 剧情/伏笔/灵感）。
// 单章记忆写入 chapter_snapshots.snapshotData 后，由 memory/merger.ts 纯代码增量合并到这里。
export const bookMemory = sqliteTable('book_memory', {
  bookId: text('book_id').primaryKey().references(() => books.id, { onDelete: 'cascade' }),
  data: text('data').notNull().default(''),
  updatedThroughChapterOrder: integer('updated_through_chapter_order').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
})

// ==================== 书籍总记忆 · 版本化快照 ====================
// 每生成一章记忆就存一行"合并后总记忆完整快照"（key = bookId+chapterOrder）。
// 当删除某章及其后续章节的记忆时，只需读 chapterOrder < 删除起点 的最新一行 → O(1) 回滚，
// 无需从第 1 章重放合并——支持"几百章级别的书"依然瞬时回退。
export const bookMemoryVersions = sqliteTable('book_memory_versions', {
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  chapterOrder: integer('chapter_order').notNull(),
  data: text('data').notNull(),
  createdAt: text('created_at').notNull(),
})

// ==================== 时间线片段 ====================
export const timelineClips = sqliteTable('timeline_clips', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  chapterId: text('chapter_id').notNull().references(() => chapters.id, { onDelete: 'cascade' }),
  clipType: text('clip_type').notNull().default('character'),
  entityId: text('entity_id').notNull(),
  entityName: text('entity_name').notNull().default(''),
  paragraphStart: integer('paragraph_start').notNull().default(0),
  paragraphEnd: integer('paragraph_end').notNull().default(0),
  status: text('status').notNull().default('active'),
  snapshotId: text('snapshot_id').references(() => chapterSnapshots.id, { onDelete: 'set null' }),
  prevClipId: text('prev_clip_id'),
  nextClipId: text('next_clip_id'),
  storylineGroup: text('storyline_group').notNull().default('main'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ==================== 剧情预演 ====================
// 一个房间 = 一组"开局模板"（角色列表 + 情境 + 章节锚点 + 写作设置勾选 + 默认 model）。
// 一个房间可以跑出多个 Run；每个 Run 是一条独立的预演时间线（互不覆盖、可对比）。
// 一个 Run = 一组有序的"片段"（snippet）；片段是预演的最小单位。
export const roleDialogueRooms = sqliteTable('role_dialogue_rooms', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  /** 开局情境（导演说戏） */
  situation: text('situation').notNull().default(''),
  /** 关联的章节 id（可选；提供后预演上下文会包含该章节的大纲 / 已写正文 / 记忆） */
  chapterId: text('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
  /** 房间默认 model id（兜底层；优先级低于"角色 model"） */
  defaultModelId: text('default_model_id').references(() => modelProviders.id, { onDelete: 'set null' }),
  /** 是否注入写作设置（POV / 文风 / 禁忌等） */
  injectWritingSettings: integer('inject_writing_settings', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const roleDialogueRuns = sqliteTable('role_dialogue_runs', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => roleDialogueRooms.id, { onDelete: 'cascade' }),
  /** Run 在房间内的序号（1-based） */
  runNumber: integer('run_number').notNull().default(1),
  /** "角色顺序 × 轮次"快照：开始 Run 时把当时房间选定的角色顺序固化下来 */
  characterIdsSnapshot: text('character_ids_snapshot').notNull().default('[]'),
  status: text('status').notNull().default('idle'),
  createdAt: text('created_at').notNull(),
})

/**
 * 片段（Snippet）—— 预演的最小单位。
 * 一个片段 = 一次"按角色顺序自动生成"的结果，对应聊天流里的一条消息记录。
 * 重跑时旧内容进入 versions[]，新内容覆盖 messages。
 */
export const roleDialogueSnippets = sqliteTable('role_dialogue_snippets', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => roleDialogueRuns.id, { onDelete: 'cascade' }),
  /** 在 Run 内的顺序（1-based） */
  order: integer('order').notNull().default(1),
  /** 本片段参与的角色 id 列表（按生成顺序）；summary 类型时存被覆盖的原片段参与角色去重结果 */
  characterIds: text('character_ids').notNull().default('[]'),
  /**
   * 当前内容：每条发言含 characterId / publicContent（剧情正文）
   * 形如：[{ characterId, characterName, publicContent, innerThought: '', modelId }, ...]
   * 注意：innerThought 字段保留以保持向后兼容，新生成的消息该字段永远为空字符串（剧情预演已不再产出内心独白）。
   *
   * summary 类型时：messages 仅含 1 条，该条 publicContent = 总结后的完整剧情，characterName = 视角名。
   */
  messages: text('messages').notNull().default('[]'),
  /**
   * 历史版本：每次重跑时把旧 messages 数组 push 进来。
   * 形如：[{ messages, regeneratedAt }, ...]
   * UI 上折叠显示，标注"已重跑"。
   */
  versions: text('versions').notNull().default('[]'),
  /** 被重跑的次数 */
  regenerateCount: integer('regenerate_count').notNull().default(0),
  /**
   * 本片段前作者插入的事实更新（仅作为下一个片段的"前置事实"使用，不进入公开聊天流）。
   * 形如：{ fact: string, insertedAt: string }
   */
  authorFactUpdate: text('author_fact_update'),
  /**
   * 片段类型：
   *   - 'snippet'（默认）：常规角色发言片段
   *   - 'summary'：剧情预演"总结片段"——把多轮对话压缩成一段完整剧情，作为新的上下文起点；
   *                之前的片段仍保留显示，但不再注入到后续模型的 context。
   */
  kind: text('kind').notNull().default('snippet'),
  /** summary 视角：'first-person'（选择某个角色第一人称） / 'third-person'（第三方旁白群像）；非 summary 为 null */
  summaryView: text('summary_view'),
  /** summary 第一人称视角所选角色 id；非 summary / 第三人称视角时为 null */
  summaryViewCharacterId: text('summary_view_character_id'),
  /** summary 覆盖的原 snippet id 列表（被覆盖的片段不再参与后续上下文注入）；非 summary 时存 '[]' */
  summaryCoveredSnippetIds: text('summary_covered_snippet_ids').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/**
 * 角色 model 偏好（每本书 × 角色 一行）：
 *   优先级最高；用于"该角色在所有预演中默认用此 model"。
 *   存空（删除）= 该角色使用房间默认 / 知卷默认。
 */
export const roleDialogueCharacterModels = sqliteTable('role_dialogue_character_models', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  /** 角色 id（bookSettingEntries.id） */
  characterId: text('character_id').notNull().references(() => bookSettingEntries.id, { onDelete: 'cascade' }),
  /** 指定的 model id */
  modelId: text('model_id').notNull().references(() => modelProviders.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// ==================== 角色聊天室 ====================
// 与「剧情预演」完全独立的新功能：一个房间 = 一组"在场角色"（可随时增删/拖拽排序）
// + 一段持续的群聊记录。用户发言后，在场角色按序接龙各回一句。
// 仅复用 model-caller / model_providers 这些"已写好的模型功能"，不复用 role_dialogue_* 任何数据。
export const chatRoomRooms = sqliteTable('chat_room_rooms', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  /** 房间默认 model id（兜底层；优先级低于"角色 model"） */
  defaultModelId: text('default_model_id').references(() => modelProviders.id, { onDelete: 'set null' }),
  /** 发言方式：sequential = 在场角色依次接龙；simultaneous = 在场角色同时各回一句 */
  speakingMode: text('speaking_mode').notNull().default('sequential'),
  /** 携带记录条数：注入模型上下文时最多携带的最近聊天条数（影响模型看到的对话长度/连贯性/成本） */
  historyLimit: integer('history_limit').notNull().default(50),
  /** 展示条数：聊天界面默认只渲染最近的 N 条消息（纯展示，不进入模型上下文） */
  displayLimit: integer('display_limit').notNull().default(15),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/** 在场角色（直播表：可随时增删 / 拖拽调整 sortOrder 即发言顺序） */
export const chatRoomParticipants = sqliteTable('chat_room_participants', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => chatRoomRooms.id, { onDelete: 'cascade' }),
  /** 角色 id（bookSettingEntries.id） */
  characterId: text('character_id').notNull(),
  /** 角色名（冗余存储，便于消息落库时不反查） */
  characterName: text('character_name').notNull().default(''),
  /** 发言顺序（1-based，越小越先说） */
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
})

/** 群聊记录（扁平日志：user / character / system） */
export const chatRoomMessages = sqliteTable('chat_room_messages', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull().references(() => chatRoomRooms.id, { onDelete: 'cascade' }),
  /** 在房间内的顺序（1-based） */
  order: integer('order').notNull().default(1),
  /** 'director' = 导演；'author' = 作者；'netizen' = 网友；'character' = 某个在场角色；'system' = 系统旁白 */
  role: text('role').notNull().default('director'),
  /** 角色消息时填（bookSettingEntries.id） */
  characterId: text('character_id'),
  /** 角色名（冗余存储） */
  characterName: text('character_name'),
  content: text('content').notNull().default(''),
  /**
   * 结果提示：模型被 content_filter / 各类中断拦截时，把已生成的内容（content）+ 错误信息（errorNotice）同时保留。
   * 与 content 独立：
   *   - content：保留已生成的剧情 / 台词正文
   *   - errorNotice：错误信息单独存，让 UI 能在气泡下方独立渲染红色提示块
   * 不进 chat-room context-builder 的"历史对话"注入（避免错误消息污染后续角色 prompt）。
   */
  errorNotice: text('error_notice'),
  /** 生成该条消息的 model id（用户/系统消息为 null） */
  modelId: text('model_id'),
  /** 生成该条消息时实际发给模型的 messages 数组（JSON 字符串），用于"查看上下文" */
  modelMessages: text('model_messages'),
  /**
   * 推理模型的"思考过程"完整文本（流式过程中通过 onReasoning 已 emit 给前端实时显示，这里是聚合结果）。
   * 仅当模型支持 reasoning（DeepSeek-R1 / Qwen 思考 / Grok reasoning / OpenAI o-series 等）才会有内容。
   * 不进 chat-room context-builder 的"历史对话"注入（避免思考过程污染后续角色 prompt）。
   */
  reasoning: text('reasoning'),
  /** 该条消息的 token 消耗统计（JSON：{promptTokens, completionTokens, totalTokens, cachedPromptTokens, reasoningTokens, cost}），用户/系统消息为 null */
  usage: text('usage'),
  createdAt: text('created_at').notNull(),
})

/** 角色 model 偏好（每本书 × 角色 一行，独立于 role_dialogue_character_models） */
export const chatRoomCharacterModels = sqliteTable('chat_room_character_models', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  /** 角色 id（bookSettingEntries.id） */
  characterId: text('character_id').notNull(),
  /** 指定的 model id */
  modelId: text('model_id').notNull().references(() => modelProviders.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})
