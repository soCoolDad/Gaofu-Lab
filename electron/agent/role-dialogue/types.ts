// 剧情预演模块共享类型
// 与 electron/db/schema.ts 中的 role_dialogue_* 表结构保持一致

export type SnippetMessage = {
  characterId: string
  characterName: string
  /** 公开内容（说出口的话 + 动作/神态） */
  publicContent: string
  /** 内心独白（没说出口的心思）—— 剧情预演已不再产出，新消息永远为空字符串（字段保留以保持向后兼容） */
  innerThought: string
  /**
   * 结果提示：模型调用失败 / 拒绝生成时的错误信息（含具体 finish_reason / 拦截原因等）。
   * 与 publicContent 独立：
   *   - publicContent：保留已生成的剧情正文
   *   - errorNotice：错误信息单独存，让 UI 能在气泡下方独立渲染红色提示块
   * 不进 context-builder 的"历史对话"注入（避免错误消息污染后续角色的 prompt）。
   */
  errorNotice?: string
  /**
   * 推理模型的"思考过程"完整文本：仅当模型支持 reasoning（DeepSeek-R1 / Qwen 思考 / Grok reasoning / OpenAI o-series 等）才会有内容。
   * 流式过程中通过 roleDialogue:snippetReasoning 事件实时推送到前端，落库后刷新页面仍可查看。
   * 不进 context-builder 的"历史对话"注入（避免思考过程污染后续角色的 prompt）。
   */
  reasoning?: string
  /** 生成该条发言的 model id（可能为 null 表示使用兜底） */
  modelId: string | null
  /** 该角色发言的 token 消耗统计（与聊天室 ChatRoomMessageUsage 同结构）；无则 null */
  usage?: SnippetUsage | null
  /** 生成该角色发言时实际发给模型的 messages 数组（JSON 字符串），用于"查看上下文" */
  modelMessages?: string | null
}

/** 单条角色发言的 token 消耗统计（与聊天室 ChatRoomMessageUsage 同结构；cost 单位：人民币） */
export type SnippetUsage = {
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
  /**
   * 片段类型：
   *   - 'snippet'（默认）：常规角色发言片段，由多个角色的 publicContent 组成
   *   - 'summary'：剧情预演"总结片段"——把多轮对话压缩成一段完整剧情，作为新的上下文起点；
   *                之前的片段仍保留显示，但不再注入到后续模型的 context。
   * summary 的 consolidatedContent 存到 messages[0].publicContent；
   * 视角选择存到 messages[0].characterName（如"旁白视角"或具体角色名）；
   * 覆盖的原片段 id 列表存到 summaryCoveredSnippetIds。
   */
  kind: 'snippet' | 'summary'
  summaryView: 'first-person' | 'third-person' | null
  summaryViewCharacterId: string | null
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

/** 用于在 IPC 层直接复用 */
export type CreateRoomInput = {
  bookId: string
  title: string
  situation: string
  chapterId?: string | null
  defaultModelId?: string | null
  injectWritingSettings?: boolean
}

export type UpdateRoomInput = {
  title?: string
  situation?: string
  chapterId?: string | null
  defaultModelId?: string | null
  injectWritingSettings?: boolean
}

export type CreateRunInput = {
  roomId: string
  characterIds: string[]
}

export type CreateSnippetInput = {
  runId: string
  order: number
  characterIds: string[]
  messages: SnippetMessage[]
  authorFactUpdate?: AuthorFactUpdate | null
}

export type UpdateSnippetInput = {
  messages?: SnippetMessage[]
  authorFactUpdate?: AuthorFactUpdate | null
}
