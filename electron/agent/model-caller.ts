/**
 * 模型调用器（Agent 专用）
 *
 * 支持两种模式：
 * 1. 原生 function calling：传入 tools 参数，模型返回 tool_calls
 * 2. JSON 降级：不传 tools，在 system prompt 中描述工具，模型在 content 中输出 JSON
 *
 * 流式处理：
 * - content delta → onChunk 回调
 * - tool_calls delta → 累积，在结束时返回完整 tool_calls
 */

import { Worker } from 'node:worker_threads'
import { jsonrepair } from '../utils/jsonrepair'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { aiSettings } from '../db/schema'
import type { ToolCall } from './types'

/** 从 SQLite 的 ai_settings 表读出当前用户的"模型读取超时"设置。读不到时返回 null（让 worker 走默认 120s）。 */
function readStreamTimeoutFromSettings(): number | null {
  try {
    const row = getDb().select({ data: aiSettings.data })
      .from(aiSettings)
      .where(eq(aiSettings.id, 'default'))
      .get()
    if (!row?.data) return null
    const parsed = JSON.parse(row.data) as { streamTimeout?: number }
    const v = Number(parsed?.streamTimeout)
    if (!Number.isFinite(v) || v < 0 || v > 600) return null
    return v
  } catch {
    return null
  }
}

/**
 * 判定 finishReason 是否代表"模型自然完成"。
 * - stop / tool_calls / function_call：模型说完了，正常收尾
 * - length / max_tokens / token_limit / content_filter / 其他：异常收尾，按错误处理
 */
function isNormalFinishReason(fr: string | null | undefined): boolean {
  if (!fr) return false
  return fr === 'stop' || fr === 'tool_calls' || fr === 'function_call'
}

// ─── Worker 脚本（支持 tools 参数 + tool_calls 流式累积） ─────

/**
 * 把 utils/jsonrepair 的实现注入 Worker 脚本，使 worker 不再 require 外部 jsonrepair 包
 * （打包后 asar 里拿不到第三方包，避免 MODULE_NOT_FOUND）。
 *
 * 实现方式：jsonrepair.toString() 取编译后函数源码注入。这要求
 * electron/utils/jsonrepair.ts 的 jsonrepair 必须「自包含」（不引用模块级变量），
 * 否则 Worker 内会 ReferenceError —— 约束已写在该文件头部注释里。
 * 注意不能用 JSON.stringify(fn)：函数不可 JSON 序列化，只会得到 undefined。
 */
function inlineJsonrepair(): string {
  return `
const __jsonrepair_source = ${jsonrepair.toString()};
function jsonrepair(input) { return __jsonrepair_source(input); }
`
}

function getAgentWorkerScript() {
  // worker 内无法通过 require 拿到项目里的 TS 模块，直接把 jsonrepair 实现字符串化注入。
  // 这样打包后 asar 不再依赖第三方 jsonrepair，彻底避免 MODULE_NOT_FOUND。
  return `
    const { parentPort } = require('node:worker_threads');
    ${inlineJsonrepair()}

    function normalizeBaseUrl(baseUrl) {
      const raw = (baseUrl || 'https://api.openai.com/v1').replace(/\\/+$/, '');
      if (raw.endsWith('/chat/completions')) return raw;
      return raw + '/chat/completions';
    }

    // worker 内部副本（与主线程 helper 同步）。worker 字符串内拿不到主进程闭包，
    // 因此这里必须再定义一次。
    function isNormalFinishReason(fr) {
      if (!fr) return false;
      return fr === 'stop' || fr === 'tool_calls' || fr === 'function_call';
    }

    function buildBody(payload) {
      // 统一使用 OpenAI 兼容协议，不做 provider 区分。
      // 缓存由各 provider 自动管理（DeepSeek / OpenAI / xAI / 智谱 / 通义 等均支持自动前缀匹配）。
      const messages = payload.messages.map((m) => ({ ...m }));
      const body = {
        model: payload.modelName,
        messages,
      };
      // ── 采样参数（来自「模型管理 → 编辑模型 → 采样参数」，由主线程 resolveSamplingParams 算好）──
      // 未配置的项（null/undefined）不写进请求体，让 provider 用自己的默认值，避免"凭空发 0/1"。
      if (payload.temperature !== undefined && payload.temperature !== null) {
        body.temperature = payload.temperature;
      }
      if (payload.topP !== undefined && payload.topP !== null) {
        body.top_p = payload.topP;
      }
      if (payload.frequencyPenalty !== undefined && payload.frequencyPenalty !== null) {
        body.frequency_penalty = payload.frequencyPenalty;
      }
      if (payload.presencePenalty !== undefined && payload.presencePenalty !== null) {
        body.presence_penalty = payload.presencePenalty;
      }
      // 输出 Token 上限：显式限制单次回复最大 token 数，避免长 JSON（如章节正文）被 provider 默认上限截断。
      if (payload.maxOutputTokens && payload.maxOutputTokens > 0) {
        body.max_tokens = payload.maxOutputTokens;
      }
      if (payload.tools && payload.tools.length > 0) {
        body.tools = payload.tools;
        body.tool_choice = payload.tool_choice || 'auto';
      }
      if (payload.stream) {
        body.stream = true;
        body.stream_options = { include_usage: true };
      }
      return body;
    }

    function pickContent(data) {
      return data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || '';
    }
    function pickDeltaContent(data) {
      return data?.choices?.[0]?.delta?.content || data?.choices?.[0]?.text || data?.choices?.[0]?.message?.content || '';
    }
    // 推理模型（DeepSeek-R1 / Qwen 思考 / Grok reasoning / OpenAI o-series 等）在"思考阶段"
    // 把内容放在 reasoning_content / reasoning / thinking 字段里流式输出，而真正的 delta.content
    // 直到思考结束才出现。之前 worker 只读取 delta.content，导致思考阶段完全不触发 chunk，
    // 界面长时间空转、答案最后"砰"地一次性出现。这里把推理内容也逐块捞出并回传。
    function pickReasoning(data) {
      return data?.choices?.[0]?.delta?.reasoning_content
        || data?.choices?.[0]?.delta?.reasoning
        || data?.choices?.[0]?.delta?.thinking
        || data?.choices?.[0]?.message?.reasoning_content
        || data?.choices?.[0]?.message?.reasoning
        || data?.choices?.[0]?.message?.thinking
        || '';
    }
    function pickToolCalls(data) {
      return data?.choices?.[0]?.message?.tool_calls || null;
    }
    function pickDeltaToolCalls(data) {
      return data?.choices?.[0]?.delta?.tool_calls || null;
    }
    function pickFinishReason(data) {
      return data?.choices?.[0]?.finish_reason || null;
    }

    // 累积流式 tool_calls 片段
    function mergeToolCallAccumulator(acc, deltaCalls) {
      if (!deltaCalls) return;
      for (const dc of deltaCalls) {
        const idx = dc.index || 0;
        if (!acc[idx]) {
          acc[idx] = { id: dc.id || '', type: 'function', function: { name: '', arguments: '' } };
        }
        if (dc.id) acc[idx].id = dc.id;
        if (dc.function?.name) acc[idx].function.name += dc.function.name;
        if (dc.function?.arguments) {
          if (typeof dc.function.arguments === 'string') {
            acc[idx].function.arguments += dc.function.arguments;
          } else if (typeof dc.function.arguments === 'object') {
            // 某些非标准 API 可能在非末次 delta 中发送已解析的对象 arguments，
            // 序列化为 JSON 字符串后追加，避免替换已累积的字符串内容
            acc[idx].function.arguments += JSON.stringify(dc.function.arguments);
          }
        }
      }
    }

    function buildErrorMessage(error, payload) {
      const url = normalizeBaseUrl(payload?.baseUrl);
      const causeMessage = error?.cause?.message || error?.cause?.code || error?.code || '';
      const message = error?.message || 'AI 请求失败';
      if (message === 'fetch failed' || causeMessage) {
        return ['AI 请求失败：fetch failed', '请求地址：' + url, '模型：' + (payload?.modelName || '未配置'), causeMessage ? '底层原因：' + causeMessage : '可能原因：网络不可达、Base URL 填写错误、代理/证书问题'].join('\\n');
      }
      return ['AI 请求失败：' + message, '请求地址：' + url, '模型：' + (payload?.modelName || '未配置')].join('\\n');
    }

    async function runStream(payload) {
      const controller = new AbortController();
      let idleTimedOut = false;
      let totalTimedOut = false;
      parentPort.on('message', (message) => {
        if (message?.type === 'abort') controller.abort();
      });

      try {
        // 模型读取超时（同时承担 idle 与 total 两种含义）：
        // - idle：SSE 连续两条 data: 行间超过此时间未收到新数据
        // - total：从发起 fetch 到收到 [DONE] / finish_reason 的整请求总耗时
        // 设 0 或负数 = 关闭两个计时器（用户主动选择不自动中断；此时改由下方的"未正常收尾检测"在 SSE 协议层判断是否中断）。
        const streamTimeoutSec = Number(payload.streamTimeout);
        const streamTimeoutMs = (Number.isFinite(streamTimeoutSec) && streamTimeoutSec > 0) ? streamTimeoutSec * 1000 : 0;
        const timeoutEnabled = streamTimeoutMs > 0;
        let idleTimer = null;
        let totalTimer = null;
        const resetIdleTimer = () => {
          if (idleTimer) clearTimeout(idleTimer);
          if (!timeoutEnabled) return;
          idleTimer = setTimeout(() => {
            idleTimedOut = true;
            controller.abort();
            parentPort.postMessage({ type: 'error', message: '模型读取超时：' + (streamTimeoutMs / 1000) + ' 秒内未收到新数据，连接已自动中断。可在设置中调整超时时间。' });
          }, streamTimeoutMs);
        };
        if (timeoutEnabled) {
          // total 计时器：整请求总耗时上限，到点不管是否有数据都中断。
          totalTimer = setTimeout(() => {
            totalTimedOut = true;
            controller.abort();
            parentPort.postMessage({ type: 'error', message: '调用超时：流式请求总耗时超过 ' + (streamTimeoutMs / 1000) + ' 秒，已自动中断。可在设置中调整超时时间。' });
          }, streamTimeoutMs);
        }

        const body = buildBody(payload);
        const bodyString = JSON.stringify(body);
        parentPort.postMessage({ type: 'request_dump', url: normalizeBaseUrl(payload.baseUrl), body: bodyString });
        const response = await fetch(normalizeBaseUrl(payload.baseUrl), {
          method: 'POST',
          signal: controller.signal,
          headers: { Authorization: 'Bearer ' + payload.apiKey, 'Content-Type': 'application/json' },
          body: bodyString,
        });
        if (!response.ok) {
          const text = await response.text()
          // 尝试从错误响应 body 中提取 usage（部分 provider 在错误响应里也带 usage 信息，方便计费核对）
          let errUsage = null
          try {
            const errJson = JSON.parse(text)
            errUsage = errJson?.usage || errJson?.error?.usage || null
          } catch {}
          const err = new Error(text || 'AI 请求失败：HTTP ' + response.status)
          if (errUsage) err.usage = errUsage
          throw err
        }
        if (!response.body) throw new Error('模型未返回流式响应');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let content = '';
        let reasoning = '';
        let usage = null;
        const toolCallAcc = [];
        let finishReason = null;
        // SSE 协议层是否正常收尾：[DONE] 行或 finish_reason 任一命中即视为正常结束。
        // 用于"关闭 idle 超时"场景下识别 provider/反代中途切断的"输出一半"情况。
        let sseProperlyClosed = false;

        const handleLine = (line) => {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) return;
          const raw = trimmed.replace(/^data:\\s*/, '');
          if (!raw) return;
          if (raw === '[DONE]') { sseProperlyClosed = true; return; }
          resetIdleTimer(); // 每收到一条有效数据就重置超时
          try {
            const json = JSON.parse(raw);
            // provider 偶发在 SSE 流中推 {"error": {...}} 行（HTTP 200 但协议层报错），
            // 立即停止后续累积并把错误信息透传给上层。
            if (json?.error) {
              parentPort.postMessage({
                type: 'error',
                message: '模型返回错误：' + (json.error.message || json.error.code || JSON.stringify(json.error).slice(0, 500)),
              });
              return;
            }
            if (json?.usage) usage = json.usage;
            const delta = pickDeltaContent(json);
            if (delta) { content += delta; parentPort.postMessage({ type: 'chunk', delta }); }
            const rsn = pickReasoning(json);
            if (rsn) { reasoning += rsn; parentPort.postMessage({ type: 'reasoning', delta: rsn }); }
            mergeToolCallAccumulator(toolCallAcc, pickDeltaToolCalls(json));
            const curFinishReason = pickFinishReason(json);
            if (curFinishReason) finishReason = curFinishReason;
            // 正常完成（stop / tool_calls / function_call）才算"协议层正常收尾"。
            // 其他 finishReason 值（length、content_filter、provider 私有截断值等）一律按异常处理，
            // 留给推 done 前的统一判别去推 error 事件。
            if (curFinishReason && isNormalFinishReason(curFinishReason)) sseProperlyClosed = true;
          } catch {}
        };
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\\n');
          buffer = lines.pop() || '';
          for (const line of lines) handleLine(line);
        }
        if (buffer) handleLine(buffer);
        if (idleTimer) clearTimeout(idleTimer); // 流正常结束，清除空闲超时计时器
        if (totalTimer) clearTimeout(totalTimer); // 流正常结束，清除整请求总耗时计时器
        // 异常 finishReason 统一处理：模型在协议层告知"我没正常结束"（length / content_filter / 私有截断值），
        // 按错误推回上层，让 UI 卡片上能看到具体原因。已输出 content/reasoning/usage 一并带在消息里，
        // 上层可以保留已生成的部分内容落库展示，而不是全部丢弃。
        if (finishReason && !isNormalFinishReason(finishReason)) {
          const hint = finishReason === 'length' || finishReason === 'max_tokens' || finishReason === 'token_limit'
            ? '（输出被截断）'
            : finishReason === 'content_filter'
              ? '（模型因内容审核未生成完成）'
              : ''
          parentPort.postMessage({
            type: 'error',
            message: '模型响应异常：finish_reason=' + JSON.stringify(finishReason) + ' ' + hint + '。已输出 content.length=' + content.length + ' reasoning.length=' + reasoning.length,
            content, reasoning, usage, finishReason,
          });
          return;
        }
        // 关闭超时场景下（timeoutEnabled=false）：SSE 协议层未正常收尾（既没 [DONE] 也没 finish_reason），
        // 说明 provider / 反代在中途切断了流（典型：反代 idle 关闭、网关限流），
        // 这种"输出一半"的情况按错误处理，避免被当成"模型自然结束"导致半句话落卡片。
        // 开启超时场景下：已有"模型读取超时 / 调用超时"错误路径，重复判别无意义，跳过。
        if (!timeoutEnabled && !sseProperlyClosed) {
          parentPort.postMessage({
            type: 'error',
            message: '连接中断：流式响应未正常结束（可能在输出一半时被网络/反代切断）。已输出 content.length=' + content.length + ' reasoning.length=' + reasoning.length,
            content, reasoning, usage, finishReason,
          });
          return;
        }
        const finalToolCalls = Object.values(toolCallAcc).filter(tc => tc.id || tc.function.name);
        // 修复 tool_call arguments 中的 JSON 问题：某些模型未正确转义 \\n 等字符，
        // 导致 SSE 行解析截断，累积后的 arguments 不是合法 JSON。
        for (const tc of finalToolCalls) {
          if (tc.function?.arguments && typeof tc.function.arguments === 'string') {
            try { JSON.parse(tc.function.arguments) } catch {
              // 先尝试修复常见转义问题
              let fixed = tc.function.arguments
                .replace(/\\n/g, '\\\\n')
                .replace(/\\r/g, '\\\\r')
                .replace(/\\t/g, '\\\\t');
              try { JSON.parse(fixed); tc.function.arguments = fixed; } catch {
                // jsonrepair 兜底：处理未转义双引号等更复杂的 JSON 格式问题
                try { tc.function.arguments = jsonrepair(tc.function.arguments); } catch {}
              }
            }
          }
        }
        parentPort.postMessage({ type: 'done', content, reasoning, usage, toolCalls: finalToolCalls.length ? finalToolCalls : null, finishReason });
      } catch (error) {
        if (error?.name === 'AbortError') {
          // 空闲超时已在 idleTimer 回调中发送了 error 消息，这里不再重复
          if (!idleTimedOut) {
            parentPort.postMessage({ type: 'aborted' });
          }
        } else {
          const errUsage = error?.usage || null
          parentPort.postMessage({
            type: 'error',
            message: buildErrorMessage(error, payload),
            ...(errUsage ? { usage: errUsage } : {}),
          })
        }
      }
    }

    async function runOnce(payload) {
      const apiKey = payload?.apiKey || '';
      const controller = new AbortController();
      parentPort.on('message', (message) => {
        if (message?.type === 'abort') controller.abort();
      });
      // 整请求总耗时超时（与流式共用 streamTimeout 设置）：非流式没有"分块进度"参考，
      // 因此只能测整请求总耗时。设 0 或负数 = 关闭超时。
      const streamTimeoutSec = Number(payload.streamTimeout);
      const streamTimeoutMs = (Number.isFinite(streamTimeoutSec) && streamTimeoutSec > 0) ? streamTimeoutSec * 1000 : 0;
      const timeoutEnabled = streamTimeoutMs > 0;
      let totalTimer = null;
      if (timeoutEnabled) {
        totalTimer = setTimeout(() => {
          controller.abort();
          parentPort.postMessage({ type: 'error', message: '调用超时：非流式请求在 ' + (streamTimeoutMs / 1000) + ' 秒内未返回，已自动中断。可在设置中调整超时时间。' });
        }, streamTimeoutMs);
      }
      try {
        const body = buildBody(payload);
        const bodyString = JSON.stringify(body);
        parentPort.postMessage({ type: 'request_dump', url: normalizeBaseUrl(payload.baseUrl), body: bodyString });
        const response = await fetch(normalizeBaseUrl(payload.baseUrl), {
          method: 'POST',
          signal: controller.signal,
          headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
          body: bodyString,
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || 'AI 请求失败：HTTP ' + response.status);
        }
        const data = await response.json();
        // provider 偶发在 HTTP 200 但协议层返回 {"error": {...}} 的情况
        if (data?.error) {
          throw new Error('模型返回错误：' + (data.error.message || data.error.code || JSON.stringify(data.error).slice(0, 500)));
        }
        // provider 异常返回：choices 为空
        if (!Array.isArray(data?.choices) || data.choices.length === 0) {
          throw new Error('模型返回异常：choices 为空。原始响应：' + JSON.stringify(data).slice(0, 500));
        }
        // 异常 finishReason：模型在协议层告知"我没正常结束"（length / content_filter / 私有截断值），
        // 按错误抛出，让上层在 catch 中把具体原因展示到 UI 卡片。
        const onceFinishReason = data?.choices?.[0]?.finish_reason || null;
        if (onceFinishReason && !isNormalFinishReason(onceFinishReason)) {
          const hint = onceFinishReason === 'length' || onceFinishReason === 'max_tokens' || onceFinishReason === 'token_limit'
            ? '（输出被截断）'
            : onceFinishReason === 'content_filter'
              ? '（模型因内容审核未生成完成）'
              : '';
          throw new Error('模型响应异常：finish_reason=' + JSON.stringify(onceFinishReason) + ' ' + hint);
        }
        const content = pickContent(data);
        const reasoning = pickReasoning(data);
        const toolCalls = pickToolCalls(data);
        // 非流式调用同样把推理模型的"思考过程"通过 reasoning 事件回传，
        // 保证任何一次模型调用都不会丢失思考（前端会拼接进同一个 reasoningContent 字符串）。
        if (reasoning) parentPort.postMessage({ type: 'reasoning', delta: reasoning });
        parentPort.postMessage({ type: 'done', content, reasoning, usage: data?.usage || null, toolCalls, finishReason: data?.choices?.[0]?.finish_reason || null });
      } finally {
        if (totalTimer) clearTimeout(totalTimer);
      }
    }

    parentPort.on('message', async (message) => {
      if (!message || message.type !== 'start') return;
      try {
        if (message.payload.stream) await runStream(message.payload);
        else await runOnce(message.payload);
      } catch (error) {
        // runStream 已内部处理 AbortError，这里只处理 runOnce 的 AbortError
        if (error?.name === 'AbortError') parentPort.postMessage({ type: 'aborted' });
        else parentPort.postMessage({ type: 'error', message: buildErrorMessage(error, message.payload) });
      }
    });
  `
}

// ─── 类型定义 ────────────────────────────────────────────────

export type AgentModelPayload = {
  baseUrl: string | null
  apiKey: string
  modelName: string
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool'
    content: string
    tool_call_id?: string
    tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
    name?: string
  }>
  /** 采样温度。由 resolveSamplingParams 计算：模型行配置优先，未配置用任务默认 */
  temperature: number
  /** 核采样阈值（OpenAI 兼容 top_p）。null/undefined = 不发送，交 provider 默认 */
  topP?: number | null
  /** 频率惩罚（OpenAI 兼容 frequency_penalty）。null/undefined = 不发送，交 provider 默认 */
  frequencyPenalty?: number | null
  /** 存在惩罚（OpenAI 兼容 presence_penalty）。null/undefined = 不发送，交 provider 默认 */
  presencePenalty?: number | null
  stream?: boolean
  /** 原生 function calling 工具定义（OpenAI 格式） */
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description: string
      parameters: any
    }
  }>
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
  /** 流式读取空闲超时（秒），默认 120 */
  streamTimeout?: number
  /** 输出 Token 上限（API max_tokens）。>0 时设置到请求体，防止长 JSON 被截断；否则由后端按默认 16384 处理 */
  maxOutputTokens?: number
  /** 「单 System 合并」：true 时在发送前把 messages 中所有 system 消息合并为一条前置消息。
   *  部分模型只接受一条 system（多条会报错），开启后自动合并，内容以双换行拼接，非 system 消息保持原序。 */
  mergeSystemMessages?: boolean
}

export type AgentModelResult = {
  content: string
  /** 推理模型的"思考过程"完整文本（流式片段已在过程中通过 onReasoning 回传，这里是聚合结果） */
  reasoning?: string | null
  usage?: any
  aborted?: boolean
  /** 原生 function calling 返回的 tool_calls（arguments 为 JSON 字符串） */
  toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> | null
  finishReason?: string | null
}

/**
 * 模型调用异常错误：当流式过程中遇到异常 finishReason（content_filter/length 等）或连接中断时，
 * 可能已经生成了部分 content/reasoning 并记录了 usage。这个错误类携带这些已累积的部分结果，
 * 让上层可以保留已生成的内容落库展示，而不是全部丢弃。
 */
export class AgentModelError extends Error {
  partialResult: {
    content: string
    reasoning: string
    usage: any
    finishReason: string | null
  }
  constructor(message: string, partialResult?: { content?: string; reasoning?: string; usage?: any; finishReason?: string | null }) {
    super(message)
    this.name = 'AgentModelError'
    this.partialResult = {
      content: partialResult?.content || '',
      reasoning: partialResult?.reasoning || '',
      usage: partialResult?.usage || null,
      finishReason: partialResult?.finishReason || null,
    }
  }
}

// ─── 调用 Worker ──────────────────────────────────────────────

/**
 * 「单 System 合并」：把 messages 中所有 system 消息合并为一条前置消息。
 * 部分模型只接受一条 system（多条会报错）。合并后内容以双换行拼接，非 system 消息保持原相对顺序。
 * system 消息上的 tool_calls / tool_call_id 等字段不保留（system 不应携带这些字段）。
 * system 消息数 ≤ 1 时原样返回（浅拷贝，避免改动调用方数组）。
 */
function mergeSystemMessagesIfNeeded<T extends { role: string; content: string }>(messages: T[], enabled?: boolean): T[] {
  if (!enabled) return messages
  const systemMessages = messages.filter((m) => m && m.role === 'system')
  if (systemMessages.length <= 1) return messages
  const mergedContent = systemMessages.map((m) => m.content).filter((c) => typeof c === 'string' && c.length > 0).join('\n\n')
  const others = messages.filter((m) => !m || m.role !== 'system')
  return [{ ...(systemMessages[0] as any), content: mergedContent }, ...others] as T[]
}

export function runAgentModel(
  payload: AgentModelPayload,
  handlers?: { onChunk?: (delta: string) => void; onReasoning?: (delta: string) => void; signal?: AbortSignal },
): Promise<AgentModelResult> {
  return new Promise<AgentModelResult>((resolve, reject) => {
    // 注入 streamTimeout 设置：调用方未显式传时从 ai_settings 读出。
    // 显式传的值（如 agent.run 链路前端透传）作为 override 优先。
    const basePayload: AgentModelPayload = (payload.streamTimeout === undefined || payload.streamTimeout === null)
      ? { ...payload, streamTimeout: readStreamTimeoutFromSettings() ?? 120 }
      : { ...payload }
    // 「单 System 合并」：在主线程合并后再 post 给 worker，worker 内 buildBody 原样映射。
    // 始终生成新对象/新数组，避免改动调用方传入的 payload。
    const effectivePayload: AgentModelPayload = basePayload.mergeSystemMessages
      ? { ...basePayload, messages: mergeSystemMessagesIfNeeded(basePayload.messages, true) as typeof basePayload.messages }
      : basePayload
    const worker = new Worker(getAgentWorkerScript(), { eval: true })
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      worker.terminate().catch(() => { })
      callback()
    }

    const abort = () => {
      worker.postMessage({ type: 'abort' })
    }
    handlers?.signal?.addEventListener('abort', abort, { once: true })

    worker.on('message', (message: any) => {
      if (message?.type === 'chunk') {
        handlers?.onChunk?.(message.delta || '')
        return
      }
      if (message?.type === 'reasoning') {
        handlers?.onReasoning?.(message.delta || '')
        return
      }
      if (message?.type === 'done') {
        handlers?.signal?.removeEventListener('abort', abort)
        finish(() => resolve({
          content: message.content || '',
          reasoning: message.reasoning || null,
          usage: message.usage || null,
          toolCalls: message.toolCalls || null,
          finishReason: message.finishReason || null,
        }))
        return
      }
      if (message?.type === 'aborted') {
        handlers?.signal?.removeEventListener('abort', abort)
        finish(() => resolve({ content: '', aborted: true, toolCalls: null, finishReason: null }))
        return
      }
      if (message?.type === 'error') {
        handlers?.signal?.removeEventListener('abort', abort)
        // 如果 error 消息携带了已累积的部分结果（content/reasoning/usage），
        // 用 AgentModelError 抛出，让上层可以保留已生成的内容落库
        if (message.content || message.reasoning || message.usage) {
          finish(() => reject(new AgentModelError(message.message || 'AI 请求失败', {
            content: message.content || '',
            reasoning: message.reasoning || '',
            usage: message.usage || null,
            finishReason: message.finishReason || null,
          })))
        } else {
          finish(() => reject(new Error(message.message || 'AI 请求失败')))
        }
      }
    })

    worker.on('error', (error) => {
      handlers?.signal?.removeEventListener('abort', abort)
      // 关键：把 worker 内部未捕获的异常的完整信息透传给上层，避免像
      // "Unexpected token ':'" 这种精简的 V8 SyntaxError 让用户摸不着头脑
      // — 加上 stack + name + 原始 cause 才有助于定位
      try {
        console.error('[model-caller] worker 内部未捕获异常:', error)
      } catch {}
      const wrapped = new Error(
        `${error?.name || 'WorkerError'}：${error?.message || String(error)}`,
      ) as Error & { stack?: string; originalStack?: string; name?: string }
      wrapped.name = error?.name || 'WorkerError'
      wrapped.stack = error?.stack
      ;(wrapped as any).originalStack = error?.stack
      finish(() => reject(wrapped))
    })

    worker.on('exit', (code) => {
      if (!settled && code !== 0) {
        handlers?.signal?.removeEventListener('abort', abort)
        finish(() => reject(new Error(`Agent Worker 异常退出：${code}`)))
      }
    })

    worker.postMessage({ type: 'start', payload: effectivePayload })
    if (handlers?.signal?.aborted) abort()
  })
}

/** 把原生 function calling 返回的 tool_calls 解析为 ToolCall[] */
export function parseNativeToolCalls(
  rawToolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string | Record<string, any> } }> | null,
): ToolCall[] {
  if (!rawToolCalls || rawToolCalls.length === 0) return []
  return rawToolCalls.map((tc) => {
    let args: Record<string, any> = {}
    const raw = tc.function.arguments
    if (typeof raw === 'object') {
      args = raw as Record<string, any>
    } else {
      const rawStr = String(raw || '')
      if (!rawStr) {
        args = {}
      } else if (rawStr.startsWith('{') || rawStr.startsWith('[')) {
        try {
          args = JSON.parse(rawStr)
        } catch {
          try {
            // 尝试修复常见问题后重试
            const fixed = rawStr
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r')
              .replace(/\t/g, '\\t')
              .replace(/^[\s,]+/, '')
              .replace(/[\s,]+$/, '')
              .replace(/(?<=["{\[,:]\s*)'(?=[a-zA-Z_])/g, '"')
              .replace(/(?<=[a-zA-Z_])\s*'(?=\s*[:,\]\}])/g, '"')
            args = JSON.parse(fixed)
          } catch {
            // jsonrepair 兜底：处理未转义双引号、单引号等模型常见 JSON 格式问题
            try {
              args = JSON.parse(jsonrepair(rawStr))
            } catch {
              // 以上均失败，尝试从截断的字符串中提取最外层完整 JSON 片段
              const open = rawStr[0] as '{' | '['
              const close = open === '{' ? '}' : ']'
              let depth = 0
              let inStr = false
              let escaped = false
              for (let i = 0; i < rawStr.length; i++) {
                const ch = rawStr[i]
                if (escaped) { escaped = false; continue }
                if (ch === '\\' && inStr) { escaped = true; continue }
                if (ch === '"') { inStr = !inStr; continue }
                if (inStr) continue
                if (ch === open) depth++
                else if (ch === close) {
                  depth--
                  if (depth === 0) {
                    try { args = JSON.parse(rawStr.slice(0, i + 1)); break } catch {}
                  }
                }
              }
            }
          }
        }
      }
    }
    return {
      id: tc.id,
      name: tc.function.name,
      arguments: args,
    }
  })
}
