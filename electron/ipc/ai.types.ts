import type { DecodedModel } from './model.ipc'

// ─── 意图分析 ───────────────────────────────────────────────

export type IntentAnalystMinimal = {
  mode: 'chat' | 'execute'
  target: 'book' | 'custom'
  location:
    | 'book' | 'outline' | 'volumes' | 'chapters' | 'chapterContent'
    | 'characters' | 'locations' | 'items' | 'skills' | 'scenes'
    | 'factions' | 'systems' | 'inspirations' | 'foreshadowings'
    | 'chapter_snapshot'
  action: 'new' | 'view' | 'edit' | 'remove' | 'finalize'
  targetIndex: number | null
  locationIndex: number | null
}

// ─── Agent 规划 ─────────────────────────────────────────────

export type TargetRef = {
  scope: 'book' | 'volume' | 'chapter' | 'character' | 'selection' | 'workspace'
  entityType: 'book' | 'volume' | 'chapter' | 'character' | 'text' | 'workspace'
  entityId?: string | null
  entityIds?: string[]
  field?: 'outline' | 'summary' | 'content' | 'detail' | 'description' | null
  label: string
  confidence: number
  resolution: 'explicit' | 'current_ui' | 'ordinal' | 'semantic' | 'fallback' | 'clarify'
}

export type ContextRole =
  | 'book_info' | 'global_outline' | 'target_content' | 'target_outline'
  | 'volume_outline' | 'chapter_outline' | 'neighbor_chapter_content'
  | 'neighbor_chapter_outline' | 'character_profile' | 'chat_history'
  | 'custom_constraint' | 'book_setting' | 'book_index'
  | 'employee_system_prompt' | 'execution_instruction'
  | 'structured_output_instruction' | 'task_context' | 'planner_rules'
  | 'planner_dynamic_input' | 'reviewer_rules' | 'plan_summary'
  | 'prev_step_result' | 'previously_applied_summary' | 'snapshot'

export type ContextRequirement = {
  role: ContextRole
  scope: 'book' | 'target' | 'target_parent' | 'neighbors' | 'characters' | 'chat' | 'custom' | 'index'
  relation?: 'self' | 'previous' | 'next' | 'previous_n' | 'next_n' | 'all' | 'mentioned_or_active'
  count?: number
  required?: boolean
  reason: string
}

export type SettingContextMode = 'none' | 'summary' | 'detail'

export type ContextIncludePlan = {
  allBooks?: boolean
  bookIndex?: 'none' | 'focused' | 'all'
  bookInfo?: boolean
  globalOutline?: boolean
  volumes?: 'none' | 'target' | 'summary_all' | 'detail_all'
  chapters?: 'none' | 'target' | 'neighbors' | 'summary_all'
  chapterContent?: 'none' | 'target' | 'previous_tail' | 'neighbors_tail'
  settings?: { mode?: SettingContextMode; focusedTypes?: string[]; relatedTypes?: string[] }
  chatHistory?: number
}

export type ContextPlan = {
  strategy: 'minimal' | 'balanced' | 'full'
  maxTokens: number
  required: ContextRequirement[]
  optional: ContextRequirement[]
  include?: ContextIncludePlan
}

export type AgentPlanOutputContract = {
  type: 'answer' | 'novel_text' | 'outline' | 'volume_list' | 'chapter_list'
    | 'book_setting_list' | 'volume_outline' | 'chapter_outline'
    | 'book_info_update' | 'delete_plan' | 'chapter_snapshot'
  applyTarget: 'none' | 'editor' | 'outline' | 'volumes' | 'chapters'
    | 'book_settings' | 'book_info' | 'delete' | 'chapter'
  recommendedApplyMode: 'none' | 'append' | 'replace' | 'insert'
  showApplyButtons: boolean
}

export type AgentPlanStep = {
  stepId: string
  employeeType: string
  employeeName?: string
  action: string
  target?: string
  targetRef?: TargetRef
  focusedSettingTypes?: string[]
  contextPlan?: ContextPlan
  executionInstruction: string
  outputContract: AgentPlanOutputContract
  dependsOn?: string[]
  parallelGroupId?: string | null
  status?: 'pending' | 'running' | 'success' | 'pending_confirm' | 'applied' | 'failed' | 'skipped' | 'aborted'
  reason?: string
}

export type ReviewLevel = 'high' | 'warn' | 'info'

export type ReviewIssue = {
  id: string
  level: ReviewLevel
  message: string
  suggestion?: string
  target?: { stepId?: string; outputType?: string; path?: string }
}

export type AgentPlanReview = {
  enabled: boolean
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  summary?: string
  issues?: ReviewIssue[]
  counts?: { high: number; warn: number; info: number }
  reviewedAt?: number
  rawContent?: string
}

export type AgentPlan = {
  planId?: string
  mode: 'chat' | 'execute'
  intent: string
  target: string
  targetRef: TargetRef
  employeeType: string
  confidence: number
  contextType: string
  focusedSettingTypes?: string[]
  contextPlan: ContextPlan
  executionInstruction: string
  outputContract: AgentPlanOutputContract
  steps?: AgentPlanStep[]
  review?: AgentPlanReview
  pendingBookId?: string | null
  autoConfirm?: boolean
  plannerUsage?: AgentPlanResult['plannerUsage']
  minimal?: IntentAnalystMinimal
}

export type AgentPlanResult = {
  plan: AgentPlan
  plannerUsage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cachedPromptTokens?: number
    requestText: string
    systemPrompt?: string
    dynamicPrompt?: string
    responseText: string
    model?: DecodedModel
    cacheUsage?: CacheUsageItem[]
    promptResources?: ContextResource[]
    dynamicResource?: ContextResource
  }
}

// ─── 上下文 ─────────────────────────────────────────────────

export type CacheType = string
export type CacheUsageStatus = 'hit' | 'updated' | 'created'

export type CacheUsageItem = {
  cacheType: CacheType
  status: CacheUsageStatus
}

export type ContextResource = {
  key: string
  role: ContextRole
  title: string
  type: '自动' | '自定义'
  enabled: boolean
  content: string
  tokenEstimate: number
  priority: number
  purpose: string
  entityType?: TargetRef['entityType']
  entityId?: string | null
  field?: TargetRef['field']
  relation?: string
  cacheMode?: 'raw'
  cacheTier?: 'fixed' | 'possible' | 'dynamic'
  cacheReason?: string
  cacheStatus?: CacheUsageStatus
}

export type PromptCacheEntry = {
  hash: string
  tokenEstimate: number
  content: string
  hitCount: number
  updatedAt: number
}

// ─── 请求/响应数据 ───────────────────────────────────────────

export type TokenLogFilterData = {
  limit?: number
  page?: number
  pageSize?: number
  range?: 'today' | 'week' | 'month' | 'all'
  modelId?: string | null
  /** 按作品过滤：优先匹配写入时的书名快照 book_title，老记录书名为空时回退匹配 books.title */
  bookTitle?: string | null
  /** 按动作过滤：匹配 token_usage_logs.action 中的单个中文动作标签（如"对话""写作正文"）。组合动作（"创建章节 + 写作正文"）也会被命中。 */
  action?: string | null
}

/** 用于筛选下拉的去重维度：作品按书名（快照或 books.title）、模型按 id、动作按拆解后的中文动作标签。 */
export type TokenLogFacets = {
  books: Array<{ bookTitle: string; deleted: boolean }>
  models: Array<{ modelId: string; modelName: string }>
  actions: string[]
}

// ─── 数据块解析 ─────────────────────────────────────────────

export type ParsedAiDataBlock = {
  location: string
  action: string
  dbIndex: string
  content: string
}

// ─── 生成结果与应用 ─────────────────────────────────────────

export type AiGeneratedResult = {
  resultId?: string
  type: 'book_outline' | 'volume_list' | 'volume_outline' | 'chapter_list'
    | 'chapter_outline' | 'chapter_content' | 'chapter_content_list'
    | 'book_setting_list' | 'book_info_update' | 'chat_answer'
    | 'delete_plan' | 'chapter_snapshot'
  target?: {
    bookId?: string
    volumeId?: string | null
    chapterId?: string | null
    characterId?: string | null
    field?: string | null
  }
  applyMode?: 'append' | 'replace' | 'insert' | 'merge' | 'none'
  data: { content?: string; items?: any[]; [key: string]: any }
  preview?: { title?: string; summary?: string; content?: string; items?: any[] }
  metadata?: Record<string, any>
}
