/**
 * Agent IPC 处理器
 *
 * 独立于 ai.ipc.ts，使用新的 tools-call Agent 系统
 *
 * IPC 通道：
 * - agent:run        启动 Agent 运行（流式）
 * - agent:apply      应用单个 PendingWrite
 * - agent:applyBatch 批量应用
 * - agent:stop       停止运行中的 Agent
 * - agent:listTools  列出所有工具定义
 *
 * 事件推送（main → renderer）：
 * - agent:chunk         流式内容片段
 * - agent:toolStart     工具开始执行
 * - agent:toolEnd       工具执行结束
 * - agent:pendingWrite  产生待应用的写操作
 * - agent:done          Agent 运行完成
 * - agent:error         Agent 运行出错
 */

import { ipcMain, BrowserWindow } from 'electron'
import { eq } from 'drizzle-orm'
import { getDb, getSqlite } from '../db'
import { books, chapters, modelProviders, applyLogs } from '../db/schema'
import { decodeModelApiKey } from './model.ipc'
import { v4 as uuidv4 } from 'uuid'

// 注册工具（副作用导入）
import '../agent/tools/register'

import { runAgent } from '../agent/agent-runner'
import { applyPendingWrite } from '../agent/apply-hooks'
import { listToolDefinitions } from '../agent/tools'
import { getAllToolPromptInfos, getToolPromptInfo, setToolPromptOverride, getOverridesFilePath } from '../agent/tools/tool-prompts'
import { summarizeAgentAction } from '../agent/tool-action-labels'
import type { PendingWrite, AgentRunResult } from '../agent/types'

// ─── 活跃运行追踪（用于 stop） ────────────────────────────────

const activeRuns = new Map<string, AbortController>()

// ─── 应用日志记录 ────────────────────────────────────────────

/** 从 PendingWrite 推导应用日志 resultType */
function deriveResultType(write: PendingWrite): string {
  return write.type || ''
}

/** 从 PendingWrite 推导目标摘要 */
function deriveTargetSummary(write: PendingWrite): string | null {
  const summary = write.preview?.title
    || write.data?.title
    || write.title
    || write.target?.chapterId
    || write.target?.volumeId
    || write.target?.bookId
    || null
  return summary ? String(summary).slice(0, 200) : null
}

/** 把 Agent 的 PendingWrite 应用结果写入 apply_logs */
function recordAgentApplyLog(write: PendingWrite, outcome: 'success' | 'failed', errorMessage?: string) {
  try {
    const db = getDb()
    db.insert(applyLogs).values({
      id: uuidv4(),
      bookId: write.target?.bookId || null,
      planId: null,
      stepId: null,
      employeeType: 'agent',
      resultType: deriveResultType(write),
      applyMode: write.applyMode || 'none',
      targetSummary: deriveTargetSummary(write),
      reviewStatus: null,
      reviewHigh: 0,
      reviewWarn: 0,
      reviewInfo: 0,
      outcome,
      forced: false,
      errorMessage: errorMessage || null,
      createdAt: new Date().toISOString(),
    }).run()
  } catch {
  }
}

// ─── IPC 注册 ────────────────────────────────────────────────

export function registerAgentIpc() {
  // 启动 Agent 运行
  ipcMain.handle('agent:run', async (event, data: {
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
  }) => {
    const streamId = data.streamId || uuidv4()
    const db = getDb()
    const win = BrowserWindow.fromWebContents(event.sender)

    // 解析模型
    const modelRow = db.select().from(modelProviders).where(eq(modelProviders.id, data.modelId)).get()
    if (!modelRow) {
      win?.webContents.send('agent:error', { streamId, message: '模型不存在' })
      return { streamId }
    }
    const model = decodeModelApiKey(modelRow)
    if (!model.apiKey || !model.modelName) {
      win?.webContents.send('agent:error', { streamId, message: '模型 API Key 或模型名称未配置' })
      return { streamId }
    }

    // 书籍信息（注入 system prompt）
    let bookTitle: string | undefined
    let bookDescription: string | undefined
    if (data.bookId) {
      const book = db.select().from(books).where(eq(books.id, data.bookId)).get()
      if (book) {
        bookTitle = book.title
        bookDescription = book.description || undefined
      }
    }

    // 创作上下文（注入 system prompt）
    let currentChapterOrder: number | undefined
    if (data.chapterId) {
      const ch = db.select({ sortOrder: chapters.sortOrder }).from(chapters).where(eq(chapters.id, data.chapterId)).get()
      if (ch) currentChapterOrder = ch.sortOrder
    }

    // 中断控制器
    const controller = new AbortController()
    activeRuns.set(streamId, controller)

    // 异步运行 Agent
    ;(async () => {
      try {
        const result: AgentRunResult = await runAgent({
          bookId: data.bookId,
          modelId: data.modelId,
          modelConfig: {
            baseUrl: model.baseUrl,
            apiKey: model.apiKey,
            modelName: model.modelName,
            maxOutputTokens: model.maxOutputTokens ?? undefined,
            maxContextTokens: model.maxContextTokens ?? undefined,
          },
          chapterId: data.chapterId,
          volumeId: data.volumeId,
          finalize: data.finalize,
          userInput: data.userInput,
          currentChapterOrder,
          bookTitle,
          bookDescription,
          outputLanguage: data.outputLanguage,
          contextDepth: data.contextDepth,
          injectWritingSettings: data.injectWritingSettings,
          streamTimeout: data.streamTimeout,
          appliedPendingWriteTypes: data.appliedPendingWriteTypes,
          history: data.history,
          writeContextVolumeOutline: data.writeContextVolumeOutline,
          writeContextChapterOutline: data.writeContextChapterOutline,
          writeContextPrevChapterOutline: data.writeContextPrevChapterOutline,
          writeContextPrevChapterContent: data.writeContextPrevChapterContent,
          writeContextNextChapterOutline: data.writeContextNextChapterOutline,
          writeContextPrevChapterMemory: data.writeContextPrevChapterMemory,
          writeContextTotalMemory: data.writeContextTotalMemory,
          signal: controller.signal,
          onChunk: (delta) => {
            win?.webContents.send('agent:chunk', { streamId, delta })
          },
          onReasoning: (delta) => {
            win?.webContents.send('agent:reasoning', { streamId, delta })
          },
          onToolStart: (toolCall) => {
            win?.webContents.send('agent:toolStart', { streamId, toolCall })
          },
          onToolEnd: (result) => {
            win?.webContents.send('agent:toolEnd', { streamId, result })
          },
          onPendingWrite: (write) => {
            win?.webContents.send('agent:pendingWrite', { streamId, write })
          },
        })

        // 记录 Token 用量
        let costDetails: {
          missCost: number
          cacheCost: number
          outputCost: number
          totalCost: number
          inputPrice: number
          outputPrice: number
          cachedPrice: number
        } | null = null
        try {
          const modelForCost = db.select().from(modelProviders).where(eq(modelProviders.id, data.modelId)).get()
          const inputPrice = modelForCost?.inputPrice || 0
          const outputPrice = modelForCost?.outputPrice || 0
          // 缓存命中价未填写时，默认使用输入价格（与模型设置页提示"留空则使用输入价格"一致）
          const cachedPrice = modelForCost?.cachedInputPrice ?? inputPrice
          const cachedTokens = result.usage.cachedPromptTokens || 0
          const missTokens = result.usage.promptTokens - cachedTokens
          const missCost = missTokens * inputPrice / 1_000_000
          const cacheCost = cachedTokens * cachedPrice / 1_000_000
          const outputCost = result.usage.completionTokens * outputPrice / 1_000_000
          const totalCost = missCost + cacheCost + outputCost

          costDetails = { missCost, cacheCost, outputCost, totalCost, inputPrice, outputPrice, cachedPrice }

          getSqlite().prepare(
            `INSERT INTO token_usage_logs (id, book_id, chapter_id, volume_id, model_id, action, context_type, prompt_tokens, completion_tokens, total_tokens, cached_prompt_tokens, reasoning_tokens, cost, calls, book_title, request_text, system_request_text, user_request_text, response_text, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'agent', ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', '', ?)`
          ).run(
            uuidv4(),
            data.bookId,
            data.chapterId || null,
            data.volumeId || null,
            data.modelId,
            // 用户可读的"动作"字符串：从本次 Agent 运行调用过的工具名派生
            // 例：只调用 generate_snapshot → "生成章节记忆"
            //     调用 create_chapters + write_chapter_content → "创建章节 + 写作正文"
            //     纯对话没调工具 → "对话"
            summarizeAgentAction((result.toolCallHistory || []).map((t) => t.call.name)),
            result.usage.promptTokens, result.usage.completionTokens, result.usage.totalTokens,
            cachedTokens, result.usage.reasoningTokens || 0, totalCost,
            // 模型调用次数：一次运行含多轮模型请求（意图分析 + 主循环各轮 + 工具内部子调用）
            result.modelCalls || 1,
            bookTitle || null, new Date().toISOString()
          )
        } catch {}

        // 更新 usage 费用明细
        const usageWithCost = costDetails
          ? {
              ...result.usage,
              cost: costDetails.totalCost,
              missCost: costDetails.missCost,
              cacheCost: costDetails.cacheCost,
              outputCost: costDetails.outputCost,
              inputPrice: costDetails.inputPrice,
              outputPrice: costDetails.outputPrice,
              cachedPrice: costDetails.cachedPrice,
            }
          : result.usage

        // 模型调用失败时仍走 agent:done 通道（保留 usage / contextSnapshot.rounds），
        // 不再走 agent:error —— UI 之前在 error 路径里只拿到 message，没有 token 统计和执行链。
        // 前端在 agent.store.onDone 里读 result.errored / errorMessage 区分"失败收尾"展示。
        win?.webContents.send('agent:done', {
          streamId,
          content: result.content,
          reasoning: result.reasoning || null,
          usage: usageWithCost,
          pendingWrites: result.pendingWrites,
          toolCallHistory: result.toolCallHistory,
          aborted: result.aborted,
          errored: result.errored || false,
          errorMessage: result.errorMessage || null,
          resumeAfterApply: result.resumeAfterApply,
          contextSnapshot: result.contextSnapshot,
        })
      } catch (err: any) {
        console.error('[agent:run] 执行失败:', err?.stack || err?.message || err)
        win?.webContents.send('agent:error', { streamId, message: err?.message || 'Agent 运行失败' })
      } finally {
        activeRuns.delete(streamId)
      }
    })()

    return { streamId }
  })

  // 应用单个 PendingWrite
  ipcMain.handle('agent:apply', async (_event, data: { write: PendingWrite; modelId?: string }) => {
    try {
      const result = await applyPendingWrite(data.write, data.modelId)
      recordAgentApplyLog(data.write, result.success ? 'success' : 'failed', result.success ? undefined : result.message)
      return result
    } catch (err: any) {
      recordAgentApplyLog(data.write, 'failed', err?.message || '应用失败')
      throw err
    }
  })

  // 批量应用
  ipcMain.handle('agent:applyBatch', async (_event, data: { writes: PendingWrite[]; modelId?: string }) => {
    const results = []
    for (const write of data.writes) {
      try {
        const r = await applyPendingWrite(write, data.modelId)
        recordAgentApplyLog(write, r.success ? 'success' : 'failed', r.success ? undefined : r.message)
        results.push({ writeId: write.id, ...r })
      } catch (err: any) {
        recordAgentApplyLog(write, 'failed', err?.message || '应用失败')
        results.push({ writeId: write.id, success: false, message: err?.message || '应用失败' })
      }
    }
    return results
  })

  // 停止运行
  ipcMain.handle('agent:stop', (_event, streamId: string) => {
    const controller = activeRuns.get(streamId)
    if (controller) {
      controller.abort()
      activeRuns.delete(streamId)
      return true
    }
    return false
  })

  // 列出工具定义
  ipcMain.handle('agent:listTools', () => {
    return listToolDefinitions()
  })

  // 获取工具的提示词信息（包含所有工具的默认值、覆盖状态、当前值）
  ipcMain.handle('agent:getToolPrompts', () => {
    const tools = listToolDefinitions()
    const promptInfos = getAllToolPromptInfos()
    // 合并工具定义和提示词信息
    return tools.map((tool) => {
      const promptInfo = promptInfos.find((p) => p.name === tool.name)
      return {
        ...tool,
        hasPromptOverride: promptInfo?.hasOverride ?? false,
        currentPrompt: promptInfo?.currentPrompt ?? null,
        defaultPrompt: promptInfo?.defaultPrompt ?? null,
      }
    })
  })

  // 更新指定工具的提示词覆盖
  ipcMain.handle('agent:updateToolPrompt', (_event, toolName: string, prompt: string | null) => {
    try {
      setToolPromptOverride(toolName, prompt)
      return { success: true, toolName }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  // 获取提示词覆盖文件路径（调试用）
  ipcMain.handle('agent:getOverridesPath', () => {
    return getOverridesFilePath()
  })
}
