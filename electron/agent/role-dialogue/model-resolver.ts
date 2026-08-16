/**
 * Model 解析器（3 层兜底）
 *
 * 优先级（从高到低）：
 *   1. 角色级 model 偏好   role_dialogue_character_models（bookId + characterId）
 *   2. 房间默认 model       role_dialogue_rooms.default_model_id
 *   3. 「知卷」当前 model   由前端从 localStorage 'agent:selectedModelId' 读取后传入
 *
 * 任一层级都找不到时，抛错（不静默 fallback——按需求边界 J.7）。
 */

import { and, eq } from 'drizzle-orm'
import { getDb } from '../../db'
import { modelProviders, roleDialogueCharacterModels, roleDialogueRooms } from '../../db/schema'
import { decodeModelApiKey } from '../../ipc/model.ipc'

export type ResolvedModel = {
  id: string
  baseUrl: string | null
  apiKey: string
  modelName: string
  inputPrice: number
  outputPrice: number
  cachedInputPrice: number
  /** 兜底层级（用于诊断/UI 提示）：'character' | 'room' | 'agent' */
  source: 'character' | 'room' | 'agent'
}

/**
 * 解析一个角色在指定 Run 下应该使用的 model。
 * @param bookId - 书 id
 * @param roomId - 房间 id（取房间默认 model 用）
 * @param characterId - 角色 id（取角色偏好 model 用）
 * @param agentFallbackModelId - 兜底层（来自前端 localStorage 里的「知卷」modelId）
 */
export function resolveModelForCharacter(args: {
  bookId: string
  roomId: string
  characterId: string
  agentFallbackModelId?: string | null
}): ResolvedModel {
  const { bookId, roomId, characterId, agentFallbackModelId } = args
  const db = getDb()

  // 第 1 层：角色级偏好
  const charPref = db.select().from(roleDialogueCharacterModels)
    .where(and(
      eq(roleDialogueCharacterModels.bookId, bookId),
      eq(roleDialogueCharacterModels.characterId, characterId),
    )).get()

  // 第 2 层：房间默认
  const room = db.select().from(roleDialogueRooms).where(eq(roleDialogueRooms.id, roomId)).get()

  // 解析顺序
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
    return {
      id: row.id,
      baseUrl: decoded.baseUrl,
      apiKey: decoded.apiKey,
      modelName: decoded.modelName,
      inputPrice: row.inputPrice || 0,
      outputPrice: row.outputPrice || 0,
      cachedInputPrice: row.cachedInputPrice ?? (row.inputPrice || 0),
      source: cand.source,
    }
  }

  throw new Error(
    '未找到可用 model：角色偏好、房间默认、知卷默认三层均未配置。\n' +
    '请在「设置」中配置「知卷」model，或在剧情预演房间中设置默认 model。',
  )
}
