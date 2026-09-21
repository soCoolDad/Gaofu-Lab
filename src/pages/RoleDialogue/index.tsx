/**
 * 剧情预演页面 —— 聊天窗口布局
 *
 * 整体结构：
 *   顶栏：[+ 新建房间]  房间名 + Run 选择器 + 操作按钮  [历史]
 *   聊天区域：气泡式片段流（角色气泡 / 内心独白 / 事实卡片 / 旁白卡片 / 折叠历史版本）
 *   底部输入区：事实/旁白切换 + 输入框 + 主操作按钮（生成）
 *   右侧栏（仿"小提示"样式，可折叠、可拖动调宽度）：当前 Run 的"在场角色"
 */

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import {
  Button,
  Input,
  Typography,
  Space,
  Tag,
  Modal,
  Form,
  Checkbox,
  Select,
  Empty,
  Tooltip,
  message,
  Spin,
  Collapse,
  Segmented,
  Radio,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
  SettingOutlined,
  MessageOutlined,
  TeamOutlined,
  HistoryOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SendOutlined,
  BulbOutlined,
  CommentOutlined,
  UserAddOutlined,
  EyeOutlined,
  QuestionCircleOutlined,
  VideoCameraTwoTone,
  ReadOutlined,
} from '@ant-design/icons'
import { useParams } from 'react-router-dom'
import { useRoleDialogueStore } from '@/stores/roleDialogue.store'
import { useModelStore } from '@/stores/model.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { modelFullName } from '@/utils/providers'
import ResizeHandle from '@/components/ResizeHandle'
import { AddCharactersModal } from '@/components/AddCharactersModal'
import type {
  MergedCharacter,
  RoleDialogueRoom,
  RoleDialogueRun,
  RoleDialogueSnippet,
  SnippetMessage,
  ChatRoomMessageUsage,
} from '@/types/api'

const { Text } = Typography

// ── Token 金额格式化（与聊天室一致）──
function formatCost(v: number, digits = 4): string {
  if (!v) return '0'
  if (v < 0.0001) return v.toExponential(2)
  return v.toFixed(digits)
}

// ── 单条角色发言的 token 消耗徽标（hover 看 Agent 面板风格明细，与聊天室一致）──
function renderTokenBadge(u: ChatRoomMessageUsage, modelName?: string) {
  const total = u.totalTokens || u.promptTokens + u.completionTokens
  const missTokens = Math.max(0, u.promptTokens - u.cachedPromptTokens)
  // 部分供应商（如 xAI Grok）把 completion_tokens 与 reasoning_tokens 作为互斥的两部分返回：
  // reasoningTokens > completionTokens 时，completionTokens 实际代表「直出」token 数。
  const isDisjointReasoning = u.reasoningTokens > u.completionTokens
  const directTokens = isDisjointReasoning
    ? u.completionTokens
    : Math.max(0, u.completionTokens - u.reasoningTokens)
  const effectiveCachedPrice = u.cachedPrice ?? u.inputPrice
  return (
    <Tooltip
      title={
        <div style={{ whiteSpace: 'normal' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', marginBottom: 8 }}>
            Token 消耗详情{modelName ? ` · ${modelName}` : ''}
          </div>

          {/* 表头 */}
          <div style={{ display: 'flex', gap: 8, fontSize: 11, color: '#9CA3AF', marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid #F3F4F6' }}>
            <span style={{ flex: 1 }}>项目</span>
            <span style={{ width: 72, textAlign: 'right' }}>Token 数</span>
            <span style={{ width: 72, textAlign: 'right' }}>单价</span>
            <span style={{ width: 90, textAlign: 'right' }}>金额</span>
          </div>

          {/* 输入 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, lineHeight: 2 }}>
            <span style={{ flex: 1, color: '#64748B' }}>输入</span>
            <span style={{ width: 72, textAlign: 'right', color: '#111827', fontWeight: 600 }}>{u.promptTokens.toLocaleString()}</span>
            <span style={{ width: 72, textAlign: 'right', color: '#9CA3AF', fontSize: 11 }}>—</span>
            <span style={{ width: 90, textAlign: 'right', color: '#111827', fontWeight: 600 }}>¥{formatCost(u.missCost + u.cacheCost, 6)}</span>
          </div>

          {/* 缓存命中 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, lineHeight: 2, paddingLeft: 16 }}>
            <span style={{ flex: 1, color: '#16A34A' }}>· 缓存命中</span>
            <span style={{ width: 72, textAlign: 'right', color: '#16A34A' }}>{u.cachedPromptTokens.toLocaleString()}</span>
            <span style={{ width: 72, textAlign: 'right', color: '#16A34A' }}>{effectiveCachedPrice !== undefined ? `¥${effectiveCachedPrice}/M` : '—'}</span>
            <span style={{ width: 90, textAlign: 'right', color: '#16A34A' }}>¥{formatCost(u.cacheCost, 6)}</span>
          </div>

          {/* 未命中 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, lineHeight: 2, paddingLeft: 16 }}>
            <span style={{ flex: 1, color: '#F59E0B' }}>· 未命中</span>
            <span style={{ width: 72, textAlign: 'right', color: '#F59E0B' }}>{missTokens.toLocaleString()}</span>
            <span style={{ width: 72, textAlign: 'right', color: '#F59E0B' }}>{u.inputPrice !== undefined ? `¥${u.inputPrice}/M` : '—'}</span>
            <span style={{ width: 90, textAlign: 'right', color: '#F59E0B' }}>¥{formatCost(u.missCost, 6)}</span>
          </div>

          {/* 输出 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, lineHeight: 2 }}>
            <span style={{ flex: 1, color: '#64748B' }}>输出</span>
            <span style={{ width: 72, textAlign: 'right', color: '#111827', fontWeight: 600 }}>{u.completionTokens.toLocaleString()}</span>
            <span style={{ width: 72, textAlign: 'right', color: '#9CA3AF', fontSize: 11 }}>—</span>
            <span style={{ width: 90, textAlign: 'right', color: '#111827', fontWeight: 600 }}>¥{formatCost(u.outputCost, 6)}</span>
          </div>

          {/* 思考 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, lineHeight: 2, paddingLeft: 16 }}>
            <span style={{ flex: 1, color: '#8B5CF6' }}>· 思考</span>
            <span style={{ width: 72, textAlign: 'right', color: '#8B5CF6' }}>{u.reasoningTokens.toLocaleString()}</span>
            <span style={{ width: 72, textAlign: 'right', color: '#8B5CF6' }}>{u.outputPrice !== undefined ? `¥${u.outputPrice}/M` : '—'}</span>
            <span style={{ width: 90, textAlign: 'right', color: '#8B5CF6' }}>¥{formatCost((u.reasoningTokens / 1_000_000) * (u.outputPrice || 0), 6)}</span>
          </div>

          {/* 直出 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, lineHeight: 2, paddingLeft: 16 }}>
            <span style={{ flex: 1, color: '#0EA5E9' }}>· 直出</span>
            <span style={{ width: 72, textAlign: 'right', color: '#0EA5E9' }}>{directTokens.toLocaleString()}</span>
            <span style={{ width: 72, textAlign: 'right', color: '#0EA5E9' }}>{u.outputPrice !== undefined ? `¥${u.outputPrice}/M` : '—'}</span>
            <span style={{ width: 90, textAlign: 'right', color: '#0EA5E9' }}>¥{formatCost((directTokens / 1_000_000) * (u.outputPrice || 0), 6)}</span>
          </div>

          {/* 合计 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, lineHeight: 2, marginTop: 6, fontWeight: 600, paddingTop: 6, borderTop: '1px dashed #E5E7EB' }}>
            <span style={{ flex: 1, color: '#111827' }}>合计</span>
            <span style={{ width: 72, textAlign: 'right', color: '#4F46E5' }}>{total.toLocaleString()}</span>
            <span style={{ width: 72, textAlign: 'right' }}></span>
            <span style={{ width: 90, textAlign: 'right', color: '#EF4444' }}>¥{formatCost(u.cost, 6)}</span>
          </div>
        </div>
      }
      placement="topLeft"
      color="#FFFFFF"
      arrow={false}
      styles={{
        root: { width: 420, maxWidth: 420 },
        body: { width: 420, maxWidth: 420, color: '#111827', boxShadow: '0 8px 24px rgba(15, 23, 42, 0.16)', borderRadius: 12 },
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: '#9CA3AF',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          cursor: 'default',
        }}
      >
        <QuestionCircleOutlined style={{ fontSize: 11 }} />
        {total.toLocaleString()} · ¥{formatCost(u.cost, 4)}
      </span>
    </Tooltip>
  )
}
const { TextArea } = Input

const NARRATOR_ID = '__narrator__'
const SIDEBAR_WIDTH_KEY = 'roleDialogue:sidebarWidth'
const SIDEBAR_COLLAPSED_KEY = 'roleDialogue:sidebarCollapsed'
const SIDEBAR_MIN_WIDTH = 240
const SIDEBAR_MAX_WIDTH = 480
const SIDEBAR_DEFAULT_WIDTH = 320
const SIDEBAR_COLLAPSED_STRIP_WIDTH = 42

export default function RoleDialoguePage() {
  const { bookId } = useParams()
  const { currentBook } = useWorkspaceStore()
  const {
    rooms,
    runsByRoom,
    snippetsByRun,
    currentRoomId,
    currentRunId,
    loading,
    generating,
    sidebarCollapsed,
    loadRooms,
    createRoom,
    updateRoom,
    deleteRoom,
    setCurrentRoom,
    loadRuns,
    createRun,
    deleteRun,
    updateRunCharacters,
    setCurrentRun,
    loadSnippets,
    generateAndCreateSnippet,
    regenerateSnippet,
    speakCharacterSnippet,
    insertAuthorFact,
    appendNarrator,
    deleteSnippet,
    setCharacterModel,
    setSidebarCollapsed,
    resetAll,
    generateSummary,
    streamingSnippet,
    streamingSummary,
  } = useRoleDialogueStore()
  const { models, loadModels } = useModelStore()

  // 角色列表（来自 bookSetting + bookMemory 合并去重）
  const [characters, setCharacters] = useState<MergedCharacter[]>([])
  const [charactersLoading, setCharactersLoading] = useState(false)
  const [characterModels, setCharacterModels] = useState<Record<string, string | null>>({})
  // 角色最后状态文本（与「角色聊天室」同源：bookMemory 定稿记忆里角色的最后状态）
  const [characterMemoryStates, setCharacterMemoryStates] = useState<Record<string, string>>({})

  // 章节列表（用于房间"锚定章节"）
  const [chapters, setChapters] = useState<Array<{ id: string; title: string }>>([])

  // UI 状态
  const [roomModalOpen, setRoomModalOpen] = useState(false)
  const [editingRoom, setEditingRoom] = useState<RoleDialogueRoom | null>(null)
  const [runSetupOpen, setRunSetupOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)

  // 「总结片段」弹窗状态：视角选择 + 提交生成
  const [summaryModalOpen, setSummaryModalOpen] = useState(false)
  const [summaryView, setSummaryView] = useState<'first-person' | 'third-person'>('third-person')
  const [summaryViewCharacterId, setSummaryViewCharacterId] = useState<string | null>(null)

  // 提交"生成剧情"：调 store action 触发生成
  const handleConfirmSummary = async () => {
    if (!currentRunId) return
    if (summaryView === 'first-person' && !summaryViewCharacterId) return
    setSummaryModalOpen(false)
    try {
      await generateSummary(currentRunId, summaryView, summaryViewCharacterId)
    } catch (e: any) {
      console.error('[RoleDialogue] generateSummary failed:', e)
      message.error(`剧情生成失败：${e?.message || String(e)}`)
    }
  }

  // 打开「房间历史」弹窗，并预加载所有房间的 runs / snippets，确保统计数字正确
  const handleOpenHistory = async () => {
    setHistoryOpen(true)
    setHistoryLoading(true)
    try {
      await Promise.all(rooms.map((r) => loadRuns(r.id)))
      const state = useRoleDialogueStore.getState()
      const allRuns = Object.values(state.runsByRoom).flat()
      await Promise.all(allRuns.map((run) => loadSnippets(run.id)))
    } finally {
      setHistoryLoading(false)
    }
  }

  // 底部输入区
  const [inputMode, setInputMode] = useState<'fact' | 'narrator'>('fact')
  const [inputText, setInputText] = useState('')

  // 「查看上下文」弹窗状态
  const [contextModal, setContextModal] = useState<{ open: boolean; title: string; messages: Array<{ role: string; content: string }> | null }>({ open: false, title: '', messages: null })
  const openContext = (raw: string | null | undefined, name: string) => {
    if (!raw) return
    try {
      const parsed = JSON.parse(raw)
      setContextModal({ open: true, title: name || '角色', messages: Array.isArray(parsed) ? parsed : [] })
    } catch { }
  }

  // 侧栏宽度
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const v = localStorage.getItem(SIDEBAR_WIDTH_KEY)
      const n = v ? Number(v) : SIDEBAR_DEFAULT_WIDTH
      return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, isNaN(n) ? SIDEBAR_DEFAULT_WIDTH : n))
    } catch {
      return SIDEBAR_DEFAULT_WIDTH
    }
  })
  useEffect(() => {
    if (!sidebarCollapsed) {
      try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth)) } catch { }
    }
  }, [sidebarWidth, sidebarCollapsed])

  // 同步 collapse 状态到 LS（首次挂载从 LS 读）
  useEffect(() => {
    try {
      const v = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
      setSidebarCollapsed(v === '1')
    } catch { }
  }, [setSidebarCollapsed])
  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0') } catch { }
  }, [sidebarCollapsed, setSidebarCollapsed])

  // 拖动（仿 Editor 的 useRef 模式，配合 ResizeHandle）
  const isResizingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizingRef.current = true
    startXRef.current = e.clientX
    startWidthRef.current = sidebarWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return
      // 侧栏在右：往左拖 width 增大
      const delta = startXRef.current - ev.clientX
      const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startWidthRef.current + delta))
      setSidebarWidth(next)
    }
    const onUp = () => {
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [sidebarWidth])

  // 滚动到底部
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = chatScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [snippetsByRun, currentRunId, generating])

  // 加载
  useEffect(() => {
    if (bookId) {
      loadRooms(bookId)
      loadModels()
      loadCharacters()
      loadChapters()
    }
  }, [bookId])

  useEffect(() => {
    if (currentRoomId) loadRuns(currentRoomId)
  }, [currentRoomId])

  // 数据管理「清空剧情预演数据」后，重置当前页所有状态
  useEffect(() => {
    const onCleared = () => resetAll()
    window.addEventListener('role-dialogue-cleared', onCleared)
    return () => window.removeEventListener('role-dialogue-cleared', onCleared)
  }, [resetAll])

  useEffect(() => {
    if (currentRunId) loadSnippets(currentRunId)
  }, [currentRunId])

  const loadCharacters = async () => {
    if (!bookId || !window.api?.bookSetting?.list) return
    setCharactersLoading(true)
    try {
      // 用新的合并 IPC：bookSetting + bookMemory，按 name 模糊去重，记忆优先
      const data = await window.api.roleDialogue.listCharacters(bookId)
      setCharacters(data as MergedCharacter[])
      const modelMap: Record<string, string | null> = {}
      await Promise.all(
        data.map(async (c) => {
          const m = await window.api.roleDialogue.getCharacterModel(bookId, c.id)
          modelMap[c.id] = m?.modelId ?? null
        }),
      )
      setCharacterModels(modelMap)
      // 角色最后状态（与「角色聊天室」同源同格式：bookMemory 定稿记忆）
      if (data.length) {
        const states = await window.api.chatRoom.getCharacterMemoryStates(bookId, data.map((c) => c.id))
        setCharacterMemoryStates(states)
      }
    } finally {
      setCharactersLoading(false)
    }
  }

  const loadChapters = async () => {
    if (!bookId) return
    try {
      const chs = await window.api.chapter.list(bookId) ?? []
      setChapters(chs.map((c: any) => ({ id: c.id, title: c.title })))
    } catch { }
  }

  const currentRoom = useMemo(() => rooms.find((r) => r.id === currentRoomId) || null, [rooms, currentRoomId])
  const currentRuns = useMemo(() => (currentRoomId ? runsByRoom[currentRoomId] || [] : []), [runsByRoom, currentRoomId])
  const currentRun = useMemo(() => currentRuns.find((r) => r.id === currentRunId) || null, [currentRuns, currentRunId])
  const currentSnippets = useMemo(() => (currentRunId ? snippetsByRun[currentRunId] || [] : []), [snippetsByRun, currentRunId])
  const runCharacterIds = useMemo<string[]>(() => {
    const raw = currentRun?.characterIdsSnapshot
    if (!raw) return []
    if (Array.isArray(raw)) return raw
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }, [currentRun])

  // ─── 房间操作 ───
  const handleCreateRoom = async (values: any) => {
    if (!bookId) return
    const created = await createRoom({ bookId, ...values })
    setRoomModalOpen(false)
    setCurrentRoom(created.id)
    message.success('房间已创建')
  }
  const handleUpdateRoom = async (values: any) => {
    if (!editingRoom) return
    await updateRoom(editingRoom.id, values)
    setEditingRoom(null)
    setRoomModalOpen(false)
    message.success('已保存')
  }
  const handleDeleteRoom = (id: string) => {
    Modal.confirm({
      title: '删除房间？',
      content: '将同时删除该房间下的所有 Run 和片段。此操作不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteRoom(id)
        message.success('已删除')
      },
    })
  }

  // ─── Run 操作 ───
  const handleCreateRun = async (characterIds: string[]) => {
    if (!currentRoomId) return
    await createRun(currentRoomId, characterIds)
    setRunSetupOpen(false)
    message.success('新 Run 已创建')
  }
  const handleDeleteRun = (id: string) => {
    Modal.confirm({
      title: '删除这个 Run？',
      content: '该 Run 下的所有片段将一并删除。',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteRun(id)
        message.success('已删除')
      },
    })
  }

  // ─── 片段操作 ───
  const handleGenerateSnippet = async (characterIds: string[], authorFact?: string | null) => {
    if (!currentRunId) return
    if (characterIds.length === 0) {
      message.warning('请先在右侧添加至少一个角色')
      return
    }
    try {
      await generateAndCreateSnippet(currentRunId, characterIds, authorFact)
      message.success('片段已生成')
    } catch (err: any) {
      message.error(err?.message || '生成失败')
    }
  }
  const handleRegenerateSnippet = (snippet: RoleDialogueSnippet) => {
    // summary 片段的"重新总结"必须走 generateSummary，不能复用普通片段的 regenerateSnippet：
    // summary 的 characterIds 来自参与片段的真实角色集合，可能包含虚拟旁白 __narrator__，
    // 传给 generateSnippet 会报"角色不存在：__narrator__"。
    if (snippet.kind === 'summary') {
      Modal.confirm({
        title: '重新总结？',
        content: '当前总结将进入历史版本，可折叠查看。',
        okText: '重新总结',
        onOk: async () => {
          if (!currentRunId) {
            message.warning('请先选择或创建一个 Run')
            return
          }
          if (!snippet.summaryView) {
            message.error('总结片段缺少视角信息')
            return
          }
          try {
            await generateSummary(currentRunId, snippet.summaryView, snippet.summaryViewCharacterId, snippet.id)
            message.success('已重新总结')
          } catch (err: any) {
            message.error(err?.message || '重新总结失败')
          }
        },
      })
      return
    }

    Modal.confirm({
      title: '重跑本片段？',
      content: `当前内容（共 ${snippet.messages.length} 条发言）将进入历史版本，可折叠查看。`,
      okText: '重跑',
      onOk: async () => {
        try {
          await regenerateSnippet(snippet.id, snippet.characterIds)
          message.success('已重跑')
        } catch (err: any) {
          message.error(err?.message || '重跑失败')
        }
      },
    })
  }
  const handleDeleteSnippet = (snippet: RoleDialogueSnippet) => {
    Modal.confirm({
      title: '删除本片段？',
      content: '本片段及之后的所有片段都会被删除（保持时间线连续）。',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteSnippet(snippet.id)
        message.success('已删除')
      },
    })
  }

  // ─── 底部输入区 ───
  const handleSendInput = async () => {
    const text = inputText.trim()
    if (!text) return
    if (!currentRunId) {
      message.warning('请先选择或创建一个 Run')
      return
    }
    await appendNarrator(currentRunId, text)
    message.success('旁白已加入时间线')
    setInputText('')
  }

  // ─── Run 角色增删调顺序 ───
  const handleAddRunCharacter = async (characterId: string) => {
    if (!currentRun || !characterId) return
    if (runCharacterIds.includes(characterId)) {
      message.warning('该角色已在场')
      return
    }
    await updateRunCharacters(currentRun.id, [...runCharacterIds, characterId])
  }
  const handleRemoveRunCharacter = async (characterId: string) => {
    if (!currentRun) return
    await updateRunCharacters(currentRun.id, runCharacterIds.filter((id) => id !== characterId))
  }
  // 让该角色单独演一段：有片段 -> 在最后一个片段里追加一条该角色的新发言（不动已有消息）；
  // 没有片段 -> 新建一个片段存放这条发言。
  const handleSpeakCharacter = async (characterId: string) => {
    if (!currentRun) return
    if (generating) return
    await speakCharacterSnippet(currentRun.id, characterId)
  }

  // 拖拽：实时让出占位（与角色聊天室的 InSceneCharacterCard 拖动一致）
  const [dragId, setDragId] = useState<string | null>(null)
  // 拖动期间的"虚拟顺序"：拖到哪它就显示在哪，避免每帧调 IPC；
  // null 表示没在拖动，渲染走 runCharacterIds。dragend 时一次性提交给 store。
  const [dragOrder, setDragOrder] = useState<string[] | null>(null)
  const inSceneListRef = useRef<HTMLDivElement | null>(null)
  // 拖动期间实时重排（本地 state，不打 IPC）：把 source 抽出，按 pos 插入 target 附近
  // 当目标位置与当前位置一致时 return order，避免每帧 setState
  const reorderInSceneLocal = (order: string[], sourceId: string, targetId: string, pos: 'before' | 'after'): string[] => {
    const sIdx = order.indexOf(sourceId)
    if (sIdx === -1) return order
    const next = [...order]
    next.splice(sIdx, 1)
    const newTIdx = next.indexOf(targetId)
    if (newTIdx === -1) return order
    const insertAt = pos === 'before' ? newTIdx : newTIdx + 1
    if (insertAt === sIdx) return order
    next.splice(insertAt, 0, sourceId)
    return next
  }
  // 用 Y 坐标找最接近的目标 card（不依赖 e.target，永远准确）
  const findInSceneTargetByY = (clientY: number, order: string[]): { id: string; pos: 'before' | 'after' } | null => {
    if (!inSceneListRef.current) return null
    const cardEls = inSceneListRef.current.querySelectorAll<HTMLElement>('[data-role-dialogue-card]')
    if (cardEls.length === 0) return null
    const metas: Array<{ id: string; centerY: number }> = []
    cardEls.forEach((el) => {
      const r = el.getBoundingClientRect()
      const id = el.getAttribute('data-role-dialogue-card')
      if (!id || !order.includes(id)) return
      metas.push({ id, centerY: r.top + r.height / 2 })
    })
    if (metas.length === 0) return null
    if (clientY <= metas[0].centerY) return { id: metas[0].id, pos: 'before' }
    const last = metas[metas.length - 1]
    if (clientY >= last.centerY) return { id: last.id, pos: 'after' }
    let best = metas[0]
    let bestDist = Math.abs(clientY - best.centerY)
    for (let i = 1; i < metas.length; i++) {
      const d = Math.abs(clientY - metas[i].centerY)
      if (d < bestDist) { best = metas[i]; bestDist = d }
    }
    return { id: best.id, pos: clientY < best.centerY ? 'before' : 'after' }
  }
  // dragend 提交：把拖动期间的最终顺序一次性写入数据库
  const commitInSceneReorder = (finalOrder: string[]) => {
    if (!currentRun) return
    updateRunCharacters(currentRun.id, finalOrder)
  }

  // 兜底：HTML5 dragend 在某些情况（drop 在浏览器外、用户按 ESC、drop 目标被拦截等）不触发，
  // 会导致 dragId 永远不为 null、card 永远显示成"拖动中"样式、dragOrder 永远不提交。
  // 监听 document.dragend 强制清理，确保 dragId 一定会被重置、最终顺序一定会被持久化。
  useEffect(() => {
    const onDocDragEnd = () => {
      setDragId((cur) => {
        if (!cur) return cur
        if (dragOrder) commitInSceneReorder(dragOrder)
        return null
      })
      setDragOrder((cur) => (cur ? null : cur))
    }
    document.addEventListener('dragend', onDocDragEnd)
    return () => document.removeEventListener('dragend', onDocDragEnd)
  }, [dragOrder, currentRun])

  // ─── 角色 model 偏好 ───
  const handleSetCharacterModel = async (characterId: string, modelId: string | null) => {
    if (!bookId) return
    await setCharacterModel(bookId, characterId, modelId)
    setCharacterModels((s) => ({ ...s, [characterId]: modelId }))
  }

  if (!bookId || !currentBook) {
    return <div style={{ padding: 24 }}><Text type="secondary">请先选择一本书</Text></div>
  }

  const inSceneCharacters = (dragOrder ?? runCharacterIds)
    .map((id) => characters.find((c) => c.id === id))
    .filter((c): c is MergedCharacter => !!c)
  const outOfSceneCharacters = characters.filter((c) => !runCharacterIds.includes(c.id))

  return (
    // 仿 Editor 的外层容器：负 margin 撑出 page padding，flex 两列
    // 左列 = 原顶栏 + 聊天 + 底部输入；右列 = 侧栏（贴窗口右边缘、无圆角）
    <div style={{ height: 'calc(100vh - 44px)', display: 'flex', flexDirection: 'row', margin: '-20px -24px', minHeight: 0, overflow: 'hidden' }}>
      {/* 左列：所有内容（含 padding） */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, margin: '0px 0px' }}>
        {/* 顶栏：[+ 新建] 在左，[历史] 在右 */}
        <div style={{
          marginBottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          height: '50px', padding: '0px 16px', background: '#fff', borderRadius: 0,
          borderTop: 'none', borderBottom: '1px solid #E5E7EB', borderLeft: 'none', borderRight: 'none',
        }}>
          {/* 左：新建按钮 + 房间信息 */}
          <Space size={12}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => { setEditingRoom(null); setRoomModalOpen(true) }}
            >
              新建房间
            </Button>
            {!currentRoom && <Text type="secondary">点击「历史」切换，或上方「新建房间」开始</Text>}
            {currentRoom && (
              <>
                {/* <Text strong style={{ fontSize: 15 }}>
                <ThunderboltOutlined style={{ color: '#8B5CF6', marginRight: 6 }} />
                {currentRoom.title}
              </Text> */}
                {/* {currentRoom.injectWritingSettings && <Tag color="purple">注入写作设置</Tag>} */}
                {/* {currentRoom.chapterId && <Tag color="blue">锚定章节</Tag>} */}
                <Tag>片段 #{currentSnippets.length}</Tag>
                {/* <Text type="secondary" style={{ fontSize: 12 }}>
                {currentRoom.situation.slice(0, 40)}{currentRoom.situation.length > 40 ? '...' : ''}
              </Text> */}
              </>
            )}
          </Space>

          {/* 右：Run 操作 + 历史 */}
          <Space>
            {currentRoom && (
              <>
                {currentRuns.length > 0 && (
                  <>
                    <Select
                      size="small"
                      value={currentRunId || undefined}
                      onChange={(v) => setCurrentRun(v)}
                      style={{ width: 140 }}
                      options={currentRuns.map((r) => ({ value: r.id, label: `Run #${r.runNumber}` }))}
                    />
                    <Tooltip title="删除当前 Run">
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={!currentRunId || generating}
                        onClick={() => currentRunId && handleDeleteRun(currentRunId)}
                      />
                    </Tooltip>
                  </>
                )}
                <Tooltip title="开始新 Run">
                  <Button
                    size="small"
                    type={currentRuns.length === 0 ? 'primary' : 'default'}
                    icon={<PlayCircleOutlined />}
                    disabled={generating}
                    onClick={() => setRunSetupOpen(true)}
                  >
                    {currentRuns.length === 0 ? '' : ''}
                  </Button>
                </Tooltip>
                <Tooltip title="编辑房间设置">
                  <Button
                    size="small"
                    icon={<SettingOutlined />}
                    onClick={() => { setEditingRoom(currentRoom); setRoomModalOpen(true) }}
                  >
                  </Button>
                </Tooltip>
                {/* <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={() => handleDeleteRoom(currentRoom.id)}
              /> */}
              </>
            )}
            <Tooltip title="查看历史">
              <Button
                size="small"
                icon={<HistoryOutlined />}
                onClick={handleOpenHistory}
              >
              </Button>
            </Tooltip>
          </Space>
        </div>

        {/* 聊天区域（flex:1 撑满左列剩余空间） */}
        <div
          ref={chatScrollRef}
          style={{
            flex: 1, overflow: 'auto', padding: 16,
            background: '#FAFAFA',
            borderRadius: 0,
            border: '0px solid #E5E7EB'
          }}
        >
          {!currentRoomId && (
            <Empty description="点击右上「历史」选一个房间，或上方「新建房间」开始" style={{ marginTop: 60 }} />
          )}
          {currentRoomId && !currentRunId && (
            <Empty description="该房间还没有 Run，点击「新 Run」开始" style={{ marginTop: 60 }} />
          )}
          {currentRoomId && currentRunId && currentSnippets.length === 0 && !generating && (
            <Empty
              description={
                <div>
                  <div>还没有片段</div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    先在右侧添加角色，然后点底部「生成片段」
                  </Text>
                </div>
              }
              style={{ marginTop: 60 }}
            />
          )}
          {generating && currentSnippets.length === 0 && !streamingSnippet && (
            <div style={{ textAlign: 'center', padding: 60 }}>
              <Spin /> <Text type="secondary" style={{ marginLeft: 8 }}>正在准备第 1 个片段...</Text>
            </div>
          )}

          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {currentSnippets.map((s) => (
              <SnippetBubble
                key={s.id}
                snippet={s}
                characters={characters}
                // 关键：currentSnippets 是已落库的卡片，generating 永远传 false。
                // 之前传 generating（全局生成状态）导致角色生成时所有 summary 卡片底部都显示"正在生成新片段..."
                // — 占位应该只出现在"流式渲染中的临时卡片"上（见下方 streamingSummary/streamingSnippet 块）。
                generating={
                  // 只有当流式渲染的临时 snippet 的 runId+order 与本卡匹配时才传 true
                  //（普通片段流式渲染会通过下方 streamingSnippet 路径独立显示，不是走 currentSnippets）
                  s.kind === 'summary'
                    ? false
                    : (!!streamingSnippet && streamingSnippet.runId === s.runId && streamingSnippet.order === s.order && generating)
                }
                models={models}
                onViewContext={openContext}
                onRegenerate={() => handleRegenerateSnippet(s)}
                onDelete={() => handleDeleteSnippet(s)}
              />
            ))}
            {/* 流式片段：把 streamingSnippet 包装成 RoleDialogueSnippet 渲染 */}
            {streamingSnippet && (() => {
              const tmpSnippet: RoleDialogueSnippet = {
                id: `streaming_${streamingSnippet.runId}_${streamingSnippet.order}`,
                runId: streamingSnippet.runId,
                order: streamingSnippet.order,
                characterIds: streamingSnippet.messages.map((m) => m.characterId),
                regenerateCount: 0,
                messages: streamingSnippet.messages,
                versions: [],
                authorFactUpdate: streamingSnippet.authorFactUpdate,
                kind: 'snippet',
                summaryView: null,
                summaryViewCharacterId: null,
                summaryCoveredSnippetIds: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
              return (
                <SnippetBubble
                  key={tmpSnippet.id}
                  snippet={tmpSnippet}
                  characters={characters}
                  generating={true}
                  pendingCharacterIds={runCharacterIds}
                  models={models}
                  onViewContext={openContext}
                  onRegenerate={() => { }}
                  onDelete={() => { }}
                />
              )
            })()}

            {/* 流式总结：实时显示 streamingSummary 累积的内容 */}
            {streamingSummary && (() => {
              const tmpSnippet: RoleDialogueSnippet = {
                id: streamingSummary.summaryId,
                runId: streamingSummary.runId,
                order: (currentSnippets[currentSnippets.length - 1]?.order ?? 0) + 1,
                characterIds: [],
                regenerateCount: 0,
                messages: [{
                  characterId: streamingSummary.view === 'first-person'
                    ? (streamingSummary.viewCharacterId || '__narrator__')
                    : '__narrator__',
                  characterName: streamingSummary.view === 'first-person'
                    ? (characters.find((c) => c.id === streamingSummary.viewCharacterId)?.name || '主角')
                    : '旁白视角',
                  publicContent: streamingSummary.content,
                  innerThought: '',
                  reasoning: streamingSummary.reasoning || undefined,
                  modelId: '',
                }],
                versions: [],
                authorFactUpdate: null,
                kind: 'summary',
                summaryView: streamingSummary.view,
                summaryViewCharacterId: streamingSummary.viewCharacterId,
                summaryCoveredSnippetIds: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
              return (
                <SnippetBubble
                  key={tmpSnippet.id}
                  snippet={tmpSnippet}
                  characters={characters}
                  generating={true}
                  models={models}
                  onViewContext={openContext}
                  onRegenerate={() => { }}
                  onDelete={() => { }}
                />
              )
            })()}
            {generating && currentSnippets.length > 0 && !streamingSnippet && !streamingSummary && (
              <div style={{ textAlign: 'center', padding: 20 }}>
                <Spin /> <Text type="secondary" style={{ marginLeft: 8 }}>正在生成新片段...</Text>
              </div>
            )}
          </Space>
        </div>

        {/* 底部输入区 */}
        {currentRun && (
          <div style={{
            marginTop: 0, padding: '8px 16px', background: '#fff', borderRadius: 0,
            borderTop: 'none', borderBottom: '1px solid #E5E7EB', borderLeft: 'none', borderRight: 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                旁白 → 作为独立片段加入时间线（所有角色都"看到"）
              </Text>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <TextArea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault()
                    handleSendInput()
                  }
                }}
                placeholder={'输入作者旁白（回车发送，Shift+Enter 换行）'}
                autoSize={{ minRows: 1, maxRows: 3 }}
                style={{ flex: 1, resize: 'none' }}
                disabled={generating}
              />
              <Button
                type="primary"
                icon={<SendOutlined />}
                onClick={handleSendInput}
                disabled={!inputText.trim() || generating}
              >
                {'发送旁白'}
              </Button>
            </div>

            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8, borderTop: '1px dashed #E5E7EB' }}>
              {/* 「生成剧情」按钮：点击后基于上次 summary 之后到当前的所有片段融合成连贯的剧情；之后之前的片段不再参与上下文 */}
              <Button
                icon={<VideoCameraTwoTone />}
                loading={generating && !!streamingSummary}
                disabled={inSceneCharacters.length === 0 || generating || currentSnippets.length === 0}
                onClick={() => setSummaryModalOpen(true)}
              >
                生成剧情
              </Button>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                loading={generating && !streamingSummary}
                disabled={inSceneCharacters.length === 0 || generating}
                onClick={() => handleGenerateSnippet(runCharacterIds)}
                style={{ marginLeft: 'auto' }}
              >
                ▶ 生成片段
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ─── 右侧栏（贴窗口右边缘，仿"小提示"侧栏） ─── */}
      {sidebarCollapsed ? (
        /* 折叠态：42px 宽的展开按钮条 */
        <aside
          style={{
            width: SIDEBAR_COLLAPSED_STRIP_WIDTH, flexShrink: 0, height: '100%',
            borderLeft: '1px solid #E5E7EB', background: '#FFFFFF',
            borderRadius: 0, display: 'flex', flexDirection: 'column', minHeight: 0,
          }}
        >
          <div style={{ height: 42, padding: '0 4px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #F1F5F9' }}>
            <Tooltip title="展开角色栏" placement="left">
              <Button
                type="text"
                icon={<MenuUnfoldOutlined />}
                onClick={() => setSidebarCollapsed(false)}
                style={{ width: 34, height: 34, borderRadius: 8 }}
              />
            </Tooltip>
          </div>
        </aside>
      ) : (
        /* 展开态：拖动把手 + 侧栏（贴窗口右边缘，无圆角） */
        <div style={{ position: 'relative', width: sidebarWidth, flexShrink: 0, height: '100%' }}>
          <ResizeHandle
            orientation="vertical"
            onResizeStart={handleResizeStart}
            title="拖动调整角色栏宽度"
          />
          <aside
            style={{
              width: '100%', height: '100%',
              borderLeft: '1px solid #E5E7EB', background: '#FFFFFF',
              borderRadius: 0,
              display: 'flex', flexDirection: 'column', minHeight: 0,
            }}
          >
            {/* 顶 42px 标题栏 */}
            <div style={{
              height: 50, padding: '0 12px', display: 'flex', alignItems: 'center',
              borderBottom: '1px solid #F1F5F9', justifyContent: 'space-between',
            }}>
              <span style={{ color: '#111827', fontWeight: 600, fontSize: 13 }}>
                <TeamOutlined style={{ marginRight: 6 }} />
                在场角色（{inSceneCharacters.length}）
              </span>
              <Tooltip title="收起角色栏" placement="left">
                <Button
                  type="text"
                  icon={<MenuFoldOutlined />}
                  onClick={() => setSidebarCollapsed(true)}
                  style={{ width: 28, height: 28, borderRadius: 6 }}
                />
              </Tooltip>
            </div>

            {/* 角色列表（可滚动） */}
            <div
              ref={inSceneListRef}
              style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 8 }}
              onDragOver={(e) => {
                // 容器接收 drop + 拖动期间用 Y 坐标实时重排（让出真位置）
                e.preventDefault()
                if (!dragId || !currentRun || inSceneCharacters.length === 0) return
                const order = dragOrder ?? runCharacterIds
                const t = findInSceneTargetByY(e.clientY, order)
                if (!t || t.id === dragId) return
                const next = reorderInSceneLocal(order, dragId, t.id, t.pos)
                if (next !== order) setDragOrder(next)
              }}
              onDrop={(e) => {
                // 拖动期间已实时重排；drop 时不重复提交，dragend 会统一提交
                e.preventDefault()
              }}
            >
              {!currentRun ? (
                <Empty description="先开始一个 Run" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {inSceneCharacters.length === 0 && (
                    <div style={{ padding: 8, textAlign: 'center', color: '#9CA3AF', fontSize: 12 }}>
                      还没有角色 — 从下方添加
                    </div>
                  )}
                  {inSceneCharacters.map((c, idx) => (
                    <InSceneCharacterCard
                      key={c.id}
                      character={c}
                      index={idx}
                      total={inSceneCharacters.length}
                      modelId={characterModels[c.id] ?? null}
                      models={models}
                      onRemove={() => handleRemoveRunCharacter(c.id)}
                      onSpeak={() => handleSpeakCharacter(c.id)}
                      onModelChange={(mid) => handleSetCharacterModel(c.id, mid)}
                      snippets={currentSnippets}
                      lastStateText={characterMemoryStates[c.id] || '（暂无状态记录）'}
                      draggable
                      onDragStart={() => {
                        // 初始化 dragOrder 为当前顺序的快照
                        setDragOrder((cur) => cur ?? runCharacterIds)
                        setDragId(c.id)
                      }}
                      isDragging={dragId === c.id}
                    />
                  ))}
                </Space>
              )}
            </div>

            {/* 底 48px：添加角色 + 软提示 */}
            {currentRun && (
              <div style={{ height: 48, padding: '0 8px', borderTop: '1px solid #F1F5F9', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Select
                  size="small"
                  placeholder={<span><UserAddOutlined /> 添加角色入场</span>}
                  value={undefined}
                  onChange={(v) => { if (v) handleAddRunCharacter(v) }}
                  style={{ flex: 1, minWidth: 0 }}
                  options={outOfSceneCharacters.map((c) => ({ value: c.id, label: c.name }))}
                  disabled={outOfSceneCharacters.length === 0}
                />
                {inSceneCharacters.length > 5 && (
                  <Tooltip title="建议不超过 5 个角色，预演质量更稳定">
                    <Text type="warning" style={{ fontSize: 11 }}>⚠</Text>
                  </Tooltip>
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      {/* 弹窗（放在外层，不受布局影响） */}
      <RoomFormModal
        open={roomModalOpen}
        editing={editingRoom}
        chapters={chapters}
        models={models}
        onCancel={() => { setRoomModalOpen(false); setEditingRoom(null) }}
        onSubmit={editingRoom ? handleUpdateRoom : handleCreateRoom}
      />
      <AddCharactersModal
        open={runSetupOpen}
        characters={characters}
        onCancel={() => setRunSetupOpen(false)}
        onSubmit={handleCreateRun}
        title="开始新 Run — 选择参与角色（可拖动排序）"
        hint="按顺序依次自动生成："
        okText="开始 Run"
      />
      <RoomHistoryModal
        open={historyOpen}
        rooms={rooms}
        runsByRoom={runsByRoom}
        snippetsByRun={snippetsByRun}
        currentRoomId={currentRoomId}
        loading={historyLoading}
        onCancel={() => setHistoryOpen(false)}
        onSwitch={(id) => { setCurrentRoom(id); setHistoryOpen(false) }}
        onDelete={(id) => { handleDeleteRoom(id) }}
      />

      {/* ─── 「生成剧情」视角选择弹窗 ─── */}
      <Modal
        title="生成剧情"
        open={summaryModalOpen}
        onCancel={() => setSummaryModalOpen(false)}
        onOk={handleConfirmSummary}
        okText="开始生成"
        cancelText="取消"
        confirmLoading={!!streamingSummary}
        okButtonProps={{ disabled: summaryView === 'first-person' && !summaryViewCharacterId }}
      >
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            根据当前所有片段（上次生成剧情之后的部分）融合成一段连贯的剧情描述。
          </Text>
        </div>
        <div style={{ marginBottom: 12 }}>
          <Text strong>选择剧情视角</Text>
          <Radio.Group
            value={summaryView}
            onChange={(e) => {
              setSummaryView(e.target.value)
              if (e.target.value === 'third-person') setSummaryViewCharacterId(null)
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}
          >
            <Radio value="third-person">第三群像视角（第三方旁白，陈述所有角色的行动）</Radio>
            <Radio value="first-person">第一人称视角（以某个角色的"我"口吻描述剧情）</Radio>
          </Radio.Group>
        </div>
        {summaryView === 'first-person' && (
          <div>
            <Text strong>选择角色</Text>
            <Select
              value={summaryViewCharacterId || undefined}
              onChange={(v) => setSummaryViewCharacterId(v)}
              placeholder="请选择一个角色作为第一人称视角"
              style={{ width: '100%', marginTop: 8 }}
              showSearch
              optionFilterProp="label"
              options={inSceneCharacters.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
        )}
      </Modal>

      {/* ─── 查看调用模型上下文弹窗 ─── */}
      <Modal
        title={`「${contextModal.title}」调用模型的上下文`}
        open={contextModal.open}
        onCancel={() => setContextModal((s) => ({ ...s, open: false }))}
        footer={[
          <Button key="close" type="primary" onClick={() => setContextModal((s) => ({ ...s, open: false }))}>
            关闭
          </Button>,
        ]}
        width={720}
      >
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {(contextModal.messages || []).map((msg, i) => (
            <div key={i} style={{ marginBottom: 12, border: '1px solid #EEF0F3', borderRadius: 8, overflow: 'hidden' }}>
              <div
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#fff',
                  background: msg.role === 'system' ? '#111827' : msg.role === 'user' ? '#2563EB' : '#16A34A',
                }}
              >
                {msg.role}
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 10,
                  fontSize: 12,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  background: '#F9FAFB',
                }}
              >
                {msg.content}
              </pre>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}

// ────────────────────────────────────────────────────────
// 气泡：片段
// ────────────────────────────────────────────────────────
function SnippetBubble(props: {
  snippet: RoleDialogueSnippet
  characters: MergedCharacter[]
  generating: boolean
  /** 本次生成计划覆盖的（全部）角色 id 顺序；生成中为尚未出现的角色显示"正在生成"占位 */
  pendingCharacterIds?: string[]
  /** 模型列表（用于 token 徽标标题显示模型名） */
  models: Array<{ id: string; name: string }>
  /** 打开"查看上下文"弹窗 */
  onViewContext: (modelMessages: string | null | undefined, name: string) => void
  onRegenerate: () => void
  onDelete: () => void
}) {
  const { snippet, characters, generating, pendingCharacterIds, models, onViewContext, onRegenerate, onDelete } = props
  const [showVersions, setShowVersions] = useState(false)
  const [showCovered, setShowCovered] = useState(false)
  const isNarrator = snippet.characterIds.length === 1 && snippet.characterIds[0] === NARRATOR_ID
  const isSummary = snippet.kind === 'summary'

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
        {isSummary ? (
          <Tag icon={<VideoCameraTwoTone />} color="geekblue">
            剧情梳理 #{snippet.order} · {snippet.summaryView === 'first-person' ? '第一人称' : '第三群像'}
          </Tag>
        ) : (
          <Tag color={isNarrator ? 'default' : 'purple'}>
            {isNarrator ? '作者旁白' : `片段 #${snippet.order}`}
          </Tag>
        )}
        {isSummary && (
          <Tag color="default" style={{ fontSize: 11 }}>
            此片段之后的内容将作为后续剧情起点
          </Tag>
        )}
        {snippet.versions.length > 0 && !isSummary && (
          <Tag color="orange">已重跑 ×{snippet.versions.length}</Tag>
        )}
        {!isNarrator && !isSummary && (
          <>
            <Button size="small" type="text" icon={<ReloadOutlined />} onClick={onRegenerate} disabled={generating}>
              重跑
            </Button>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={onDelete} disabled={generating}>
              删除
            </Button>
          </>
        )}
        {(isNarrator || isSummary) && (
          <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={onDelete} disabled={generating}>
            删除
          </Button>
        )}
        {isSummary && (
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            disabled={generating}
            onClick={onRegenerate}
          >
            重新总结
          </Button>
        )}
      </div>


      {isSummary ? (
        <SummaryBubble
          snippet={snippet}
          characters={characters}
          modelName={models.find((md) => md.id === snippet.messages[0]?.modelId)?.name}
          generating={generating}
          onViewContext={onViewContext}
          onRegenerate={onRegenerate}
        />
      ) : isNarrator ? (
        <NarratorBubble content={snippet.messages[0]?.publicContent || ''} />
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {snippet.messages.map((m, i) => {
            const char = characters.find((c) => c.id === m.characterId)
            const isPartial = !!(m as { __partial?: boolean }).__partial
            return (
              <CharacterBubble
                key={i}
                message={m}
                character={char}
                streaming={generating && isPartial}
                modelName={models.find((md) => md.id === m.modelId)?.name}
                onViewContext={onViewContext}
              />
            )
          })}
          {/* 生成中：尚未开始生成的角色显示占位转圈 */}
          {generating && pendingCharacterIds && pendingCharacterIds
            .filter((id) => !snippet.messages.some((m) => m.characterId === id))
            .map((id) => {
              const char = characters.find((c) => c.id === id)
              return (
                <CharacterBubble
                  key={`pending_${id}`}
                  message={{ characterId: id, characterName: char?.name ?? '', publicContent: '', innerThought: '', modelId: '' }}
                  character={char}
                  streaming
                />
              )
            })}
        </Space>
      )}

      {snippet.versions.length > 0 && (
        <Collapse
          size="small"
          ghost
          style={{ marginTop: 8 }}
          activeKey={showVersions ? ['versions'] : []}
          onChange={(keys) => setShowVersions((keys as string[]).includes('versions'))}
          items={[{
            key: 'versions',
            label: <Text type="secondary" style={{ fontSize: 12 }}>历史版本（{snippet.versions.length}）</Text>,
            children: (
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                {snippet.versions.map((v, vi) => (
                  <div key={vi} style={{
                    padding: 8, background: '#FFFBEB', border: '1px dashed #FCD34D', borderRadius: 6,
                  }}>
                    <div style={{ fontSize: 11, color: '#92400E', marginBottom: 4 }}>
                      版本 {snippet.versions.length - vi} · {new Date(v.regeneratedAt).toLocaleString()}
                    </div>
                    {v.messages.map((m, mi) => {
                      const char = characters.find((c) => c.id === m.characterId)
                      const isNotice = isResultNotice(m.publicContent)
                      return (
                        <div key={mi} style={{
                          fontSize: 12, marginTop: 2,
                          padding: isNotice ? '2px 4px' : undefined,
                          background: isNotice ? '#FEF2F2' : undefined,
                          color: isNotice ? '#B91C1C' : '#6B7280',
                          borderRadius: isNotice ? 4 : undefined,
                        }}>
                          <strong>{char?.name || m.characterName}：</strong>{m.publicContent}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </Space>
            ),
          }]}
        />
      )}

      {/* <div style={{ height: 1, background: '#E5E7EB', marginTop: 12 }} /> */}
    </div>
  )
}

// ────────────────────────────────────────────────────────
// 气泡：角色发言
// ────────────────────────────────────────────────────────
// 是否为"模型返回为空 / 调用失败 / 拒绝生成"的结果提示片段
// （与后端 snippet-runner 的 EMPTY_RESULT_MARKER / ERROR_RESULT_PREFIX / REFUSED_RESULT_PREFIX 文案保持一致）
function isResultNotice(content?: string): boolean {
  if (!content) return false
  return content === '（模型返回为空，未生成台词）'
    || content.startsWith('（模型调用失败：')
    || content.startsWith('（模型拒绝生成：')
}

function CharacterBubble(props: {
  message: SnippetMessage
  character?: MergedCharacter
  streaming?: boolean
  modelName?: string
  onViewContext?: (modelMessages: string | null | undefined, name: string) => void
}) {
  const { message: m, character, streaming, modelName, onViewContext } = props
  const name = character?.name || m.characterName
  const initial = name.charAt(0)
  const isNotice = isResultNotice(m.publicContent)
  // 正在生成且该角色还没有任何内容：显示"正在生成"占位
  const showPlaceholder = !!streaming && !m.publicContent?.trim()

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: isNotice ? '#FEE2E2' : '#EEF2FF',
        color: isNotice ? '#DC2626' : '#4F46E5',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 600, flexShrink: 0,
      }}>
        {initial}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: isNotice ? '#DC2626' : '#6B7280', marginBottom: 2 }}>
          <span>{name}</span>
          {streaming && <Spin size="small" />}
        </div>
        <div style={{
          display: 'inline-block', maxWidth: '100%', padding: '8px 12px',
          background: isNotice ? '#FEF2F2' : '#fff',
          border: isNotice ? '1px solid #FCA5A5' : '0px solid #E5E7EB',
          borderRadius: '0',
          fontSize: 14, color: isNotice ? '#B91C1C' : '#111827', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {m.reasoning && (
            <div style={{ marginTop: 4, marginBottom: 4, maxWidth: '100%' }}>
              <details style={{ borderRadius: 0, background: '#FFFFFF' }}>
                <summary style={{
                  cursor: 'pointer', padding: '0',
                  fontSize: 13, color: '#8B5CF6', userSelect: 'none',
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  listStyle: 'none',
                }}>
                  <span>思考过程（{m.reasoning.length} 字）</span>
                </summary>
                <div style={{
                  padding: '6px 8px',
                  background: '#FFFFFF',
                  color: '#374151',
                  fontSize: 13, lineHeight: 1.6,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  maxHeight: 240, overflowY: 'auto',
                  borderRadius: 0,
                }}>
                  {m.reasoning}
                </div>
              </details>
            </div>
          )}
          {showPlaceholder
            ? <span style={{ color: '#9CA3AF' }}>正在生成角色台词…</span>
            : m.publicContent}
        </div>
        {m.errorNotice && (
          <div style={{
            display: 'inline-block', maxWidth: '100%', marginTop: 4, padding: '6px 10px',
            background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '0',
            fontSize: 12, color: '#B91C1C', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {m.errorNotice}
          </div>
        )}
        {/* 底部：token 统计徽标 + 查看上下文 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4, marginTop: 4 }}>
          {m.usage ? renderTokenBadge(m.usage, modelName) : <span />}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {m.modelMessages && (
              <Tooltip title="查看上下文">
                <Button
                  type="text"
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={() => onViewContext?.(m.modelMessages, name)}
                  style={{ height: 22, padding: '0 6px', fontSize: 12, color: '#6B7280' }}
                />
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────
// 气泡：剧情梳理（summary 片段）
// 视觉：渐变背景 + 边框，明显区别于普通片段；正文居中显示 consolidatedContent；
// 底部：token 徽标 + 查看上下文按钮（与 CharacterBubble 一致）；
// 上方：可折叠查看"参与本次总结的片段列表"。
// ────────────────────────────────────────────────────────
function SummaryBubble(props: {
  snippet: RoleDialogueSnippet
  characters: MergedCharacter[]
  modelName?: string
  generating?: boolean
  onViewContext?: (modelMessages: string | null | undefined, name: string) => void
  onRegenerate: () => void
}) {
  const { snippet, characters, modelName, generating, onViewContext, onRegenerate } = props
  const [open, setOpen] = useState(false)
  const [reasoningOpen, setReasoningOpen] = useState(false)
  const viewName = snippet.messages[0]?.characterName || (snippet.summaryView === 'third-person' ? '旁白视角' : '主角')
  const content = snippet.messages[0]?.publicContent || ''
  const reasoning = snippet.messages[0]?.reasoning || ''
  const messageUsage = snippet.messages[0]?.usage || null
  const modelMessages = snippet.messages[0]?.modelMessages

  // 从已加载的 snippets 缓存中找被覆盖的片段（外部通过 props 不便取 store；改用 useRoleDialogueStore）
  const allSnippets = useRoleDialogueStore((s) => s.snippetsByRun[snippet.runId] || [])
  const coveredSnippets = (snippet.summaryCoveredSnippetIds || [])
    .map((id) => allSnippets.find((s) => s.id === id))
    .filter(Boolean) as RoleDialogueSnippet[]

  return (
    <div>
      {/* 「参与本次总结的片段」—— 放在卡片上方（与 CharacterBubble 的 token 徽标位置对齐：token 在下，列表在上） */}
      {coveredSnippets.length > 0 && (
        <div style={{ maxWidth: 720, margin: '0 auto 6px' }}>
          <Collapse
            size="small"
            ghost
            activeKey={open ? ['covered'] : []}
            onChange={(keys) => setOpen((keys as string[]).includes('covered'))}
            items={[{
              key: 'covered',
              label: (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  参与本次总结的片段（{coveredSnippets.length}）
                </Text>
              ),
              children: (
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  {coveredSnippets.map((s) => {
                    const lines = s.messages
                      .filter((m) => m.publicContent && m.publicContent.trim())
                      .map((m) => {
                        const char = characters.find((c) => c.id === m.characterId)
                        return (
                          <div key={m.characterId} style={{ fontSize: 12, color: '#4B5563' }}>
                            <strong style={{ color: '#6D28D9' }}>{char?.name || m.characterName}：</strong>
                            <span style={{ marginLeft: 4 }}>{m.publicContent}</span>
                          </div>
                        )
                      })
                    return (
                      <div key={s.id} style={{
                        padding: '6px 10px',
                        background: '#F9FAFB',
                        border: '1px solid #E5E7EB',
                        borderRadius: 6,
                      }}>
                        <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 2 }}>
                          片段 #{s.order}
                        </div>
                        {lines}
                      </div>
                    )
                  })}
                </Space>
              ),
            }]}
          />
        </div>
      )}

      <div
        style={{
          padding: '14px 18px',
          margin: '4px auto',
          maxWidth: 720,
          background: 'linear-gradient(135deg, #EEF2FF 0%, #FAE8FF 100%)',
          border: '1px solid #C7D2FE',
          borderRadius: 10,
          boxShadow: '0 1px 4px rgba(99,102,241,0.10)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#6B21A8', marginBottom: 8 }}>
          <ReadOutlined />
          <span style={{ fontWeight: 600 }}>{viewName} · 剧情片段</span>
        </div>
        {/* 思考过程折叠区放在标题下（紧邻标题）—— 与 CharacterBubble 的位置习惯一致 */}
        {reasoning && (
          <div style={{ marginBottom: 8 }}>
            <div
              onClick={(e) => { e.stopPropagation(); setReasoningOpen((v) => !v) }}
              style={{
                cursor: 'pointer', fontSize: 13, color: '#8B5CF6',
                display: 'inline-flex', alignItems: 'center', gap: 4, userSelect: 'none',
              }}
            >
              <span>思考过程（{reasoning.length} 字）</span>
            </div>
            {reasoningOpen && (
              <div style={{
                marginTop: 6, padding: '8px 12px',
                background: 'rgba(255,255,255,0.6)',
                color: '#374151',
                fontSize: 13, lineHeight: 1.6,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                maxHeight: 240, overflowY: 'auto',
                borderRadius: 6,
              }}>
                {reasoning}
              </div>
            )}
          </div>
        )}
        <div style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: '#1F2937',
          fontSize: 14,
          lineHeight: 1.85,
        }}>
          {content || (generating ? (
            <span style={{ color: '#9CA3AF', fontStyle: 'italic' }}>
              <Spin size="small" style={{ marginRight: 8 }} />
              等待模型响应...
            </span>
          ) : '')}
        </div>
        {/* 生成中占位（仅在已经有内容时才显示，避免与"等待模型响应"占位重复） */}
        {generating && content && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#6B7280', fontSize: 13 }}>
            <Spin size="small" />
            <span>正在生成新片段...</span>
          </div>
        )}
      </div>
      {/* 卡片外底部：1. 错误信息（红色块，优先）；2. token 统计徽标 + 查看上下文按钮（同一行） */}
      {snippet.messages[0]?.errorNotice && (
        <div style={{ maxWidth: 720, margin: '6px auto 0' }}>
          <div style={{
            padding: '6px 10px',
            background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6,
            fontSize: 12, color: '#B91C1C', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {snippet.messages[0].errorNotice}
          </div>
        </div>
      )}
      {/* 卡片外底部：
          - 有 token 详情时：左侧 token 徽标 + 右侧查看上下文按钮（justify-content: space-between）
          - 没 token 详情时：只显示查看上下文按钮（justify-content: flex-end 顶到右边） */}
      {(messageUsage || modelMessages) && (
        <div style={{
          maxWidth: 720,
          margin: '4px auto 0',
          display: 'flex',
          justifyContent: messageUsage ? 'space-between' : 'flex-end',
          alignItems: 'center',
          gap: 4,
        }}>
          {messageUsage && <div>{renderTokenBadge(messageUsage, modelName)}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {modelMessages && (
              <Tooltip title="查看上下文">
                <Button
                  type="text"
                  size="small"
                  icon={<EyeOutlined />}
                  onClick={(e) => {
                    e.stopPropagation()
                    onViewContext?.(modelMessages, '剧情梳理')
                  }}
                  style={{ height: 22, padding: '0 6px', fontSize: 12, color: '#6B7280' }}
                />
              </Tooltip>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────
// 气泡：作者旁白
// ────────────────────────────────────────────────────────
function NarratorBubble(props: { content: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
      <div style={{
        maxWidth: '70%', padding: '8px 14px',
        background: '#F3F4F6', border: '0px solid #E5E7EB', borderRadius: 10,
        fontSize: 13, color: '#4B5563', lineHeight: 1.7, textAlign: 'center'
      }}>
        {props.content}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────
// 右侧栏：入场角色卡片
// ────────────────────────────────────────────────────────
// 与「角色聊天室」的角色卡片视觉与操作保持一致：
//   - 22×22 圆形序号（colorFor 颜色，截断的角色名）
//   - 头部操作：↑↓（剧情预演特性，排序）+ 🗨 让 TA 单独演一段 + ✕ 移除
//   - model 选择器（allowClear，「使用房间默认 / 知卷默认」）
//   - 折叠区：角色最后状态（默认折叠，与 ChatRoom 同源同解析）
//   - 拖拽重排（与 ChatRoom 一致）
const CARD_COLORS = ['#4F46E5', '#16A34A', '#DB2777', '#D97706', '#0891B2', '#7C3AED', '#DC2626', '#059669']
function colorForCharacter(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return CARD_COLORS[h % CARD_COLORS.length]
}

function InSceneCharacterCard(props: {
  character: MergedCharacter
  index: number
  total: number
  modelId: string | null
  models: Array<{ id: string; name: string }>
  onRemove: () => void
  onSpeak?: () => void
  onModelChange: (modelId: string | null) => void
  snippets: RoleDialogueSnippet[]
  // 角色最后状态文本（与「角色聊天室」同源：bookMemory 定稿记忆，逐行「字段：值」格式）
  lastStateText: string
  // 拖拽：拖动期间由父组件统一管理，card 自身只提供 data 属性 + 状态标记
  draggable?: boolean
  onDragStart?: () => void
  isDragging?: boolean
}) {
  const {
    character, index, total, modelId, models,
    onRemove, onSpeak, onModelChange, snippets,
    lastStateText, draggable, onDragStart, isDragging,
  } = props
  const [stateOpen, setStateOpen] = useState<string[]>([])
  const expanded = stateOpen.includes('state')
  const cardColor = colorForCharacter(character.id)

  return (
    <div
      data-role-dialogue-card={character.id}
      draggable={draggable}
      onDragStart={onDragStart}
      style={{
        marginBottom: 10,
        padding: 10,
        borderRadius: 10,
        border: '1px solid #EEF0F3',
        background: '#FBFBFD',
        cursor: draggable ? 'grab' : 'default',
        opacity: isDragging ? 0.5 : 1,
      }}
    >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: cardColor,
              color: '#fff',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {index + 1}
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 14,
              fontWeight: 500,
              color: '#111827',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {character.name}
          </span>
          {/* 「让 TA 单独演一段」-- 在最后一个片段里追加一条该角色的新发言；没有片段则新建片段 */}
          {onSpeak && (
            <Tooltip title="让 TA 单独演一段">
              <Button
                type="text"
                size="small"
                icon={<CommentOutlined />}
                onClick={onSpeak}
                style={{ flexShrink: 0 }}
              />
            </Tooltip>
          )}
          <span
            style={{ color: '#9CA3AF', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}
            onClick={onRemove}
            title="移出在场角色"
          >
            ✕
          </span>
        </div>

        {/* 角色级 model 偏好（与「角色聊天室」同结构） */}
        <Select
          size="small"
          value={modelId || undefined}
          onChange={(v) => onModelChange(v || null)}
          placeholder="使用房间默认"
          allowClear
          style={{ width: '100%', marginTop: 6 }}
          options={models.map((m) => ({ value: m.id, label: modelFullName(m) }))}
          onClick={(e) => e.stopPropagation()}
        />

        {/* 角色最后状态（与「角色聊天室」同源同解析，卡片内折叠，默认折叠） */}
        <div
          style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setStateOpen(expanded ? [] : ['state'])}
        >
          <span style={{ fontSize: 12, color: '#6B7280' }}>
            {expanded ? '收起角色最后状态' : '查看角色最后状态'}
          </span>
          <span style={{ fontSize: 10, color: '#9CA3AF' }}>{expanded ? '▲' : '▼'}</span>
        </div>

        {expanded && (
          <div style={{ marginTop: 8 }}>
            <div
              style={{
                fontSize: 12,
                color: '#374151',
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                background: '#F3F4F6',
                padding: '8px 10px',
                borderRadius: 8,
              }}
            >
              {lastStateText.split('\n').map((line, i) => {
                const sep = line.indexOf('：')
                if (sep > 0) {
                  return (
                    <div key={i}>
                      <strong style={{ fontWeight: 600, color: '#1F2937', whiteSpace: 'nowrap' }}>
                        {line.slice(0, sep)}：
                      </strong>
                      {line.slice(sep + 1)}
                    </div>
                  )
                }
                return (
                  <div key={i} style={{ color: sep === 0 ? '#9CA3AF' : undefined }}>{line}</div>
                )
              })}
            </div>
          </div>
        )}
      </div>
  )
}

// ────────────────────────────────────────────────────────
// 弹窗：房间表单
// ────────────────────────────────────────────────────────
function RoomFormModal(props: {
  open: boolean
  editing: RoleDialogueRoom | null
  chapters: Array<{ id: string; title: string }>
  models: Array<{ id: string; name: string }>
  onCancel: () => void
  onSubmit: (values: any) => void
}) {
  const { open, editing, chapters, models, onCancel, onSubmit } = props
  const [form] = Form.useForm()

  useEffect(() => {
    if (open) {
      form.setFieldsValue(editing ? {
        title: editing.title,
        situation: editing.situation,
        chapterId: editing.chapterId,
        defaultModelId: editing.defaultModelId,
        injectWritingSettings: editing.injectWritingSettings,
      } : {
        injectWritingSettings: true,
        defaultModelId: undefined,
        chapterId: undefined,
      })
    }
  }, [open, editing, form])

  return (
    <Modal
      title={editing ? `编辑房间 · ${editing.title}` : '新建房间'}
      open={open}
      onCancel={onCancel}
      footer={null}
      width={640}
      centered
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Form.Item name="title" label="房间标题" rules={[{ required: true }]}>
          <Input placeholder="例：第 3 章 · 客栈夜谈" />
        </Form.Item>
        <Form.Item name="situation" label="开局情境（导演说戏）" rules={[{ required: true }]}>
          <TextArea rows={4} placeholder="描述时间、地点、大致局势、角色任务等" style={{ resize: 'none' }} />
        </Form.Item>
        <Form.Item name="chapterId" label="锚定章节（可选 — 预演会拉取该章大纲/已写正文/记忆）">
          <Select allowClear placeholder="不锚定" options={chapters.map((c) => ({ value: c.id, label: c.title }))} />
        </Form.Item>
        <Form.Item name="defaultModelId" label="默认 model（兜底 — 角色级偏好会覆盖这里）">
          <Select allowClear placeholder="使用知卷默认" options={models.map((m) => ({ value: m.id, label: modelFullName(m) }))} />
        </Form.Item>
        <Form.Item name="injectWritingSettings" valuePropName="checked">
          <Checkbox>注入写作设置（POV / 文风 / 禁忌）</Checkbox>
        </Form.Item>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" htmlType="submit">{editing ? '保存' : '创建'}</Button>
        </div>
      </Form>
    </Modal>
  )
}

// ────────────────────────────────────────────────────────
// 弹窗：房间历史
// ────────────────────────────────────────────────────────
function RoomHistoryModal(props: {
  open: boolean
  rooms: RoleDialogueRoom[]
  runsByRoom: Record<string, RoleDialogueRun[]>
  snippetsByRun: Record<string, RoleDialogueSnippet[]>
  currentRoomId: string | null
  loading?: boolean
  onCancel: () => void
  onSwitch: (roomId: string) => void
  onDelete: (roomId: string) => void
}) {
  const { open, rooms, runsByRoom, snippetsByRun, currentRoomId, loading, onCancel, onSwitch, onDelete } = props
  return (
    <Modal
      title="房间历史（点击切换）"
      open={open}
      onCancel={onCancel}
      footer={null}
      width={760}
      centered
    >
      {rooms.length === 0 ? (
        <Empty description="还没有房间" />
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '8px 0' }}>
              <Spin size="small" tip="正在加载 Run / 片段 统计..." />
            </div>
          )}
          {rooms.map((r) => {
            const runs = runsByRoom[r.id] || []
            const snippetCount = runs.reduce((sum, run) => {
              return sum + (snippetsByRun[run.id]?.length || 0)
            }, 0)
            return (
              <div
                key={r.id}
                style={{
                  padding: 12, background: currentRoomId === r.id ? '#F5F3FF' : '#FAFAFA',
                  border: currentRoomId === r.id ? '1px solid #8B5CF6' : '1px solid #E5E7EB',
                  borderRadius: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <Text strong style={{ fontSize: 14 }}>{r.title}</Text>
                      {currentRoomId === r.id && <Tag color="purple" style={{ marginLeft: 4 }}>当前</Tag>}
                      {r.injectWritingSettings && <Tag color="purple">注入写作</Tag>}
                    </div>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                      {r.situation.slice(0, 80)}{r.situation.length > 80 ? '...' : ''}
                    </Text>
                    <Space size={4} wrap>
                      <Tag>{runs.length} 个 Run</Tag>
                      <Tag color="blue">{snippetCount} 个片段</Tag>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        更新于 {new Date(r.updatedAt).toLocaleString()}
                      </Text>
                    </Space>
                  </div>
                  <Space>
                    <Button
                      type={currentRoomId === r.id ? 'default' : 'primary'}
                      size="small"
                      onClick={() => onSwitch(r.id)}
                      disabled={currentRoomId === r.id}
                    >
                      {currentRoomId === r.id ? '当前' : '切换'}
                    </Button>
                    <Button
                      danger size="small" icon={<DeleteOutlined />}
                      onClick={() => onDelete(r.id)}
                    />
                  </Space>
                </div>
              </div>
            )
          })}
        </Space>
      )}
    </Modal>
  )
}
