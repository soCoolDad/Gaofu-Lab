import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ReactNode, CSSProperties } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, Button, Typography, Collapse, Empty, message, Space, Tooltip, Popover, Modal, Select, Tag, Input, Spin } from 'antd'
import {
  TeamOutlined,
  FireOutlined,
  BulbOutlined,
  ArrowLeftOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  EnvironmentOutlined,
  InboxOutlined,
  BankOutlined,
  ApartmentOutlined,
  PartitionOutlined,
  ReadOutlined,
  ProfileOutlined,
  SaveOutlined,
  CheckOutlined,
  EyeOutlined,
  EditOutlined,
} from '@ant-design/icons'
import MDXEditorWrapper from '@/components/MDXEditorWrapper'
import type { MDXEditorWrapperHandle } from '@/components/MDXEditorWrapper'
import MDXViewer from '@/components/MDXViewer'
import SnapshotViewerModal from '@/components/SnapshotViewerModal'
import { BrainOutlined } from '@/icons/BrainOutlined'
import ResizeHandle from '@/components/ResizeHandle'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useAgentStore } from '@/stores/agent.store'
import { useModelStore } from '@/stores/model.store'
import type { BookSettingEntry, BookSettingEntryType } from '@/types/api'
import type { Chapter, Volume } from '@/types/api'
import StoryTimeline, { type StoryTimelineHandle } from '@/components/StoryTimeline'

const { Title, Text, Paragraph } = Typography

const EDITOR_CONTEXT_PANEL_STATE_KEY = 'ainovel.editor.contextPanelState'
const EDITOR_LAST_CHAPTER_KEY_PREFIX = 'ainovel.editor.lastChapter.'
const CONTEXT_PANEL_MIN_WIDTH = 150
const CONTEXT_PANEL_MAX_WIDTH = 300
const CONTEXT_PANEL_DEFAULT_WIDTH = 240
const TIMELINE_MIN_HEIGHT = 40
const TIMELINE_MAX_HEIGHT = 300
const TIMELINE_DEFAULT_HEIGHT = 150

export default function EditorPage() {
  const { bookId } = useParams()
  const navigate = useNavigate()
  const { chapters, currentBook, updateChapter, loadChapters, updateBook, selectedSnapshotId, setSelectedSnapshotId, createChapter } = useWorkspaceStore()
  const workspaceLoading = useWorkspaceStore((s) => s.loading)
  // 订阅 Agent 运行状态：定稿（或任何 Agent 运行）进行中时，禁用「定稿」按钮，避免重复点击
  const activeRun = useAgentStore((s) => s.activeRun)

  const [currentChapter, setCurrentChapter] = useState<Chapter | null>(null)
  const [editorKey, setEditorKey] = useState(0)
  // 剧情线组件命令式引用：切章时把当前章的章节点滚到可视窗口靠左位置
  const storyTimelineRef = useRef<StoryTimelineHandle | null>(null)
  // 当前正文字数（实时，仅前端计算）
  const [liveWordCount, setLiveWordCount] = useState<number>(0)
  // 章节快照下拉列表 & 选中的快照内容
  const [snapshotList, setSnapshotList] = useState<Array<{ id: string; chapterId: string; chapterOrder: number; chapterTitle: string; storyTime: string | null }>>([])
  const [selectedSnapshotData, setSelectedSnapshotData] = useState<any | null>(null)
  // 截至选中快照为止的所有快照数据（key: snapshotId → snapshotData）用于跨章节聚合"所有角色/地点/场景"
  const [allSnapshotDataMap, setAllSnapshotDataMap] = useState<Record<string, any>>({})
  // 快照详情弹窗开关
  const [snapshotDetailOpen, setSnapshotDetailOpen] = useState(false)
  // 正文写作设置：面板表单（默认从 currentBook 读取，输入时立即写入 state 并 debounce 落库）
  // 快照选择与「章节快照」面板共用 selectedSnapshotId，此处不再单独维护 snapshotId
  const [writingCfg, setWritingCfg] = useState<{ style: string; pov: string; wordCountTarget: string; taboo: string; constraint: string }>({
    style: '',
    pov: '',
    wordCountTarget: '',
    taboo: '',
    constraint: '',
  })
  const [volumes, setVolumes] = useState<Volume[]>([])
  const [bookSettings, setBookSettings] = useState<BookSettingEntry[]>([])
  const [timelineClipData, setTimelineClipData] = useState<Record<string, any[]>>({})
  const [timelineSnapshotData, setTimelineSnapshotData] = useState<Record<string, { isValid: boolean; storyTime?: string }>>({})
  // 分数据源加载态：整个正文编辑页要等这四份数据都到位才渲染，避免闪烁 & 半页面状态。
  // 每当 bookId 变化时（切书）四个 flag 都重置回 false，让加载覆盖层重新出现。
  const [volumesLoading, setVolumesLoading] = useState(true)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [timelineLoading, setTimelineLoading] = useState(true)
  // 空态（未选章节）下的分卷/章节选择：null 表示未指定。
  // 首次进入或章节列表变化时，按照以下三条规则自动初始化：
  //   1. 全书最早的空章（wordCount === 0） → 分卷=该章的 volumeId，章节=该章 id
  //   2. 无空章但有章节 → 分卷=最新章的 volumeId，章节=null
  //   3. 都没有 → 分卷=第一分卷，章节=null
  const [emptyStateVolumeId, setEmptyStateVolumeId] = useState<string | null>(null)
  const [emptyStateVolumeInited, setEmptyStateVolumeInited] = useState(false)
  const [emptyStateChapterId, setEmptyStateChapterId] = useState<string | null>(null)
  const [creatingChapter, setCreatingChapter] = useState(false)
  const [contextPanelCollapsed, setContextPanelCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(EDITOR_CONTEXT_PANEL_STATE_KEY)
      return saved ? !!JSON.parse(saved).collapsed : true
    } catch {
      return true
    }
  })
  const [contextPanelWidth, setContextPanelWidth] = useState(() => {
    try {
      const saved = localStorage.getItem(EDITOR_CONTEXT_PANEL_STATE_KEY)
      const parsed = saved ? JSON.parse(saved) : null
      return parsed?.width || CONTEXT_PANEL_DEFAULT_WIDTH
    } catch {
      return CONTEXT_PANEL_DEFAULT_WIDTH
    }
  })
  const [timelineHeight, setTimelineHeight] = useState(TIMELINE_DEFAULT_HEIGHT)
  const editorRef = useRef<MDXEditorWrapperHandle>(null)
  const isResizingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)
  const timelineIsResizingRef = useRef(false)
  const timelineStartYRef = useRef(0)
  const timelineStartHeightRef = useRef(0)
  const [openContextKeys, setOpenContextKeys] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(EDITOR_CONTEXT_PANEL_STATE_KEY)
      const parsed = saved ? JSON.parse(saved) : null
      return Array.isArray(parsed?.openKeys) ? parsed.openKeys : ['chapter-outline', 'volume-outline']
    } catch {
      return ['chapter-outline', 'volume-outline']
    }
  })

  // 找到当前章节：仅在 bookId 变化或章节数量变化时执行
  // 依赖 chapters 数组引用会因 updateChapter 频繁刷新，导致编辑器被强制 remount
  //
  // 关键语义：只有 localStorage 里存有 lastChapter 且该章仍存在时才自动打开该章；
  // 其它情况一律落到空态（currentChapter = null），让用户回到"请开始创作吧！"。
  // 这样"离开 Editor → 清空 lastChapter → 再进 Editor"就能可靠落到空态。
  useEffect(() => {
    const lastChapterKey = bookId ? `${EDITOR_LAST_CHAPTER_KEY_PREFIX}${bookId}` : ''
    if (chapters.length > 0) {
      const savedId = lastChapterKey ? localStorage.getItem(lastChapterKey) : null
      const savedChapter = savedId ? chapters.find((c) => c.id === savedId) : null
      // 如果当前已经选中一个存在于列表里的章节，不做任何切换（避免打断用户输入）
      const pickedFromList = (prev: Chapter | null) => {
        if (prev && chapters.find((c) => c.id === prev.id)) return prev
        // 没有显式指定的 lastChapter 就落到空态，不再默认到 chapters[0]
        return (savedChapter ?? null) as Chapter | null
      }
      setCurrentChapter((prev) => pickedFromList(prev))
    } else {
      setCurrentChapter(null)
    }
    // 首次加载或章节数量变化时刷新编辑器
    setEditorKey((k) => k + 1)
  }, [bookId, chapters.length])

  // 同步 workspaceStore.chapters 里的元数据变化到本地 currentChapter：
  // 例如 Agent 应用快照后主进程会把 status 改为 'finalized' 并广播 chapters-updated，
  // workspaceStore 重拉 chapters 后需要把 status / outline / summary / title 等字段合回来，
  // 否则「定稿」按钮和只读态不会切换。
  // 注意：不覆盖 content（content 由用户输入或独立的 chapter.get 拉取，避免打断编辑）。
  useEffect(() => {
    if (!currentChapter?.id) return
    const latest = chapters.find((c) => c.id === currentChapter.id)
    if (!latest) return
    setCurrentChapter((prev) => {
      if (!prev || prev.id !== latest.id) return prev
      if (
        prev.status === latest.status &&
        prev.title === latest.title &&
        prev.outline === latest.outline &&
        prev.summary === latest.summary &&
        prev.volumeId === latest.volumeId &&
        prev.wordCount === latest.wordCount &&
        prev.updatedAt === latest.updatedAt
      ) {
        return prev
      }
      return { ...prev, ...latest, content: prev.content }
    })
  }, [chapters, currentChapter?.id])

  // 离开正文编辑页时清空"上次编辑章节 ID"记录。
  // 语义：只有从章节列表页显式点进来才携带 lastChapter；一旦离开 Editor 后再次进入，
  // 就回到空态（请开始创作吧！），需要用户重新选择或点进来。
  // 切书（bookId 变化）也视为离开当前书的编辑上下文，一并清空该书的 lastChapter。
  useEffect(() => {
    if (!bookId) return
    const key = `${EDITOR_LAST_CHAPTER_KEY_PREFIX}${bookId}`
    return () => {
      try { localStorage.removeItem(key) } catch {}
    }
  }, [bookId])

  // chapter:list 出于性能考虑不再返回 content 大正文，
  // 这里在 currentChapter 变化时按需拉取完整正文一次。
  useEffect(() => {
    if (!currentChapter?.id || !window.api?.chapter?.get) return
    // 已经有 content（例如刚保存过或 ai-result-applied 已回填）就不再拉
    if (currentChapter.content !== undefined && currentChapter.content !== null) return
    let cancelled = false
    window.api.chapter.get(currentChapter.id).then((full) => {
      if (cancelled || !full) return
      setCurrentChapter((prev) => prev && prev.id === full.id ? { ...prev, ...full } : prev)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [currentChapter?.id])

  // 空态默认值初始化：按上方注释的三条规则一次性设定 emptyStateVolumeId + emptyStateChapterId。
  // 修复历史 bug：workspace 的 chapters/volumes 是异步加载的，初始都是空数组 []。
  // 之前的实现会在数据未就绪时就把 emptyStateVolumeInited 锁死为 true，导致永远落到"未分卷"。
  // 现在改为：只要看到 chapters 或 volumes 中任意一方有数据，就用当下的数据初始化并锁；
  // 若切书后到某个时间点两者都还是空，那么"落到未分卷"就是符合规则 3 的正确结果。
  useEffect(() => {
    setEmptyStateVolumeInited(false)
  }, [bookId])
  useEffect(() => {
    if (emptyStateVolumeInited) return
    const bookChapters = chapters.filter((c) => c.bookId === bookId)
    const volumesInBook = volumes.filter((v) => v.bookId === bookId).sort((a, b) => a.sortOrder - b.sortOrder)
    // 数据还没就位：本书的 chapters/volumes 都为空且 workspace 还在 loading —— 等一等再初始化，避免误落到"未分卷"
    if (bookChapters.length === 0 && volumesInBook.length === 0) {
      return
    }
    // 规则 1：全书最早的"空章"（wordCount === 0），按 sortOrder 升序取第一个
    const earliestEmpty = [...bookChapters]
      .filter((c) => (c.wordCount || 0) === 0)
      .sort((a, b) => a.sortOrder - b.sortOrder)[0]
    if (earliestEmpty) {
      setEmptyStateVolumeId(earliestEmpty.volumeId ?? null)
      setEmptyStateChapterId(earliestEmpty.id)
    } else if (bookChapters.length > 0) {
      // 规则 2：无空章但有章节 → 最新章的分卷，章节不设定
      const latest = [...bookChapters].sort((a, b) => b.sortOrder - a.sortOrder)[0]
      setEmptyStateVolumeId(latest?.volumeId ?? null)
      setEmptyStateChapterId(null)
    } else {
      // 规则 3：都没有章节 → 第一分卷（此时 volumesInBook.length > 0 一定成立）
      setEmptyStateVolumeId(volumesInBook[0]?.id ?? null)
      setEmptyStateChapterId(null)
    }
    setEmptyStateVolumeInited(true)
  }, [bookId, chapters, volumes, emptyStateVolumeInited])

  useEffect(() => {
    if (!bookId || !window.api?.volume?.list) {
      setVolumes([])
      setVolumesLoading(false)
      return
    }
    setVolumesLoading(true)
    window.api.volume.list(bookId)
      .then((v) => { setVolumes(v); setVolumesLoading(false) })
      .catch(() => { setVolumes([]); setVolumesLoading(false) })
  }, [bookId])

  // 抽出剧情线数据的加载函数，供初始化 effect + 快照生成/AI 应用事件复用。
  // 参数 setLoading=true 只在页面初始化时用；事件驱动的重拉不切 loading（保持页面不闪）。
  const reloadTimelineData = useCallback(async (setLoading = false) => {
    if (!bookId || !window.api?.clip?.listByBook || !window.api?.ai?.listSnapshotsByBook) {
      setTimelineClipData({})
      setTimelineSnapshotData({})
      if (setLoading) setTimelineLoading(false)
      return
    }
    if (setLoading) setTimelineLoading(true)
    try {
      const [allClips, allSnapshots] = await Promise.all([
        window.api.clip.listByBook(bookId),
        window.api.ai.listSnapshotsByBook(bookId),
      ])
      const clipData: Record<string, any[]> = {}
      for (const c of (allClips || [])) {
        const cid = c.chapterId
        if (!clipData[cid]) clipData[cid] = []
        clipData[cid].push(c)
      }
      const snapshotData: Record<string, { isValid: boolean; storyTime?: string }> = {}
      const fullMap: Record<string, any> = {}
      for (const s of (allSnapshots || [])) {
        snapshotData[s.chapterId] = {
          isValid: s.isValid,
          storyTime: s.storyTime,
        }
        if (s.snapshotData) {
          fullMap[s.id] = typeof s.snapshotData === 'string' ? JSON.parse(s.snapshotData) : s.snapshotData
        }
      }
      setTimelineClipData(clipData)
      setTimelineSnapshotData(snapshotData)
      setAllSnapshotDataMap((prev) => ({ ...fullMap, ...prev }))
    } catch {
      setTimelineClipData({})
      setTimelineSnapshotData({})
    } finally {
      if (setLoading) setTimelineLoading(false)
    }
  }, [bookId])

  useEffect(() => {
    let cancelled = false
    reloadTimelineData(true).catch(() => {})
    return () => { cancelled = true; void cancelled }
  }, [bookId, chapters.length, reloadTimelineData])

  const loadBookSettings = useCallback(async () => {
    if (!bookId) {
      setBookSettings([])
      setSettingsLoading(false)
      return
    }
    setSettingsLoading(true)
    // 优先使用 batch API 一次拉全部 8 个类型，避免 8 次 IPC 排队
    if (window.api?.bookSetting?.listAll) {
      try {
        const all = await window.api.bookSetting.listAll(bookId)
        setBookSettings(all || [])
        return
      } catch {
        setBookSettings([])
        return
      } finally {
        setSettingsLoading(false)
      }
    }
    // 兜底：老 API 逐类型并发
    if (!window.api?.bookSetting?.list) {
      setBookSettings([])
      setSettingsLoading(false)
      return
    }
    try {
      const settingTypes: BookSettingEntryType[] = ['characters', 'locations', 'items', 'skills', 'scenes', 'factions', 'systems', 'inspirations']
      const data = await Promise.all(settingTypes.map((type) => window.api.bookSetting.list({ bookId, type })))
      setBookSettings(data.flat())
    } finally {
      setSettingsLoading(false)
    }
  }, [bookId])

  useEffect(() => {
    loadBookSettings().catch(() => setBookSettings([]))
  }, [loadBookSettings])

  useEffect(() => {
    const handleBookSettingsUpdated = () => {
      loadBookSettings().catch(() => setBookSettings([]))
    }
    window.addEventListener('book-settings-updated', handleBookSettingsUpdated)
    return () => window.removeEventListener('book-settings-updated', handleBookSettingsUpdated)
  }, [loadBookSettings])

  useEffect(() => {
    localStorage.setItem(EDITOR_CONTEXT_PANEL_STATE_KEY, JSON.stringify({
      collapsed: contextPanelCollapsed,
      openKeys: openContextKeys,
      width: contextPanelWidth,
    }))
  }, [contextPanelCollapsed, openContextKeys, contextPanelWidth])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizingRef.current = true
    startXRef.current = e.clientX
    startWidthRef.current = contextPanelWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return
      const delta = startXRef.current - e.clientX
      const newWidth = Math.min(CONTEXT_PANEL_MAX_WIDTH, Math.max(CONTEXT_PANEL_MIN_WIDTH, startWidthRef.current + delta))
      setContextPanelWidth(newWidth)
    }

    const handleMouseUp = () => {
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [contextPanelWidth])

  const handleTimelineResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    timelineIsResizingRef.current = true
    timelineStartYRef.current = e.clientY
    timelineStartHeightRef.current = timelineHeight
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineIsResizingRef.current) return
      const delta = timelineStartYRef.current - e.clientY
      const newHeight = Math.min(TIMELINE_MAX_HEIGHT, Math.max(TIMELINE_MIN_HEIGHT, timelineStartHeightRef.current + delta))
      setTimelineHeight(newHeight)
    }

    const handleMouseUp = () => {
      timelineIsResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [timelineHeight])

  useEffect(() => {
    if (!bookId || !currentChapter) return
    localStorage.setItem(`${EDITOR_LAST_CHAPTER_KEY_PREFIX}${bookId}`, currentChapter.id)
  }, [bookId, currentChapter?.id])

  useEffect(() => {
    const handleAiApplied = async () => {
      if (!currentChapter?.id || !window.api?.chapter?.get) return
      const latest = await window.api.chapter.get(currentChapter.id)
      if (!latest) return
      setCurrentChapter(latest)
      setEditorKey((k) => k + 1)
      // AI 应用（含快照、正文写入等）后，剧情线/快照列表可能已经变化 —— 重拉一次
      reloadTimelineData().catch(() => {})
    }
    window.addEventListener('ai-result-applied', handleAiApplied)
    return () => window.removeEventListener('ai-result-applied', handleAiApplied)
  }, [currentChapter?.id, reloadTimelineData])

  useEffect(() => {
    if (!window.api?.ai?.onSnapshotGenerated) return
    const unsubscribe = window.api.ai.onSnapshotGenerated((data) => {
      if (!data.success) return
      // 无论生成的是不是当前章节，都要刷剧情线：剧情线是全书维度的视图，别的章节生成快照
      // 后本章底部时间线也会新增点位。
      if (bookId) loadChapters(bookId)
      reloadTimelineData().catch(() => {})
      // 只在生成的是当前章节时才弹提示，避免打扰
      if (data.chapterId === currentChapter?.id) {
        message.success('章节记忆生成完成')
      }
    })
    return unsubscribe
  }, [currentChapter?.id, bookId, loadChapters, reloadTimelineData])

  const handleContentChange = useCallback((markdown: string) => {
    // 实时更新前端字数展示（不调接口）：去除 markdown 语法字符与空白后计数
    const plain = (markdown || '')
      .replace(/```[\s\S]*?```/g, '')      // 去代码块
      .replace(/`[^`]*`/g, '')              // 去行内代码
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 去图片
      .replace(/\[[^\]]*\]\([^)]*\)/g, '')  // 去链接
      .replace(/[#>*_~`\-]/g, '')           // 去 markdown 符号
      .replace(/\s+/g, '')                  // 去空白
    setLiveWordCount(plain.length)
  }, [])

  // 章节切换或 currentChapter.content 被外部（如 AI 应用）更新时，都要重新计算字数
  useEffect(() => {
    handleContentChange(currentChapter?.content || '')
  }, [currentChapter?.id, currentChapter?.content, handleContentChange])

  // 章节切换或快照数据更新时，把剧情线滚到"最新有快照的章节点"（sortOrder 最大的那一章）
  // 若整本书还没有任何快照，就不做定位，保持默认视口
  useEffect(() => {
    if (!bookId) return
    const bookChapters = chapters
      .filter((c) => c.bookId === bookId)
      .sort((a, b) => b.sortOrder - a.sortOrder)
    const latestWithSnapshot = bookChapters.find((c) => !!timelineSnapshotData[c.id]?.isValid)
    if (!latestWithSnapshot) return
    // 轻微延迟，等待 StoryTimeline 内部 sortedChapters 更新完成
    const timer = window.setTimeout(() => {
      storyTimelineRef.current?.scrollToChapterId(latestWithSnapshot.id, 'smooth')
    }, 60)
    return () => window.clearTimeout(timer)
  }, [bookId, currentChapter?.id, timelineSnapshotData, chapters])

  // 加载书籍所有快照列表：默认选中章节序号最大的一个
  useEffect(() => {
    if (!bookId || !window.api?.ai?.listSnapshots) {
      setSnapshotList([])
      setSelectedSnapshotId(null)
      return
    }
    let cancelled = false
    window.api.ai.listSnapshots(bookId).then((rows) => {
      if (cancelled) return
      setSnapshotList(rows || [])
      if (rows && rows.length > 0) {
        // 默认选中最后一个（章节序号最大）；若之前的选择仍在列表里则保持
        const last = rows[rows.length - 1]
        const currentId = useWorkspaceStore.getState().selectedSnapshotId
        if (currentId && rows.some((r) => r.id === currentId)) {
          // 保持不变
        } else {
          setSelectedSnapshotId(last.id)
        }
      } else {
        setSelectedSnapshotId(null)
        setSelectedSnapshotData(null)
      }
    }).catch(() => {
      if (!cancelled) {
        setSnapshotList([])
        setSelectedSnapshotId(null)
      }
    })
    return () => { cancelled = true }
  }, [bookId, chapters.length])

  // 加载选中快照的完整数据 + 跨快照聚合数据（截至该快照为止所有快照）
  // 注意：allSnapshotDataMap 已经被 timeline 那个 useEffect 通过 batch IPC 预填了，
  // 所以这里绝大多数情况下无需再发 IPC，直接从内存 map 取即可。
  useEffect(() => {
    if (!selectedSnapshotId) {
      setSelectedSnapshotData(null)
      return
    }
    const item = snapshotList.find((r) => r.id === selectedSnapshotId)
    if (!item) return
    // 直接从内存 map 取
    const data = allSnapshotDataMap[selectedSnapshotId]
    if (data !== undefined) {
      setSelectedSnapshotData(data ?? null)
      return
    }
    // fallback：内存里没有就发一次 IPC（例如刚生成完的新快照）
    if (!window.api?.ai?.getSnapshot) return
    let cancelled = false
    window.api.ai.getSnapshot(item.chapterId).then((snap) => {
      if (cancelled) return
      const raw = snap?.snapshotData
      const snapData = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null
      setSelectedSnapshotData(snapData)
      if (snapData) setAllSnapshotDataMap((prev) => ({ ...prev, [selectedSnapshotId]: snapData }))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [selectedSnapshotId, snapshotList, allSnapshotDataMap])

  const handleSave = useCallback(
    async (content: string) => {
      if (!currentChapter) return
      try {
        await updateChapter(currentChapter.id, { content })
        setCurrentChapter((prev) => prev ? { ...prev, content } : null)
        message.success('已保存')
      } catch (e: any) {
        console.error('保存失败：', e)
        message.error(e?.message || '保存失败')
      }
    },
    [currentChapter, updateChapter],
  )

  // currentBook 加载完成后同步一次到面板；也在 currentBook 变化时（如切书）重置
  useEffect(() => {
    if (!currentBook) return
    setWritingCfg({
      style: currentBook.writingStyle || '',
      pov: currentBook.writingPov || '',
      wordCountTarget: currentBook.writingWordCountTarget || '',
      taboo: currentBook.writingTaboo || '',
      constraint: currentBook.writingConstraint || '',
    })
  }, [currentBook?.id])

  // debounce 保存参数字段到 books 表（不包含 snapshotId，snapshotId 仅内存态）
  const writingCfgSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!bookId || !currentBook) return
    if (writingCfgSaveTimerRef.current) clearTimeout(writingCfgSaveTimerRef.current)
    writingCfgSaveTimerRef.current = setTimeout(() => {
      // 只写变化字段，避免无谓 IPC
      const patch: any = {}
      if (writingCfg.style !== (currentBook.writingStyle || '')) patch.writingStyle = writingCfg.style
      if (writingCfg.pov !== (currentBook.writingPov || '')) patch.writingPov = writingCfg.pov
      if (writingCfg.wordCountTarget !== (currentBook.writingWordCountTarget || '')) patch.writingWordCountTarget = writingCfg.wordCountTarget
      if (writingCfg.taboo !== (currentBook.writingTaboo || '')) patch.writingTaboo = writingCfg.taboo
      if (writingCfg.constraint !== (currentBook.writingConstraint || '')) patch.writingConstraint = writingCfg.constraint
      if (Object.keys(patch).length === 0) return
      updateBook(bookId, patch).catch(() => { /* 忽略 */ })
    }, 500)
    return () => {
      if (writingCfgSaveTimerRef.current) clearTimeout(writingCfgSaveTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writingCfg.style, writingCfg.pov, writingCfg.wordCountTarget, writingCfg.taboo, writingCfg.constraint])

  // 离开正文页时清空共享的参考快照选择，避免污染其它页面/非正文场景的知卷请求
  useEffect(() => {
    return () => {
      setSelectedSnapshotId(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleStatusChange = async () => {
    if (!currentChapter) return
    // 已定稿：不做任何操作
    if (currentChapter.status === 'finalized') {
      return
    }
    // 已锁定（定稿中）或 Agent 正在处理：不做操作，避免重复发起定稿
    if (currentChapter.status === 'locked') {
      message.info('章节正在定稿中，请等待「知卷」返回结果')
      return
    }
    if (activeRun) {
      message.info('「知卷」正在处理中，请等待当前任务完成')
      return
    }
    // 草稿：弹确认框 → 保存 → 通过 Agent 发一条明确的定稿请求（携带 finalize 标记 + chapterId）。
    //   走聊天流：agent-runner 会在隐藏系统提示里告知模型调用 generate_snapshot 生成章节记忆，
    //   由用户在「知卷」面板确认应用 → apply-hooks 生成记忆 + 把 status 改为 finalized。
    Modal.confirm({
      title: '发起定稿',
      content: '将向「知卷」发送定稿请求，处理完成后可在面板中确认应用。',
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          // 1. 保存当前正文
          editorRef.current?.save()

          // 2. 选模型：与「知卷」面板选中口径完全一致。
          //    知卷面板把选中的模型 ID 存在 localStorage['agent:selectedModelId']（组件本地状态），
          //    编辑器这里读取同一份存储，命中且仍启用才用，否则回退到第一个启用模型。
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

          // 3. 通过 Agent 发送定稿请求（等同于用户手打）
          const chapterTitle = currentChapter.title
          const chapterId = currentChapter.id
          // 发给模型的完整指令（携带 chapterId 让模型能直接定位，不用去查）
          const userInput = `请为章节《${chapterTitle}》完成定稿：生成本章定稿记忆。chapterId: ${chapterId}`
          // 界面上展示的简洁内容（不含 chapterId 这类技术细节）
          const displayInput = `请为章节《${chapterTitle}》完成定稿`

          message.success('已向「知卷」发起定稿请求，请在面板查看进度')

          useAgentStore.getState().sendMessage({
            bookId: bookId || null,
            modelId,
            chapterId,
            volumeId: currentChapter.volumeId || null,
            finalize: true,
            userInput,
            displayInput,
          }).catch((e: any) => {
            console.error('[Editor] 定稿请求失败', e)
            message.error(e?.message || '发起定稿失败')
          })
        } catch (e: any) {
          message.error(e?.message || '发起定稿失败')
        }
      },
    })
  }

  const handleTitleChange = async (newTitle: string) => {
    if (!currentChapter) return
    await updateChapter(currentChapter.id, { title: newTitle })
    setCurrentChapter((prev) => prev ? { ...prev, title: newTitle } : null)
  }

  const currentVolume = useMemo(() => volumes.find((volume) => volume.id === currentChapter?.volumeId) || null, [volumes, currentChapter?.volumeId])

  const settingGroups: Array<{ key: BookSettingEntryType; title: string; icon: ReactNode; emptyText: string }> = [
    { key: 'characters', title: '角色', icon: <TeamOutlined />, emptyText: '暂无角色设定' },
    { key: 'locations', title: '地点', icon: <EnvironmentOutlined />, emptyText: '暂无地点设定' },
    { key: 'items', title: '物品', icon: <InboxOutlined />, emptyText: '暂无物品设定' },
    { key: 'skills', title: '技能', icon: <FireOutlined />, emptyText: '暂无技能设定' },
    { key: 'scenes', title: '场景', icon: <BankOutlined />, emptyText: '暂无场景设定' },
    { key: 'factions', title: '势力', icon: <ApartmentOutlined />, emptyText: '暂无势力设定' },
    { key: 'systems', title: '体系', icon: <PartitionOutlined />, emptyText: '暂无体系设定' },
    { key: 'inspirations', title: '灵感', icon: <BulbOutlined />, emptyText: '暂无灵感' },
  ]

  const renderTextBlock = (content?: string | null, emptyText = '暂无内容') => {
    const text = content?.trim()
    if (!text) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
    return <Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.7, color: '#4B5563' }}>{text}</Paragraph>
  }

  const renderSettingEntries = (type: BookSettingEntryType, emptyText: string) => {
    const entries = bookSettings.filter((entry) => entry.type === type)
    if (!entries.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.map((entry) => (
          <div key={entry.id} style={{ padding: '7px 8px', borderRadius: 8, background: '#F9FAFB', border: '1px solid #F3F4F6' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', marginBottom: entry.description || entry.detail ? 4 : 0 }}>{entry.name}</div>
            {entry.description && <div style={{ fontSize: 12, color: '#6B7280', lineHeight: 1.5, marginBottom: entry.detail ? 4 : 0 }}>{entry.description}</div>}
            {entry.detail && (
              <div style={{ fontSize: 12, color: '#9CA3AF', lineHeight: 1.5 }}>
                <MDXViewer content={entry.detail} style={{ fontSize: 12, color: '#9CA3AF', lineHeight: 1.5, maxWidth: '100%' }} />
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  // 正文写作设置面板：参考快照下拉 + 参数文本框
  // 选中的快照通过 workspace store 共享给知卷面板；普通聊天时会自动携带 forcedSnapshotId
  const renderWritingConfigBlock = () => {
    const labelStyle: CSSProperties = { fontSize: 12, color: '#6B7280', marginBottom: 4 }
    const fieldWrap: CSSProperties = { marginBottom: 8 }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={fieldWrap}>
          <div style={labelStyle}>参考记忆</div>
          <Select
            size="small"
            showSearch
            allowClear
            value={selectedSnapshotId || undefined}
            onChange={(v) => setSelectedSnapshotId(v || null)}
            placeholder="选择参考记忆"
            optionFilterProp="label"
            style={{ width: '100%' }}
            options={snapshotList.map((r) => ({
              value: r.id,
              label: `第${r.chapterOrder + 1}章 · ${r.chapterTitle || '未命名'}${r.storyTime ? ` · ${r.storyTime}` : ''}`,
            }))}
          />
        </div>
        <div style={fieldWrap}>
          <div style={labelStyle}>写作风格</div>
          <Input.TextArea
            size="small"
            autoSize={{ minRows: 1, maxRows: 4 }}
            value={writingCfg.style}
            onChange={(e) => setWritingCfg((s) => ({ ...s, style: e.target.value }))}
            placeholder="例：冷峻克制 / 中式古典 / 网文爽感"
          />
        </div>
        <div style={fieldWrap}>
          <div style={labelStyle}>叙述人称（POV）</div>
          <Input
            size="small"
            value={writingCfg.pov}
            onChange={(e) => setWritingCfg((s) => ({ ...s, pov: e.target.value }))}
            placeholder="例：第三人称限知 / 第一人称"
          />
        </div>
        <div style={fieldWrap}>
          <div style={labelStyle}>单章期待字数</div>
          <Input
            size="small"
            value={writingCfg.wordCountTarget}
            onChange={(e) => setWritingCfg((s) => ({ ...s, wordCountTarget: e.target.value }))}
            placeholder="例：3000 字"
          />
        </div>
        <div style={fieldWrap}>
          <div style={labelStyle}>禁写清单</div>
          <Input.TextArea
            size="small"
            autoSize={{ minRows: 1, maxRows: 4 }}
            value={writingCfg.taboo}
            onChange={(e) => setWritingCfg((s) => ({ ...s, taboo: e.target.value }))}
            placeholder="不允许出现的词、剧透、内容等"
          />
        </div>
        <div style={fieldWrap}>
          <div style={labelStyle}>写作约束</div>
          <Input.TextArea
            size="small"
            autoSize={{ minRows: 1, maxRows: 4 }}
            value={writingCfg.constraint}
            onChange={(e) => setWritingCfg((s) => ({ ...s, constraint: e.target.value }))}
            placeholder="例：每章结尾留悬念 / 对话占比不低于 30%"
          />
        </div>
      </div>
    )
  }

  // 渲染快照面板：下拉选择 + 角色/地点/场景/物品最新状态
  const renderSnapshotBlock = () => {
    if (!snapshotList.length) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无记忆，定稿章节后自动生成" />
    }
    const snap = selectedSnapshotData
    // 当前选中快照信息
    const currentSnapItem = snapshotList.find((r) => r.id === selectedSnapshotId)
    const currentChapterOrder = currentSnapItem?.chapterOrder ?? -1

    // 轻量文本序列化：把字符串/数字/{name}/{id,name}/数组统一转成显示字符串
    function toTextEarly(v: any): string {
      if (v == null) return ''
      if (typeof v === 'string') return v
      if (typeof v === 'number' || typeof v === 'boolean') return String(v)
      if (Array.isArray(v)) return v.map(toTextEarly).filter(Boolean).join('、')
      if (typeof v === 'object') return v.name || v.title || v.label || v.id || ''
      return ''
    }
    const toText = toTextEarly
    const getName = (t: any): string => toText(t?.entityName || t?.name || t?.characterName || t?.locationName || t?.itemName || t?.sceneName)

    // 兼容新老 schema：
    //  - 新（ChapterMemoryV2）：snap.characters[] / snap.sceneEntities / snap.currentPlot
    //  - 老（v1）：snap.tracks[]（旧库遗留）
    // 从两处提取"本章出场角色/地点/场景/物品"，然后统一走同一套渲染逻辑。
    const v2Characters: any[] = Array.isArray(snap?.characters) ? snap.characters : []
    const v2SceneEntities: any = snap?.sceneEntities || {}
    const v2CurrentPlot: any = snap?.currentPlot || {}

    // 把 v2 CharacterV2 转成老渲染函数认得的 track 形态（description/location/mood/holds/relationships 等字段）
    const v2CharAsTrack = (c: any): any => ({
      type: 'character',
      entityId: c.id,
      entityName: c.name,
      description: c.personality || c.originalSetting,
      location: c.state?.location,
      mood: c.state?.mood,
      speechStyle: c.state?.speechStyle,
      holds: c.state?.holds,
      knows: c.state?.knows,
      goal: c.state?.goal,
      status: c.state?.survival ? 'active' : undefined,
      relationships: c.state?.relationships,
    })

    // 老 schema tracks（用作兜底）
    const legacyTracks: any[] = Array.isArray(snap?.tracks) ? snap.tracks : []
    const getType = (t: any): string => t?.type || t?.clipType || ''
    const legacyCharTracks = legacyTracks.filter((t) => getType(t) === 'character')
    const legacyLocTracks = legacyTracks.filter((t) => getType(t) === 'location')
    const legacySceneTracks = legacyTracks.filter((t) => getType(t) === 'scene')
    const legacyItemTracks = legacyTracks.filter((t) => getType(t) === 'item')

    // 优先用 v2 数据；v2 缺失（老库）再退到 legacyTracks
    const currentCharTracks: any[] = v2Characters.length > 0
      ? v2Characters.map(v2CharAsTrack)
      : legacyCharTracks
    const currentLocTracks: any[] = (v2SceneEntities.locations?.length || v2CurrentPlot.lastLocation)
      ? [
        ...(v2CurrentPlot.lastLocation ? [{ type: 'location', entityId: v2CurrentPlot.lastLocation.id, entityName: v2CurrentPlot.lastLocation.name, status: 'active' }] : []),
        ...(Array.isArray(v2SceneEntities.locations)
          ? v2SceneEntities.locations
            .filter((l: any) => l?.id !== v2CurrentPlot.lastLocation?.id)
            .map((l: any) => ({ type: 'location', entityId: l.id, entityName: l.name }))
          : []),
      ]
      : legacyLocTracks
    const currentSceneTracks: any[] = (v2SceneEntities.scenes?.length || v2CurrentPlot.lastScene)
      ? [
        ...(v2CurrentPlot.lastScene ? [{ type: 'scene', entityId: v2CurrentPlot.lastScene.id, entityName: v2CurrentPlot.lastScene.name }] : []),
        ...(Array.isArray(v2SceneEntities.scenes)
          ? v2SceneEntities.scenes
            .filter((s: any) => s?.id !== v2CurrentPlot.lastScene?.id)
            .map((s: any) => ({ type: 'scene', entityId: s.id, entityName: s.name, description: s.summary }))
          : []),
      ]
      : legacySceneTracks
    const currentItemTracks: any[] = Array.isArray(v2SceneEntities.items) && v2SceneEntities.items.length > 0
      ? v2SceneEntities.items.map((it: any) => ({ type: 'item', entityId: it.id, entityName: it.name }))
      : legacyItemTracks
    const currentTracks: any[] = [...currentCharTracks, ...currentLocTracks, ...currentSceneTracks, ...currentItemTracks]

    // 状态英文 → 中文
    const statusLabelMap: Record<string, string> = {
      active: '在场',
      frozen: '下镜',
      destroyed: '损毁',
      changed: '状态改变',
      mentioned: '被提及',
    }
    const statusColorMap: Record<string, string> = {
      active: 'blue',
      frozen: 'default',
      destroyed: 'red',
      changed: 'orange',
      mentioned: 'purple',
    }
    const mapStatus = (v: any): { label: string; color: string } => {
      const s = toText(v).toLowerCase()
      return { label: statusLabelMap[s] || toText(v), color: statusColorMap[s] || 'default' }
    }

    // 构建实体 id → name 映射：仅来自快照 tracks（快照数据独立于角色/设定表）
    // 快照中的条目 id 是快照分析器生成的，不与设定表 id 对齐，所以此处只用快照数据源
    const idToName: Record<string, string> = {}
    // 同时记录每个 key（id 或 name）对应的最新完整 character track，用于点击弹角色详情
    const keyToCharTrack: Record<string, any> = {}
    const collectIds = (tracks: any[]) => {
      for (const t of tracks) {
        const id = t.entityId || t.id
        const name = getName(t)
        if (id && name) idToName[id] = name
        // 名字自身也作为 key，兼容旧数据模型把角色名塞到 targetId 的情况
        if (name) idToName[name] = name
        // 仅收集角色详情，供关系名点击查看
        if (getType(t) === 'character') {
          if (id) keyToCharTrack[id] = t
          if (name) keyToCharTrack[name] = t
        }
      }
    }
    collectIds(currentTracks)
    for (const r of snapshotList) {
      const d = allSnapshotDataMap[r.id]
      if (!d) continue
      // 老 schema
      if (Array.isArray(d.tracks)) collectIds(d.tracks)
      // 新 schema：从 characters + sceneEntities + currentPlot 提取 id/name 映射
      if (Array.isArray(d.characters)) {
        collectIds(d.characters.map((c: any) => v2CharAsTrack(c)))
      }
      if (d.currentPlot?.lastLocation) collectIds([{ type: 'location', entityId: d.currentPlot.lastLocation.id, entityName: d.currentPlot.lastLocation.name }])
      if (d.currentPlot?.lastScene) collectIds([{ type: 'scene', entityId: d.currentPlot.lastScene.id, entityName: d.currentPlot.lastScene.name }])
      if (Array.isArray(d.sceneEntities?.locations)) {
        collectIds(d.sceneEntities.locations.map((l: any) => ({ type: 'location', entityId: l.id, entityName: l.name })))
      }
      if (Array.isArray(d.sceneEntities?.scenes)) {
        collectIds(d.sceneEntities.scenes.map((s: any) => ({ type: 'scene', entityId: s.id, entityName: s.name })))
      }
    }

    // 汇总"截至当前章为止其它章"的实体（按 name 去重，取最后一次出现）
    const otherByType: Record<string, Map<string, any>> = {
      character: new Map(),
      location: new Map(),
      scene: new Map(),
      item: new Map(),
    }
    // 快照按章节序号升序遍历，后覆盖前，保留每个实体的最后一次状态
    const orderedSnapshots = snapshotList
      .filter((r) => r.chapterOrder <= currentChapterOrder && r.id !== selectedSnapshotId)
      .slice()
      .sort((a, b) => a.chapterOrder - b.chapterOrder)
    for (const r of orderedSnapshots) {
      const d = allSnapshotDataMap[r.id]
      if (!d) continue
      // 新 schema：把 sceneEntities.locations/scenes + currentPlot.lastLocation/lastScene 计入其它章记忆
      if (d.sceneEntities?.locations) {
        for (const loc of d.sceneEntities.locations) {
          if (loc?.name) otherByType.location.set(loc.name, { type: 'location', entityId: loc.id, entityName: loc.name })
        }
      }
      if (d.currentPlot?.lastLocation?.name) {
        otherByType.location.set(d.currentPlot.lastLocation.name, {
          type: 'location',
          entityId: d.currentPlot.lastLocation.id,
          entityName: d.currentPlot.lastLocation.name,
        })
      }
      if (d.sceneEntities?.scenes) {
        for (const sc of d.sceneEntities.scenes) {
          if (sc?.name) otherByType.scene.set(sc.name, { type: 'scene', entityId: sc.id, entityName: sc.name })
        }
      }
      if (d.currentPlot?.lastScene?.name) {
        otherByType.scene.set(d.currentPlot.lastScene.name, {
          type: 'scene',
          entityId: d.currentPlot.lastScene.id,
          entityName: d.currentPlot.lastScene.name,
        })
      }
      // 老 schema：走 tracks
      if (Array.isArray(d.tracks)) {
        for (const t of d.tracks) {
          const type = getType(t)
          const name = getName(t)
          if (!name || !otherByType[type]) continue
          if (type === 'location' && toText(t.status).toLowerCase() === 'mentioned') continue
          otherByType[type].set(name, t)
        }
      }
    }
    // 剔除已在当前章出现过的名字（避免重复）
    const currentNames: Record<string, Set<string>> = {
      character: new Set(currentCharTracks.map(getName).filter(Boolean)),
      location: new Set(currentLocTracks.map(getName).filter(Boolean)),
      scene: new Set(currentSceneTracks.map(getName).filter(Boolean)),
      item: new Set(currentItemTracks.map(getName).filter(Boolean)),
    }
    const otherLocations = Array.from(otherByType.location.entries()).filter(([n]) => !currentNames.location.has(n)).map(([, t]) => t)
    const otherScenes = Array.from(otherByType.scene.entries()).filter(([n]) => !currentNames.scene.has(n)).map(([, t]) => t)

    // "最后场景"/"最后地点" —— 优先从 timeline clips 取（clips 有准确的类型分离和段落号）
    // clips 数据由 persistChapterSnapshot 从 AI 分析结果写入，比 currentPlot 更可靠
    const chapterClips = timelineClipData[currentSnapItem?.chapterId || ''] || []
    const lastClipByType = (type: string) =>
      chapterClips
        .filter((c: any) => c.clipType === type)
        .sort((a: any, b: any) => (b.paragraphEnd ?? 0) - (a.paragraphEnd ?? 0))[0] || null
    const clipLocation = lastClipByType('location')
    const clipScene = lastClipByType('scene')
    const lastLocation = clipLocation
      ? { type: 'location', entityId: clipLocation.entityId, entityName: clipLocation.entityName, status: clipLocation.status }
      : null
    const lastScene = clipScene
      ? { type: 'scene', entityId: clipScene.entityId, entityName: clipScene.entityName, paragraphStart: clipScene.paragraphStart, paragraphEnd: clipScene.paragraphEnd }
      : null

    // v2 数据没有段落号——直接用 sceneEntities.characters / sceneEntities.items 作为"最后场景里的角色/物品"
    // v1 兜底：走段落范围重叠计算
    const usingV2 = v2Characters.length > 0 || !!v2CurrentPlot.lastScene
    const lastSceneItems: any[] = usingV2
      ? currentItemTracks
      : (lastScene
        ? currentItemTracks.filter((it) => {
          const s = lastScene.paragraphStart ?? 0
          const e = lastScene.paragraphEnd ?? 0
          const is = it.paragraphStart ?? 0
          const ie = it.paragraphEnd ?? 0
          return ie >= s && is <= e
        })
        : [])

    // "最后场景里的角色"：v2 直接用 sceneEntities.characters（在场角色列表）
    const lastSceneCharacters: any[] = usingV2
      ? (Array.isArray(v2SceneEntities.characters) && v2SceneEntities.characters.length > 0
        // 从 v2Characters 里挑出与 sceneEntities.characters 匹配的完整档案，落回 track 形态
        ? v2SceneEntities.characters
          .map((sc: any) => v2Characters.find((c) => c.id === sc.id) || { id: sc.id, name: sc.name })
          .map(v2CharAsTrack)
        // 兜底：v2 有 characters 但没 sceneEntities.characters，就全部当作在场
        : currentCharTracks)
      : (lastScene
        ? currentCharTracks.filter((ch) => {
          const s = lastScene.paragraphStart ?? 0
          const e = lastScene.paragraphEnd ?? 0
          const cs = ch.paragraphStart ?? 0
          const ce = ch.paragraphEnd ?? 0
          return ce >= s && cs <= e
        })
        : [])

    const sectionTitle = (t: string) => (
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', margin: '10px 0 6px' }}>{t}</div>
    )

    const renderCharacterCard = (t: any, muted = false, renderRelations = true) => {
      const s = mapStatus(t.status)
      const description = toText(t.description)
      const location = toText(t.location)
      const stateChange = toText(t.stateChange)
      const holds = toText(t.holds ?? t.holdings)
      const knows = toText(t.knows ?? t.knownClues)
      const goal = toText(t.goal)
      const mood = toText(t.mood)
      const speechStyle = toText(t.speechStyle ?? t.speakingStyle)
      const relationships: any[] = Array.isArray(t.relationships) ? t.relationships : []
      const row = (label: string, value: string) => (
        value ? (
          <div style={{ fontSize: 12, color: '#4B5563', lineHeight: 1.6, marginTop: 2 }}>
            <span style={{ color: '#9CA3AF' }}>{label}：</span>
            <span>{value}</span>
          </div>
        ) : null
      )
      return (
        <div key={`char-${getName(t)}-${t.paragraphStart}`} style={{ padding: '8px 10px', borderRadius: 8, background: muted ? '#FAFAFA' : '#F9FAFB', border: '1px solid #F3F4F6', marginBottom: 6, opacity: muted ? 0.9 : 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{getName(t) || '（未命名）'}</span>
          </div>
          {description && <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.6, marginBottom: 4 }}>{description}</div>}
          {row('位置', location)}
          {row('心理', mood)}
          {row('目标', goal)}
          {row('持有', holds)}
          {row('已知', knows)}
          {row('状态变化', stateChange)}
          {row('说话风格', speechStyle)}
          {renderRelations && relationships.length > 0 && (
            <div style={{ fontSize: 12, color: '#4B5563', lineHeight: 1.6, marginTop: 4 }}>
              <span style={{ color: '#9CA3AF' }}>关系：</span>
              {relationships.map((r, i) => {
                // 依次尝试：targetName / target / target 对象；然后 targetId（先查 id→name 表，若查不到直接把 targetId 原样当作名字使用，因为模型经常直接把角色名写进 targetId 字段）
                let target = toText(r.targetName || r.target)
                let lookupKey = ''
                if (!target) {
                  const tid = typeof r.targetId === 'string' ? r.targetId : ''
                  if (tid) {
                    target = idToName[tid] || tid
                    lookupKey = tid
                  }
                }
                if (!target) target = '未知'
                if (!lookupKey) lookupKey = target
                const targetTrack = keyToCharTrack[lookupKey]
                const relType = toText(r.type)
                const val = typeof r.value === 'number' ? r.value : null
                const suffix = relType ? `（${relType}${val != null ? ` ${val}` : ''}）` : val != null ? `（${val}）` : ''
                // 悬停灰底 + 点击弹出角色详情 Popover
                const nameEl = targetTrack ? (
                  <Popover
                    content={<div style={{ maxWidth: 260, maxHeight: 400, overflow: 'auto' }}>{renderCharacterCard(targetTrack, false, false)}</div>}
                    trigger="click"
                    placement="left"
                  >
                    <span
                      className="snapshot-rel-name"
                      style={{ cursor: 'pointer', padding: '0 4px', borderRadius: 4, transition: 'background 0.15s' }}
                    >
                      {target}
                    </span>
                  </Popover>
                ) : (
                  <span style={{ padding: '0 4px' }}>{target}</span>
                )
                return (
                  <span key={i} style={{ marginRight: 8 }}>
                    {nameEl}
                    {suffix}
                    {i < relationships.length - 1 ? '、' : ''}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )
    }

    const renderPlainCard = (t: any, muted = false) => {
      const s = mapStatus(t.status)
      const description = toText(t.description)
      const location = toText(t.location)
      const stateChange = toText(t.stateChange)
      const holds = toText(t.holds ?? t.holdings)
      const mood = toText(t.mood)
      const row = (label: string, value: string) => (
        value ? (
          <div style={{ fontSize: 12, color: '#4B5563', lineHeight: 1.6, marginTop: 2 }}>
            <span style={{ color: '#9CA3AF' }}>{label}：</span>
            <span>{value}</span>
          </div>
        ) : null
      )
      return (
        <div key={`ent-${getName(t)}-${t.paragraphStart}`} style={{ padding: '8px 10px', borderRadius: 8, background: muted ? '#FAFAFA' : '#F9FAFB', border: '1px solid #F3F4F6', marginBottom: 6, opacity: muted ? 0.9 : 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{getName(t) || '（未命名）'}</span>
          </div>
          {description && <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.6, marginBottom: 4 }}>{description}</div>}
          {row('位置', location)}
          {row('氛围', mood)}
          {row('相关物品', holds)}
          {row('状态变化', stateChange)}
        </div>
      )
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* 下拉选择 + 查看详情按钮：章节序号 + 章节标题 + 故事时间，支持搜索 */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Select
            size="small"
            showSearch
            value={selectedSnapshotId || undefined}
            onChange={(v) => setSelectedSnapshotId(v)}
            placeholder="选择记忆"
            optionFilterProp="label"
            style={{ flex: 1, minWidth: 0 }}
            options={snapshotList.map((r) => ({
              value: r.id,
              label: `第${r.chapterOrder + 1}章 · ${r.chapterTitle || '未命名'}${r.storyTime ? ` · ${r.storyTime}` : ''}`,
            }))}
          />
          <Tooltip title="查看所选记忆详情">
            <Button
              size="small"
              icon={<EyeOutlined />}
              disabled={!selectedSnapshotData}
              onClick={() => setSnapshotDetailOpen(true)}
            />
          </Tooltip>
        </div>

        {!snap ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="加载中或无数据" style={{ marginTop: 8 }} />
        ) : (
          <>
            {/* 最后地点 */}
            {sectionTitle('最后地点 · 所选记忆')}
            {lastLocation
              ? renderPlainCard(lastLocation)
              : <div style={{ fontSize: 12, color: '#9CA3AF' }}>本章未识别到地点</div>}
            {/* "其它章地点"分组已隐藏（用户不需要跨章聚合展示） */}

            {/* 最后场景 */}
            {sectionTitle('最后场景 · 所选记忆')}
            {lastScene
              ? renderPlainCard(lastScene)
              : <div style={{ fontSize: 12, color: '#9CA3AF' }}>本章未识别到场景</div>}
            {/* "其它章场景"分组已隐藏（用户不需要跨章聚合展示） */}

            {/* 最后场景里的角色 */}
            {sectionTitle('最后场景里的角色 · 所选记忆')}
            {lastSceneCharacters.length > 0
              ? lastSceneCharacters.map((ch) => renderCharacterCard(ch))
              : <div style={{ fontSize: 12, color: '#9CA3AF' }}>本场景无角色</div>}

            {/* 最后场景内的物品 */}
            {sectionTitle('最后场景里的物品 · 所选记忆')}
            {lastSceneItems.length > 0
              ? lastSceneItems.map((it) => renderPlainCard(it))
              : <div style={{ fontSize: 12, color: '#9CA3AF' }}>本场景无相关物品</div>}
          </>
        )}
      </div>
    )
  }

  const contextGroups = [
    {
      key: 'chapter-outline',
      title: '当前章大纲',
      icon: <ProfileOutlined />,
      content: renderTextBlock(currentChapter?.outline || currentChapter?.summary, '当前章节暂无大纲'),
    },
    {
      key: 'volume-outline',
      title: '当前卷大纲',
      icon: <ReadOutlined />,
      content: renderTextBlock(currentVolume?.outline || currentVolume?.description, currentChapter?.volumeId ? '当前分卷暂无大纲' : '当前章节未归属分卷'),
    },
    {
      key: 'writing-config',
      title: '正文写作设置',
      icon: <EditOutlined />,
      content: renderWritingConfigBlock(),
    },
    {
      key: 'chapter-snapshot',
      title: '章节记忆',
      icon: <BrainOutlined />,
      content: renderSnapshotBlock(),
    },
    ...settingGroups.map((group) => ({
      key: group.key,
      title: group.title,
      icon: group.icon,
      content: renderSettingEntries(group.key, group.emptyText),
    })),
  ]

  const contextCollapseItems = contextGroups.map((group) => ({
    key: group.key,
    label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{group.icon}{group.title}</span>,
    children: group.content,
  }))

  const getCurrentVolumeTitle = () => {
    if (!currentChapter?.volumeId) return ''
    return currentChapter.volumeTitle || volumes.find((volume) => volume.id === currentChapter.volumeId)?.title || ''
  }

  // 页面级加载态：等 workspaceStore（切书 loading）+ 三个本地数据源都完成后才渲染主体。
  // 这样避免出现"章节列表已经有数据，但分卷/设定还在加载中"导致的空态错判（例如把"未分卷"
  // 塞进空态下拉，或把 timelineSnapshotData 尚未回填的章节渲染成"无快照"的错觉）。
  const isPageLoading = workspaceLoading || volumesLoading || settingsLoading || timelineLoading
  if (isPageLoading) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        color: '#6B7280',
        fontSize: 13,
      }}>
        <Spin size="large" />
        <span>正在加载正文数据…</span>
      </div>
    )
  }

  if (!currentBook) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <Text type="secondary">请先选择或创建一个作品</Text>
      </div>
    )
  }

  if (!currentChapter) {
    // 空态：标题「请开始创作吧！」+ 分卷下拉（所有分卷） + 章节下拉（该分卷下所有章节）
    // 按钮：若已选中章节则显示 编辑 + 开始新剧情；否则仅显示 开始新剧情
    const bookChapters = chapters.filter((c) => c.bookId === bookId)
    const volumesInBook = volumes.filter((v) => v.bookId === bookId).sort((a, b) => a.sortOrder - b.sortOrder)
    // 匹配当前空态分卷选择的章节（含所有状态）；null 代表"未分卷"
    const chaptersOfSelectedVolume = bookChapters
      .filter((c) => (c.volumeId || null) === (emptyStateVolumeId || null))
      .sort((a, b) => a.sortOrder - b.sortOrder)
    // 当前选中的章节（若已失效则视为未选）
    const selectedChapter = emptyStateChapterId
      ? chaptersOfSelectedVolume.find((c) => c.id === emptyStateChapterId) || null
      : null

    // 选项：所有分卷 + "未分卷" 选项（值为特殊 sentinel）
    const VOLUME_NONE = '__none__'
    const volumeOptions = [
      ...volumesInBook.map((v) => ({ value: v.id, label: v.title })),
      { value: VOLUME_NONE, label: '未分卷' },
    ]
    // 章节下拉展示"该分卷下所有章节"。antd v5 Select 默认启用虚拟滚动，长列表也不卡。
    const chapterOptions = chaptersOfSelectedVolume.map((c) => ({
      value: c.id,
      label: c.title,
    }))

    const openChapter = (ch: Chapter) => {
      setCurrentChapter(ch)
      setEditorKey((k) => k + 1)
      try {
        if (bookId) localStorage.setItem(`${EDITOR_LAST_CHAPTER_KEY_PREFIX}${bookId}`, ch.id)
      } catch {}
    }

    const handleEdit = () => {
      if (!selectedChapter) return
      openChapter(selectedChapter)
    }

    const handleStartNewPlot = async () => {
      if (!bookId || creatingChapter) return
      setCreatingChapter(true)
      try {
        // "开始新剧情"：快速在当前所选分卷下新建一章"新章节"并立即打开
        const newChapter = await createChapter({
          bookId,
          volumeId: emptyStateVolumeId || undefined,
          title: '新章节',
        })
        openChapter(newChapter)
      } catch (err) {
        console.error('[Editor] 开始新剧情失败', err)
        message.error('开始新剧情失败')
      } finally {
        setCreatingChapter(false)
      }
    }

    return (
      <div
        style={{
          // 垂直 + 水平居中；-20 -24 抵消外层 <Content> 的 padding，使卡片相对整个内容区居中
          margin: '-20px -24px',
          height: 'calc(100% + 40px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 20, minWidth: 320 }}>
          {/* 标题 */}
          <div style={{ fontSize: 22, fontWeight: 600, color: '#111827' }}>请开始创作吧！</div>

          {/* 分卷选择（所有分卷 + 未分卷） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: '#6B7280', minWidth: 40, textAlign: 'right' }}>分卷</span>
            <Select
              value={emptyStateVolumeId ?? VOLUME_NONE}
              onChange={(v) => {
                setEmptyStateVolumeId(v === VOLUME_NONE ? null : v)
                // 切换分卷时清空章节选中
                setEmptyStateChapterId(null)
              }}
              options={volumeOptions}
              style={{ minWidth: 220 }}
              size="middle"
            />
          </div>

          {/* 章节（该分卷下所有章节；虚拟滚动由 antd v5 Select 默认启用） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: '#6B7280', minWidth: 40, textAlign: 'right' }}>章节</span>
            {chapterOptions.length > 0 ? (
              <Select
                value={selectedChapter?.id}
                onChange={(v) => setEmptyStateChapterId(v)}
                options={chapterOptions}
                style={{ minWidth: 220 }}
                size="middle"
                placeholder="选择章节"
                showSearch
                optionFilterProp="label"
                // listHeight 控制下拉面板高度，超出会走虚拟滚动
                listHeight={280}
              />
            ) : (
              <span style={{ fontSize: 13, color: '#9CA3AF' }}>暂无章节</span>
            )}
          </div>

          {/* 按钮组：有选中章 → 编辑 + 开始新剧情；否则只显示 开始新剧情 */}
          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            {selectedChapter && (
              <Button onClick={handleEdit}>编辑</Button>
            )}
            <Button type="primary" loading={creatingChapter} onClick={handleStartNewPlot}>
              开始新剧情
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: 'calc(100% + 40px)', margin: '-20px -24px', display: 'flex', minHeight: 0 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '12px 0 0 20px' }}>
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Space>
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate(`/book/${bookId}/chapters`)}
            />
            <Title
              level={4}
              style={{
                margin: 0,
                fontWeight: 600,
                cursor: 'pointer',
                minWidth: 100,
              }}
              editable={{
                onChange: handleTitleChange,
                text: currentChapter.title,
              }}
            >
              {currentChapter.title}
            </Title>
            {getCurrentVolumeTitle() && (
              <span style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 400, marginLeft: 2 }}>{getCurrentVolumeTitle()}</span>
            )}
          </Space>
          <Space style={{ paddingRight: 20 }}>
            <Button
              icon={currentChapter.status === 'finalized' ? <CheckOutlined /> : undefined}
              onClick={handleStatusChange}
              disabled={currentChapter.status === 'locked' || !!activeRun}
              loading={currentChapter.status === 'locked' || !!activeRun}
              style={{
                backgroundColor: currentChapter.status === 'finalized' ? '#D1FAE5' : undefined,
                color: currentChapter.status === 'finalized' ? '#065F46' : undefined,
                borderColor: currentChapter.status === 'finalized' ? '#10B981' : undefined,
              }}
            >
              {currentChapter.status === 'finalized'
                ? '已定稿'
                : currentChapter.status === 'locked'
                  ? '定稿中'
                  : '定稿'}
            </Button>
            {currentChapter.status !== 'finalized' && currentChapter.status !== 'locked' && (
              <Button
                type="primary"
                icon={<SaveOutlined />}
                onClick={() => editorRef.current?.save()}
              >
                保存
              </Button>
            )}
          </Space>
        </div>

        <div style={{ flex: 1, minHeight: 0, paddingRight: 20, display: 'flex', flexDirection: 'column' }}>
          <Card
            variant="borderless"
            style={{ flex: 1, minHeight: 0, borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', padding: 0, minHeight: 0, borderRadius: 12, overflow: 'hidden' } }}
          >
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <MDXEditorWrapper
                ref={editorRef}
                key={editorKey}
                content={currentChapter.content || ''}
                onChange={handleContentChange}
                onSave={handleSave}
                variant={(currentChapter.status === 'finalized' || currentChapter.status === 'locked') ? 'readonly' : 'writing'}
                placeholder="开始写作……"
              />
            </div>
          </Card>
          {/* 编辑器卡片外部右下角：字数统计 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              paddingTop: 10,
              paddingBottom: 10,
              fontSize: 12,
              color: '#6B7280',
            }}
          >
            {liveWordCount.toLocaleString()} 字
          </div>
        </div>

        {/* 底栏：剧情线（在左侧内容区内，紧贴左侧底部） */}
        <div
          style={{
            marginLeft: -20,
            marginTop: 20,
            flexShrink: 0,
            background: '#FFFFFF',
            borderTop: '1px solid #E5E7EB',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            height: timelineHeight + 0,
          }}
        >
          <ResizeHandle
            orientation="horizontal"
            onResizeStart={handleTimelineResizeStart}
            title="拖动调整记忆线高度"
          />
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', paddingTop: 0 }}>
            <StoryTimeline
              ref={storyTimelineRef}
              bookId={bookId || ''}
              chapters={(() => {
                const bookChapters = chapters.filter(c => c.bookId === bookId)
                return bookChapters.map(ch => {
                  // 段落数与剧情线页保持一致：取本章所有 clip 中最大的 paragraphEnd+1；
                  // 若本章尚无 clip，则回退到正文段落数，保证仍有一个合理刻度。
                  const chapterClips = timelineClipData[ch.id] || []
                  const clipMaxEnd = chapterClips.reduce((max: number, c: any) => Math.max(max, c.paragraphEnd ?? 0), -1)
                  const fallback = (ch.content || '').split(/\n\n+/).filter(p => p.trim()).length || 1
                  const paragraphCount = clipMaxEnd >= 0 ? clipMaxEnd + 1 : fallback
                  return {
                    id: ch.id,
                    title: ch.title,
                    sortOrder: ch.sortOrder,
                    paragraphCount,
                    hasSnapshot: !!timelineSnapshotData[ch.id]?.isValid,
                    storyTime: timelineSnapshotData[ch.id]?.storyTime,
                  }
                })
              })()}
              clips={(() => {
                // 每个 clip 直接传原始 paragraphStart/paragraphEnd，与剧情线页保持一致，不再 clamp
                return Object.entries(timelineClipData).flatMap(([chapterId, clips]) => {
                  return (clips || []).map((clip: any) => {
                    const rawStart = Math.max(0, clip.paragraphStart ?? 0)
                    const rawEnd = Math.max(rawStart, clip.paragraphEnd ?? rawStart)
                    return {
                      id: clip.id,
                      clipType: clip.clipType,
                      entityId: clip.entityId,
                      entityName: clip.entityName,
                      chapterId,
                      paragraphStart: rawStart,
                      paragraphEnd: rawEnd,
                      status: clip.status,
                      prevClipId: clip.prevClipId ?? null,
                      nextClipId: clip.nextClipId ?? null,
                      storylineGroup: clip.storylineGroup ?? 'main',
                    }
                  })
                })
              })()}
              onChapterClick={undefined}
              height={timelineHeight}
            />
          </div>
        </div>
      </div>

      {contextPanelCollapsed ? (
        <aside style={{ width: 48, borderLeft: '1px solid #E5E7EB', background: '#FFFFFF', display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 0 }}>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            {contextGroups.map((group) => (
              <Popover
                key={group.key}
                placement="leftTop"
                arrow={false}
                title={<span style={{ fontSize: 13, fontWeight: 600 }}>{group.title}</span>}
                content={<div style={{ width: 280, maxHeight: 360, overflow: 'auto' }}>{group.content}</div>}
              >
                <Button
                  type="text"
                  icon={group.icon}
                  style={{ width: 34, height: 34, borderRadius: 8, color: '#111827' }}
                />
              </Popover>
            ))}
          </div>
          <div style={{ width: '100%', height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: '1px solid #F1F5F9' }}>
            <Tooltip title="展开小提示">
              <Button type="text" icon={<MenuUnfoldOutlined />} onClick={() => setContextPanelCollapsed(false)} style={{ width: 34, height: 34, borderRadius: 8 }} />
            </Tooltip>
          </div>
        </aside>
      ) : (
        <div style={{ position: 'relative', width: contextPanelWidth, flexShrink: 0 }}>
          <ResizeHandle
            orientation="vertical"
            onResizeStart={handleResizeStart}
            title="拖动调整小提示宽度"
          />
          <aside style={{ width: '100%', height: '100%', borderLeft: '1px solid #E5E7EB', background: '#FFFFFF', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ height: 42, padding: '0 12px', display: 'flex', alignItems: 'center', borderBottom: '1px solid #F1F5F9' }}>
              <span style={{ color: '#111827', fontWeight: 600 }}>小提示</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 0 }}>
              <Collapse
                className="editor-context-collapse"
                ghost
                size="small"
                expandIconPosition="end"
                activeKey={openContextKeys}
                onChange={(keys) => setOpenContextKeys(Array.isArray(keys) ? keys.map(String) : [String(keys)])}
                items={contextCollapseItems}
              />
            </div>
            <div style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: '1px solid #F1F5F9' }}>
              <Tooltip title="收起小提示">
                <Button type="text" icon={<MenuFoldOutlined />} onClick={() => setContextPanelCollapsed(true)} style={{ width: 34, height: 34, borderRadius: 8 }} />
              </Tooltip>
            </div>
          </aside>
        </div>
      )}
      {/* 快照详情弹窗（复用 Chapters 页的组件） */}
      <SnapshotViewerModal
        key={selectedSnapshotId}
        open={snapshotDetailOpen}
        onClose={() => setSnapshotDetailOpen(false)}
        snapshotData={selectedSnapshotData}
        timelineClips={(() => {
          const item = snapshotList.find((r) => r.id === selectedSnapshotId)
          return item ? timelineClipData[item.chapterId] : undefined
        })()}
      />
    </div>
  )
}
