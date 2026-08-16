/**
 * Agent 前端类型定义
 */

/** 工具调用 */
export type AgentToolCall = {
  id: string
  name: string
  arguments: Record<string, any>
}

/** 工具执行结果 */
export type AgentToolResult = {
  id: string
  name: string
  success: boolean
  data: any
  error?: string
}

/** Pending 写操作 */
export type PendingWrite = {
  id: string
  type: 'book_info' | 'book_outline' | 'volume_list' | 'volume_outline' | 'chapter_list' | 'chapter_outline' | 'chapter_content' | 'book_setting' | 'delete_entity' | 'chapter_snapshot'
  title: string
  summary: string
  target: {
    bookId?: string
    volumeId?: string | null
    chapterId?: string | null
    settingType?: string
    entityType?: string
    entityIds?: string[]
  }
  applyMode: 'append' | 'replace' | 'insert' | 'merge' | 'none' | 'update'
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
  riskLevel: 'low' | 'medium' | 'high'
  applied: boolean
  /**
   * 是否是"目标前置操作"。true 时用户应用完本消息所有 isPrerequisite=true 的卡片后，
   * 前端会自动发送"已应用结果，请继续。"以触发模型下一步。
   */
  isPrerequisite?: boolean
  /**
   * 用户已拒绝本卡片。true 时 UI 展示"已拒绝：原因"状态，不展示重跑/拒绝按钮。
   * 原因存于 rejectReason。
   */
  rejected?: boolean
  /** 拒绝原因（用户在拒绝时填写的理由） */
  rejectReason?: string
}

/** 应用结果 */
export type ApplyResult = {
  success: boolean
  message: string
  sideEffects?: string[]
  createdId?: string
}

/** Agent 消息 */
export type AgentMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  /** 创建该消息时使用的模型 ID。重跑/拒绝等需要触发新 run 的场景下，从对应消息上读取以保证使用同一模型。 */
  modelId?: string
  /** 推理模型的"思考过程"流式文本（reasoning_content / reasoning / thinking） */
  reasoningContent?: string
  /** 工具调用历史 */
  toolCalls?: Array<{
    call: AgentToolCall
    result: AgentToolResult
    /** 工具开始执行的时间戳（ms）；tool_start 事件到达时写入 */
    startedAt?: number
    /** 工具结束的时间戳（ms）；tool_end 事件到达时写入 */
    finishedAt?: number
  }>
  /** 待应用的写操作 */
  pendingWrites?: PendingWrite[]
  /** Token 用量 */
  usage?: {
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
  /** 是否被中断 */
  aborted?: boolean
  /**
   * 模型调用失败时的错误消息（content_filter / 截断 / 网络错误 / 反代中断 等）。
   * 与 aborted 互斥：aborted = 用户主动停止；errorMessage = 模型端在协议层报错。
   * 两者都保留 token 统计和执行链（contextSnapshot.rounds）；UI 据此给消息打"失败"标。
   */
  errorMessage?: string
  /** 模型主动标记"应用完所有 PendingWrite 后需自动续跑"（调用了 mark_resume_after_apply 工具） */
  resumeAfterApply?: boolean
  /** 本消息由前端自动续跑触发（用户不是主动发起）；仅用于内部审计/UI 提示，模型不感知 */
  autoResumed?: boolean
  /** 本次请求上下文快照 */
  contextSnapshot?: {
    /** 完整系统提示词（静态+动态拼接，向后兼容） */
    systemPrompt: string
    /** 静态系统提示词（铁律部分，跨请求恒定，用于缓存命中） */
    staticSystemPrompt: string
    /** 动态上下文（bookId/书名/记忆等，随请求变化），可能为空 */
    dynamicContext?: string
    memoryText?: string
    tools: any[]
    userInput: string
    modelName: string
    /** 实际发送给模型的完整消息列表（含意图分析阶段） */
    fullMessages?: Array<{ role: string; content: string }>
    /** 按轮次分组的实际模型调用参数快照（含每轮耗时） */
    rounds?: Array<{
      label: string
      input: Array<{ role: string; content: string }>
      output?: Array<{ role: string; content: string; tool_calls?: any }>
      usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number; reasoningTokens?: number }
      durationMs?: number
    }>
  }
  createdAt: number
}

/** Agent 运行配置 */
export type AgentRunOptions = {
  bookId: string | null
  modelId: string
  chapterId?: string | null
  volumeId?: string | null
  userInput: string
  outputLanguage?: 'follow_input' | 'chinese' | 'english'
  displayInput?: string
  autoResumed?: boolean
}
