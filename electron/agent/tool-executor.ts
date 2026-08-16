/**
 * 工具执行器
 *
 * 职责：
 * - 接收模型的 tool_call 列表
 * - 逐个执行（read 工具立即返回数据，write 工具产出 PendingWrite）
 * - 返回 ToolResult[] 给模型回注 + PendingWrite[] 给前端展示
 */

import type { ToolCall, ToolResult, PendingWrite, ToolContext } from './types'
import { getTool } from './tools'
import { v4 as uuidv4 } from 'uuid'

/**
 * 递归归一化工具参数中的字面转义序列。
 *
 * 背景：部分模型在 tool_call JSON 里把换行输出成双重转义（\\n），
 * JSON.parse 之后字符串里留下的是字面量 "\n"（反斜杠+n 两个字符）而非真实换行，
 * 导致大纲/正文等长文本显示成一行内嵌 "\n" 的样子。
 *
 * 策略（与 agent-runner 里对 content 的兜底一致）：
 * 仅当字符串**不含真实换行**但**含字面 \n** 时才转换——含真实换行说明模型转义正确，
 * 此时字面 \n 可能是内容本身（如代码示例），不动它。
 * 递归覆盖嵌套对象/数组（如 create_volumes/create_chapters 的 items[].outline）。
 */
function normalizeLiteralEscapes(value: any): any {
  if (typeof value === 'string') {
    if (!/\n/.test(value) && /\\n/.test(value)) {
      return value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    }
    return value
  }
  if (Array.isArray(value)) return value.map(normalizeLiteralEscapes)
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {}
    for (const k of Object.keys(value)) out[k] = normalizeLiteralEscapes(value[k])
    return out
  }
  return value
}

/**
 * 执行工具调用列表
 *
 * @param toolCalls 模型输出的工具调用
 * @param ctx 工具上下文（bookId 等）
 * @returns { results: 回注给模型的结果, pendingWrites: 需用户确认的写操作 }
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  ctx: ToolContext,
): Promise<{ results: ToolResult[]; pendingWrites: PendingWrite[] }> {
  const results: ToolResult[] = []
  const pendingWrites: PendingWrite[] = []

  for (const call of toolCalls) {
    const tool = getTool(call.name)
    if (!tool) {
      results.push({
        id: call.id,
        name: call.name,
        success: false,
        data: null,
        error: `工具 "${call.name}" 不存在`,
      })
      continue
    }

    // 必需参数校验：如果模型漏传，直接告诉它，避免 handler 里访问 undefined.length 崩掉
    const requiredKeys = tool.definition.required || []
    // 统一归一化：把参数里的字面 \n（模型双重转义产物）转成真实换行，递归覆盖嵌套 items
    const rawArgs: Record<string, any> = (call.arguments && typeof call.arguments === 'object')
      ? normalizeLiteralEscapes(call.arguments)
      : {}
    const missing: string[] = []
    for (const key of requiredKeys) {
      const v = rawArgs[key]
      if (v === undefined || v === null) missing.push(key)
    }
    if (missing.length > 0) {
      results.push({
        id: call.id,
        name: call.name,
        success: false,
        data: null,
        error: `缺少必需参数：${missing.join('、')}。请补齐参数后重试。`,
      })
      continue
    }

    try {
      const handlerResult = await tool.handler(rawArgs, ctx)

      // 优先检查顶层 error 字段（明确的错误返回）
      if (handlerResult.error) {
        results.push({
          id: call.id,
          name: call.name,
          success: false,
          data: null,
          error: String(handlerResult.error),
        })
      } else if (handlerResult.pendingWrite) {
        // write 工具：产出 pending 结果
        pendingWrites.push(handlerResult.pendingWrite)
        results.push({
          id: call.id,
          name: call.name,
          success: true,
          data: {
            message: `已提交写操作请求，等待用户在卡片中确认后落库。当前请求中请勿再次调用该写工具。`,
            pendingWriteId: handlerResult.pendingWrite.id,
            title: handlerResult.pendingWrite.title,
            summary: handlerResult.pendingWrite.summary,
          },
        })
      } else if (handlerResult.data !== undefined) {
        // read 工具：直接返回数据（不再隐式检测 data.error，工具必须显式返回 error 字段表示失败）
        results.push({
          id: call.id,
          name: call.name,
          success: true,
          data: handlerResult.data,
        })
      } else {
        results.push({
          id: call.id,
          name: call.name,
          success: true,
          data: { message: '操作完成' },
        })
      }
    } catch (err: any) {
      results.push({
        id: call.id,
        name: call.name,
        success: false,
        data: null,
        error: err?.message || '工具执行失败',
      })
    }
  }

  return { results, pendingWrites }
}

/** 生成 PendingWrite 的辅助函数 */
export function createPendingWrite(opts: {
  type: PendingWrite['type']
  title: string
  summary: string
  target?: PendingWrite['target']
  applyMode?: PendingWrite['applyMode']
  data: PendingWrite['data']
  preview?: PendingWrite['preview']
  riskLevel?: PendingWrite['riskLevel']
}): PendingWrite {
  return {
    id: uuidv4(),
    type: opts.type,
    title: opts.title,
    summary: opts.summary,
    target: opts.target || {},
    applyMode: opts.applyMode || 'none',
    data: opts.data,
    preview: opts.preview,
    riskLevel: opts.riskLevel || 'low',
    applied: false,
  }
}
