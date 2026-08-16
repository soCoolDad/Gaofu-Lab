/**
 * 章节记忆工具
 *
 * generate_snapshot：生成章节记忆（写操作，需用户确认）
 * 工具调用时就同步调模型算出 memory + clips，塞到 pendingWrite 里让用户在"结果确认"弹窗审核。
 * 用户点应用后由 apply-hooks 直接把这份数据落库（不再重跑模型）。
 *
 * get_snapshot：查询章节记忆（读操作）
 * list_snapshots：查询书籍所有章节记忆（读操作）
 *
 * 注：工具函数名仍保持 `*_snapshot`（这是模型侧的 function calling 标识符，改会破坏
 * 已有会话的兼容），但工具描述、pendingWrite 文本、错误文案对用户暴露的措辞统一改为"记忆"。
 */

import { eq, desc, asc, and } from 'drizzle-orm'
import { getDb } from '../../db'
import { chapters, chapterSnapshots, timelineClips } from '../../db/schema'
import { defineReadTool, defineWriteTool } from './index'
import { createPendingWrite } from '../tool-executor'
import { computeChapterSnapshot } from '../apply-hooks'
import type { ChapterMemoryV2 } from '../types'

// 事件类型 → 中文（用于「结果确认」弹窗的 [事件·xxx] 标题；与 SnapshotViewerModal 的 eventTypeLabelMap 保持一致）
const EVENT_TYPE_LABEL_CN: Record<string, string> = {
  discovery: '发现',
  investigation: '调查',
  attempted_communication: '尝试通讯',
  communication: '通讯',
  conversation: '对话',
  dialogue: '对话',
  discussion: '讨论',
  decision: '抉择',
  revelation: '揭露',
  realization: '醒悟',
  preparation: '准备',
  reflection: '反思',
  accident: '意外',
  combat: '战斗',
  battle: '交战',
  war: '战争',
  skirmish: '小规模冲突',
  siege: '围攻',
  ambush: '伏击',
  duel: '决斗',
  assassination: '刺杀',
  conflict: '冲突',
  confrontation: '对峙',
  quarrel: '争吵',
  argument: '争论',
  exploration: '探索',
  reconnaissance: '侦察',
  stealth: '潜入',
  infiltration: '渗透',
  pursuit: '追捕',
  chase: '追逐',
  escape: '逃亡',
  flight: '逃窜',
  hunt: '狩猎',
  rescue: '救援',
  arrival: '抵达',
  departure: '离开',
  journey: '旅程',
  travel: '出行',
  reunion: '重逢',
  farewell: '离别',
  parting: '分别',
  separation: '分离',
  meeting: '会面',
  encounter: '偶遇',
  confession: '告白',
  proposal: '求婚',
  marriage: '婚礼',
  courtship: '求爱',
  intimate_act: '亲密互动',
  break_up: '决裂',
  divorce: '离异',
  betrayal: '背叛',
  deception: '欺骗',
  conspiracy: '阴谋',
  plot: '算计',
  negotiation: '谈判',
  persuasion: '劝说',
  manipulation: '操纵',
  birth: '诞生',
  death: '死亡',
  injury: '受伤',
  healing: '疗愈',
  recovery: '康复',
  illness: '染病',
  training: '修炼',
  breakthrough: '突破',
  awakening: '觉醒',
  transformation: '蜕变',
  summon: '召唤',
  sacrifice: '牺牲',
  kidnapping: '绑架',
  imprisonment: '囚禁',
  release: '释放',
  torture: '拷问',
  interrogation: '审讯',
  exile: '流放',
  promotion: '晋升',
  demotion: '贬谪',
  inheritance: '继承',
  coronation: '加冕',
  election: '选举',
  celebration: '庆典',
  festival: '节庆',
  ritual: '仪式',
  prayer: '祈祷',
  prophecy: '预言',
  dream: '梦境',
  vision: '异象',
  omen: '预兆',
  disaster: '灾祸',
  catastrophe: '浩劫',
  miracle: '奇迹',
  creation: '创造',
  destruction: '毁灭',
  alliance: '结盟',
  declaration: '宣战',
  truce: '休战',
  planning: '谋划',
  competition: '比试',
  tournament: '竞赛',
  graduation: '毕业',
  mourning: '哀悼',
}

const eventTypeLabel = (type?: string): string => EVENT_TYPE_LABEL_CN[type || ''] || type || '事件'

const getSnapshotTool = defineReadTool(
  'get_snapshot',
  '查询指定章节的记忆（含角色详细状态、剧情接续点、场景实体、事件、伏笔等）。',
  'snapshot',
  { chapterId: { type: 'string', description: '章节 ID' } },
  ['chapterId'],
  async (args) => {
    const db = getDb()
    const snapshot = db.select().from(chapterSnapshots).where(eq(chapterSnapshots.chapterId, args.chapterId)).orderBy(desc(chapterSnapshots.createdAt)).limit(1).get()
    if (!snapshot) return { error: '该章节暂无记忆' }
    let snapshotData: any = null
    try { snapshotData = JSON.parse(snapshot.snapshotData) } catch { snapshotData = null }
    const clips = db.select().from(timelineClips).where(eq(timelineClips.chapterId, args.chapterId)).all()
    return { data: { ...snapshot, snapshotData, clips } }
  },
)

const listSnapshotsTool = defineReadTool(
  'list_snapshots',
  '查询书籍所有章节的记忆列表。需要 bookId（不填则用当前选中书籍）。',
  'snapshot',
  { bookId: { type: 'string', description: '书籍 ID（可选）' } },
  [],
  async (args, ctx) => {
    const bookId = args.bookId || ctx.bookId
    if (!bookId) return { error: '未提供 bookId 且当前无选中书籍' }
    const db = getDb()
    const list = db.select({
      id: chapterSnapshots.id,
      chapterId: chapterSnapshots.chapterId,
      chapterOrder: chapterSnapshots.chapterOrder,
      storyTime: chapterSnapshots.storyTime,
      isValid: chapterSnapshots.isValid,
      createdAt: chapterSnapshots.createdAt,
    }).from(chapterSnapshots).where(eq(chapterSnapshots.bookId, bookId)).orderBy(asc(chapterSnapshots.chapterOrder)).all()
    return { data: list }
  },
)

const generateSnapshotTool = defineWriteTool(
  'generate_snapshot',
  '为指定章节生成记忆并定稿。分析正文提取角色状态/场景/地点/事件/伏笔，用户确认后落库并将章节置为「已定稿」。',
  'snapshot',
  {
    chapterId: { type: 'string', description: '章节 ID' },
  },
  ['chapterId'],
  async (args, ctx) => {
    const db = getDb()
    const ch = db.select({
      id: chapters.id,
      title: chapters.title,
      content: chapters.content,
      bookId: chapters.bookId,
      sortOrder: chapters.sortOrder,
    }).from(chapters).where(eq(chapters.id, args.chapterId)).get()
    if (!ch) return { error: '章节不存在' }
    if (!ch.content) return { error: '章节无正文内容，无法生成记忆' }

    const modelId = ctx.modelId
    if (!modelId) return { error: '当前会话未指定模型，无法生成记忆' }

    // 工具阶段就把记忆分析算好：调两次模型 → 得到 snapshotData(ChapterMemoryV2) + clips
    let snapshotData: ChapterMemoryV2 | null = null
    let clips: any[] = []
    try {
      const computed = await computeChapterSnapshot(ch.bookId, ch.id, ch.content, modelId, ctx.onSubModelCall, ctx.onReasoning)
      snapshotData = computed.snapshotData
      clips = computed.clips
    } catch (err: any) {
      return { error: `记忆分析失败：${err?.message || '未知错误'}` }
    }

    // 取上一章记忆（用于差异对比）
    let previousSnapshotData: any = null
    try {
      const prevChapter = db.select({ id: chapters.id })
        .from(chapters)
        .where(and(eq(chapters.bookId, ch.bookId), eq(chapters.sortOrder, ch.sortOrder - 1)))
        .get()
      if (prevChapter) {
        const prevSnap = db.select({ snapshotData: chapterSnapshots.snapshotData })
          .from(chapterSnapshots)
          .where(eq(chapterSnapshots.chapterId, prevChapter.id))
          .orderBy(desc(chapterSnapshots.createdAt))
          .limit(1)
          .get()
        if (prevSnap?.snapshotData) {
          try {
            previousSnapshotData = typeof prevSnap.snapshotData === 'string'
              ? JSON.parse(prevSnap.snapshotData)
              : prevSnap.snapshotData
          } catch {}
        }
      }
    } catch {}

    // 构造供"结果确认"弹窗展示的 items（角色/场景实体/事件/伏笔）— 严格按 ChapterMemoryV2 schema
    const previewItems: any[] = []
    if (snapshotData) {
      // 构建"内部 id → 展示名"映射：事件 participants / 关系 targetId 等引用的都是内部 id（c1/i1/l1），
      // 面向用户展示时必须映射回中文名，不能把技术标识暴露给用户。
      const idToName = new Map<string, string>()
      const collect = (list?: Array<{ id?: string; name?: string }>) => {
        if (!list) return
        for (const x of list) if (x?.id && x?.name) idToName.set(x.id, x.name)
      }
      collect(snapshotData.characters)
      collect(snapshotData.sceneEntities?.characters)
      collect(snapshotData.sceneEntities?.items)
      collect(snapshotData.sceneEntities?.skills)
      collect(snapshotData.sceneEntities?.factions)
      collect(snapshotData.sceneEntities?.systems)
      const lastLoc = snapshotData.currentPlot?.lastLocation
      const lastScn = snapshotData.currentPlot?.lastScene
      if (lastLoc?.id && lastLoc?.name) idToName.set(lastLoc.id, lastLoc.name)
      if (lastScn?.id && lastScn?.name) idToName.set(lastScn.id, lastScn.name)
      for (const c of (snapshotData.characters || [])) {
        collect(c.state?.knownSkills)
        collect(c.state?.holds)
        const loc = c.state?.location
        if (loc?.id && loc?.name) idToName.set(loc.id, loc.name)
      }
      const resolveName = (idOrName: string) => idToName.get(idOrName) || idOrName

      // 角色详细状态：originalSetting 太长做截断
      for (const c of (snapshotData.characters || [])) {
        const parts: string[] = []
        if (c.state?.location?.name) parts.push(`位置 ${c.state.location.name}`)
        if (c.state?.mood) parts.push(`心境 ${c.state.mood}`)
        if (c.state?.injury?.hurt) parts.push(`受伤 ${c.state.injury.severity || '?'}`)
        if (c.state?.holds?.length) parts.push(`持有 ${c.state.holds.map((h) => h.name).join('、')}`)
        previewItems.push({
          title: `[角色] ${c.name}`,
          description: parts.join(' · ') || (c.growthArc || c.personality || ''),
        })
      }
      // 本章出场实体（地点/场景/物品/技能/势力/体系）— 从 sceneEntities 取完整列表
      const se = snapshotData.sceneEntities || {}
      const cp = snapshotData.currentPlot
      // 地点（完整列表）
      for (const loc of (se.locations || [])) {
        previewItems.push({ title: `[地点] ${loc.name}`, description: loc.description || '' })
      }
      // 场景（完整列表）
      for (const scn of (se.scenes || [])) {
        previewItems.push({ title: `[场景] ${scn.name}`, description: scn.summary || '' })
      }
      // 兜底：如果模型没有输出 locations/scenes 但 currentPlot 里有，仍然展示
      if ((se.locations || []).length === 0 && cp?.lastLocation?.name) {
        previewItems.push({ title: `[地点] ${cp.lastLocation.name}`, description: '' })
      }
      if ((se.scenes || []).length === 0 && cp?.lastScene?.name) {
        previewItems.push({ title: `[场景] ${cp.lastScene.name}`, description: cp.lastPlot || '' })
      }
      for (const it of (se.items || [])) {
        previewItems.push({ title: `[物品] ${it.name}`, description: '' })
      }
      for (const sk of (se.skills || [])) {
        previewItems.push({ title: `[技能] ${sk.name}`, description: '' })
      }
      for (const fa of (se.factions || [])) {
        previewItems.push({ title: `[势力] ${fa.name}`, description: '' })
      }
      for (const sy of (se.systems || [])) {
        previewItems.push({ title: `[体系] ${sy.name}`, description: '' })
      }
      for (const ev of (se.events || [])) {
        previewItems.push({ title: `[事件·${eventTypeLabel(ev.type)}] ${ev.summary}`, description: (ev.participants || []).map((p: string) => resolveName(p)).join('、') })
      }
      // 伏笔
      for (const f of (snapshotData.foreshadowing || [])) {
        const actionLabel = f.action === 'planted' ? '未回收' : f.action === 'resolved' ? '已回收' : '推进中'
        previewItems.push({
          title: `[伏笔·${actionLabel}] ${f.description}`,
          description: f.significance ? `重要度 ${f.significance}` : '',
        })
      }
      // 灵感
      for (const insp of (snapshotData.inspirationsUsed || [])) {
        previewItems.push({ title: `[灵感] ${insp.name}`, description: '' })
      }
    }

    const summaryParts: string[] = []
    const pushCount = (label: string, n: number) => { if (n > 0) summaryParts.push(`${n} 个${label}`) }
    if (snapshotData) {
      pushCount('角色', snapshotData.characters?.length || 0)
      pushCount('出场物品', snapshotData.sceneEntities?.items?.length || 0)
      pushCount('事件', snapshotData.sceneEntities?.events?.length || 0)
      pushCount('伏笔', snapshotData.foreshadowing?.length || 0)
      pushCount('灵感', snapshotData.inspirationsUsed?.length || 0)
    }
    if (clips.length > 0) summaryParts.push(`${clips.length} 个记忆线切片`)
    const snapshotSummary = summaryParts.length > 0
      ? `分析出 ${summaryParts.join('、')}`
      : '未分析到任何实体'

    return {
      pendingWrite: createPendingWrite({
        type: 'chapter_snapshot',
        title: `生成章节《${ch.title}》记忆`,
        summary: snapshotSummary,
        target: { chapterId: args.chapterId, entityType: 'chapter' },
        applyMode: 'none',
        // 关键：把算好的数据一并塞进去，apply-hooks 会直接读取落库，不再调模型
        data: { chapterId: args.chapterId, snapshotData, clips, previousSnapshotData },
        preview: {
          title: ch.title,
          summary: `${previewItems.length} 条待入库条目（角色/场景/地点/物品/事件/伏笔）`,
          content: JSON.stringify({ snapshotData, clips }, null, 2),
          items: previewItems,
        },
        riskLevel: 'low',
      }),
    }
  },
  [
    'bookInfo',            // 当前作品信息
    'bookRequirements',    // 作品写作要求（约束·必遵）
    'chapterOutline',      // 本章大纲（生成记忆时由工具直接读本章，无需注入）
    'prevChapterOutline',  // 上一章节大纲
    'prevChapterContent',  // 上一章正文
    'nextChapterOutline',  // 下一章节大纲
    'prevChapterMemory',   // 上一章记忆
  ],
)

export const snapshotTools = [getSnapshotTool, listSnapshotsTool, generateSnapshotTool]
