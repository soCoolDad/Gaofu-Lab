import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, Typography, Button, Space, Tooltip, Pagination, Modal, message } from 'antd'
import {
  BookOutlined,
  UserOutlined,
  EnvironmentOutlined,
  VideoCameraOutlined,
  DeleteOutlined,
  EyeOutlined,
  CheckCircleFilled,
  ReadOutlined,
} from '@ant-design/icons'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useAgentStore } from '@/stores/agent.store'
import { useModelStore } from '@/stores/model.store'
import StoryTimeline, { type StoryTimelineHandle } from '@/components/StoryTimeline'
import SnapshotViewerModal from '@/components/SnapshotViewerModal'
import MDXViewer from '@/components/MDXViewer'
import { BrainOutlined } from '@/icons/BrainOutlined'

const { Title, Text, Paragraph } = Typography

interface TimelineClip {
  id: string
  bookId: string
  chapterId: string
  clipType: 'character' | 'location' | 'scene'
  entityId: string
  entityName: string
  paragraphStart: number
  paragraphEnd: number
  status: string
  snapshotId: string
  prevClipId: string | null
  nextClipId: string | null
  storylineGroup: string
  createdAt: string
}

interface ChapterWithClips {
  chapter: any
  clips: TimelineClip[]
  snapshot: any | null
}

export default function TimelinePage() {
  const { bookId } = useParams()
  const navigate = useNavigate()
  const { chapters, volumes, currentBook, loadChapters } = useWorkspaceStore()
  // 订阅 Agent 运行状态：发起定稿（或任何 Agent 运行）期间，禁用「定稿」按钮，避免重复点击
  const activeRun = useAgentStore((s) => s.activeRun)

  const [timelineData, setTimelineData] = useState<ChapterWithClips[]>([])
  const [loading, setLoading] = useState(false)
  const [viewingSnapshot, setViewingSnapshot] = useState<any>(null)
  // 底部剧情线组件的命令式引用：数据加载完成后自动把最新章节点滚到左侧
  const storyTimelineRef = useRef<StoryTimelineHandle | null>(null)
  // 片段懒加载状态：按可见章节区间/列表分页加载，clipsByChapter 仅保存已加载章节的片段，
  // 避免一次性拉取整本书所有片段（大数据场景的加载卡顿 + 内存爆炸根因）。
  const [clipsByChapter, setClipsByChapter] = useState<Record<string, TimelineClip[]>>({})
  const loadedChapterIdsRef = useRef<Set<string>>(new Set())
  const timelineDataRef = useRef<ChapterWithClips[]>([])
  timelineDataRef.current = timelineData
  const [viewingPrevSnapshot, setViewingPrevSnapshot] = useState<any>(null)
  const [snapshotViewerOpen, setSnapshotViewerOpen] = useState(false)
  // 总记忆查看弹窗
  const [bookMemoryOpen, setBookMemoryOpen] = useState(false)
  const [bookMemoryText, setBookMemoryText] = useState('')
  const [bookMemoryLoading, setBookMemoryLoading] = useState(false)
  // 剧情线列表分页：与章节管理保持一致，pageSize 默认 20
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageSize, setPageSize] = useState<number>(20)
  // 底部"剧情线概览"栏高度（可拖拽调整）：默认 360，最小 120，最大 700
  const [timelineBarHeight, setTimelineBarHeight] = useState<number>(180)
  const [showResizeHandle, setShowResizeHandle] = useState(false)

  // 拖拽调整底部栏高度：按下 mousedown 后绑定全局 mousemove/mouseup，通过 clientY 变化计算新高度
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = timelineBarHeight
    const onMove = (ev: MouseEvent) => {
      // 鼠标向下拖 → clientY 增大 → 底部栏应该"变矮"，因此用 startY - clientY
      const delta = startY - ev.clientY
      const next = Math.max(120, Math.min(700, startHeight + delta))
      setTimelineBarHeight(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }

  const loadTimeline = async () => {
    if (!bookId) return
    setLoading(true)
    try {
      const chaps = chapters.filter(c => c.bookId === bookId).sort((a, b) => a.sortOrder - b.sortOrder)
      // 只拉快照（轻量），片段改为按可见区间/分页懒加载（见 loadClipsForOrders），
      // 不再一次性 listByBook 拉全本书片段，避免大数据下的加载卡顿与内存暴涨。
      const allSnapshots = await (window.api?.ai?.listSnapshotsByBook
        ? window.api.ai.listSnapshotsByBook(bookId)
        : Promise.resolve([]))
      const snapshotByChapter: Record<string, any> = {}
      for (const s of (allSnapshots || [])) {
        snapshotByChapter[s.chapterId] = s
      }
      const result: ChapterWithClips[] = chaps.map((chapter) => ({
        chapter,
        clips: [],
        snapshot: snapshotByChapter[chapter.id] || null,
      }))
      setTimelineData(result)
      // 重置懒加载片段状态，准备按可见区间/分页增量加载
      loadedChapterIdsRef.current = new Set()
      setClipsByChapter({})
    } catch (e) {
      console.error('加载时间线失败:', e)
    } finally {
      setLoading(false)
    }
  }

  // 按章节 sortOrder 区间加载片段（Tier 3 按需加载核心）。
  // 区间内的目标章节若已全部加载过则直接跳过；否则经 clip:listByChapterRange 拉取并合并进 clipsByChapter。
  const loadClipsForOrders = useCallback(async (fromOrder: number, toOrder: number) => {
    const bid = bookId
    if (!bid) return
    const data = timelineDataRef.current
    const targetChapters = data.filter(
      (c) => c.chapter.sortOrder >= fromOrder && c.chapter.sortOrder <= toOrder
    )
    if (targetChapters.length === 0) return
    const missing = targetChapters.filter((c) => !loadedChapterIdsRef.current.has(c.chapter.id))
    if (missing.length === 0) return
    try {
      const clips = await (window.api?.clip?.listByChapterRange
        ? window.api.clip.listByChapterRange(bid, fromOrder, toOrder)
        : Promise.resolve([]))
      const byChap: Record<string, any[]> = {}
      for (const c of (clips || [])) {
        if (!byChap[c.chapterId]) byChap[c.chapterId] = []
        byChap[c.chapterId].push(c)
      }
      setClipsByChapter((prev) => {
        const next = { ...prev }
        for (const [cid, arr] of Object.entries(byChap)) next[cid] = arr
        return next
      })
      // 标记该区间全部目标章节为已加载（含无片段的章节），避免重复拉取
      for (const c of targetChapters) loadedChapterIdsRef.current.add(c.chapter.id)
    } catch (e) {
      console.error('[Timeline] 区间加载片段失败:', e)
    }
  }, [bookId])

  // StoryTimeline 滚动时上报的可见章节区间（0-based）→ 映射成 sortOrder 区间并扩展缓冲后加载
  const handleVisibleRange = useCallback((fromIndex: number, toIndex: number) => {
    const data = timelineDataRef.current
    if (!data.length) return
    const sorted = [...data].sort((a, b) => a.chapter.sortOrder - b.chapter.sortOrder)
    const n = sorted.length
    const BUFFER = 8 // 可见区间两侧额外预加载的章节数
    const from = Math.max(0, fromIndex - BUFFER)
    const to = Math.min(n - 1, toIndex + BUFFER)
    const fromOrder = sorted[from].chapter.sortOrder
    const toOrder = sorted[to].chapter.sortOrder
    loadClipsForOrders(fromOrder, toOrder)
  }, [loadClipsForOrders])

  const handleViewSnapshot = async (ch: ChapterWithClips) => {
    if (!ch.snapshot) return
    const snap = ch.snapshot as any
    const snapshotData = typeof snap.snapshotData === 'string' ? JSON.parse(snap.snapshotData) : snap.snapshotData
    // 拉上一章快照用于差异对比
    const prevChapter = chapters.find((c) => c.bookId === ch.chapter.bookId && c.sortOrder === ch.chapter.sortOrder - 1)
    let prevSnapshotData: any = null
    if (prevChapter && window.api?.ai?.getSnapshot) {
      const prev = await window.api.ai.getSnapshot(prevChapter.id)
      if (prev) {
        prevSnapshotData = typeof (prev as any).snapshotData === 'string' ? JSON.parse((prev as any).snapshotData) : (prev as any).snapshotData
      }
    }
    setViewingSnapshot(snapshotData)
    setViewingPrevSnapshot(prevSnapshotData)
    setSnapshotViewerOpen(true)
  }

  const handleFinalizeChapter = (ch: ChapterWithClips) => {
    if (ch.chapter.status === 'finalized') {
      message.info('该章节已定稿')
      return
    }
    if (ch.chapter.status === 'locked') {
      message.info('章节正在定稿中，请等待「知卷」返回结果')
      return
    }
    if (activeRun) {
      message.info('「知卷」正在处理中，请等待当前任务完成')
      return
    }
    // 草稿/未生成记忆：弹确认框 → 通过 Agent 发一条定稿请求（携带 finalize 标记 + chapterId），
    // 走聊天流（agent-runner 在隐藏系统提示里告知模型调用 generate_snapshot 生成章节记忆），
    // 用户在「知卷」面板确认应用后 → apply-hooks 生成记忆 + 把章节状态置为 finalized。
    Modal.confirm({
      title: '发起定稿',
      width: 520,
      content: (
        <div style={{ fontSize: 13, lineHeight: 1.7, color: '#374151' }}>
          将向「知卷」发送「{ch.chapter.title}」的定稿请求，处理完成后可在面板中确认应用。
        </div>
      ),
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          // 选模型：与「知卷」面板选中口径完全一致（localStorage['agent:selectedModelId']，回退首个启用模型）
          const models = useModelStore.getState().models
          let modelId = ''
          try {
            const saved = localStorage.getItem('agent:selectedModelId') || ''
            if (saved && models.some((m) => m.id === saved && m.enabled)) {
              modelId = saved
            }
          } catch { /* localStorage 不可用时走下方兜底 */ }
          if (!modelId) {
            modelId = models.find((m) => m.enabled)?.id || ''
          }
          if (!modelId) {
            message.error('未找到可用模型，请先在设置里启用一个模型')
            return
          }

          const chapterId = ch.chapter.id
          const chapterTitle = ch.chapter.title
          // 发给模型的完整指令（携带 chapterId 让模型直接定位，不用去查）
          const userInput = `请为章节《${chapterTitle}》完成定稿：生成本章定稿记忆。chapterId: ${chapterId}`
          // 界面上展示的简洁内容（不含 chapterId 这类技术细节）
          const displayInput = `请为章节《${chapterTitle}》完成定稿`

          message.success('已向「知卷」发起定稿请求，请在面板查看进度')

          useAgentStore.getState().sendMessage({
            bookId: bookId || null,
            modelId,
            chapterId,
            volumeId: ch.chapter.volumeId || null,
            finalize: true,
            userInput,
            displayInput,
          }).catch((e: any) => {
            console.error('[Timeline] 定稿请求失败', e)
            message.error(e?.message || '发起定稿失败')
          })
        } catch (e: any) {
          message.error(e?.message || '发起定稿失败')
        }
      },
    })
  }

  const handleDeleteSnapshot = (ch: ChapterWithClips) => {
    if (!bookId) return
    // 计算本章之后有快照的章节
    const laterWithSnapshot = timelineData.filter(
      (row) => row.chapter.sortOrder > ch.chapter.sortOrder && !!row.snapshot
    )
    const laterText = laterWithSnapshot.length > 0
      ? `本章之后有 ${laterWithSnapshot.length} 个章节已生成记忆（${laterWithSnapshot.slice(0, 5).map(r => r.chapter.title).join('、')}${laterWithSnapshot.length > 5 ? '……' : ''}），将一并删除它们的记忆与记忆线片段，并把这些章节状态回退为待定稿（可重新发起定稿）。`
      : ''
    Modal.confirm({
      title: '删除章节记忆',
      width: 520,
      content: (
        <div style={{ fontSize: 13, lineHeight: 1.7, color: '#374151' }}>
          <div style={{ marginBottom: laterText ? 12 : 0 }}>
            将删除「{ch.chapter.title}」的记忆与记忆线片段，并把本章状态回退为待定稿（可重新发起定稿）。
          </div>
          {laterText && <div style={{ color: '#B45309' }}>{laterText}</div>}
        </div>
      ),
      okText: laterWithSnapshot.length > 0 ? '删除本章及后续' : '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await (window as any).api?.ai?.deleteChapterSnapshot?.({
            bookId,
            chapterId: ch.chapter.id,
          })
          message.success('已删除记忆')
          await Promise.all([loadTimeline(), loadChapters(bookId)])
        } catch (e) {
          console.error('删除记忆失败：', e)
          message.error('删除记忆失败')
        }
      },
    })
  }

  useEffect(() => {
    loadTimeline()
    // 只在切书或章节数量变化时重跑；避免 chapters 数组引用变更（如保存正文）触发重复 N+1
  }, [bookId, chapters.length])

  // 当一次 Agent 运行结束（activeRun 由「进行中」变为 null）时，重新拉取记忆线数据，
  // 让定稿生成的章节记忆/快照及时显示出来（定稿走 Agent 流程，结束即代表快照已可生成/落库）。
  const prevActiveRunRef = useRef<any>(null)
  useEffect(() => {
    if (prevActiveRunRef.current && !activeRun) {
      loadTimeline()
    }
    prevActiveRunRef.current = activeRun
  }, [activeRun])

  // 当章节状态发生变化（如定稿应用后变为 finalized、发起定稿后变为 locked）时刷新记忆线，
  // 让「定稿」按钮的可用状态与快照及时更新。仅比对 status 字段，正文编辑不改变 status，故不会触发 N+1 重拉。
  const prevChapterStatusRef = useRef<Record<string, string>>({})
  useEffect(() => {
    const statusMap: Record<string, string> = {}
    for (const c of chapters) statusMap[c.id] = c.status
    const prev = prevChapterStatusRef.current
    const changed =
      Object.keys(prev).length > 0 &&
      Object.keys(statusMap).some((id) => prev[id] !== statusMap[id])
    if (changed) loadTimeline()
    prevChapterStatusRef.current = statusMap
  }, [chapters])

  // timelineData 加载完成后，自动把"最新有快照的章节点"（sortOrder 最大且 snapshot 存在的一章）滚到剧情线可视窗口左侧
  useEffect(() => {
    if (timelineData.length === 0) return
    const latestWithSnapshot = [...timelineData]
      .filter((ch) => !!ch.snapshot)
      .sort((a, b) => b.chapter.sortOrder - a.chapter.sortOrder)[0]
    if (!latestWithSnapshot) return
    const timer = window.setTimeout(() => {
      storyTimelineRef.current?.scrollToChapterId(latestWithSnapshot.chapter.id, 'auto')
    }, 80)
    return () => window.clearTimeout(timer)
  }, [timelineData])

  // 本页使用底栏固定布局，父容器 <Content> 默认 overflow:auto 会引入外层滚动条，把负 margin 露白，此处禁用之
  useEffect(() => {
    const contentEl = document.querySelector('.ant-layout-content') as HTMLElement | null
    if (!contentEl) return
    const prevOverflow = contentEl.style.overflow
    contentEl.style.overflow = 'hidden'
    return () => {
      contentEl.style.overflow = prevOverflow
    }
  }, [])

  const getClipIcon = (type: string) => {
    switch (type) {
      case 'character': return <UserOutlined style={{ color: '#4F46E5' }} />
      case 'location': return <EnvironmentOutlined style={{ color: '#059669' }} />
      case 'scene': return <VideoCameraOutlined style={{ color: '#DC2626' }} />
      default: return <BookOutlined style={{ color: '#6B7280' }} />
    }
  }

  const getClipTypeLabel = (type: string) => {
    switch (type) {
      case 'character': return '角色'
      case 'location': return '地点'
      case 'scene': return '场景'
      default: return '其他'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case '出场': return { label: '出场', color: 'blue' }
      case '退场': return { label: '退场', color: 'default' }
      case '持续': return { label: '持续', color: 'green' }
      default: return { label: status, color: 'default' }
    }
  }

  // 分页：数据条数变化时，页码越界回到第 1 页
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(timelineData.length / pageSize))
    if (currentPage > maxPage) setCurrentPage(1)
  }, [timelineData.length, pageSize])
  const pagedChapters = timelineData.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  // 页级"全章节序号"起点（用于徽章展示 1-based 全局序号，跨页仍然连续）
  const pageStartIndex = (currentPage - 1) * pageSize

  // 列表翻页时加载当前页章节区间的片段（与底部时间线懒加载共用 clipsByChapter，已加载则跳过）
  useEffect(() => {
    if (timelineData.length === 0) return
    const start = (currentPage - 1) * pageSize
    const pageChapters = timelineData.slice(start, start + pageSize)
    if (pageChapters.length === 0) return
    const fromOrder = pageChapters[0].chapter.sortOrder
    const toOrder = pageChapters[pageChapters.length - 1].chapter.sortOrder
    loadClipsForOrders(fromOrder, toOrder)
  }, [currentPage, pageSize, timelineData, loadClipsForOrders])

  // 传给底部 StoryTimeline 的数组：用 useMemo 稳定引用，配合 React.memo 避免父层翻页/状态变更触发无谓重渲染与 tracks 重算
  const timelineChapters = useMemo(() => timelineData.map((ch) => {
    // 段落数必须能"装下"本章所有片段的段落范围，否则 getClipX/getClipW 的 clamp 会把片段全挤到起点重叠。
    // 旧逻辑用 clipMaxEnd+1 撑空间；懒加载下用「已加载片段」的最大 paragraphEnd+1，与正文段数取 max。
    // 若本章尚无片段加载则回落到正文段数（至少 1）。loadedClips 为空时 clipMaxEnd=-1 → 不影响回落逻辑。
    const loadedClips = clipsByChapter[ch.chapter.id] || []
    const clipMaxEnd = loadedClips.reduce((mx, c) => Math.max(mx, (c.paragraphEnd ?? 0)), -1)
    const contentCount = Math.max(1, (ch.chapter.content || '').split(/\n\n+/).filter((p: string) => p.trim()).length)
    const paragraphCount = Math.max(contentCount, clipMaxEnd + 1)
    return {
      id: ch.chapter.id,
      title: ch.chapter.title,
      sortOrder: ch.chapter.sortOrder,
      paragraphCount,
      hasSnapshot: !!ch.snapshot,
      storyTime: ch.snapshot?.storyTime,
    }
  }), [timelineData, clipsByChapter])

  const timelineClips = useMemo(
    () => Object.values(clipsByChapter).flat() as TimelineClip[],
    [clipsByChapter]
  )

  // 章节点点击：跳转到列表对应章节面板（稳定回调，避免 StoryTimeline 因父层重渲而重绑/重渲）
  const handleChapterClick = useCallback((chapterId: string) => {
    const panel = document.querySelector(`.ant-collapse-item[data-key="${chapterId}"]`)
    panel?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  const totalClips = useMemo(
    () => Object.values(clipsByChapter).reduce((sum, arr) => sum + arr.length, 0),
    [clipsByChapter]
  )

  // 打开"查看总记忆"弹窗时按需拉取
  const handleOpenBookMemory = async () => {
    if (!bookId) return
    setBookMemoryOpen(true)
    if (bookMemoryText) return
    setBookMemoryLoading(true)
    try {
      const res = await window.api?.ai?.getBookMemory?.(bookId)
      if (!res || res.empty) {
        setBookMemoryText('暂无总记忆。请先定稿章节，系统会自动生成并聚合记忆。')
      } else {
        setBookMemoryText(res.naturalLanguage || '')
      }
    } catch (e: any) {
      console.error('加载总记忆失败：', e)
      setBookMemoryText(`加载失败：${e?.message || e}`)
    } finally {
      setBookMemoryLoading(false)
    }
  }

  // 删除全书总记忆：高风险操作。清空总记忆 + 各章记忆线片段与章节记忆，章节回退待定稿。
  // 提示风险：不可恢复，且删除后所有章节需重新定稿才能再次生成记忆（正文不受影响）。
  const handleDeleteBookMemory = () => {
    if (!bookId) return
    Modal.confirm({
      title: '删除全书总记忆',
      width: 540,
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      content: (
        <div style={{ fontSize: 13, lineHeight: 1.8, color: '#374151' }}>
          <div style={{ color: '#B45309', fontWeight: 500, marginBottom: 10 }}>
            此操作不可恢复，请谨慎确认。
          </div>
          <div>将清空本书的<strong>全书总记忆</strong>，并连带删除：</div>
          <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
            <li>所有章节的<strong>记忆线片段</strong>（角色 / 地点 / 场景等轨迹）</li>
            <li>所有章节的<strong>章节记忆</strong>（定稿快照）</li>
          </ul>
          <div>
            删除后，本书所有已定稿章节将<strong>回退为「待定稿」</strong>状态，需要重新发起定稿才能再次生成记忆；
            正文内容不受影响。
          </div>
        </div>
      ),
      onOk: async () => {
        try {
          await (window as any).api?.ai?.deleteBookMemory?.(bookId)
          message.success('已删除全书总记忆')
          // 若总记忆弹窗正打开，关闭并清空缓存
          setBookMemoryOpen(false)
          setBookMemoryText('')
          await Promise.all([loadTimeline(), loadChapters(bookId)])
        } catch (e) {
          console.error('删除总记忆失败：', e)
          message.error('删除总记忆失败')
        }
      },
    })
  }

  return (
    <div style={{
      // 用负 margin 抵消 WorkspaceLayout <Content> 的 padding: 20px 24px，
      // 让本页占满整个内容区，底栏与页面完全贴边
      margin: '-20px -24px',
      height: 'calc(100% + 40px)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: '#F6F7FB',
    }}>
      {/*
        覆盖 antd Collapse 展开箭头默认样式：默认为 flex-start 对齐（居于 header 顶部），
        剧情线场景 header 有两行（章节标题 + 分卷标签），需要箭头随整个 header 垂直居中
      */}
      <style>{`
        .timeline-collapse .ant-collapse-header {
          align-items: center !important;
        }
        .timeline-collapse .ant-collapse-expand-icon {
          align-self: center !important;
          margin-top: 0 !important;
          height: auto !important;
          display: flex !important;
          align-items: center !important;
        }
      `}</style>
      {/* 顶部区域：标题栏 + 筛选面板；固定高度不参与滚动/自适应 */}
      <div style={{ padding: '24px 24px 0 24px', flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Title level={3} style={{ margin: 0, marginBottom: 4 }}>
            记忆线
          </Title>
          <Text type="secondary">
            {currentBook?.title && <span style={{ marginRight: 8 }}>{currentBook.title}</span>}
            共 {timelineData.length} 章 · {totalClips} 个片段
          </Text>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            danger
            icon={<DeleteOutlined />}
            onClick={handleDeleteBookMemory}
          >
            删除总记忆
          </Button>
          <Button
            type="primary"
            icon={<ReadOutlined />}
            onClick={handleOpenBookMemory}
          >
            查看总记忆
          </Button>
        </div>
      </div>
      </div>

      {/* 中间：列表区（自适应高度），loading/空态/正常列表均落在这里 */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '0 24px 12px 24px', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <Text type="secondary">加载中...</Text>
          </div>
        ) : timelineData.length === 0 ? (
          <Card variant="borderless" style={{ borderRadius: 12, textAlign: 'center', padding: '48px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>
              <BrainOutlined style={{ fontSize: 48, color: '#4F46E5' }} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 500, color: '#111827', marginBottom: 8 }}>
              当前没有记忆
            </div>
            <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 20 }}>
              请先将章节定稿，系统会自动生成记忆线片段
            </div>
            <Button type="primary" onClick={() => navigate(`/book/${bookId}/chapters`)}>
              去写作
            </Button>
          </Card>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <Card
              variant="borderless"
              // 自适应高度：flex:1 占满父容器（父容器已限定高度），内部滚动
              style={{ borderRadius: 12, background: '#FFFFFF', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
              // 列表与白卡容器紧贴：内边距 0，让 Collapse 每个 Panel 的白色底自然占满
              styles={{ body: { padding: 0, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
            >
              {/* 滚动区：只在这个 div 上做垂直滚动 */}
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12 }}>
                {pagedChapters.map((ch, idx) => {
                  const volume = volumes.find(v => v.id === ch.chapter.volumeId)
                  // 片段来自懒加载的 clipsByChapter（而非 timelineData，避免一次性全量加载）
                  const chClips = clipsByChapter[ch.chapter.id] || []
                  const sortedClips = [...chClips].sort((a, b) => a.paragraphStart - b.paragraphStart)
                  // 判断章节是否显示「定稿」按钮：
                  // ① 必须是 draft / completed（locked=定稿中、finalized=已定稿 都不显示）
                  // ② 还没有生成过定稿记忆（snapshot）
                  // ③ 当前没有其它 Agent 任务在跑（避免并发重复发起）
                  // 只有 status === 'completed'（写作已完成、待定稿）才显示按钮；
                  // draft（写作进行中）、locked（定稿中）、finalized（已定稿）一律不显示。
                  const chapterStatus = ch.chapter.status
                  const showFinalizeBtn = !ch.snapshot && chapterStatus === 'completed' && !activeRun

                  return (
                    <div
                      key={ch.chapter.id}
                      style={{
                        background: '#FFFFFF',
                        border: '1px solid #F1F5F9',
                        borderRadius: 8,
                        padding: 12,
                        marginBottom: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          background: '#EEF2FF',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#4F46E5',
                          fontWeight: 600,
                          fontSize: 13,
                          flexShrink: 0,
                        }}>
                          {pageStartIndex + idx + 1}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ch.chapter.title}
                          </div>
                          {volume && (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {volume.title}
                            </Text>
                          )}
                        </div>
                        <Space>
                          {sortedClips.length > 0 && (
                            <Tooltip title={`已生成记忆线（${sortedClips.length} 个片段）`}>
                                <Button color="green" type="text" size="small" icon={<CheckCircleFilled />} />
                            </Tooltip>
                          )}
                          {ch.snapshot ? (
                            <>
                              <Tooltip title="查看记忆">
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<EyeOutlined />}
                                  onClick={() => handleViewSnapshot(ch)}
                                />
                              </Tooltip>
                              <Tooltip title="删除本章记忆（会级联删除后续章节的记忆）">
                                <Button
                                  type="text"
                                  size="small"
                                  danger
                                  icon={<DeleteOutlined />}
                                  onClick={() => handleDeleteSnapshot(ch)}
                                />
                              </Tooltip>
                            </>
                          ) : showFinalizeBtn ? (
                            <Tooltip title="发起定稿">
                              <Button
                                type="primary"
                                size="small"
                                icon={<CheckCircleFilled />}
                                onClick={() => handleFinalizeChapter(ch)}
                              >
                                定稿
                              </Button>
                            </Tooltip>
                          ) : null}
                        </Space>
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* 分页栏固定在白卡底部，不参与滚动区滚动 */}
              {timelineData.length > pageSize && (
                <div style={{ padding: '10px 16px', borderTop: '1px solid #F3F4F6', display: 'flex', justifyContent: 'flex-end', flexShrink: 0, background: '#FFFFFF' }}>
                  <Pagination
                    size="small"
                    current={currentPage}
                    pageSize={pageSize}
                    total={timelineData.length}
                    showSizeChanger
                    pageSizeOptions={[10, 20, 50, 100]}
                    onChange={(page, size) => {
                      setCurrentPage(page)
                      if (size && size !== pageSize) setPageSize(size)
                    }}
                    showTotal={(t) => `共 ${t} 章`}
                  />
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      {/* 底部固定栏：剧情线概览（可拖拽调整高度） */}
      {!loading && timelineData.length > 0 && (
        <div style={{ height: timelineBarHeight, flexShrink: 0, background: '#FFFFFF', overflow: 'hidden', display: 'flex', flexDirection: 'column', borderTop: '1px solid #E5E7EB', position: 'relative', paddingTop: 0 }}>
          {/* 拖动分隔条：平时隐藏，hover 时显示。绝对定位，不占据空间 */}
          <div
            onMouseDown={handleResizeStart}
            onMouseEnter={() => setShowResizeHandle(true)}
            onMouseLeave={() => setShowResizeHandle(false)}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              height: 12,
              cursor: 'row-resize',
              zIndex: 10,
            }}
            title="拖动调整概览栏高度"
          >
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: 40,
                height: 4,
                background: showResizeHandle ? '#CBD5E1' : 'transparent',
                borderRadius: 2,
                transition: 'all 0.2s ease',
              }}
            />
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <StoryTimeline
              ref={storyTimelineRef}
              bookId={bookId || ''}
              chapters={timelineChapters}
              clips={timelineClips}
              onChapterClick={handleChapterClick}
              onVisibleChapterRangeChange={handleVisibleRange}
              // 内容自适应底栏高度：减去拖动把手区域 2
              height={Math.max(60, timelineBarHeight - 2)}
            />
          </div>
        </div>
      )}

      <SnapshotViewerModal
        open={snapshotViewerOpen}
        onClose={() => { setSnapshotViewerOpen(false); setViewingSnapshot(null); setViewingPrevSnapshot(null) }}
        snapshotData={viewingSnapshot}
        previousSnapshotData={viewingPrevSnapshot}
      />

      {/* 总记忆查看弹窗：显示 book_memory.data 序列化出的中文文本，只读；用 Markdown 渲染 */}
      <Modal
        title={
          <Space>
            <BrainOutlined style={{ color: '#4F46E5' }} />
            <span>全书总记忆</span>
          </Space>
        }
        open={bookMemoryOpen}
        onCancel={() => setBookMemoryOpen(false)}
        footer={
          <Button onClick={() => setBookMemoryOpen(false)}>关闭</Button>
        }
        width={820}
        centered
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto', padding: '16px 24px', background: '#FAFBFC' } }}
      >
        {bookMemoryLoading ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Text type="secondary">加载中...</Text>
          </div>
        ) : (
          <div style={{ fontSize: 13, lineHeight: 1.75, color: '#1F2937' }}>
            <MDXViewer content={bookMemoryText} style={{ maxWidth: '100%' }} />
          </div>
        )}
      </Modal>
    </div>
  )
}
