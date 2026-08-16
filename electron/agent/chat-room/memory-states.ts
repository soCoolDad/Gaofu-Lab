/**
 * 角色定稿记忆状态解析（共享模块）
 *
 * 与 SnapshotViewerModal「角色本章末状态」完全一致的字段解析：
 *   数据来自 book_memory（BookMemoryV2），角色状态挂在 characters[].currentState，
 *   与章节记忆的 characters[].state 同为 CharacterStateV2，子字段完全一致。
 *   故本模块直接复用 SnapshotViewerModal 的字段访问，仅把 state/vector/growthArc
 *   换成 book memory 同义的 currentState/vectorCurrent/growthArcCurrent。
 *
 * 该模块同时被以下两处复用，避免重复解析、保证前后端展示与注入上下文一致：
 *   - chat-room.ipc.ts 的 getCharacterMemoryStates（右侧面板「最近的状态」）
 *   - chat-room/chat-runner.ts（把全部角色状态注入 LLM 上下文）
 */

import { and, eq } from 'drizzle-orm'
import { getDb } from '../../db'
import { bookMemory, bookSettingEntries } from '../../db/schema'

// 与 SnapshotViewerModal 中「与他人关系」标签保持一致的关系类型中文映射
export const relationshipTypeLabelMap: Record<string, string> = {
  love: '爱恋', intimate: '亲密', crush: '暗恋', adore: '倾慕', affection: '好感',
  friendship: '友谊', ally: '盟友', companion: '同伴', partner: '搭档', family: '亲属',
  parent: '父母', sibling: '手足', rival: '对手', enemy: '仇敌', hatred: '仇恨',
  hostile: '敌对', dislike: '嫌隙', contempt: '鄙夷', mistrust: '猜忌', distrust: '不信任',
  respect: '敬重', admiration: '钦佩', mentor: '师长', student: '弟子', subordinate: '下属',
  superior: '上司', loyalty: '效忠', devotion: '忠心', obligation: '亏欠', gratitude: '感恩',
  indebted: '亏欠', fear: '畏惧', awe: '敬畏', curious: '好奇', suspicious: '疑心',
  neutral: '中立', acquaintance: '相识',
}

export function joinNames(list?: Array<{ name?: string } | string>): string {
  if (!list || list.length === 0) return ''
  return list
    .map((x) => (typeof x === 'string' ? x : x?.name || ''))
    .filter(Boolean)
    .join('、')
}

export function formatCharacterMemoryState(c: any, idToName: Map<string, string>): string {
  if (!c) return '（暂无状态记录）'
  const state = c.currentState || {}
  const resolveName = (idOrName: string): string => idToName.get(idOrName) || idOrName
  const parts: string[] = []

  if (c.originalSetting) parts.push(`原始设定：${c.originalSetting}`)
  if (c.personality) parts.push(`性格：${c.personality}`)
  if (c.growthArcCurrent) parts.push(`成长阶段：${c.growthArcCurrent}`)

  if (state.survival) parts.push(`状态：${state.survival}`)
  if (state.injury?.hurt) {
    const severity = state.injury.severity || '受伤'
    const pts = Array.isArray(state.injury.parts) ? state.injury.parts.join('、') : ''
    parts.push(`伤势：${severity}${pts ? `（${pts}）` : ''}`)
  }
  if (state.location?.name) parts.push(`位置：${state.location.name}`)
  if (state.mood) parts.push(`心境：${state.mood}`)
  if (state.speechStyle) parts.push(`说话风格：${state.speechStyle}`)

  const knownSkills = joinNames(state.knownSkills)
  if (knownSkills) parts.push(`已掌握技能：${knownSkills}`)

  const holds = joinNames(state.holds)
  if (holds) parts.push(`持有物：${holds}`)

  if (Array.isArray(state.knows) && state.knows.length) {
    const items = state.knows.map(String).filter(Boolean).join('；')
    if (items) parts.push(`已知线索：${items}`)
  }

  if (Array.isArray(state.relationships) && state.relationships.length) {
    const rels = state.relationships
      .map((r: any) =>
        `${r.targetName || resolveName(r.targetId)}（${relationshipTypeLabelMap[r.type] || r.type}${typeof r.value === 'number' ? ` ${r.value >= 0 ? '+' : ''}${r.value}` : ''}）`,
      )
      .join('、')
    parts.push(`与他人关系：${rels}`)
  }

  return parts.length ? parts.join('\n') : '（暂无状态记录）'
}

export type CharacterMemoryState = { characterId: string; name: string; stateText: string }

/**
 * 读取指定角色在 book_memory 中的最后状态文本（对齐 SnapshotViewerModal）。
 * 返回顺序与入参 characterIds 一致；房间内角色顺序即参与表顺序。
 */
export function getAllCharacterMemoryStates(bookId: string, characterIds: string[]): CharacterMemoryState[] {
  if (!characterIds.length) return []
  const db = getDb()
  const result: CharacterMemoryState[] = []

  // 先拿角色名，用于 bookMemory 按 name 兜底匹配（记忆里的 id 不一定与 setting id 一致）
  const names = db.select({ id: bookSettingEntries.id, name: bookSettingEntries.name })
    .from(bookSettingEntries)
    .where(and(
      eq(bookSettingEntries.bookId, bookId),
      ...characterIds.map((id) => eq(bookSettingEntries.id, id)),
    ))
    .all()
  const nameById = new Map(names.map((n) => [n.id, n.name]))

  const memRow = db.select({ data: bookMemory.data }).from(bookMemory).where(eq(bookMemory.bookId, bookId)).get()

  let chars: any[] = []
  const idToName = new Map<string, string>()
  if (memRow?.data) {
    try {
      const parsed = JSON.parse(memRow.data)
      chars = Array.isArray(parsed?.characters) ? parsed.characters : []
      for (const cc of chars) {
        if (cc?.id && cc?.name) idToName.set(String(cc.id), cc.name)
      }
    } catch {}
  }

  for (const cid of characterIds) {
    const name = nameById.get(cid)
    let hit = chars.find((c) => String(c?.id) === cid)
    if (!hit && name) {
      hit = chars.find((c) => String(c?.name) === name)
    }
    result.push({
      characterId: cid,
      name: name || (hit?.name ?? '某角色'),
      stateText: hit ? formatCharacterMemoryState(hit, idToName) : '（暂无状态记录）',
    })
  }
  return result
}

/** 单个角色在 book_memory 中的结构化关系（用于聊天室"你与在场成员的关系"块） */
export type CharacterRelationship = { targetName: string; type: string; typeLabel: string }

export function getCharacterRelationships(bookId: string, characterId: string): CharacterRelationship[] {
  const db = getDb()
  const nameRow = db.select({ name: bookSettingEntries.name })
    .from(bookSettingEntries)
    .where(eq(bookSettingEntries.id, characterId))
    .get()
  const name = nameRow?.name

  const memRow = db.select({ data: bookMemory.data }).from(bookMemory).where(eq(bookMemory.bookId, bookId)).get()
  let hit: any = null
  if (memRow?.data) {
    try {
      const parsed = JSON.parse(memRow.data)
      const chars = Array.isArray(parsed?.characters) ? parsed.characters : []
      hit = chars.find((c: any) => String(c?.id) === characterId) || (name ? chars.find((c: any) => String(c?.name) === name) : null)
    } catch {}
  }

  const state = hit?.currentState || {}
  if (!Array.isArray(state.relationships) || state.relationships.length === 0) return []
  return state.relationships.map((r: any) => ({
    targetName: r.targetName || String(r.targetId),
    type: r.type,
    typeLabel: relationshipTypeLabelMap[r.type] || r.type,
  }))
}
