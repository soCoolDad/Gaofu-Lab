/**
 * 工具注册表
 *
 * 每个工具包含：
 * - definition: 工具的 JSON Schema 定义（给模型看）
 * - handler: 执行函数（read 类直接返回结果，write 类产出 PendingWrite）
 */

import type { ToolDefinition, ToolResult, PendingWrite, ToolContext, ContextKey } from '../types'

/** 工具执行返回值 */
export type ToolHandlerResult = {
  /** read 工具的直接返回数据（成功时） */
  data?: any
  /** write 工具产出的 pending 写操作（成功时） */
  pendingWrite?: PendingWrite
  /** 错误信息（失败时，优先级高于 data.error） */
  error?: string
}

/** 工具处理函数 */
export type ToolHandler = (args: Record<string, any>, ctx: ToolContext) => Promise<ToolHandlerResult>

/** 注册的工具 */
export type RegisteredTool = {
  definition: ToolDefinition
  handler: ToolHandler
}

// ─── 注册表 ──────────────────────────────────────────────────

const registry = new Map<string, RegisteredTool>()

/** 注册工具 */
export function registerTool(tool: RegisteredTool) {
  registry.set(tool.definition.name, tool)
}

/** 批量注册工具 */
export function registerTools(tools: RegisteredTool[]) {
  for (const tool of tools) {
    registerTool(tool)
  }
}

/** 获取工具 */
export function getTool(name: string): RegisteredTool | undefined {
  return registry.get(name)
}

/** 列出所有工具定义（给模型看） */
export function listToolDefinitions(): ToolDefinition[] {
  return Array.from(registry.values()).map((t) => t.definition)
}

/** 判断工具是否存在 */
export function hasTool(name: string): boolean {
  return registry.has(name)
}

/**
 * 计算一组工具共同排除的上下文块集合（取各工具 excludedContexts 的**交集**）。
 * 只剔除被本轮所有预测工具都声明不需要的上下文，避免多工具同轮时误删某个工具仍需要的块。
 * 若任一工具无排除声明/列表为空，则交集为空（不剔除任何块）。
 */
export function getExcludedContexts(toolNames: string[]): Set<ContextKey> {
  const sets = toolNames
    .map((t) => new Set<ContextKey>(getTool(t)?.definition.excludedContexts || []))
    .filter((s) => s.size > 0)
  if (sets.length === 0) return new Set()
  return sets.reduce((acc, s) => {
    const next = new Set<ContextKey>()
    for (const k of acc) if (s.has(k)) next.add(k)
    return next
  })
}

// ─── 工具构造辅助函数 ────────────────────────────────────────

/** 构造 read 工具 */
export function defineReadTool(
  name: string,
  description: string,
  category: ToolDefinition['category'],
  parameters: ToolDefinition['parameters'],
  required: string[],
  handler: ToolHandler,
  excludedContexts?: ContextKey[],
): RegisteredTool {
  return {
    definition: { name, description, category, mode: 'read', parameters, required, excludedContexts },
    handler,
  }
}

/** 构造 write 工具
 *
 * 自动注入统一参数 `is_prerequisite`：所有 write 工具的 schema 里会自动追加一个可选布尔参数，
 * 让模型可以在产出 PendingWrite 的同一次工具调用里声明"这张卡是达成目标的前置步骤"。
 * handler 里的 pendingWrite 会自动接管 args.is_prerequisite → pendingWrite.isPrerequisite。
 *
 * 这样模型不再需要额外调用 mark_resume_after_apply 这个 meta 工具（省一次 model round）。
 */
export function defineWriteTool(
  name: string,
  description: string,
  category: ToolDefinition['category'],
  parameters: ToolDefinition['parameters'],
  required: string[],
  handler: ToolHandler,
  excludedContexts?: ContextKey[],
): RegisteredTool {
  const enhancedParameters = {
    ...parameters,
    is_prerequisite: {
      type: 'boolean',
      description: '本次操作是否为"前置步骤"。设为 true 时，应用后自动触发下一步。独立成果保持 false 或不传。',
    } as any,
  }
  const wrappedHandler: ToolHandler = async (args: any, ctx) => {
    const isPrerequisite = args?.is_prerequisite === true
    const result = await handler(args, ctx)
    if (result?.pendingWrite && isPrerequisite) {
      result.pendingWrite.isPrerequisite = true
    }
    return result
  }
  return {
    definition: { name, description, category, mode: 'write', parameters: enhancedParameters, required, excludedContexts },
    handler: wrappedHandler,
  }
}
