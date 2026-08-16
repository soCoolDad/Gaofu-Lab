// 角色聊天室模块共享类型
// 与 electron/db/schema.ts 中的 chat_room_* 表结构保持一致
// 该模块完全独立，不复用 role_dialogue_* 的任何类型。

export type ChatRoomRole = 'director' | 'author' | 'netizen' | 'character' | 'system'

/** 房间发言方式：sequential = 依次接龙；simultaneous = 在场角色同时各回一句 */
export type ChatRoomSpeakingMode = 'sequential' | 'simultaneous'

export type ChatRoomMessage = {
  id: string
  roomId: string
  order: number
  role: ChatRoomRole
  /** 角色消息时填（bookSettingEntries.id），用户/系统消息为 null */
  characterId: string | null
  characterName: string | null
  content: string
  /**
   * 结果提示：模型被 content_filter / 各类中断拦截时，把已生成的内容（content）+ 错误信息（errorNotice）同时保留。
   * UI 在气泡下方独立渲染红色错误块。错误信息不会进入后续角色的 context（context-builder 需过滤）。
   */
  errorNotice: string | null
  /**
   * 推理模型的"思考过程"完整文本：仅当模型支持 reasoning（DeepSeek-R1 / Qwen 思考 / Grok reasoning / OpenAI o-series 等）才会有内容。
   * 流式过程中通过 chatRoom:messageReasoning 事件实时推送到前端，落库后刷新页面仍可查看。
   * 不进 chat-room context-builder 的"历史对话"注入。
   */
  reasoning: string | null
  /** 生成该条消息的 model id（用户/系统消息为 null） */
  modelId: string | null
  /** 生成该条消息时实际发给模型的 messages 数组（JSON 字符串），用于"查看上下文" */
  modelMessages: string | null
  /** 该条消息的 token 消耗统计（用户/系统消息为 null）；cost 单位为人民币 */
  usage: ChatRoomMessageUsage | null
  createdAt: string
}

/** 单条聊天消息的 token 消耗统计（cost 单位：人民币） */
export type ChatRoomMessageUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedPromptTokens: number
  reasoningTokens: number
  /** 本次请求输入单价（元 / M tokens） */
  inputPrice: number
  /** 本次请求输出单价（元 / M tokens） */
  outputPrice: number
  /** 本次请求缓存命中单价（元 / M tokens） */
  cachedPrice: number
  /** 输入未命中部分金额 */
  missCost: number
  /** 输入缓存命中部分金额 */
  cacheCost: number
  /** 输出部分金额 */
  outputCost: number
  /** 总花费 */
  cost: number
}

/** 聊天室发言者身份 */
export type ChatRoomSender =
  | { role: 'director' }
  | { role: 'author' }
  | { role: 'netizen' }
  | { role: 'character'; characterId: string; characterName: string }

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

/** 聊天室选角色专用：bookSetting + bookMemory 合并去重后的角色（与剧情预演同源逻辑，独立实现） */
export type ChatRoomSelectableCharacter = {
  id: string
  name: string
  description: string
  detail: string
  source: 'setting' | 'memory' | 'merged'
}

// ─── IPC 输入类型 ───
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

export type SendTurnInput = {
  roomId: string
  /** 用户（导演/作者/网友，或扮演的角色）本回合说的话；为空字符串时表示"纯角色接龙"（不插入用户消息） */
  userContent: string
  /** 发送者身份 */
  sender: ChatRoomSender
  agentFallbackModelId?: string | null
}
