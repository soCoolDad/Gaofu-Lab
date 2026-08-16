/**
 * 记忆序列化器：把 BookMemoryV2 / ChapterMemoryV2 转成给写手看的中文自然语言。
 *
 * 写手看的是"上下文"，不是结构化 JSON。序列化的目标：
 * - 关键事实（谁在哪、拿着什么、还欠着什么伏笔）以行文形式呈现
 * - 变化轨迹 A→B→C 用箭头串起来，一眼看到"演化路径"
 * - 保留 originalSetting 全文（保证角色不跑偏）
 */

import type {
  BookMemoryV2,
  ChapterMemoryV2,
  CharacterVector,
  CharacterStateV2,
  MemoryEntityRef,
} from '../types'

function joinRef(refs?: MemoryEntityRef[] | null): string {
  if (!refs || refs.length === 0) return '无'
  return refs.map((r) => r.name).filter(Boolean).join('、')
}

/**
 * 数据库里 chapters.sortOrder 是 0-based（第一章 sortOrder = 0），
 * 展示给用户/写手时统一 +1，以避免出现"第 0 章"这种反直觉的字样。
 * 本文件里所有面向用户的"第 N 章"文案都走这个 helper。
 */
function chapterLabel(order: number): number {
  return order + 1
}

function vectorText(v?: CharacterVector): string {
  if (!v) return ''
  return `忠诚${v.loyalty} / 攻击${v.aggression} / 理性${v.rationality} / 信任${v.trust} / 道德${v.morality}`
}

function stateBlock(state: CharacterStateV2): string[] {
  const lines: string[] = []
  if (state.location?.name) { lines.push('  · 位置'); lines.push(`    ${state.location.name}`) }
  if (state.injury) {
    if (state.injury.hurt) {
      const parts = state.injury.parts && state.injury.parts.length > 0 ? `（${state.injury.parts.join('、')}）` : ''
      lines.push('  · 受伤')
      lines.push(`    ${state.injury.severity || '受伤'}${parts}`)
    } else {
      lines.push('  · 受伤')
      lines.push('    无')
    }
  }
  if (state.survival) { lines.push('  · 生存状态'); lines.push(`    ${state.survival}`) }
  if (state.mood) { lines.push('  · 心境'); lines.push(`    ${state.mood}`) }
  if (state.speechStyle) { lines.push('  · 说话风格'); lines.push(`    ${state.speechStyle}`) }
  if (state.knownSkills && state.knownSkills.length > 0) { lines.push('  · 已掌握技能'); lines.push(`    ${joinRef(state.knownSkills)}`) }
  if (state.holds && state.holds.length > 0) { lines.push('  · 持有物品'); lines.push(`    ${joinRef(state.holds)}`) }
  if (state.knows && state.knows.length > 0) { lines.push('  · 已知线索'); lines.push(`    ${state.knows.join('；')}`) }
  if (state.relationships && state.relationships.length > 0) {
    const rels = state.relationships
      .map((r) => `${r.targetName || r.targetId}(${r.type} ${r.value >= 0 ? '+' : ''}${r.value})`)
      .join('、')
    lines.push('  · 与他人关系')
    lines.push(`    ${rels}`)
  }
  return lines
}

/** 序列化整本书的总记忆（供写手 context 注入使用） */
export function serializeBookMemory(book: BookMemoryV2, opts?: { maxCharacters?: number; maxPlots?: number }): string {
  const maxCharacters = opts?.maxCharacters ?? 30
  const maxPlots = opts?.maxPlots ?? 40

  const lines: string[] = []
  lines.push(`#全书总记忆`)
  lines.push('以下内容作为参考：')
  lines.push('')

  // 剧情轨迹
  if (book.plots.length > 0) {
    lines.push('## 剧情轨迹（从早到晚）')
    const plots = book.plots.slice(-maxPlots)
    for (const p of plots) {
      const title = p.chapterTitle ? `《${p.chapterTitle}》` : ''
      lines.push(`- 第${chapterLabel(p.chapterOrder)}章${title}`)
      lines.push(p.summary || p.name)
    }
    lines.push('')
  }

  // 角色档案
  if (book.characters.length > 0) {
    lines.push('## 角色档案（按 id 顺序）')
    const chars = book.characters.slice(0, maxCharacters)
    for (const c of chars) {
      lines.push(`### ${c.name}`)
      if (c.originalSetting) {
        lines.push('- 原始设定')
        lines.push(c.originalSetting)
      }
      if (c.personality) {
        lines.push('- 性格')
        lines.push(c.personality)
      }
      if (c.growthArcCurrent) {
        lines.push('- 当前成长阶段')
        lines.push(c.growthArcCurrent)
      }
      if (c.vectorCurrent) {
        lines.push('- 立场向量')
        lines.push(vectorText(c.vectorCurrent))
      }
      if (c.currentState) {
        lines.push(`- 当前状态：`)
        lines.push(...stateBlock(c.currentState))
      }
      if (c.locationTrace.length > 1) {
        const trace = c.locationTrace
          .map((t) => `第${chapterLabel(t.chapterOrder)}章:${t.location?.name || '未知'}`)
          .join(' → ')
        lines.push('- 位置轨迹')
        lines.push(trace)
      }
      if (c.growthArcTrace.length > 1) {
        const trace = c.growthArcTrace
          .map((t) => `第${chapterLabel(t.chapterOrder)}章:${t.arc}`)
          .join(' → ')
        lines.push('- 成长轨迹')
        lines.push(trace)
      }
      if (c.vectorTrace.length > 1) {
        const trace = c.vectorTrace
          .map((t) => `第${chapterLabel(t.chapterOrder)}章:[${vectorText(t.vector)}]`)
          .join(' → ')
        lines.push('- 立场轨迹')
        lines.push(trace)
      }
      lines.push('')
    }
  }

  // 地点档案（重点关注改名的）
  if (book.locations.length > 0) {
    lines.push('## 地点脉络（按剧情顺序）')
    const sorted = [...book.locations].sort((a, b) => {
      const aFirst = a.nameTrace[0]?.chapterOrder ?? 999
      const bFirst = b.nameTrace[0]?.chapterOrder ?? 999
      return aFirst - bFirst
    })
    for (const l of sorted) {
      const firstAppearance = l.nameTrace[0]?.chapterOrder
      if (firstAppearance === undefined) continue
      const label = `第${chapterLabel(firstAppearance)}章`
      if (l.nameTrace.length > 1) {
        const trace = l.nameTrace.map((t) => `第${chapterLabel(t.chapterOrder)}章:${t.name}`).join(' → ')
        lines.push(`- [${label}首次出现] ${trace}`)
      } else {
        lines.push(`- [${label}首次出现] ${l.name}`)
      }
    }
    lines.push('')
  }

  // 伏笔
  if (book.foreshadowings.length > 0) {
    const open = book.foreshadowings.filter((f) => f.currentAction !== 'resolved')
    const closed = book.foreshadowings.filter((f) => f.currentAction === 'resolved')
    if (open.length > 0) {
      lines.push('## 未回收伏笔（必须推进或维持，不得凭空遗忘）')
      for (const f of open) {
        const trace = f.trace.map((t) => `第${chapterLabel(t.chapterOrder)}章:${t.action}`).join(' → ')
        lines.push(`- [${f.significance || '?'}] ${f.description}`)
        lines.push('状态轨迹')
        lines.push(trace)
      }
      lines.push('')
    }
    if (closed.length > 0) {
      lines.push('## 已回收伏笔（不得再被当作未回收使用）')
      for (const f of closed) {
        lines.push(`- ${f.description}`)
      }
      lines.push('')
    }
  }

  // 灵感
  if (book.inspirations.length > 0) {
    const unused = book.inspirations.filter((i) => !i.used)
    if (unused.length > 0) {
      lines.push('## 未使用灵感（可择机融入，不必强用）')
      for (const i of unused) lines.push(`- ${i.name}`)
      lines.push('')
    }
  }

  return lines.join('\n').trim()
}

/** 序列化单章记忆（写手接续基准） */
export function serializeChapterMemory(memory: ChapterMemoryV2, chapterOrder: number, chapterTitle?: string): string {
  const lines: string[] = []
  if (memory.storyTime) {
    lines.push('故事时间')
    lines.push(memory.storyTime)
  }
  lines.push('')

  // 剧情接续点
  const cp = memory.currentPlot || { lastPlot: '' }
  lines.push('## 剧情接续点')
  if (cp.lastPlot) {
    lines.push('- 最后剧情')
    lines.push(cp.lastPlot)
  }
  if (cp.lastLocation?.name) {
    lines.push('- 最后地点')
    lines.push(cp.lastLocation.name)
  }
  if (cp.lastScene?.name) {
    lines.push('- 最后场景')
    lines.push(cp.lastScene.name)
  }
  lines.push('')

  // 本章出场实体
  const se = memory.sceneEntities || {}
  if (se.locations?.length || se.scenes?.length || se.characters?.length || se.items?.length || se.skills?.length || se.factions?.length || se.systems?.length) {
    lines.push('## 本章出场实体')
    if (se.locations?.length) {
      lines.push(`- 地点：`)
      for (const loc of se.locations) {
        lines.push(`  · ${loc.name}${loc.description ? `（${loc.description}）` : ''}`)
      }
    }
    if (se.scenes?.length) {
      lines.push(`- 场景：`)
      for (const scn of se.scenes) {
        lines.push(`  · ${scn.name}${scn.summary ? ` — ${scn.summary}` : ''}`)
      }
    }
    if (se.characters?.length) {
      lines.push('- 角色')
      lines.push(joinRef(se.characters))
    }
    if (se.items?.length) {
      lines.push('- 物品')
      lines.push(joinRef(se.items))
    }
    if (se.skills?.length) {
      lines.push('- 技能')
      lines.push(joinRef(se.skills))
    }
    if (se.factions?.length) {
      lines.push('- 势力')
      lines.push(joinRef(se.factions))
    }
    if (se.systems?.length) {
      lines.push('- 体系')
      lines.push(joinRef(se.systems))
    }
    if (se.events?.length) {
      lines.push(`- 事件：`)
      for (const e of se.events) {
        lines.push(`  · [${e.type}] ${e.summary}`)
      }
    }
    lines.push('')
  }

  // 角色详细状态
  if (memory.characters?.length) {
    lines.push('## 角色本章末状态')
    for (const c of memory.characters) {
      lines.push(`### ${c.name}`)
      if (c.originalSetting) {
        lines.push('- 原始设定')
        lines.push(c.originalSetting)
      }
      if (c.personality) {
        lines.push('- 性格')
        lines.push(c.personality)
      }
      if (c.growthArc) {
        lines.push('- 成长阶段')
        lines.push(c.growthArc)
      }
      if (c.vector) {
        lines.push('- 立场向量')
        lines.push(vectorText(c.vector))
      }
      if (c.state) {
        lines.push(`- 状态：`)
        lines.push(...stateBlock(c.state))
      }
      lines.push('')
    }
  }

  // 本章伏笔状态
  if (memory.foreshadowing?.length) {
    lines.push('## 本章伏笔')
    for (const f of memory.foreshadowing) {
      lines.push(`- [${f.action}] ${f.description}`)
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}
