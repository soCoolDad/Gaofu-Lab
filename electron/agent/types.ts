/**
 * Agent tools-call 系统类型定义
 *
 * 设计要点：
 * - 工具分两类：read（查询，立即执行返回结果）和 write（生成，产出 pending 结果需用户确认）
 * - Agent 循环：模型输出 tool_call → 执行 → 回注结果 → 继续调用，直到模型不再调用工具
 * - 支持两种调用方式：模型原生 function calling + JSON 降级
 */

// ─── 工具定义 ────────────────────────────────────────────────

/** 工具参数的 JSON Schema 字段定义 */
export type ToolParamSchema = {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description: string
  enum?: string[]
  items?: ToolParamSchema
  properties?: Record<string, ToolParamSchema>
  required?: string[]
  default?: any
}

/** 工具定义 */
/** 可注入上下文块的标识（与 agent-runner 注入逻辑、buildWriteContextParts 的开关一一对应） */
export type ContextKey =
  | 'bookList'          // 作品列表
  | 'bookInfo'          // 当前作品信息
  | 'bookRequirements'  // 作品写作要求（约束·必遵）
  | 'bookOutline'       // 当前作品大纲
  | 'volumeList'        // 当前作品分卷列表
  | 'chapterList'       // 当前作品章节列表
  | 'chapterMemory'     // 指定章节记忆
  | 'settingList'       // 当前作品设定列表
  | 'volumeOutline'     // 本卷大纲
  | 'chapterOutline'    // 本章大纲
  | 'prevChapterOutline'// 上一章节大纲
  | 'prevChapterContent'// 上一章正文
  | 'nextChapterOutline'// 下一章节大纲
  | 'prevChapterMemory' // 上一章记忆
  | 'totalMemory'       // 全书总记忆

export type ToolDefinition = {
  name: string
  description: string
  category: 'book' | 'volume' | 'chapter' | 'outline' | 'setting' | 'snapshot' | 'memory' | 'system'
  /** read = 查询类立即执行；write = 写操作产出 pending 结果需用户确认 */
  mode: 'read' | 'write'
  parameters: Record<string, ToolParamSchema>
  required: string[]
  /** 该工具执行时不需要的上下文块 key；注入阶段据此剔除（定稿生成记忆等工具用它精简 prompt）。默认空 = 不剔除。 */
  excludedContexts?: ContextKey[]
}

// ─── 工具调用与结果 ──────────────────────────────────────────

/** 模型输出的工具调用 */
export type ToolCall = {
  /** 调用 ID，用于关联结果 */
  id: string
  /** 工具名称 */
  name: string
  /** 参数对象 */
  arguments: Record<string, any>
}

/** 工具执行结果（回注给模型） */
export type ToolResult = {
  id: string
  name: string
  /** 成功或失败 */
  success: boolean
  /** 返回数据（JSON 序列化后回注给模型） */
  data: any
  /** 错误信息（失败时） */
  error?: string
}

// ─── Pending 写操作（需用户确认） ─────────────────────────────

/** Pending 写操作的类型 */
export type PendingWriteType =
  | 'book_info'        // 创建/更新书籍
  | 'book_outline'     // 书籍大纲
  | 'volume_list'      // 批量创建分卷
  | 'volume_outline'   // 更新分卷大纲
  | 'volume_info'      // 更新分卷标题/简介
  | 'chapter_list'     // 批量创建章节
  | 'chapter_outline'  // 更新章节大纲
  | 'chapter_info'     // 更新章节标题/摘要/状态
  | 'chapter_content'  // 写正文
  | 'book_setting'     // 设定条目
  | 'setting_info'     // 更新设定条目
  | 'delete_entity'    // 删除操作
  | 'chapter_snapshot' // 章节快照

/** Pending 写操作（Agent 产出，需用户确认应用） */
export type PendingWrite = {
  id: string
  type: PendingWriteType
  /** 操作描述（给用户看） */
  title: string
  /** 详细说明 */
  summary: string
  /** 目标信息 */
  target: {
    bookId?: string
    volumeId?: string | null
    chapterId?: string | null
    settingId?: string | null
    settingType?: string
    entityType?: 'book' | 'volume' | 'chapter' | 'setting' | 'outline'
    entityIds?: string[]
  }
  /** 应用模式 */
  applyMode: 'append' | 'replace' | 'insert' | 'merge' | 'none'
  /** 生成的数据 */
  data: {
    content?: string
    items?: any[]
    [key: string]: any
  }
  /** 预览内容（给用户看的摘要） */
  preview?: {
    title?: string
    summary?: string
    content?: string
    items?: any[]
  }
  /** 风险等级 */
  riskLevel: 'low' | 'medium' | 'high'
  /** 是否已应用 */
  applied: boolean
  /**
   * 是否是"目标前置操作"：
   * 模型在同一轮里为了完成用户的原始目标（如"写第三章正文"），需要先产出这张卡（如"创建第三章章节"）作为前置步骤。
   * true = 用户应用完这张卡（以及本消息里所有其他前置卡）后，前端会自动向模型发送"已应用结果，请继续。"以触发下一步；
   * false（默认） = 独立成果，应用即结束，不触发续跑。
   *
   * 这个字段替代了原来的 mark_resume_after_apply meta 工具（消息级 boolean）——
   * 现在细化到"每张卡"，模型只需在产出前置卡的工具调用参数里把 isPrerequisite=true 一并传入，
   * 免去额外一次模型调用。
   */
  isPrerequisite?: boolean
}

// ─── Agent 消息 ──────────────────────────────────────────────

/** Agent 对话消息（用于构建模型 messages） */
export type AgentMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** tool 角色时关联的 tool_call_id */
  tool_call_id?: string
  /** assistant 角色时携带的 tool_calls（OpenAI 格式，arguments 必须是 JSON 字符串） */
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  /** 工具名称（tool 角色时） */
  name?: string
}

// ─── Agent 运行状态 ──────────────────────────────────────────

/** 模型配置（注入到 worker payload） */
export type AgentModelConfig = {
  baseUrl: string | null
  apiKey: string
  modelName: string
  temperature?: number
  /** 输出 Token 上限（API max_tokens）。undefined = 后端默认 16384 */
  maxOutputTokens?: number
  /** 输入上下文 Token 软上限（超出则截断最早聊天历史）。undefined/0 = 不限制 */
  maxContextTokens?: number
}

/** Agent 运行配置 */
export type AgentRunConfig = {
  bookId: string | null
  modelId: string
  /** 模型配置（baseUrl/apiKey/modelName） */
  modelConfig: AgentModelConfig
  /** 当前章节 ID（写正文时作为目标） */
  chapterId?: string | null
  /** 定稿流程标记：编辑器「定稿」按钮触发。Agent 据此确定性生成章节记忆（直接复用 generate_snapshot 工具逻辑），
   *  不依赖模型"自行决定"调用该工具（不可靠，可能误改写成正文）。 */
  finalize?: boolean
  /** 当前分卷 ID */
  volumeId?: string | null
  /** 用户输入 */
  userInput: string
  /** 当前章节序号（用于定位上一章记忆） */
  currentChapterOrder?: number
  /** 书名（注入 system prompt） */
  bookTitle?: string
  /** 书籍简介 */
  bookDescription?: string
  /** 流式回调（最终回复内容） */
  onChunk?: (delta: string) => void
  /** 流式回调（推理模型的"思考过程"，reasoning_content / reasoning / thinking） */
  onReasoning?: (delta: string) => void
  /** 进度回调（工具开始执行） */
  onToolStart?: (toolCall: ToolCall) => void
  /** 工具结束回调 */
  onToolEnd?: (result: ToolResult) => void
  /** Pending 写操作产生回调 */
  onPendingWrite?: (write: PendingWrite) => void
  /** 中断信号 */
  signal?: AbortSignal
  /** 输出语言：跟随输入/中文/英文 */
  outputLanguage?: 'follow_input' | 'chinese' | 'english'
  /** 上下文深度：精简（仅标题）/ 平衡（标题+简介）/ 深入（标题+详细简介） */
  contextDepth?: 'minimal' | 'balanced' | 'deep'
  /** 是否注入作品正文写作设置（写作风格、叙事视角、禁写清单、写作约束等） */
  injectWritingSettings?: boolean
  /**
   * 流式读取空闲超时（秒）。SSE 连接超过此时间无数据则自动中断。
   * 由前端设置页面配置，默认 120 秒。
   */
  streamTimeout?: number
  /** 正文写作参考设置：写章节正文时注入哪些上下文（由前端知卷设置控制） */
  writeContextVolumeOutline?: boolean
  writeContextChapterOutline?: boolean
  writeContextPrevChapterOutline?: boolean
  writeContextPrevChapterContent?: boolean
  writeContextNextChapterOutline?: boolean
  writeContextPrevChapterMemory?: boolean
  writeContextTotalMemory?: boolean
  /**
   * 已应用的 pendingWrite 类型列表（用于 auto-resume 时注入下一步工具提示词）。
   * 如 ['chapter_list'] 表示刚应用了创建章节的结果，下一步需要写正文。
   */
  appliedPendingWriteTypes?: string[]
  /**
   * 本轮携带的历史聊天记录（前端从内存线程按 chatHistoryLimit 截取后传入）。
   * 每条作为独立的 user/assistant 消息注入，保证多轮对话连贯，且各条独立便于命中缓存。
   */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
}

/** Agent 运行结果 */
export type AgentRunResult = {
  /** 最终回复内容 */
  content: string
  /** 推理模型的"思考过程"完整文本（流式片段已在过程中通过 onReasoning 回传） */
  reasoning?: string | null
  /** Token 用量 */
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cachedPromptTokens?: number
    /** 思考 tokens（推理模型的 reasoning_tokens，属于 completionTokens 的一部分） */
    reasoningTokens?: number
    cost: number
    missCost?: number
    cacheCost?: number
    outputCost?: number
    inputPrice?: number
    outputPrice?: number
    cachedPrice?: number
  }
  /** 产生的 pending 写操作 */
  pendingWrites: PendingWrite[]
  /** 工具调用历史 */
  toolCallHistory: Array<{ call: ToolCall; result: ToolResult }>
  /** 本次运行的模型调用次数（每一轮模型请求算一次，含意图分析、主循环各轮、工具内部子调用） */
  modelCalls: number
  /** 是否被中断 */
  aborted: boolean
  /**
   * 是否因模型调用失败（content_filter / 截断 / 网络错误 / 反代中断 等）而提前结束。
   * 与 aborted 互斥：aborted = 用户主动停止；errored = 模型端在协议层报错。
   * 两者都不影响 token 用量与执行链的记录，调用方仍能拿到完整的 usage / contextSnapshot.rounds。
   */
  errored?: boolean
  /** 失败时的错误消息（与 errored 配套） */
  errorMessage?: string
  /** 模型主动标记"应用完 PendingWrite 后需自动续跑"（调用了 mark_resume_after_apply 工具） */
  resumeAfterApply?: boolean
  /** 本次请求上下文快照（供用户查看） */
  contextSnapshot?: {
    /** 完整系统提示词（静态+动态拼接，向后兼容） */
    systemPrompt: string
    /** 静态系统提示词（铁律部分，跨请求恒定，用于缓存命中） */
    staticSystemPrompt: string
    /** 动态上下文（bookId/书名/记忆等，随请求变化），可能为空 */
    dynamicContext?: string
    memoryText?: string
    /** 半静态上下文（全书大纲+本卷大纲），用于前缀缓存 */
    semiStaticContext?: string
    tools: ToolDefinition[]
    userInput: string
    modelName: string
    /** 实际发送给模型的完整消息列表（含意图分析阶段） */
    fullMessages?: Array<{ role: string; content: string }>
    /** 本轮携带的历史聊天记录（每条独立消息，用于多轮连贯） */
    chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
    /** 按轮次分组的模型调用参数快照 */
    rounds?: Array<{
      label: string
      /** 本轮发给模型的消息（即 payload.messages） */
      input: Array<{ role: string; content: string }>
      /** 模型的原始输出：assistant 消息，含 content 和 tool_calls */
      output?: Array<{ role: string; content: string; tool_calls?: any }>
      usage?: {
        promptTokens: number
        completionTokens: number
        cachedTokens?: number
        reasoningTokens?: number
      }
      /** 本轮实际耗时（毫秒），从发起模型调用到响应完成 */
      durationMs?: number
      /** 本轮模型结束原因（stop/length/tool_calls 等），length 表示输出触顶被截断 */
      finishReason?: string | null
    }>
  }
}

/** Agent 运行上下文（传递给工具执行器） */
export type ToolContext = {
  bookId: string | null
  chapterId?: string | null
  volumeId?: string | null
  /** 当前会话使用的模型 ID，工具内部需要再次调模型（如 generate_snapshot 的两步分析）时使用 */
  modelId?: string | null
  /** 工具内部调模型的记录回调（用于执行链展示） */
  onSubModelCall?: (entry: {
    label: string
    input: Array<{ role: string; content: string }>
    output: Array<{ role: string; content: string }>
    durationMs: number
    usage?: any
  }) => void
  /** 工具内部调模型时，推理模型的"思考过程"逐块回调（拼接进同一个 reasoningContent 字符串） */
  onReasoning?: (delta: string) => void
}

// ─── 增量记忆 ───────────────────────────────────────────────

/** 记忆条目 */
export type MemoryEntry = {
  type: 'character_status' | 'foreshadowing' | 'setting_change' | 'plot_event' | 'world_fact'
  entityId?: string
  entityName?: string
  /** 记忆内容 */
  content: string
  /** 来源章节 ID */
  sourceChapterId?: string
  /** 来源章节序号 */
  sourceChapterOrder?: number
  /** 创建时间 */
  createdAt: string
}

/** 章节记忆摘要 */
export type ChapterMemory = {
  chapterId: string
  chapterOrder: number
  chapterTitle: string
  /** 记忆条目 */
  entries: MemoryEntry[]
  /** 生成时间 */
  generatedAt: string
}

/** 书籍创作记忆 */
export type BookMemory = {
  bookId: string
  /** 各章节记忆 */
  chapters: ChapterMemory[]
  /** 全局未回收伏笔 */
  activeForeshadowings: MemoryEntry[]
  /** 最近更新时间 */
  updatedAt: string
}

// ─── 新记忆体系（v2：结构化、层次化、持久化） ────────────────────
//
// 决策见 discussion（2025-07-12）：
//   - 单章记忆 = 一条 chapter_snapshots.snapshotData，JSON schema 见下（ChapterMemoryV2）
//   - 总记忆 = 一条 book_memory.data，JSON schema 见下（BookMemoryV2），
//     每次单章记忆落库后由 memory/merger.ts 纯代码增量维护
//   - 术语上对外统一叫"记忆"，"快照" 概念不再暴露给用户

/** 命名实体引用（角色/地点/物品/技能/势力/体系/灵感等在快照内部的稳定 id + 展示名） */
export type MemoryEntityRef = {
  id: string
  name: string
}

/** 人物 5 维立场向量：忠诚 / 攻击性 / 理性 / 信任度 / 道德感，取值 0-100 */
export type CharacterVector = {
  loyalty: number
  aggression: number
  rationality: number
  trust: number
  morality: number
}

/** 单章记忆里角色的"当前详细状态" */
export type CharacterStateV2 = {
  location?: MemoryEntityRef | null
  /** 是否受伤 + 部位 + 严重程度 */
  injury?: {
    hurt: boolean
    parts?: string[]
    severity?: '无' | '轻伤' | '中伤' | '重伤' | '濒死' | string
  }
  /** 生存状态：健康 / 疲惫 / 受伤 / 濒死 / 死亡 / 失踪 等 */
  survival?: string
  /** 心境 / 心理 */
  mood?: string
  /** 说话风格 */
  speechStyle?: string
  /** 会的技能（跨章持续继承，除非被明确剥夺） */
  knownSkills?: MemoryEntityRef[]
  /** 持有物品（除非被"明确移除/丢弃/送出/使用消耗"，否则跨章持续持有） */
  holds?: MemoryEntityRef[]
  /** 本章新获取的关键线索 */
  knows?: string[]
  /** 与其他角色的关系 */
  relationships?: Array<{ targetId: string; targetName?: string; type: string; value: number }>
}

/** 单章记忆里角色的完整档案（含状态 + 恒久属性） */
export type CharacterMemoryV2 = {
  id: string
  name: string
  /** 原始设定（首次出场时写入，后续保持不变，由合并器保护） */
  originalSetting: string
  /** 性格（可缓慢演化） */
  personality?: string
  /** 人物成长弧线（描述"目前处于什么阶段"） */
  growthArc?: string
  /** 人物立场 5 维向量 */
  vector?: CharacterVector
  /** 本章末该角色的详细状态 */
  state: CharacterStateV2
}

/** 单章记忆 —— 存入 chapter_snapshots.snapshotData */
export type ChapterMemoryV2 = {
  storyTime?: string
  currentPlot: {
    lastPlot: string
    lastLocation?: MemoryEntityRef | null
    lastScene?: MemoryEntityRef | null
  }
  sceneEntities: {
    characters?: MemoryEntityRef[]
    items?: MemoryEntityRef[]
    skills?: MemoryEntityRef[]
    factions?: MemoryEntityRef[]
    systems?: MemoryEntityRef[]
    locations?: Array<{ id: string; name: string; description?: string }>
    scenes?: Array<{ id: string; name: string; summary?: string }>
    events?: Array<{ type: string; summary: string; participants?: string[] }>
  }
  characters: CharacterMemoryV2[]
  foreshadowing?: Array<{
    id: string
    description: string
    action: 'planted' | 'developing' | 'resolved'
    significance?: 'low' | 'medium' | 'high'
    relatedCharacters?: string[]
  }>
  inspirationsUsed?: MemoryEntityRef[]
}

/** 总记忆里的角色档案（含各种 trace） */
export type BookMemoryCharacter = {
  id: string
  name: string
  originalSetting: string
  personality?: string
  growthArcCurrent?: string
  vectorCurrent?: CharacterVector
  currentState: CharacterStateV2
  locationTrace: Array<{ chapterOrder: number; location: MemoryEntityRef | null }>
  growthArcTrace: Array<{ chapterOrder: number; arc: string }>
  vectorTrace: Array<{ chapterOrder: number; vector: CharacterVector }>
}

/** 总记忆里的地点档案（含改名 trace） */
export type BookMemoryLocation = {
  id: string
  name: string
  nameTrace: Array<{ chapterOrder: number; name: string }>
  firstAppearChapterOrder: number
}

/** 总记忆里的剧情（每章一条） */
export type BookMemoryPlot = {
  chapterOrder: number
  chapterTitle?: string
  name: string
  summary: string
}

/** 总记忆里的伏笔（含 trace + 冗余当前状态） */
export type BookMemoryForeshadowing = {
  id: string
  description: string
  significance?: 'low' | 'medium' | 'high'
  trace: Array<{ chapterOrder: number; action: 'planted' | 'developing' | 'resolved' }>
  currentAction: 'planted' | 'developing' | 'resolved'
}

/** 总记忆里的灵感 */
export type BookMemoryInspiration = {
  id: string
  name: string
  used: boolean
  usedInChapterOrder?: number | null
}

/** 总记忆 —— 存入 book_memory.data */
export type BookMemoryV2 = {
  bookId: string
  updatedThroughChapterOrder: number
  characters: BookMemoryCharacter[]
  locations: BookMemoryLocation[]
  plots: BookMemoryPlot[]
  foreshadowings: BookMemoryForeshadowing[]
  inspirations: BookMemoryInspiration[]
}
