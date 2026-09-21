/**
 * 聊天室 Model 解析器（3 层兜底）
 *
 * 优先级（从高到低）：
 *   1. 角色级 model 偏好   chat_room_character_models（bookId + characterId）
 *   2. 房间默认 model       chat_room_rooms.default_model_id
 *   3. 「知卷」当前 model   由前端从 localStorage 'agent:selectedModelId' 读取后传入
 *
 * 与剧情预演的 resolveModelForCharacter 逻辑一致，但只读取 chat_room_* 表，互不复用。
 * 任一层级都找不到时抛错（不静默 fallback）。
 */

import { and, eq } from 'drizzle-orm'
import { getDb } from '../../db'
import { chatRoomCharacterModels, chatRoomRooms, modelProviders } from '../../db/schema'
import { decodeModelApiKey } from '../../ipc/model.ipc'
import { resolveCurrentPrices, assertBillingRulesConfigured } from '../../utils/billing'

export type ResolvedModel = {
  id: string
  baseUrl: string | null
  apiKey: string
  modelName: string
  inputPrice: number
  outputPrice: number
  cachedInputPrice: number
  /** 「单 System 合并」开关（来自模型行 mergeSystemMessages） */
  mergeSystemMessages: boolean
  /** 采样参数（模型行配置值；null = 未配置，由调用方用 resolveSamplingParams 回落任务默认温度） */
  temperature: number | null
  topP: number | null
  frequencyPenalty: number | null
  presencePenalty: number | null
  /** 兜底层级（用于诊断/UI 提示）：'character' | 'room' | 'agent' */
  source: 'character' | 'room' | 'agent'
}

export function resolveChatRoomModel(args: {
  bookId: string
  roomId: string
  characterId: string
  agentFallbackModelId?: string | null
}): ResolvedModel {
  const { bookId, roomId, characterId, agentFallbackModelId } = args
  const db = getDb()

  // 第 1 层：角色级偏好
  const charPref = db.select().from(chatRoomCharacterModels)
    .where(and(
      eq(chatRoomCharacterModels.bookId, bookId),
      eq(chatRoomCharacterModels.characterId, characterId),
    )).get()

  // 第 2 层：房间默认
  const room = db.select().from(chatRoomRooms).where(eq(chatRoomRooms.id, roomId)).get()

  const candidates: Array<{ modelId: string | null | undefined; source: ResolvedModel['source'] }> = [
    { modelId: charPref?.modelId, source: 'character' },
    { modelId: room?.defaultModelId, source: 'room' },
    { modelId: agentFallbackModelId, source: 'agent' },
  ]

  for (const cand of candidates) {
    if (!cand.modelId) continue
    const row = db.select().from(modelProviders).where(eq(modelProviders.id, cand.modelId)).get()
    if (!row) continue
    const decoded = decodeModelApiKey(row)
    if (!decoded.apiKey || !decoded.modelName) continue
    // 强校验：模型未配置计费规则则直接抛错，避免"未预估成本就调用"
    assertBillingRulesConfigured(row)
    // 计费价格：优先使用当前时刻命中的计费规则；无规则命中时回退到默认单价。
    const { prices: effectivePrices } = resolveCurrentPrices(row)
    return {
      id: row.id,
      baseUrl: decoded.baseUrl,
      apiKey: decoded.apiKey,
      modelName: decoded.modelName,
      inputPrice: effectivePrices.inputPrice,
      outputPrice: effectivePrices.outputPrice,
      cachedInputPrice: effectivePrices.cachedInputPrice,
      mergeSystemMessages: !!row.mergeSystemMessages,
      // 采样参数：直接带出模型行配置值（null = 未配置），由调用方 resolveSamplingParams 兜底任务默认温度
      temperature: row.temperature ?? null,
      topP: row.topP ?? null,
      frequencyPenalty: row.frequencyPenalty ?? null,
      presencePenalty: row.presencePenalty ?? null,
      source: cand.source,
    }
  }

  throw new Error(
    '未找到可用 model：角色偏好、房间默认、知卷默认三层均未配置。\n' +
    '请在「设置」中配置「知卷」model，或在聊天室房间中设置默认 model / 单个角色 model。',
  )
}
