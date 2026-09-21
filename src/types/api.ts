// Electron preload 暴露的 API 类型

// ==================== 剧情预演（Role Dialogue）类型 ====================
export type SnippetMessage = {
  characterId: string
  characterName: string
  publicContent: string
  innerThought: string
  /**
   * 结果提示：模型被 content_filter / 超时 / 各类中断拦截时，把已生成的剧情（publicContent）+ 错误信息（errorNotice）同时保留。
   * UI 在气泡下方独立渲染红色错误块。错误信息不会进入后续角色的 context（context-builder 已过滤）。
   */
  errorNotice?: string
  /**
   * 推理模型的"思考过程"完整文本：仅当模型支持 reasoning 时才会有内容。
   * 流式过程中通过 roleDialogue:snippetReasoning 事件实时推送，落库后刷新页面仍可查看。
   */
  reasoning?: string
  modelId: string | null
  /** 该角色发言的 token 消耗统计（与聊天室 ChatRoomMessageUsage 同结构）；无则 null */
  usage?: ChatRoomMessageUsage | null
  /** 生成该角色发言时实际发给模型的 messages 数组（JSON 字符串），用于"查看上下文" */
  modelMessages?: string | null
}

export type SnippetVersion = {
  messages: SnippetMessage[]
  regeneratedAt: string
}

export type AuthorFactUpdate = {
  fact: string
  insertedAt: string
}

export type RoleDialogueRoom = {
  id: string
  bookId: string
  title: string
  situation: string
  chapterId: string | null
  defaultModelId: string | null
  injectWritingSettings: boolean
  createdAt: string
  updatedAt: string
}

export type RoleDialogueRun = {
  id: string
  roomId: string
  runNumber: number
  characterIdsSnapshot: string[]
  status: 'idle' | 'running' | 'stopped'
  createdAt: string
}

export type RoleDialogueSnippet = {
  id: string
  runId: string
  order: number
  characterIds: string[]
  messages: SnippetMessage[]
  versions: SnippetVersion[]
  regenerateCount: number
  authorFactUpdate: AuthorFactUpdate | null
  /** 片段类型：'snippet'（默认）= 常规角色发言；'summary' = 总结片段，作为新的上下文起点 */
  kind: 'snippet' | 'summary'
  /** summary 视角：'first-person'（选择某个角色第一人称）/ 'third-person'（第三方旁白群像）；非 summary 为 null */
  summaryView: 'first-person' | 'third-person' | null
  /** summary 第一人称视角所选角色 id；非 summary / 第三人称视角时为 null */
  summaryViewCharacterId: string | null
  /** summary 覆盖的原 snippet id 列表（被覆盖的片段不再参与后续上下文注入）；非 summary 时为 [] */
  summaryCoveredSnippetIds: string[]
  createdAt: string
  updatedAt: string
}

export type RoleDialogueCharacterModel = {
  id: string
  bookId: string
  characterId: string
  modelId: string
  createdAt: string
  updatedAt: string
}

// ==================== 角色聊天室（Chat Room）类型 ====================
export type ChatRoomRole = 'director' | 'author' | 'netizen' | 'character' | 'system'

/** 房间发言方式：sequential = 依次接龙；simultaneous = 同时发言 */
export type ChatRoomSpeakingMode = 'sequential' | 'simultaneous'

export type ChatRoomSender =
  | { role: 'director' }
  | { role: 'author' }
  | { role: 'netizen' }
  | { role: 'character'; characterId: string; characterName: string }

export type ChatRoomMessageUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedPromptTokens: number
  reasoningTokens: number
  inputPrice: number
  outputPrice: number
  cachedPrice: number
  missCost: number
  cacheCost: number
  outputCost: number
  cost: number
}

export type ChatRoomMessage = {
  id: string
  roomId: string
  order: number
  role: ChatRoomRole
  characterId: string | null
  characterName: string | null
  content: string
  /**
   * 结果提示：模型被 content_filter / 各类中断拦截时，把已生成的内容（content）+ 错误信息（errorNotice）同时保留。
   * UI 在气泡下方独立渲染红色错误块。错误信息不会进入后续角色的 context（context-builder 需过滤）。
   */
  errorNotice: string | null
  /**
   * 推理模型的"思考过程"完整文本：仅当模型支持 reasoning 时才会有内容。
   * 流式过程中通过 chatRoom:messageReasoning 事件实时推送，落库后刷新页面仍可查看。
   */
  reasoning: string | null
  modelId: string | null
  /** 生成该条消息时实际发给模型的 messages 数组（JSON 字符串），用于"查看上下文" */
  modelMessages: string | null
  /** 该条消息的 token 消耗统计（用户/系统消息为 null）；cost 单位：人民币 */
  usage: ChatRoomMessageUsage | null
  createdAt: string
}

export type ChatRoomParticipant = {
  id: string
  roomId: string
  characterId: string
  characterName: string
  sortOrder: number
  createdAt: string
}

export type ChatRoomRoom = {
  id: string
  bookId: string
  title: string
  defaultModelId: string | null
  /** 发言方式：sequential = 依次接龙；simultaneous = 同时发言 */
  speakingMode: ChatRoomSpeakingMode
  /** 携带记录条数：注入模型上下文时最多携带的最近聊天条数 */
  historyLimit: number
  /** 展示条数：聊天界面默认只渲染最近的 N 条消息 */
  displayLimit: number
  createdAt: string
  updatedAt: string
}

export type ChatRoomCharacterModel = {
  id: string
  bookId: string
  characterId: string
  modelId: string
}

export type ChatRoomSelectableCharacter = {
  id: string
  name: string
  description: string
  detail: string
  source: 'setting' | 'memory' | 'merged'
}

export type CreateChatRoomInput = {
  bookId: string
  title: string
  defaultModelId?: string | null
  /** 发言方式（默认 sequential） */
  speakingMode?: ChatRoomSpeakingMode
  /** 携带记录条数（默认 50） */
  historyLimit?: number
  /** 展示条数（默认 15） */
  displayLimit?: number
}

export type UpdateChatRoomInput = {
  title?: string
  defaultModelId?: string | null
  /** 发言方式 */
  speakingMode?: ChatRoomSpeakingMode
  /** 携带记录条数 */
  historyLimit?: number
  /** 展示条数 */
  displayLimit?: number
}

export type SendChatRoomTurnInput = {
  roomId: string
  userContent: string
  sender: ChatRoomSender
  agentFallbackModelId?: string | null
}

/** 记忆里指向一个实体（角色/地点/物品/技能）的引用 */
export type MemoryEntityRef = {
  id?: string
  name?: string
  kind?: 'character' | 'location' | 'item' | 'skill' | string
}

/** bookMemory.characters[].currentState —— 角色结构化状态（与主进程 CharacterStateV2 保持一致） */
export type CharacterStateV2 = {
  location?: MemoryEntityRef | null
  injury?: {
    hurt: boolean
    parts?: string[]
    severity?: string
  }
  survival?: string
  mood?: string
  speechStyle?: string
  knownSkills?: MemoryEntityRef[]
  holds?: MemoryEntityRef[]
  knows?: string[]
  relationships?: Array<{ targetId: string; targetName?: string; type: string; value: number }>
}

/** 剧情预演选角色专用：bookSetting + bookMemory 合并去重后的角色 */
export type MergedCharacter = {
  id: string
  name: string
  description: string
  detail: string
  /** currentState 可能是字符串（旧数据）或结构化对象（CharacterStateV2） */
  currentState?: CharacterStateV2 | string
  /** location 可能是字符串（顶层） 或 MemoryEntityRef（嵌套在 currentState 里） */
  location?: MemoryEntityRef | string
  status?: string
  source: 'setting' | 'memory' | 'merged'
}

export type CreateRoleDialogueRoomInput = {
  bookId: string
  title: string
  situation: string
  chapterId?: string | null
  defaultModelId?: string | null
  injectWritingSettings?: boolean
}

export type UpdateRoleDialogueRoomInput = {
  title?: string
  situation?: string
  chapterId?: string | null
  defaultModelId?: string | null
  injectWritingSettings?: boolean
}

export type CreateRoleDialogueSnippetInput = {
  runId: string
  order: number
  characterIds: string[]
  messages: SnippetMessage[]
  authorFactUpdate?: AuthorFactUpdate | null
}

export type UpdateRoleDialogueSnippetInput = {
  messages?: SnippetMessage[]
  authorFactUpdate?: AuthorFactUpdate | null
}

// ==================== 原有类型 ====================

/** 「任务默认模型参数」：单个任务的采样参数配置（mode='follow' 时数值字段被忽略，即"跟随模型"） */
export interface TaskSamplingConfig {
  mode: 'follow' | 'custom'
  temperature?: number | null
  topP?: number | null
  frequencyPenalty?: number | null
  presencePenalty?: number | null
}

/** 「任务默认模型参数」：按任务 key 索引的自定义配置（与后端 electron/utils/sampling.ts 一致） */
export type TaskSamplingSettings = Record<string, TaskSamplingConfig>

/** 任务注册表条目（后端 electron/utils/sampling.ts 的 SAMPLING_TASKS，通过 settings:getSamplingTasks 下发） */
export interface SamplingTaskMeta {
  key: string
  label: string
  description: string
  defaultTemperature: number
}

/** Agent（「知卷」）设置的完整结构，与渲染进程 aiSettings.store.ts 中的 AiSettingsValues 保持一致 */
export interface AiSettingsValues {
  smartContextEnabled: boolean
  outputLanguage: 'follow_input' | 'chinese' | 'english'
  contextDepth: 'minimal' | 'balanced' | 'deep'
  injectWritingSettings: boolean
  chatHistoryLimit: number
  streamTimeout: number
  writeContextVolumeOutline: boolean
  writeContextChapterOutline: boolean
  writeContextPrevChapterOutline: boolean
  writeContextPrevChapterContent: boolean
  writeContextNextChapterOutline: boolean
  writeContextPrevChapterMemory: boolean
  writeContextTotalMemory: boolean
  /** 「设置 → 任务默认模型参数」：每个任务的采样参数覆盖（跟随模型 / 自定义） */
  taskSampling: TaskSamplingSettings
}

export interface ElectronAPI {
  clipboard: {
    writeText: (text: string) => void
  }
  shell: {
    openExternal: (url: string) => Promise<void>
  }
  app: {
    quit: () => Promise<boolean>
    versions: () => Promise<{ electron: string; chrome: string; node: string }>
    devtools: () => Promise<boolean>
    exportDb: () => Promise<{ success: boolean; path?: string; reason?: string }>
    importDb: () => Promise<{ success: boolean; reason?: string }>
    relaunch: () => Promise<boolean>
  }
  book: {
    list: () => Promise<Book[]>
    get: (id: string) => Promise<Book | null>
    create: (data: { id?: string; title: string; description?: string; detail?: string }) => Promise<Book>
    update: (id: string, data: Partial<{ title: string; description: string; detail: string; cover: string; writingStyle: string; writingPov: string; writingWordCountTarget: string; writingTaboo: string }>) => Promise<Book>
    delete: (id: string) => Promise<boolean>
  }
  chapter: {
    list: (bookId: string) => Promise<Chapter[]>
    listPaged: (data: { bookId: string; page: number; pageSize: number; volumeId?: string | null }) => Promise<{ items: Chapter[]; total: number; page: number; pageSize: number }>
    get: (id: string) => Promise<Chapter | null>
    stats: (bookId: string) => Promise<{ totalWords: number; totalChapters: number; completedCount: number }>
    create: (data: {
      bookId: string
      volumeId?: string
      title: string
      summary?: string
      outline?: string
      sortOrder?: number
    }) => Promise<Chapter>
    bulkCreate: (data: {
      bookId: string
      mode?: 'append' | 'replace'
      chapters: Array<{
        title: string
        summary?: string
        outline?: string
        volumeId?: string | null
        volumeTitle?: string | null
      }>
    }) => Promise<Chapter[]>
    update: (id: string, data: {
      title?: string
      summary?: string
      outline?: string
      content?: string
      status?: string
      volumeId?: string
      sortOrder?: number
    }) => Promise<Chapter>
    delete: (id: string) => Promise<boolean>
  }
  volume: {
    list: (bookId: string) => Promise<Volume[]>
    create: (data: { bookId: string; title: string; description?: string; outline?: string; sortOrder?: number }) => Promise<Volume>
    bulkCreate: (data: {
      bookId: string
      mode?: 'append' | 'replace'
      volumes: Array<{ title: string; description?: string; outline?: string }>
    }) => Promise<Volume[]>
    update: (id: string, data: Partial<{ title: string; description: string; outline: string; sortOrder: number }>) => Promise<Volume>
    delete: (id: string) => Promise<boolean>
  }
  outline: {
    getBook: (bookId: string) => Promise<Outline | null>
    saveBook: (bookId: string, content: string) => Promise<Outline>
  }
  bookSetting: {
    list: (data: { bookId: string; type: string }) => Promise<BookSettingEntry[]>
    listAll: (bookId: string) => Promise<BookSettingEntry[]>
    create: (data: { bookId: string; type: string; name: string; description?: string; detail?: string }) => Promise<BookSettingEntry>
    update: (id: string, data: Partial<{ name: string; description: string; detail: string }>) => Promise<BookSettingEntry>
    delete: (id: string) => Promise<boolean>
  }
  model: {
    list: () => Promise<ModelProvider[]>
    get: (id: string) => Promise<ModelProvider | null>
    create: (data: {
      name: string
      provider: string
      apiKey: string
      modelName: string
      baseUrl?: string
      inputPrice?: number
      outputPrice?: number
      cachedInputPrice?: number
      maxOutputTokens?: number
      maxContextTokens?: number
      temperature?: number | null
      topP?: number | null
      frequencyPenalty?: number | null
      presencePenalty?: number | null
      billingRules?: string | null
      mergeSystemMessages?: boolean
    }) => Promise<ModelProvider>
    update: (id: string, data: Partial<{
      name: string
      provider: string
      apiKey: string
      modelName: string
      baseUrl?: string
      inputPrice?: number
      outputPrice?: number
      cachedInputPrice?: number
      maxOutputTokens?: number
      maxContextTokens?: number
      temperature?: number | null
      topP?: number | null
      frequencyPenalty?: number | null
      presencePenalty?: number | null
      billingRules?: string | null
      enabled: boolean
      mergeSystemMessages?: boolean
    }>) => Promise<ModelProvider>
    delete: (id: string) => Promise<boolean>
    fetchModels: (baseUrl: string, apiKey: string) => Promise<any[]>
  }
  settings: {
    clearBooks: () => Promise<boolean>
    clearModels: () => Promise<boolean>
    clearTokens: () => Promise<boolean>
    clearApplyLogs: () => Promise<boolean>
    clearChatMessages: () => Promise<boolean>
    clearRoleDialogue: () => Promise<boolean>
    clearChatRoom: () => Promise<boolean>
    clearPromptCaches: () => Promise<boolean>
    clearAll: () => Promise<boolean>
    getAiSettings: () => Promise<AiSettingsValues | null>
    saveAiSettings: (data: AiSettingsValues) => Promise<boolean>
    /** 「任务默认模型参数」的任务注册表（后端 electron/utils/sampling.ts 的 SAMPLING_TASKS） */
    getSamplingTasks: () => Promise<SamplingTaskMeta[]>
  }
  chatMessage: {
    list: (bookId: string) => Promise<AiChatMessageRecord[]>
    saveBatch: (data: { bookId: string; messages: AiChatMessageRecord[] }) => Promise<boolean>
    clear: (bookId: string) => Promise<boolean>
    move: (data: { fromBookId: string; toBookId: string }) => Promise<boolean>
    moveByIds: (data: { messageIds: string[]; toBookId: string }) => Promise<boolean>
    copyByIds: (data: { messageIds: string[]; toBookId: string }) => Promise<boolean>
    clearAll: () => Promise<boolean>
    deleteByBook: (bookId: string) => Promise<boolean>
  }
  // 剧情预演（Role Dialogue）
  roleDialogue: {
    listRooms: (bookId: string) => Promise<RoleDialogueRoom[]>
    createRoom: (data: CreateRoleDialogueRoomInput) => Promise<RoleDialogueRoom>
    updateRoom: (id: string, data: UpdateRoleDialogueRoomInput) => Promise<RoleDialogueRoom>
    deleteRoom: (id: string) => Promise<{ success: boolean }>
    listRuns: (roomId: string) => Promise<RoleDialogueRun[]>
    createRun: (data: { roomId: string; characterIds: string[] }) => Promise<RoleDialogueRun>
    deleteRun: (id: string) => Promise<{ success: boolean }>
    updateRunCharacters: (runId: string, characterIds: string[]) => Promise<RoleDialogueRun | undefined>
    listSnippets: (runId: string) => Promise<RoleDialogueSnippet[]>
    createSnippet: (data: CreateRoleDialogueSnippetInput) => Promise<RoleDialogueSnippet>
    updateSnippet: (id: string, data: UpdateRoleDialogueSnippetInput) => Promise<{ success: boolean }>
    regenerateSnippet: (id: string, newMessages: SnippetMessage[]) => Promise<{ success: boolean }>
    insertAuthorFact: (id: string, fact: string) => Promise<{ success: boolean }>
    appendNarratorSnippet: (runId: string, narratorText: string) => Promise<RoleDialogueSnippet | undefined>
    deleteSnippet: (id: string) => Promise<{ success: boolean; deletedCount: number }>
    getCharacterModel: (bookId: string, characterId: string) => Promise<RoleDialogueCharacterModel | null>
    setCharacterModel: (bookId: string, characterId: string, modelId: string | null) => Promise<{ id?: string; modelId?: string | null; success?: boolean; cleared?: boolean }>
    listCharacters: (bookId: string) => Promise<MergedCharacter[]>
    generateSnippet: (data: { runId: string; characterIds: string[]; authorFact?: string | null; agentFallbackModelId?: string | null }) => Promise<SnippetMessage[]>
    generateSummary: (data: { runId: string; view: 'first-person' | 'third-person'; viewCharacterId?: string | null; agentFallbackModelId?: string | null; sourceSummaryId?: string | null }) => Promise<RoleDialogueSnippet>
    onSummaryDelta: (listener: (payload: { runId: string; summaryId: string; delta: string }) => void) => () => void
    onSummaryReasoning: (listener: (payload: { runId: string; summaryId: string; delta: string }) => void) => () => void
    onSummaryDone: (listener: (payload: { runId: string; summaryId: string; snippet: RoleDialogueSnippet }) => void) => () => void
    onSummaryError: (listener: (payload: { runId: string; message: string }) => void) => () => void
    onSnippetChunk: (listener: (payload: { runId: string; index: number; total: number; message: SnippetMessage }) => void) => () => void
    onSnippetDelta: (listener: (payload: { runId: string; characterId: string; characterName: string; delta?: string; reasoningDelta?: string; partial?: string; index: number; total: number }) => void) => () => void
    onSnippetReasoning: (listener: (payload: { runId: string; characterId: string; characterName: string; delta: string; index: number; total: number }) => void) => () => void
    onSnippetDone: (listener: (payload: { runId: string; messages: SnippetMessage[] }) => void) => () => void
  }
  // 角色聊天室（Chat Room）
  chatRoom: {
    listRooms: (bookId: string) => Promise<ChatRoomRoom[]>
    createRoom: (data: CreateChatRoomInput) => Promise<ChatRoomRoom>
    updateRoom: (id: string, data: UpdateChatRoomInput) => Promise<ChatRoomRoom>
    deleteRoom: (id: string) => Promise<{ success: boolean }>
    listParticipants: (roomId: string) => Promise<ChatRoomParticipant[]>
    addParticipant: (roomId: string, characterId: string) => Promise<ChatRoomParticipant>
    removeParticipant: (id: string) => Promise<{ success: boolean }>
    reorderParticipants: (roomId: string, orderedIds: string[]) => Promise<ChatRoomParticipant[]>
    listMessages: (roomId: string) => Promise<ChatRoomMessage[]>
    clearMessages: (roomId: string) => Promise<{ success: boolean; deleted: boolean }>
    deleteMessage: (id: string) => Promise<{ success: boolean }>
    listCharacters: (bookId: string) => Promise<ChatRoomSelectableCharacter[]>
    getCharacterMemoryStates: (bookId: string, characterIds: string[]) => Promise<Record<string, string>>
    getCharacterModel: (bookId: string, characterId: string) => Promise<ChatRoomCharacterModel | null>
    setCharacterModel: (bookId: string, characterId: string, modelId: string | null) => Promise<{ id?: string; modelId?: string | null; success?: boolean; cleared?: boolean }>
    sendTurn: (data: SendChatRoomTurnInput) => Promise<ChatRoomMessage[]>
    characterSpeak: (roomId: string, characterId: string) => Promise<ChatRoomMessage[]>
    onMessageStart: (listener: (payload: { roomId: string; messageId: string; characterId: string; characterName: string; order: number }) => void) => () => void
    onMessageDelta: (listener: (payload: { roomId: string; messageId: string; delta: string }) => void) => () => void
    onMessageReasoning: (listener: (payload: { roomId: string; messageId: string; delta: string }) => void) => () => void
    onMessageComplete: (listener: (payload: { roomId: string; messageId: string; message: ChatRoomMessage }) => void) => () => void
    onMessageError: (listener: (payload: { roomId: string; messageId: string; error: string }) => void) => () => void
    onTurnDone: (listener: (payload: { roomId: string; messages: ChatRoomMessage[] }) => void) => () => void
  }
  ai: {
    applyLogs: (filter?: AiApplyLogFilter) => Promise<AiApplyLog[]>
    exportApplyLogs: (filter?: AiApplyLogFilter) => Promise<{ csv: string; count: number }>
    reviewEditorContent: (data: AiReviewRequest) => Promise<AiSendResponse>
    onSnapshotGenerated: (callback: (data: { chapterId: string; snapshotId: string; success: boolean }) => void) => () => void
    tokenLogs: (data?: TokenUsageLogFilter) => Promise<TokenUsageLogPage>
    tokenLogFacets: () => Promise<TokenLogFacets>
    tokenSummary: () => Promise<TokenUsageSummary>
    getSnapshot: (chapterId: string) => Promise<any | null>
    getLatestSnapshot: (bookId: string) => Promise<any | null>
    /** 读取整本书的总记忆（BookMemoryV2）+ 中文序列化文本 */
    getBookMemory: (bookId: string) => Promise<{ raw: any; naturalLanguage: string; empty: boolean }>
    listSnapshots: (bookId: string) => Promise<Array<{ id: string; chapterId: string; chapterOrder: number; volumeId: string | null; storyTime: string | null; isValid: boolean; createdAt: string; chapterTitle: string }>>
    listSnapshotsByBook: (bookId: string) => Promise<any[]>
    saveSnapshot: (data: { snapshotId: string; snapshotData: any; storyTime?: string }) => Promise<{ success: boolean }>
    validateSnapshot: (data: { snapshotId: string; isValid: boolean }) => Promise<{ success: boolean }>
    applyChapterSnapshot: (data: { bookId: string; chapterId: string; snapshotData: any }) => Promise<{ snapshotId: string; success: boolean }>
    checkChapterSnapshotConflicts: (data: { bookId: string; chapterId: string }) => Promise<{ hasCurrentSnapshot: boolean; laterChapters: Array<{ id: string; title: string; sortOrder: number }> }>
    deleteChapterSnapshot: (data: { bookId: string; chapterId: string }) => Promise<{ deletedChapterCount: number }>
    deleteBookMemory: (bookId: string) => Promise<{ success: boolean }>
    updateBookMemory: (data: { bookId: string; data: string }) => Promise<{ success: boolean; message?: string }>
  }
  skill: {
    list: (opts?: { includeDisabled?: boolean }) => Promise<AiSkill[]>
    create: (data: { name: string; description?: string; prompt: string; enabled?: boolean }) => Promise<{ success: boolean; id?: string; error?: string }>
    update: (data: { id: string; name?: string; description?: string; prompt?: string; enabled?: boolean }) => Promise<{ success: boolean; error?: string }>
    delete: (id: string) => Promise<{ success: boolean }>
    invoke: (data: { skillId: string; content: string; modelId?: string | null; bookId?: string | null; bookTitle?: string | null }) => Promise<{ success: boolean; content?: string; error?: string }>
    importFromUrl: (data: { url: string }) => Promise<{ success: boolean; drafts?: SkillDraft[]; error?: string }>
    importZip: (buffer: Uint8Array) => Promise<{ success: boolean; drafts?: SkillDraft[]; error?: string }>
  }
  styleFingerprint: {
    list: (bookId: string) => Promise<StyleFingerprint[]>
    create: (data: { bookId: string; name: string; description?: string; samples?: StyleFingerprintSample[] }) => Promise<StyleFingerprint | null>
    update: (data: { id: string; name?: string; description?: string; samples?: StyleFingerprintSample[] }) => Promise<StyleFingerprint | null>
    delete: (id: string) => Promise<boolean>
    setDefault: (id: string) => Promise<{ success: boolean; message?: string }>
    extract: (data: { id: string; modelId: string }) => Promise<{ success: boolean; message?: string; fingerprint?: StyleFingerprint | null }>
    audit: (data: { bookId: string; content: string }) => Promise<StyleAuditResult | null>
    onExtractReasoning: (listener: (payload: { id: string; delta: string }) => void) => () => void
  }
  clip: {
    getClips: (chapterId: string) => Promise<any[]>
    listByBook: (bookId: string) => Promise<any[]>
    listByChapterRange: (bookId: string, fromOrder: number, toOrder: number) => Promise<any[]>
    createClip: (data: { bookId: string; chapterId: string; clipType: string; entityId: string; entityName: string; paragraphStart: number; paragraphEnd: number; status: string; snapshotId: string }) => Promise<any>
    updateClip: (id: string, data: Partial<{ clipType: string; entityId: string; entityName: string; paragraphStart: number; paragraphEnd: number; status: string; prevClipId: string | null; nextClipId: string | null }>) => Promise<any>
    deleteClip: (id: string) => Promise<boolean>
  }
  agent: {
    run: (data: {
      streamId?: string
      bookId: string | null
      modelId: string
      chapterId?: string | null
      volumeId?: string | null
      /** 定稿流程标记：编辑器「定稿」按钮触发，由 Agent 确定性生成章节记忆 */
      finalize?: boolean
      userInput: string
    outputLanguage?: 'follow_input' | 'chinese' | 'english'
    contextDepth?: 'minimal' | 'balanced' | 'deep'
    injectWritingSettings?: boolean
    styleFingerprintId?: string | null
    streamTimeout?: number
    appliedPendingWriteTypes?: string[]
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
    writeContextVolumeOutline?: boolean
    writeContextChapterOutline?: boolean
    writeContextPrevChapterOutline?: boolean
    writeContextPrevChapterContent?: boolean
    writeContextNextChapterOutline?: boolean
    writeContextPrevChapterMemory?: boolean
    writeContextTotalMemory?: boolean
  }) => Promise<{ streamId: string }>
    apply: (data: { write: any; modelId?: string }) => Promise<{ success: boolean; message: string; sideEffects?: string[] }>
    applyBatch: (data: { writes: any[]; modelId?: string }) => Promise<Array<{ writeId: string; success: boolean; message: string; sideEffects?: string[] }>>
    stop: (streamId: string) => Promise<boolean>
    listTools: () => Promise<any[]>
    onChunk: (callback: (data: { streamId: string; delta: string }) => void) => () => void
    onReasoning: (callback: (data: { streamId: string; delta: string }) => void) => () => void
    onToolStart: (callback: (data: { streamId: string; toolCall: any }) => void) => () => void
    onToolEnd: (callback: (data: { streamId: string; result: any }) => void) => () => void
    onPendingWrite: (callback: (data: { streamId: string; write: any }) => void) => () => void
    onDone: (callback: (data: {
      streamId: string
      content: string
      reasoning?: string | null
      usage: any
      pendingWrites: any[]
      toolCallHistory: any[]
      aborted: boolean
      errored?: boolean
      errorMessage?: string | null
      resumeAfterApply?: boolean
      contextSnapshot?: {
        systemPrompt: string
        staticSystemPrompt: string
        dynamicContext?: string
        memoryText?: string
        tools: any[]
        userInput: string
        modelName: string
        chatHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
      }
    }) => void) => () => void
    onError: (callback: (data: { streamId: string; message: string }) => void) => () => void
    getToolPrompts: () => Promise<ToolPromptInfo[]>
    updateToolPrompt: (toolName: string, prompt: string | null) => Promise<{ success: boolean; toolName?: string; error?: string }>
    getOverridesPath: () => Promise<string>
  }
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

// ==================== 文风指纹 ====================

export type StyleFingerprintSample = {
  title?: string
  content: string
}

export type StyleMetrics = {
  totalChars: number
  totalSentences: number
  totalParagraphs: number
  avgSentenceLength: number
  medianSentenceLength: number
  shortSentenceRatio: number
  longSentenceRatio: number
  maxSentenceLength: number
  sentenceLengthStd: number
  avgParagraphLength: number
  dialogueRatio: number
  narrationRatio: number
  dashFreq: number
  ellipsisFreq: number
  semicolonFreq: number
  commaFreq: number
  typeTokenRatio: number
  aiClicheHits: Array<{ category: string; word: string; count: number }>
  aiClicheDensity: number
}

export type StyleAuditStatus = 'good' | 'warn' | 'bad'

export type StyleAuditDimension = {
  key: string
  label: string
  fingerprintValue: string
  contentValue: string
  deviation: number
  status: StyleAuditStatus
  note: string
}

export type StyleAuditResult = {
  score: number
  level: 'green' | 'yellow' | 'red'
  dimensions: StyleAuditDimension[]
  summary: string
}

export type StyleFingerprint = {
  id: string
  bookId: string
  name: string
  description: string
  samples: StyleFingerprintSample[]
  metrics: StyleMetrics
  summary: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

// ==================== 工具提示词 ====================

/** 工具提示词信息（从 agent:getToolPrompts 返回） */
export type ToolPromptInfo = {
  name: string
  description: string
  category: string
  mode: 'read' | 'write'
  parameters: Record<string, any>
  required: string[]
  hasPromptOverride: boolean
  currentPrompt: string | null
  defaultPrompt: string | null
}

// ==================== 数据模型 ====================
export type AiChatMessageRecord = {
  id: string
  role: 'user' | 'ai'
  content: string
  rawContent?: string
  displayContent?: string
  usage?: any
  structuredData?: any
  contextType?: string
  chapterId?: string | null
  volumeId?: string | null
  canApply?: boolean
  contextSnapshot?: any
  cacheUsage?: any
  generatedResult?: any
  deletePlan?: any
  agentPlan?: any
  agentProgress?: any
  actualContextResources?: any
  contextGroups?: any
  awaitingPlanConfirmation?: boolean
  planStepResults?: any
  planRequest?: any
  stopped?: boolean
}

export type Book = {
  id: string
  title: string
  description: string | null
  detail: string
  cover: string | null
  writingStyle: string
  writingPov: string
  writingWordCountTarget: string
  writingTaboo: string
  writingConstraint: string
  createdAt: string
  updatedAt: string
}

export type Volume = {
  id: string
  bookId: string
  title: string
  description: string | null
  outline: string | null
  sortOrder: number
}

export type Chapter = {
  id: string
  bookId: string
  volumeId: string | null
  volumeTitle?: string | null
  title: string
  summary: string | null
  outline: string | null
  content: string
  wordCount: number
  status: 'draft' | 'locked' | 'completed' | 'finalized'
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type BookSettingEntryType = 'characters' | 'locations' | 'items' | 'skills' | 'scenes' | 'factions' | 'systems' | 'inspirations' | 'foreshadowings'

export type BookSettingEntry = {
  id: string
  bookId: string
  type: BookSettingEntryType
  name: string
  description: string
  detail: string
  createdAt: string
  updatedAt: string
}

export type Outline = {
  id: string
  bookId: string
  type: string
  targetId: string | null
  content: string
  updatedAt: string
}

export type ModelProvider = {
  id: string
  name: string
  provider: string
  apiKey: string
  baseUrl: string | null
  modelName: string
  inputPrice: number | null
  outputPrice: number | null
  cachedInputPrice: number | null
  /** 输出 Token 上限（API max_tokens），null = 后端默认 16384 */
  maxOutputTokens: number | null
  /** 输入上下文 Token 软上限，null/0 = 不限制 */
  maxContextTokens: number | null
  /** 采样温度（0~2），null = provider 默认 */
  temperature: number | null
  /** Nucleus sampling 阈值（0~1），null = provider 默认 */
  topP: number | null
  /** Frequency penalty（-2~2），null = provider 默认 */
  frequencyPenalty: number | null
  /** Presence penalty（-2~2），null = provider 默认 */
  presencePenalty: number | null
  /** 计费规则 JSON 数组字符串，null = 未配置（直接使用默认单价）。
   *  每条规则 {name, days:1..7, startTime:'HH:mm', endTime:'HH:mm', inputPrice, outputPrice, cachedInputPrice}；
   *  规则内未填的价格字段回退到模型默认值，显式 0 视为 0。所有后端计费都走 electron/utils/billing.ts 的
   *  resolveCurrentPrices 解析，未命中/未配置时回退默认价。 */
  billingRules: string | null
  /** 「单 System 合并」：true 时调用前把上下文中所有 system 消息合并为一条前置消息（部分模型只接受一条 system） */
  mergeSystemMessages: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export type AiGeneratedResultType =
  | 'book_outline'
  | 'volume_list'
  | 'volume_outline'
  | 'chapter_list'
  | 'chapter_outline'
  | 'chapter_content'
  | 'chapter_content_list'
  | 'book_setting_list'
  | 'book_info_update'
  | 'chat_answer'
  | 'delete_plan'
  | 'chapter_snapshot'

export type AiGeneratedApplyMode = 'append' | 'replace' | 'insert' | 'merge' | 'none'

export type AiDeletePlan = {
  type: 'delete_book' | 'delete_volume' | 'delete_chapter' | 'delete_book_setting' | 'clear_chapter_content' | 'clear_chapter_outline' | 'clear_volume_outline' | 'clear_outline'
  riskLevel: 'low' | 'medium' | 'high'
  summary: string
  requireConfirm: boolean
  targets: Array<{
    id: string
    title: string
    entityType: 'book' | 'volume' | 'chapter' | 'outline' | 'book_setting'
    field?: 'content' | 'outline' | 'detail' | null
    subtitle?: string
  }>
}

export type AiGeneratedResult = {
  resultId?: string
  type: AiGeneratedResultType
  target?: {
    bookId?: string
    volumeId?: string | null
    chapterId?: string | null
    characterId?: string | null
    field?: string | null
  }
  applyMode?: AiGeneratedApplyMode
  data: {
    content?: string
    items?: any[]
    [key: string]: any
  }
  preview?: {
    title?: string
    summary?: string
    content?: string
    items?: any[]
  }
  metadata?: {
    taskType?: string
    employeeType?: string
    contextUsed?: string[]
    [key: string]: any
  }
}

export type AiAgentProgressStep = {
  title: string
  detail?: string
  status?: 'running' | 'done' | 'error'
}

export type AiTargetRef = {
  scope: 'book' | 'volume' | 'chapter' | 'character' | 'selection' | 'workspace'
  entityType: 'book' | 'volume' | 'chapter' | 'character' | 'text' | 'workspace'
  entityId?: string | null
  entityIds?: string[]
  field?: 'outline' | 'summary' | 'content' | 'detail' | 'description' | null
  label: string
  confidence: number
  resolution: 'explicit' | 'current_ui' | 'ordinal' | 'semantic' | 'fallback'
}

export type AiContextRequirement = {
  role: string
  scope: string
  relation?: string
  count?: number
  required?: boolean
  reason: string
}

export type AiContextPlan = {
  strategy: 'minimal' | 'balanced' | 'full'
  maxTokens: number
  required: AiContextRequirement[]
  optional: AiContextRequirement[]
}

export type AiContextResource = {
  key: string
  role: string
  title: string
  type: '自动' | '自定义'
  enabled: boolean
  content: string
  tokenEstimate: number
  priority: number
  purpose: string
  entityType?: string
  entityId?: string | null
  field?: string | null
  relation?: string
  cacheMode?: 'raw'
  cacheTier?: 'fixed' | 'possible' | 'dynamic'
  cacheReason?: string
  cacheStatus?: 'hit' | 'updated' | 'created'
}

export type AiContextGroup = {
  key: string
  employeeType: string
  employeeName: string
  phase: 'planner' | 'executor'
  resources: AiContextResource[]
  requestText?: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export type AiAgentPlanOutputContract = {
  type: string
  applyTarget: string
  recommendedApplyMode: string
  showApplyButtons: boolean
}

export type AiAgentPlanStep = {
  stepId: string
  employeeType: string
  employeeName?: string
  action: string
  target?: string
  targetRef?: AiTargetRef
  focusedSettingTypes?: string[]
  contextPlan?: AiContextPlan
  executionInstruction: string
  outputContract: AiAgentPlanOutputContract
  dependsOn?: string[]
  parallelGroupId?: string | null
  status?: 'pending' | 'running' | 'success' | 'pending_confirm' | 'applied' | 'failed' | 'skipped' | 'aborted'
  reason?: string
}

export type AiAgentReviewIssue = {
  id: string
  level: 'high' | 'warn' | 'info'
  message: string
  suggestion?: string
  target?: {
    stepId?: string
    outputType?: string
    path?: string
  }
}

export type AiAgentPlanReview = {
  enabled: boolean
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  summary?: string
  issues?: AiAgentReviewIssue[]
  counts?: { high: number; warn: number; info: number }
  reviewedAt?: number
  rawContent?: string
}

export type AiIntentMinimal = {
  mode: 'chat' | 'execute'
  target: 'book' | 'custom'
  location:
    | 'book'
    | 'outline'
    | 'volumes'
    | 'chapters'
    | 'chapterContent'
    | 'characters'
    | 'locations'
    | 'items'
    | 'skills'
    | 'scenes'
    | 'factions'
    | 'systems'
    | 'inspirations'
    | 'foreshadowings'
  action: 'new' | 'view' | 'edit' | 'remove'
  targetIndex: number | null
  locationIndex: number | null
}

export type AiAgentPlan = {
  planId?: string
  mode: 'chat' | 'execute'
  intent: string
  target: string
  targetRef: AiTargetRef
  employeeType: string
  confidence: number
  contextType: string
  contextPlan: AiContextPlan
  executionInstruction: string
  outputContract?: AiAgentPlanOutputContract
  steps?: AiAgentPlanStep[]
  review?: AiAgentPlanReview
  pendingBookId?: string | null
  autoConfirm?: boolean
  minimal?: AiIntentMinimal
}

export type AiSendRequest = {
  bookId?: string
  contextType: 'outline' | 'volumes' | 'chapters' | 'editor' | string
  action: string
  prompt: string
  modelId?: string
  agentMode?: boolean
  onlyChat?: boolean
  chapterId?: string | null
  volumeId?: string | null
  writeMode?: 'none' | 'append' | 'replace'
  contextDepth?: 'brief' | 'balanced' | 'deep'
  chatHistoryLimit?: number
  smartContextEnabled?: boolean
  chatHistory?: Array<{ role: 'user' | 'ai'; content: string }>
  // 强制指定员工类型（跳过意图分析师）。用于定稿等确定性流程直接指定 snapshot_analyst 等员工
  forceEmployee?: string
  // "正文写作设置"面板指定的参考快照 id；如果指定，写手上下文会用此快照的"最后场景条目"，覆盖默认的"目标章前一章快照"
  forcedSnapshotId?: string
}

export type AiCacheUsage = Array<{ cacheType: string; status: 'hit' | 'updated' | 'created' }>

export type AiSendResponse = {
  content: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cachedPromptTokens?: number
    cost: number
    systemTokens: number
    userTokens: number
  }
  cacheUsage?: AiCacheUsage
  contextResources?: AiContextResource[]
  contextGroups?: AiContextGroup[]
  generatedResult?: AiGeneratedResult
  deletePlan?: AiDeletePlan
  agentPlan?: AiAgentPlan
}

export type AiApplyRequest = {
  bookId: string
  contextType?: string
  content?: string
  applyMode: 'append' | 'replace' | 'insert' | 'merge' | 'none'
  chapterId?: string | null
  volumeId?: string | null
  insertPosition?: number | null
  generatedResult?: AiGeneratedResult
  planId?: string | null
  stepId?: string | null
  dependsOn?: string[] | null
  employeeType?: string | null
  reviewStatus?: string | null
  reviewCounts?: { high?: number; warn?: number; info?: number } | null
  forced?: boolean
}

export type AiApplyBatchResult = {
  success: boolean
  applied: number
  results: Array<{ target: string; id?: string; count?: number }>
  skipped?: Array<{ stepId: string; reason: string }>
  appliedStepIds?: string[]
  error?: string
}

export type AiReviewRequest = {
  bookId?: string
  chapterId?: string | null
  content: string
  modelId?: string | null
}

/** 用户可导入的 AI 技能（提示词技能，如 humanizer-zh 去 AI 味） */
export type AiSkill = {
  id: string
  name: string
  description: string
  prompt: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** GitHub 链接 / Zip 导入解析出的技能草稿（预览确认后才创建） */
export type SkillDraft = {
  name: string
  description: string
  prompt: string
  /** 来源标注（原始 URL / zip 内路径），仅用于展示 */
  source?: string
}

export type AiStreamChunk = {
  streamId: string
  delta: string
}

export type AiPromptCacheAggEntry = {
  entries: number
  hits: number
  tokens: number
}

export type AiPromptCacheRow = {
  id: string
  cacheKey: string
  role: string
  tier: string
  bookId: string | null
  promptHash: string
  tokenEstimate: number
  hitCount: number
  lastHitAt: string | null
  createdAt: string
  updatedAt: string
}

export type AiPromptCacheStats = {
  summary: {
    totalEntries: number
    totalHits: number
    totalCreations: number
    totalTokenEstimate: number
    estimatedSavedTokens: number
  }
  byRole: Array<{ role: string } & AiPromptCacheAggEntry>
  byTier: Array<{ tier: string } & AiPromptCacheAggEntry>
  top: AiPromptCacheRow[]
}

export type AiApplyLogFilter = {
  bookId?: string | null
  planId?: string | null
  outcome?: 'success' | 'failed' | null
  keyword?: string | null
  limit?: number
}

export type AiApplyLog = {
  id: string
  bookId: string | null
  planId: string | null
  stepId: string | null
  employeeType: string | null
  resultType: string
  applyMode: string
  targetSummary: string | null
  reviewStatus: string | null
  reviewHigh: number
  reviewWarn: number
  reviewInfo: number
  outcome: 'success' | 'failed'
  forced?: boolean
  errorMessage: string | null
  createdAt: string
}

export type AiPlanStepResult = {
  stepId: string
  employeeType: string
  action: string
  content: string
  generatedResult?: AiGeneratedResult | null
  deletePlan?: AiDeletePlan | null
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cachedPromptTokens?: number; cost: number; systemTokens: number; userTokens: number }
  cacheUsage?: AiCacheUsage
  contextResources?: AiContextResource[]
  status: 'success' | 'pending_confirm' | 'applied' | 'failed' | 'aborted'
  errorMessage?: string
}

export type AiStreamDone = {
  streamId: string
  content: string
  stopped?: boolean
  usage?: AiSendResponse['usage'] | null
  cacheUsage?: AiCacheUsage
  contextResources?: AiContextResource[]
  generatedResult?: AiGeneratedResult
  deletePlan?: AiDeletePlan
  agentPlan?: AiAgentPlan
  awaitingPlanConfirmation?: boolean
  planStepResults?: AiPlanStepResult[]
}

export type AiAgentProgressEvent = AiAgentProgressStep & {
  streamId: string
  agentPlan?: AiAgentPlan
}

export type AiStreamError = {
  streamId: string
  message: string
}

export type TokenUsageLog = {
  id: string
  bookId: string | null
  chapterId: string | null
  volumeId: string | null
  modelId: string | null
  action: string
  contextType: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedPromptTokens: number
  /** 思考 tokens（推理模型的 reasoning_tokens，属于 completionTokens 的一部分） */
  reasoningTokens?: number
  cost: number
  /** 模型调用次数：本次运行（聊天/写作）包含的模型请求轮数（意图分析 + 主循环各轮 + 工具内部子调用） */
  calls?: number
  requestText: string | null
  systemRequestText: string | null
  userRequestText: string | null
  responseText: string | null
  createdAt: string
  bookTitle: string | null
  chapterTitle: string | null
  volumeTitle: string | null
  modelName: string | null
  modelInputPrice?: number | null
  modelOutputPrice?: number | null
  modelCachedInputPrice?: number | null
}

export type TokenUsageLogFilter = {
  limit?: number
  page?: number
  pageSize?: number
  range?: 'today' | 'week' | 'month' | 'all'
  modelId?: string | null
  /** 按书名过滤作品（写入时的书名快照 / books.title） */
  bookTitle?: string | null
  /** 按动作（中文动作字符串）精确过滤 */
  action?: string | null
}

/** 筛选下拉的去重维度（作品按书名快照、模型按 id、动作按中文动作字符串） */
export type TokenLogFacets = {
  books: Array<{ bookTitle: string; deleted: boolean }>
  models: Array<{ modelId: string; modelName: string; provider: string | null }>
  actions: string[]
}

export type TokenUsageLogPage = {
  items: TokenUsageLog[]
  total: number
  page: number
  pageSize: number
  summary: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cachedPromptTokens: number
    reasoningTokens: number
    cost: number
    calls: number
  }
}

export type TokenUsageSummary = {
  todayTokens: number
  todayCachedTokens: number
  todayCost: number
  todayCalls: number
  monthCost: number
  monthCachedTokens: number
  monthCalls: number
  byModel: Array<{
    modelId: string | null
    modelName: string | null
    totalTokens: number
    promptTokens: number
    completionTokens: number
    cachedPromptTokens: number
    cost: number
  }>
}
