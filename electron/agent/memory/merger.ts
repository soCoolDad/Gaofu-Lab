/**
 * 记忆合并器（纯代码，不调 AI）
 *
 * 每次单章记忆（ChapterMemoryV2）落库后调用 `mergeIntoBookMemory`，
 * 把它按以下规则增量合并到总记忆（BookMemoryV2）：
 *
 * - characters：
 *   · 首次出现 → 建档；originalSetting 首次写入后永不覆盖（首次以外若字段被填也忽略，尊重"恒定"原则）
 *   · 已有档案 → currentState / personality / growthArcCurrent / vectorCurrent 覆盖
 *   · locationTrace：只在 location.id 或 name 发生变化时 append
 *   · growthArcTrace：只在 arc 文本变化时 append
 *   · vectorTrace：只在向量任意一维发生变化时 append
 * - locations：nameTrace 在同一 id 下 name 变化时 append；新 id 直接建档
 * - plots：以 chapterOrder 为唯一键，覆盖或 append
 * - foreshadowings：trace 按 chapterOrder 覆盖或 append；currentAction = trace 最新一条
 * - inspirations：单章 inspirationsUsed 里出现的 id 全部标记为 used=true 并写 usedInChapterOrder
 */

import type {
  ChapterMemoryV2,
  BookMemoryV2,
  BookMemoryCharacter,
  BookMemoryLocation,
  BookMemoryPlot,
  BookMemoryForeshadowing,
  BookMemoryInspiration,
  CharacterVector,
  MemoryEntityRef,
} from '../types'

export function emptyBookMemory(bookId: string): BookMemoryV2 {
  return {
    bookId,
    updatedThroughChapterOrder: 0,
    characters: [],
    locations: [],
    plots: [],
    foreshadowings: [],
    inspirations: [],
  }
}

function cloneVector(v?: CharacterVector): CharacterVector | undefined {
  if (!v) return undefined
  return {
    loyalty: v.loyalty,
    aggression: v.aggression,
    rationality: v.rationality,
    trust: v.trust,
    morality: v.morality,
  }
}

function vectorEqual(a?: CharacterVector, b?: CharacterVector): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.loyalty === b.loyalty && a.aggression === b.aggression
    && a.rationality === b.rationality && a.trust === b.trust
    && a.morality === b.morality
}

function locationEqual(a?: MemoryEntityRef | null, b?: MemoryEntityRef | null): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return (a.id || '') === (b.id || '') && (a.name || '') === (b.name || '')
}

/** 把单章记忆合并到总记忆（返回新的总记忆对象，不修改入参） */
export function mergeIntoBookMemory(
  book: BookMemoryV2,
  chapterOrder: number,
  chapterMemory: ChapterMemoryV2,
  chapterTitle?: string,
): BookMemoryV2 {
  const next: BookMemoryV2 = {
    bookId: book.bookId,
    updatedThroughChapterOrder: Math.max(book.updatedThroughChapterOrder, chapterOrder),
    characters: book.characters.map((c) => ({
      ...c,
      locationTrace: [...c.locationTrace],
      growthArcTrace: [...c.growthArcTrace],
      vectorTrace: [...c.vectorTrace],
      currentState: { ...c.currentState },
    })),
    locations: book.locations.map((l) => ({ ...l, nameTrace: [...l.nameTrace] })),
    plots: [...book.plots],
    foreshadowings: book.foreshadowings.map((f) => ({ ...f, trace: [...f.trace] })),
    inspirations: book.inspirations.map((i) => ({ ...i })),
  }

  // 1. characters
  for (const ch of chapterMemory.characters || []) {
    let entry = next.characters.find((c) => c.id === ch.id)
    if (!entry) {
      // 首次出现 → 建档
      entry = {
        id: ch.id,
        name: ch.name,
        originalSetting: ch.originalSetting || '',
        personality: ch.personality,
        growthArcCurrent: ch.growthArc,
        vectorCurrent: cloneVector(ch.vector),
        currentState: { ...(ch.state || {}) },
        locationTrace: [],
        growthArcTrace: [],
        vectorTrace: [],
      }
      next.characters.push(entry)
      if (ch.state?.location !== undefined) {
        entry.locationTrace.push({ chapterOrder, location: ch.state.location || null })
      }
      if (ch.growthArc) entry.growthArcTrace.push({ chapterOrder, arc: ch.growthArc })
      if (ch.vector) entry.vectorTrace.push({ chapterOrder, vector: cloneVector(ch.vector)! })
    } else {
      // 已有档案 → 更新
      entry.name = ch.name || entry.name
      // originalSetting 首次写入后不再变（尊重"恒定"原则）
      if (!entry.originalSetting && ch.originalSetting) entry.originalSetting = ch.originalSetting
      if (ch.personality) entry.personality = ch.personality
      if (ch.growthArc && ch.growthArc !== entry.growthArcCurrent) {
        entry.growthArcCurrent = ch.growthArc
        entry.growthArcTrace.push({ chapterOrder, arc: ch.growthArc })
      }
      if (ch.vector && !vectorEqual(ch.vector, entry.vectorCurrent)) {
        entry.vectorCurrent = cloneVector(ch.vector)
        entry.vectorTrace.push({ chapterOrder, vector: cloneVector(ch.vector)! })
      }
      // currentState：覆盖式（新的单章状态即是当前状态）
      const prevLoc = entry.currentState.location || null
      entry.currentState = { ...(ch.state || {}) }
      const newLoc = entry.currentState.location || null
      if (!locationEqual(prevLoc, newLoc)) {
        entry.locationTrace.push({ chapterOrder, location: newLoc })
      }
    }
  }

  // 2. locations（从 sceneEntities.locations + currentPlot.lastLocation + 角色位置 综合收集）
  const locationCandidates: MemoryEntityRef[] = []
  // sceneEntities.locations 是完整列表，优先从中取
  for (const loc of chapterMemory.sceneEntities?.locations || []) {
    if (loc.id) locationCandidates.push({ id: loc.id, name: loc.name })
  }
  // 兜底：如果模型没输出 sceneEntities.locations 但 currentPlot 有
  const lastLoc = chapterMemory.currentPlot?.lastLocation
  if (lastLoc?.id && !locationCandidates.find((l) => l.id === lastLoc.id)) {
    locationCandidates.push(lastLoc)
  }
  // 额外从每个角色的 state.location 里收集，确保新地点也建档
  for (const ch of chapterMemory.characters || []) {
    const loc = ch.state?.location
    if (loc?.id && !locationCandidates.find((l) => l.id === loc.id)) {
      locationCandidates.push(loc)
    }
  }
  for (const loc of locationCandidates) {
    if (!loc.id) continue
    let entry = next.locations.find((l) => l.id === loc.id)
    if (!entry) {
      entry = {
        id: loc.id,
        name: loc.name,
        nameTrace: [{ chapterOrder, name: loc.name }],
        firstAppearChapterOrder: chapterOrder,
      }
      next.locations.push(entry)
    } else if (entry.name !== loc.name) {
      entry.name = loc.name
      entry.nameTrace.push({ chapterOrder, name: loc.name })
    }
  }

  // 3. plots：按 chapterOrder 覆盖或 append
  const plotSummary = chapterMemory.currentPlot?.lastPlot || ''
  // chapterOrder 是 0-based；给用户展示时统一 +1，避免出现"第 0 章"
  const plotName = chapterMemory.currentPlot?.lastScene?.name || chapterTitle || `第${chapterOrder + 1}章`
  const existingPlot = next.plots.find((p) => p.chapterOrder === chapterOrder)
  if (existingPlot) {
    existingPlot.name = plotName
    existingPlot.summary = plotSummary
    existingPlot.chapterTitle = chapterTitle
  } else {
    next.plots.push({
      chapterOrder,
      chapterTitle,
      name: plotName,
      summary: plotSummary,
    } satisfies BookMemoryPlot)
    next.plots.sort((a, b) => a.chapterOrder - b.chapterOrder)
  }

  // 4. foreshadowings
  for (const f of chapterMemory.foreshadowing || []) {
    if (!f.id) continue
    let entry = next.foreshadowings.find((x) => x.id === f.id)
    if (!entry) {
      entry = {
        id: f.id,
        description: f.description,
        significance: f.significance,
        trace: [{ chapterOrder, action: f.action }],
        currentAction: f.action,
      }
      next.foreshadowings.push(entry)
    } else {
      // 同 chapterOrder 覆盖，不同则 append
      const idx = entry.trace.findIndex((t) => t.chapterOrder === chapterOrder)
      if (idx >= 0) entry.trace[idx] = { chapterOrder, action: f.action }
      else entry.trace.push({ chapterOrder, action: f.action })
      entry.trace.sort((a, b) => a.chapterOrder - b.chapterOrder)
      entry.currentAction = entry.trace[entry.trace.length - 1].action
      if (f.description) entry.description = f.description
      if (f.significance) entry.significance = f.significance
    }
  }

  // 5. inspirations
  for (const insp of chapterMemory.inspirationsUsed || []) {
    if (!insp.id) continue
    let entry = next.inspirations.find((x) => x.id === insp.id)
    if (!entry) {
      entry = { id: insp.id, name: insp.name, used: true, usedInChapterOrder: chapterOrder }
      next.inspirations.push(entry)
    } else if (!entry.used) {
      entry.used = true
      entry.usedInChapterOrder = chapterOrder
    }
  }

  return next
}

/** 供 db/index.ts 或迁移场景调用的构造器 */
export function createEmptyMemoryRow(bookId: string): BookMemoryV2 {
  return emptyBookMemory(bookId)
}
