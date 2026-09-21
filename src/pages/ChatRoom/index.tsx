/**
 * 角色聊天室页面
 *
 * 布局（三栏，左右侧边栏均可折叠 / 拖拽调整宽度）：
 *   - 左侧：聊天室房间列表（新建 / 选择 / 删除 / 编辑）
 *   - 中侧：聊天主区
 *      头部：房间标题 + 房间设置 + 一键清空聊天记录
 *      聊天区：消息气泡（导演右对齐 / 角色左对齐 + 颜色头像），支持真·逐字流式
 *      输入区：输入框内嵌发送按钮
 *   - 右侧：角色列表面板（可拖拽排序、随时增删；"角色最后状态"默认折叠）
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
  Button,
  Modal,
  Input,
  InputNumber,
  Select,
  Segmented,
  message as antdMessage,
  Tooltip,
  Empty,
  Spin,
  Popconfirm,
  Collapse,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  SettingOutlined,
  ClearOutlined,
  SendOutlined,
  MessageOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  TeamOutlined,
  CommentOutlined,
  EyeOutlined,
  BulbOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons'
import { useChatRoomStore } from '@/stores/chatRoom.store'
import type { ChatRoomMessageUsage, ChatRoomRoom, ChatRoomSender, ModelProvider } from '@/types/api'
import { modelFullName } from '@/utils/providers'
import { AddCharactersModal } from '@/components/AddCharactersModal'

const COLORS = ['#4F46E5', '#16A34A', '#DB2777', '#D97706', '#0891B2', '#7C3AED', '#DC2626', '#059669']

const CHAT_ROOM_UI_STATE_KEY = 'ainovel.chatRoom.uiState'
const LEFT_MIN_WIDTH = 180
const LEFT_MAX_WIDTH = 360
const LEFT_DEFAULT_WIDTH = 240
const RIGHT_MIN_WIDTH = 220
const RIGHT_MAX_WIDTH = 420
const RIGHT_DEFAULT_WIDTH = 300
const COLLAPSED_WIDTH = 48

function colorFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

// 是否为"模型返回为空 / 调用失败 / 拒绝生成"的结果提示片段
// （与后端 chat-runner 的 EMPTY_RESULT_MARKER / ERROR_RESULT_PREFIX / REFUSED_RESULT_PREFIX 文案保持一致）
function isResultNotice(content?: string): boolean {
  if (!content) return false
  return content === '（模型返回为空，未生成台词）'
    || content.startsWith('（模型调用失败：')
    || content.startsWith('（模型拒绝生成：')
}

function initials(name: string): string {
  return (name || '?').trim().slice(0, 1)
}

// 拖拽排序时实时让出占位（不再用插入线指示：拖到哪 tag 就在哪，松开即定型）

/** 金额格式化：过小用科学计数法，否则固定小数位 */
function formatCost(v: number, digits = 4): string {
  if (!v) return '0'
  if (v < 0.0001) return v.toExponential(2)
  return v.toFixed(digits)
}

/** 单条聊天消息的 token 消耗徽标（hover 看 Agent 面板风格明细） */
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

export default function ChatRoomPage() {
  const { bookId } = useParams<{ bookId: string }>()
  const {
    rooms,
    currentRoomId,
    participants,
    messages,
    selectableCharacters,
    characterMemoryStates,
    loading,
    generating,
    error,
    loadRooms,
    createRoom,
    updateRoom,
    deleteRoom,
    setCurrentRoom,
    addParticipant,
    removeParticipant,
    reorderParticipants,
    clearMessages,
    sendTurn,
    characterSpeak,
    deleteMessage,
    initListeners,
    resetAll,
    clearError,
  } = useChatRoomStore()

  const [models, setModels] = useState<ModelProvider[]>([])
  // 角色级 model 偏好：characterId → modelId（null = 走房间默认 / 知卷默认）
  const [characterModels, setCharacterModels] = useState<Record<string, string | null>>({})
  const [roomModalOpen, setRoomModalOpen] = useState(false)
  const [editingRoom, setEditingRoom] = useState<ChatRoomRoom | null>(null)
  const [roomForm, setRoomForm] = useState({
    title: '',
    defaultModelId: null as string | null,
    speakingMode: 'sequential' as 'sequential' | 'simultaneous',
    historyLimit: 50,
    displayLimit: 15,
  })
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [contextModal, setContextModal] = useState<{ open: boolean; title: string; messages: Array<{ role: string; content: string }> | null }>({ open: false, title: '', messages: null })
  // 拖动期间的"虚拟顺序"：拖到哪它就显示在哪，避免每帧调 IPC；
  // null 表示没在拖动，渲染走原始 participants。dragend 时一次性提交给 store。
  const [dragOrder, setDragOrderState] = useState<string[] | null>(null)
  const [dragId, setDragIdState] = useState<string | null>(null)
  // 同步 ref：document.dragend / window.mouseup 兑底里读取最新值，
  // 避免 useEffect 异步同步 ref 引起的 race（mouseup 可能在 useEffect 之前触发）
  const dragOrderRef = useRef<string[] | null>(null)
  const dragIdRef = useRef<string | null>(null)
  // 包装 setState：调用即同步写 ref，跨 setDragOrder / setDragId 一致
  const setDragOrder = (next: string[] | null | ((prev: string[] | null) => string[] | null)) => {
    setDragOrderState((prev) => {
      const v = typeof next === 'function' ? (next as (p: string[] | null) => string[] | null)(prev) : next
      dragOrderRef.current = v
      return v
    })
  }
  const setDragId = (next: string | null | ((prev: string | null) => string | null)) => {
    setDragIdState((prev) => {
      const v = typeof next === 'function' ? (next as (p: string | null) => string | null)(prev) : next
      dragIdRef.current = v
      return v
    })
  }
  const [expandedChars, setExpandedChars] = useState<Record<string, boolean>>({})
  // 历史展示上限之外额外加载的条数（点击"加载更多"累加），用于分批次展示更早的消息
  const [extraLoaded, setExtraLoaded] = useState(0)

  const [uiState] = useState(() => {
    try {
      const raw = localStorage.getItem(CHAT_ROOM_UI_STATE_KEY)
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })
  const [leftCollapsed, setLeftCollapsed] = useState(uiState.leftCollapsed ?? false)
  const [leftWidth, setLeftWidth] = useState(uiState.leftWidth ?? LEFT_DEFAULT_WIDTH)
  const [rightCollapsed, setRightCollapsed] = useState(uiState.rightCollapsed ?? false)
  const [rightWidth, setRightWidth] = useState(uiState.rightWidth ?? RIGHT_DEFAULT_WIDTH)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const isResizingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)
  const resizingSideRef = useRef<'left' | 'right' | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(
        CHAT_ROOM_UI_STATE_KEY,
        JSON.stringify({ leftCollapsed, leftWidth, rightCollapsed, rightWidth }),
      )
    } catch { }
  }, [leftCollapsed, leftWidth, rightCollapsed, rightWidth])

  useEffect(() => {
    initListeners()
  }, [initListeners])

  // 数据管理「清空角色聊天室数据」后，重置当前页所有状态
  useEffect(() => {
    const onCleared = () => resetAll()
    window.addEventListener('chat-room-cleared', onCleared)
    return () => window.removeEventListener('chat-room-cleared', onCleared)
  }, [resetAll])

  // 容器 ref：拖动期间用 Y 坐标实时重排 dragOrder
  const characterListRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!bookId) return
    loadRooms(bookId)
    window.api.model.list().then(setModels).catch(() => { })
  }, [bookId, loadRooms])

  // 同步角色级 model 偏好：监听 participants 变化时拉取每个角色的偏好。
  // 与 RoleDialogue 的 setCharacterModels 行为一致。
  // 切换房间时清空旧数据，再加载新房间的偏好。
  useEffect(() => {
    if (!bookId || !currentRoomId) {
      setCharacterModels({})
      return
    }
    // 切换房间：清空旧值
    setCharacterModels({})
    if (participants.length === 0) return
    const cids = participants.map((p) => p.characterId)
    let cancelled = false
    Promise.all(
      cids.map(async (cid) => {
        const m = await window.api.chatRoom.getCharacterModel(bookId, cid)
        return { cid, mid: m?.modelId ?? null }
      }),
    ).then((pairs) => {
      if (cancelled) return
      const map: Record<string, string | null> = {}
      for (const { cid, mid } of pairs) map[cid] = mid
      setCharacterModels(map)
    }).catch(() => { /* 拉取失败不阻塞 UI */ })
    return () => { cancelled = true }
  }, [bookId, currentRoomId, participants])

  // ─── 角色级 model 偏好设置 ───
  const handleSetCharacterModel = async (characterId: string, modelId: string | null) => {
    if (!bookId) return
    await window.api.chatRoom.setCharacterModel(bookId, characterId, modelId)
    setCharacterModels((s) => ({ ...s, [characterId]: modelId }))
  }

  // 首次进入自动选中第一个房间
  useEffect(() => {
    if (rooms.length > 0 && (!currentRoomId || !rooms.some((r) => r.id === currentRoomId))) {
      setCurrentRoom(rooms[0].id)
    }
    if (rooms.length === 0 && currentRoomId) {
      setCurrentRoom(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (error) {
      antdMessage.error(error)
      clearError()
    }
  }, [error, clearError])

  const currentRoom = useMemo(
    () => rooms.find((r) => r.id === currentRoomId) ?? null,
    [rooms, currentRoomId],
  )

  // 分批展示：界面默认只渲染最近 displayLimit 条，更早的消息通过"加载更多"逐步展开
  const displayLimit = currentRoom?.displayLimit ?? 15
  const shownCount = Math.min(messages.length, displayLimit + extraLoaded)
  const hasMoreHistory = messages.length > shownCount
  const visibleMessages = useMemo(() => messages.slice(-shownCount), [messages, shownCount])
  // 切换聊天室或调整展示条数时，重置额外加载量，回到"仅展示最近 N 条"
  useEffect(() => { setExtraLoaded(0) }, [currentRoomId, displayLimit])

  // 房间累计 token 消耗（统计全部消息，不限于界面展示的最近 N 条）
  const roomUsageTotals = useMemo(() => {
    let tokens = 0
    let cost = 0
    for (const m of messages) {
      if (m.usage) {
        tokens += m.usage.totalTokens || m.usage.promptTokens + m.usage.completionTokens
        cost += m.usage.cost
      }
    }
    return { tokens, cost }
  }, [messages])

  const availableCharacters = useMemo(
    () => selectableCharacters.filter((c) => !participants.some((p) => p.characterId === c.id)),
    [selectableCharacters, participants],
  )

  // ─── 侧边栏：拖拽调整宽度 ───
  const handleResizeStart = useCallback(
    (side: 'left' | 'right', e: React.MouseEvent) => {
      e.preventDefault()
      resizingSideRef.current = side
      isResizingRef.current = true
      startXRef.current = e.clientX
      startWidthRef.current = side === 'left' ? leftWidth : rightWidth
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const handleMove = (ev: MouseEvent) => {
        if (!isResizingRef.current) return
        const delta = ev.clientX - startXRef.current
        if (side === 'left') {
          const w = Math.min(LEFT_MAX_WIDTH, Math.max(LEFT_MIN_WIDTH, startWidthRef.current + delta))
          setLeftWidth(w)
        } else {
          // 右侧 handle 在面板左边缘，向左拖动（delta 负）则面板变宽
          const w = Math.min(RIGHT_MAX_WIDTH, Math.max(RIGHT_MIN_WIDTH, startWidthRef.current - delta))
          setRightWidth(w)
        }
      }

      const handleUp = () => {
        isResizingRef.current = false
        resizingSideRef.current = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        window.removeEventListener('mousemove', handleMove)
        window.removeEventListener('mouseup', handleUp)
      }

      window.addEventListener('mousemove', handleMove)
      window.addEventListener('mouseup', handleUp)
    },
    [leftWidth, rightWidth],
  )

  // ─── 房间：新建 / 编辑 ───
  const openCreateRoom = () => {
    setEditingRoom(null)
    setRoomForm({ title: '', defaultModelId: null, speakingMode: 'sequential', historyLimit: 50, displayLimit: 15 })
    setRoomModalOpen(true)
  }
  const openEditRoom = (room: ChatRoomRoom) => {
    setEditingRoom(room)
    setRoomForm({
      title: room.title,
      defaultModelId: room.defaultModelId,
      speakingMode: room.speakingMode ?? 'sequential',
      historyLimit: room.historyLimit ?? 50,
      displayLimit: room.displayLimit ?? 15,
    })
    setRoomModalOpen(true)
  }
  const handleSaveRoom = async () => {
    if (!roomForm.title.trim()) {
      antdMessage.warning('请填写聊天室名称')
      return
    }
    if (!bookId) return
    try {
      if (editingRoom) {
        await updateRoom(editingRoom.id, roomForm)
      } else {
        const room = await createRoom({ ...roomForm, bookId })
        if (room) await setCurrentRoom(room.id)
      }
      setRoomModalOpen(false)
    } catch {
      antdMessage.error('保存失败')
    }
  }

  // ─── 角色：拖拽排序 ───
  // 用 Y 坐标找最接近的目标 card（不依赖 e.target，永远准确）：
  //   - 鼠标 Y 在第一个 card 中心之上 → before 第一个
  //   - 鼠标 Y 在最后一个 card 中心之下 → after 最后一个
  //   - 否则找中心 Y 最接近的 card，pos 由上下决定
  const findDropTargetByY = (clientY: number, order: string[]): { id: string; pos: 'before' | 'after' } | null => {
    if (!characterListRef.current) return null
    const cardEls = characterListRef.current.querySelectorAll<HTMLElement>('[data-chatroom-participant]')
    if (cardEls.length === 0) return null
    const metas: Array<{ id: string; centerY: number }> = []
    cardEls.forEach((el) => {
      const r = el.getBoundingClientRect()
      const id = el.getAttribute('data-chatroom-participant')
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
  // 拖动期间实时重排（本地 state，不打 IPC）：把 source 从 list 抽出，按 pos 插入 target 附近
  // 当目标位置与当前位置一致时 return list，避免每帧 setState
  const reorderLocal = (order: string[], sourceId: string, targetId: string, pos: 'before' | 'after'): string[] => {
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
  // dragend 提交：把拖动期间的最终顺序一次性写入数据库
  const commitReorder = (finalOrder: string[]) => {
    if (!currentRoomId) return
    reorderParticipants(currentRoomId, finalOrder)
  }

  // ─── 角色：添加（复用剧情预演的「添加角色」弹窗，支持拖拽排序；提交的顺序即加入顺序）───
  const handleAddParticipants = async (characterIds: string[]) => {
    if (!currentRoomId) return
    for (const cid of characterIds) {
      await addParticipant(currentRoomId, cid)
    }
    setAddModalOpen(false)
  }

  // ─── 清空聊天记录 ───
  const handleClear = async () => {
    if (!currentRoomId) return
    try {
      await clearMessages(currentRoomId)
      antdMessage.success('聊天记录已清空')
    } catch {
      antdMessage.error('清空失败')
    }
  }

  const [inputValue, setInputValue] = useState('')
  // 发送者身份选择：author | char:${characterId}
  const [senderKey, setSenderKey] = useState('author')
  // 输入框 DOM 引用：用于在不该失焦的时机（一轮生成结束后）把焦点还给输入框
  const inputRef = useRef<any>(null)
  const prevGenerating = useRef(generating)
  useEffect(() => {
    // 一轮角色发言刚结束（generating true→false）：自动聚焦输入框，避免每轮都要重新点输入框
    if (prevGenerating.current && !generating) {
      inputRef.current?.focus()
    }
    prevGenerating.current = generating
  }, [generating])

  const senderFromKey = useCallback((key: string): ChatRoomSender => {
    if (key.startsWith('char:')) {
      const characterId = key.slice(5)
      const p = participants.find((x) => x.characterId === characterId)
      return { role: 'character', characterId, characterName: p?.characterName || '' }
    }
    if (key === 'author') return { role: key }
    return { role: 'author' }
  }, [participants])

  useEffect(() => {
    if (senderKey.startsWith('char:') && !participants.some((p) => `char:${p.characterId}` === senderKey)) {
      setSenderKey('author')
    }
  }, [participants, senderKey])

  const handleSend = (text: string) => {
    if (!text.trim() || participants.length === 0) {
      antdMessage.warning(participants.length === 0 ? '请先添加在场角色' : '请输入内容')
      return
    }
    sendTurn(text, senderFromKey(senderKey))
  }

  const openContext = (m: any) => {
    if (!m?.modelMessages) return
    try {
      const parsed = JSON.parse(m.modelMessages)
      setContextModal({ open: true, title: m.characterName || '角色', messages: Array.isArray(parsed) ? parsed : [] })
    } catch {
      antdMessage.error('上下文数据解析失败')
    }
  }

  // ─── 左侧：展开态房间列表 ───
  const renderRoomList = () => (
    <>
      <div style={{ padding: '16px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>角色聊天室</div>
        <Tooltip title="新建聊天室">
          <Button type="text" icon={<PlusOutlined />} onClick={openCreateRoom} />
        </Tooltip>
      </div>
      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
        {loading && (
          <div style={{ padding: 16, color: '#9CA3AF' }}>
            <Spin size="small" /> 加载中…
          </div>
        )}
        {!loading && rooms.length === 0 && (
          <div style={{ padding: 16, color: '#9CA3AF', fontSize: 13 }}>还没有聊天室，点右上角 + 新建。</div>
        )}
        {rooms.map((room) => (
          <div
            key={room.id}
            onClick={() => setCurrentRoom(room.id)}
            style={{
              padding: '10px 12px',
              marginBottom: 4,
              borderRadius: 8,
              cursor: 'pointer',
              background: room.id === currentRoomId ? '#EEF2FF' : 'transparent',
              border: room.id === currentRoomId ? '1px solid #C7D2FE' : '1px solid transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 14,
                  color: '#111827',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {room.title}
              </div>
            </div>
            <Popconfirm
              title="删除该聊天室？"
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => deleteRoom(room.id)}
            >
              <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
            </Popconfirm>
          </div>
        ))}
      </div>
    </>
  )

  // ─── 右侧：展开态角色面板 ───
  const renderCharacterPanel = () => (
    <>
      <div style={{ padding: '16px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>在场角色</div>
        <Button
          size="small"
          type="dashed"
          icon={<PlusOutlined />}
          onClick={() => setAddModalOpen(true)}
          disabled={!currentRoom || availableCharacters.length === 0}
        >
          添加角色
        </Button>
      </div>
      <div
        ref={characterListRef}
        className="hide-scrollbar"
        style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 16px' }}
        onDragOver={(e) => {
          // 容器接收 drop + 拖动期间用 Y 坐标实时重排（让出真位置）
          e.preventDefault()
          if (!dragId || !currentRoom || participants.length === 0) return
          const order = dragOrder ?? participants.map((p) => p.id)
          const t = findDropTargetByY(e.clientY, order)
          if (!t || t.id === dragId) return
          const next = reorderLocal(order, dragId, t.id, t.pos)
          if (next !== order) setDragOrder(next)
        }}
        onDrop={(e) => {
          // 拖动期间已实时重排；drop 时不重复提交，dragend 会统一提交
          e.preventDefault()
        }}
      >
        {!currentRoom && <div style={{ padding: 12, color: '#9CA3AF', fontSize: 13 }}>请先选择聊天室</div>}
        {currentRoom && participants.length === 0 && (
          <div style={{ padding: 12, color: '#9CA3AF', fontSize: 13 }}>还没有在场角色，点右上角“添加角色”。</div>
        )}
        {currentRoom &&
          (dragOrder
            ? dragOrder.map((pid) => participants.find((p) => p.id === pid)).filter((p): p is typeof participants[number] => !!p)
            : participants
          ).map((p, idx) => {
            const memoryState = characterMemoryStates[p.characterId] || '（暂无状态记录）'
            const color = colorFor(p.characterId)
            const expanded = !!expandedChars[p.characterId]
            const isDragging = dragId === p.id
            return (
              <div
                key={p.id}
                data-chatroom-participant={p.id}
                draggable
                onDragStart={(e) => {
                  setDragOrder((cur) => cur ?? participants.map((x) => x.id))
                  setDragId(p.id)
                  try { (e as any).nativeEvent?.dataTransfer?.setData('text/plain', p.id) } catch { /* 非关键 */ }
                }}
                onDragOver={(e) => { e.preventDefault() }}
                onDragEnd={() => {
                  // card 自身的 onDragEnd 优先提交；document.dragend 作为兜底
                  const finalOrder = dragOrderRef.current
                  if (finalOrder) {
                    commitReorder(finalOrder)
                  }
                  dragIdRef.current = null
                  dragOrderRef.current = null
                  setDragId(null)
                  setDragOrder(null)
                }}
                  style={{
                    marginBottom: 10,
                    padding: 10,
                    borderRadius: 10,
                    border: '1px solid #EEF0F3',
                    background: '#FBFBFD',
                    cursor: dragId === p.id ? 'grabbing' : 'grab',
                    opacity: dragId === p.id ? 0.5 : 1,
                    userSelect: 'none',
                    touchAction: 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: color,
                        color: '#fff',
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {idx + 1}
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
                      {p.characterName}
                    </span>
                    <Tooltip title="让 TA 单独说一句">
                      <Button
                        type="text"
                        size="small"
                        icon={<CommentOutlined />}
                        disabled={!currentRoom || generating}
                        onClick={() => currentRoom && characterSpeak(currentRoom.id, p.characterId)}
                        style={{ flexShrink: 0 }}
                      />
                    </Tooltip>
                    <span
                      style={{ color: '#9CA3AF', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}
                      onClick={() => removeParticipant(p.id)}
                      title="移出在场角色"
                    >
                      ✕
                    </span>
                  </div>

                  {/* 角色级 model 偏好（与剧情预演 InSceneCharacterCard 同结构） */}
                  <Select
                    size="small"
                    value={characterModels[p.characterId] ?? undefined}
                    onChange={(v) => handleSetCharacterModel(p.characterId, v || null)}
                    placeholder="使用房间默认"
                    allowClear
                    style={{ width: '100%', marginTop: 6 }}
                    options={models.map((m) => ({ value: m.id, label: modelFullName(m) }))}
                    onClick={(e) => e.stopPropagation()}
                  />

                  <div
                    style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setExpandedChars((s) => ({ ...s, [p.characterId]: !expanded }))}
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
                        {memoryState.split('\n').map((line, i) => {
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
          })}
        {currentRoom && availableCharacters.length === 0 && participants.length > 0 && (
          <div style={{ padding: '4px 4px 8px', fontSize: 12, color: '#9CA3AF' }}>本书角色已全部加入</div>
        )}
      </div>
      {/* 拖动期间不渲染独立 ghost —— 直接用原 card 半透明（opacity 0.5）+ 位置实时重排
          作为唯一的视觉反馈，避免与原 card 视觉不一致带来的歧义 */}
    </>
  )

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 44px)', background: '#F7F8FA', margin: '-20px -24px' }}>
      {/* ─── 左：房间列表（可折叠 / 可拖拽宽度） ─── */}
      {leftCollapsed ? (
        <aside
          style={{
            width: COLLAPSED_WIDTH,
            flexShrink: 0,
            borderRight: '1px solid #EEF0F3',
            background: '#FFFFFF',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            minHeight: 0,
          }}
        >
          <div
            className="hide-scrollbar"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '8px 0',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              width: '100%',
            }}
          >
            {rooms.map((room) => (
              <Tooltip key={room.id} title={room.title} placement="right">
                <div
                  onClick={() => setCurrentRoom(room.id)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    background: room.id === currentRoomId ? '#EEF2FF' : 'transparent',
                    border: room.id === currentRoomId ? '1px solid #C7D2FE' : '1px solid transparent',
                  }}
                >
                  <MessageOutlined style={{ fontSize: 14, color: room.id === currentRoomId ? '#4F46E5' : '#6B7280' }} />
                </div>
              </Tooltip>
            ))}
            <Tooltip title="新建聊天室" placement="right">
              <Button type="text" icon={<PlusOutlined />} onClick={openCreateRoom} style={{ width: 32, height: 32 }} />
            </Tooltip>
          </div>
          <div
            style={{
              width: '100%',
              height: 58,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderTop: '0px solid #F1F5F9',
            }}
          >
            <Tooltip title="展开聊天室列表">
              <Button
                type="text"
                icon={<MenuUnfoldOutlined />}
                onClick={() => setLeftCollapsed(false)}
                style={{ width: 32, height: 32, borderRadius: 8 }}
              />
            </Tooltip>
          </div>
        </aside>
      ) : (
        <div style={{ position: 'relative', width: leftWidth, flexShrink: 0 }}>
          <div
            onMouseDown={(e) => handleResizeStart('left', e)}
            onMouseEnter={(e) => ((e.currentTarget.firstChild as HTMLElement | null)!.style.background = '#CBD5E1')}
            onMouseLeave={(e) => ((e.currentTarget.firstChild as HTMLElement | null)!.style.background = 'transparent')}
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              bottom: 0,
              width: 8,
              cursor: 'col-resize',
              zIndex: 10,
            }}
            title="拖动调整宽度"
          >
            <div
              style={{
                position: 'absolute',
                right: 2,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 3,
                height: 36,
                borderRadius: 2,
                background: 'transparent',
                transition: 'all 0.2s ease',
              }}
            />
          </div>
          <aside
            style={{
              width: '100%',
              height: '100%',
              borderRight: '1px solid #EEF0F3',
              background: '#FFFFFF',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            {renderRoomList()}
            <div
              style={{
                height: 58,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderTop: '0px solid #F1F5F9',
              }}
            >
              <Tooltip title="收起聊天室列表">
                <Button
                  type="text"
                  icon={<MenuFoldOutlined />}
                  onClick={() => setLeftCollapsed(true)}
                  style={{ width: 32, height: 32, borderRadius: 8 }}
                />
              </Tooltip>
            </div>
          </aside>
        </div>
      )}

      {/* ─── 中：聊天主区 ─── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {!currentRoom ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }}>
            <Empty description="请选择或新建一个聊天室" />
          </div>
        ) : (
          <>
            {/* 头部 */}
            <div
              style={{
                padding: '14px 20px',
                borderBottom: '1px solid #EEF0F3',
                background: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>{currentRoom.title}</div>
                <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>
                  累计 {roomUsageTotals.tokens.toLocaleString()} tokens · ¥{formatCost(roomUsageTotals.cost, 4)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <Button size="small" icon={<SettingOutlined />} onClick={() => openEditRoom(currentRoom)}></Button>
                <Popconfirm
                  title="清空当前聊天室的全部聊天记录？"
                  okText="清空"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={handleClear}
                >
                  <Button size="small" danger icon={<ClearOutlined />}></Button>
                </Popconfirm>
              </div>
            </div>

            {/* 聊天区 */}
            <div
              className="hide-scrollbar"
              style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              {messages.length === 0 && (
                <div style={{ margin: 'auto', textAlign: 'center', color: '#9CA3AF' }}>
                  <MessageOutlined style={{ fontSize: 32, opacity: 0.4 }} />
                  <div style={{ marginTop: 8, fontSize: 13 }}>在下方输入内容，让在场角色接龙发言。</div>
                </div>
              )}
              {hasMoreHistory && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 8px' }}>
                  <Button
                    size="small"
                    type="dashed"
                    onClick={() => setExtraLoaded((c) => c + displayLimit)}
                  >
                    加载更多（还有 {messages.length - shownCount} 条更早的消息）
                  </Button>
                </div>
              )}
              {visibleMessages.map((m) => {
                if (m.role === 'director' || m.role === 'author' || m.role === 'netizen') {
                  const labelMap: Record<string, string> = {
                    director: '导演（你）',
                    author: '作者',
                    netizen: '网友',
                  }
                  const bgMap: Record<string, string> = {
                    director: '#4F46E5',
                    author: '#2563EB',
                    netizen: '#6B7280',
                  }
                  const isNotice = isResultNotice(m.content)
                  return (
                    <div key={m.id} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <div style={{ maxWidth: '72%' }}>
                        <div style={{ textAlign: 'right', fontSize: 12, color: isNotice ? '#DC2626' : '#9CA3AF', marginBottom: 4 }}>{labelMap[m.role]}</div>
                        <div
                          style={{
                            background: isNotice ? '#FEF2F2' : bgMap[m.role],
                            color: isNotice ? '#B91C1C' : '#fff',
                            border: isNotice ? '1px solid #FCA5A5' : '0px solid transparent',
                            padding: '10px 14px',
                            borderRadius: '12px 12px 2px 12px',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            lineHeight: 1.6,
                          }}
                        >
                          {m.content}
                        </div>
                        {m.errorNotice && (
                          <div style={{
                            display: 'inline-block', maxWidth: '100%', marginTop: 4, padding: '6px 10px',
                            background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 0,
                            fontSize: 12, color: '#B91C1C', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            textAlign: 'left',
                          }}>
                            {m.errorNotice}
                          </div>
                        )}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'flex-end',
                            alignItems: 'center',
                            gap: 4,
                            marginTop: 4,
                          }}
                        >
                          <Tooltip title="删除">
                            <Button
                              type="text"
                              size="small"
                              icon={<DeleteOutlined />}
                              onClick={() => deleteMessage(m.id)}
                              style={{ height: 22, padding: '0 6px', fontSize: 12, color: '#6B7280' }}
                            />
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  )
                }
                const color = colorFor(m.characterId || m.id)
                const isNotice = isResultNotice(m.content)
                return (
                  <div key={m.id} style={{ display: 'flex', justifyContent: 'flex-start', gap: 10 }}>
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        background: isNotice ? '#FEE2E2' : color,
                        color: isNotice ? '#DC2626' : '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        fontSize: 15,
                      }}
                    >
                      {initials(m.characterName || '?')}
                    </div>
                    <div style={{ maxWidth: '72%' }}>
                      <div style={{ fontSize: 12, color: isNotice ? '#DC2626' : color, fontWeight: 500, marginBottom: 4 }}>{m.characterName}</div>
                      <div
                        style={{
                          background: isNotice ? '#FEF2F2' : '#FFFFFF',
                          border: isNotice ? '1px solid #FCA5A5' : '1px solid #EEF0F3',
                          padding: '10px 14px',
                          borderRadius: '2px 12px 12px 12px',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          lineHeight: 1.6,
                          color: isNotice ? '#B91C1C' : '#111827',
                        }}
                      >
                        {m.reasoning && (
                          <div style={{ marginTop: 4, marginBottom: 4, maxWidth: '100%' }}>
                            <details style={{ borderRadius: 0, background: '#FFFFFF' }}>
                              <summary style={{
                                cursor: 'pointer', padding: '0 0 0 0',
                                fontSize: 13, color: '#8B5CF6', userSelect: 'none',
                                display: 'inline-flex', alignItems: 'center', gap: 0,
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
                        {m.content}
                        {m.__streaming && (
                          <span
                            style={{
                              display: 'inline-block',
                              width: 6,
                              height: 14,
                              background: color,
                              marginLeft: 2,
                              verticalAlign: 'text-bottom',
                              animation: 'blink 1s steps(2, start) infinite',
                            }}
                          />
                        )}
                      </div>
                      {m.errorNotice && (
                        <div style={{
                          display: 'inline-block', maxWidth: '100%', marginTop: 4, padding: '6px 10px',
                          background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 0,
                          fontSize: 12, color: '#B91C1C', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        }}>
                          {m.errorNotice}
                        </div>
                      )}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 4,
                          marginTop: 4,
                        }}
                      >
                        {m.usage ? renderTokenBadge(m.usage, models.find((md) => md.id === m.modelId)?.modelName) : <span />}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {m.modelMessages && (
                            <Tooltip title="查看上下文">
                              <Button
                                type="text"
                                size="small"
                                icon={<EyeOutlined />}
                                onClick={() => openContext(m)}
                                style={{ height: 22, padding: '0 6px', fontSize: 12, color: '#6B7280' }}
                              />
                            </Tooltip>
                          )}
                          <Tooltip title="删除">
                            <Button
                              type="text"
                              size="small"
                              icon={<DeleteOutlined />}
                              onClick={() => deleteMessage(m.id)}
                              style={{ height: 22, padding: '0 6px', fontSize: 12, color: '#6B7280' }}
                            />
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={chatEndRef} />
            </div>

            {/* 输入区：身份选择 + 输入框 + 发送 融为一体，选择框自适应宽度 */}
            <div
              style={{
                borderTop: '1px solid #EEF0F3',
                background: '#FFFFFF',
                padding: '10px 16px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-end',
                  gap: 8,
                  border: '1px solid #D1D5DB',
                  borderRadius: 12,
                  padding: '4px 6px',
                  background: '#FFFFFF',
                  minHeight: 44,
                }}
              >
                <Select
                  value={senderKey}
                  onChange={setSenderKey}
                  variant="borderless"
                  optionLabelProp="label"
                  options={[
                    { label: '作者', value: 'author' },
                    {
                      label: '在场角色',
                      options: participants.map((p) => ({ label: p.characterName, value: `char:${p.characterId}` })),
                    },
                  ]}
                  dropdownStyle={{ minWidth: 160 }}
                  style={{ flexShrink: 0, maxWidth: 200 }}
                  disabled={generating}
                />
                <Input.TextArea
                  id="chat-room-input"
                  ref={inputRef}
                  variant="borderless"
                  autoSize={{ minRows: 1, maxRows: 5 }}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  placeholder={generating ? '角色们正在发言…（你也可以继续输入下一句）' : '输入台词，回车发送（Shift+Enter 换行）'}
                  onPressEnter={(e) => {
                    if (!e.shiftKey) {
                      e.preventDefault()
                      if (!generating) {
                        handleSend(inputValue)
                        setInputValue('')
                      }
                    }
                  }}
                  style={{ flex: 1, resize: 'none', minHeight: 24, padding: '6px 4px' }}
                />
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={generating}
                  style={{
                    flexShrink: 0,
                    width: 32,
                    height: 32,
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 8,
                  }}
                  onClick={() => {
                    if (!generating) {
                      handleSend(inputValue)
                      setInputValue('')
                    }
                  }}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* ─── 右：角色列表面板（可折叠 / 可拖拽宽度） ─── */}
      {rightCollapsed ? (
        <aside
          style={{
            width: COLLAPSED_WIDTH,
            flexShrink: 0,
            borderLeft: '1px solid #EEF0F3',
            background: '#FFFFFF',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            minHeight: 0,
          }}
        >
          <div
            className="hide-scrollbar"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '8px 0',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              width: '100%',
            }}
          >
            <Tooltip title="在场角色" placement="left">
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <TeamOutlined style={{ fontSize: 16, color: '#4F46E5' }} />
              </div>
            </Tooltip>
            {participants.map((p) => (
              <Tooltip key={p.id} title={p.characterName} placement="left">
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: colorFor(p.characterId),
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                  }}
                >
                  {initials(p.characterName)}
                </div>
              </Tooltip>
            ))}
          </div>
          <div
            style={{
              width: '100%',
              height: 58,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderTop: '0px solid #F1F5F9',
            }}
          >
            <Tooltip title="展开在场角色">
              <Button
                type="text"
                icon={<MenuUnfoldOutlined />}
                onClick={() => setRightCollapsed(false)}
                style={{ width: 32, height: 32, borderRadius: 8 }}
              />
            </Tooltip>
          </div>
        </aside>
      ) : (
        <div style={{ position: 'relative', width: rightWidth, flexShrink: 0 }}>
          <div
            onMouseDown={(e) => handleResizeStart('right', e)}
            onMouseEnter={(e) => ((e.currentTarget.firstChild as HTMLElement | null)!.style.background = '#CBD5E1')}
            onMouseLeave={(e) => ((e.currentTarget.firstChild as HTMLElement | null)!.style.background = 'transparent')}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 8,
              cursor: 'col-resize',
              zIndex: 10,
            }}
            title="拖动调整宽度"
          >
            <div
              style={{
                position: 'absolute',
                left: 2,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 3,
                height: 36,
                borderRadius: 2,
                background: 'transparent',
                transition: 'all 0.2s ease',
              }}
            />
          </div>
          <aside
            style={{
              width: '100%',
              height: '100%',
              borderLeft: '1px solid #EEF0F3',
              background: '#FFFFFF',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            {renderCharacterPanel()}
            <div
              style={{
                height: 58,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderTop: '0px solid #F1F5F9',
              }}
            >
              <Tooltip title="收起在场角色">
                <Button
                  type="text"
                  icon={<MenuFoldOutlined />}
                  onClick={() => setRightCollapsed(true)}
                  style={{ width: 32, height: 32, borderRadius: 8 }}
                />
              </Tooltip>
            </div>
          </aside>
        </div>
      )}

      {/* ─── 房间新建/编辑弹窗 ─── */}
      <Modal
        title={editingRoom ? '编辑聊天室' : '新建聊天室'}
        open={roomModalOpen}
        onCancel={() => setRoomModalOpen(false)}
        onOk={handleSaveRoom}
        okText="保存"
        cancelText="取消"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 13, color: '#374151', marginBottom: 6 }}>名称 *</div>
            <Input
              value={roomForm.title}
              onChange={(e) => setRoomForm((s) => ({ ...s, title: e.target.value }))}
              placeholder="例如：酒馆夜谈"
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#374151', marginBottom: 6 }}>默认模型（不填则使用知卷当前模型）</div>
            <Select
              style={{ width: '100%' }}
              allowClear
              placeholder="跟随知卷默认"
              value={roomForm.defaultModelId ?? undefined}
              onChange={(v) => setRoomForm((s) => ({ ...s, defaultModelId: v ?? null }))}
              options={models.map((m) => ({ value: m.id, label: modelFullName(m) }))}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#374151', marginBottom: 6 }}>发言方式</div>
            <Segmented
              value={roomForm.speakingMode}
              onChange={(v) => setRoomForm((s) => ({ ...s, speakingMode: v as 'sequential' | 'simultaneous' }))}
              options={[
                { label: '依次发言', value: 'sequential' },
                { label: '同时发言', value: 'simultaneous' },
              ]}
            />
            <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 6 }}>
              {roomForm.speakingMode === 'simultaneous'
                ? '在场角色基于同一段对话并行各回一句（彼此看不到对方的本轮发言）。'
                : '在场角色按排序依次接龙，每人能看到前序角色的发言。'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#374151', marginBottom: 6 }}>携带记录条数（注入模型）</div>
            <InputNumber
              style={{ width: '100%' }}
              min={1}
              max={500}
              value={roomForm.historyLimit ?? 50}
              onChange={(v) => setRoomForm((s) => ({ ...s, historyLimit: v ?? 50 }))}
            />
            <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 6 }}>
              生成角色台词时，最多把最近的 N 条聊天记录注入模型上下文。数值越大越连贯、但 token 成本越高；数值越小越快但可能遗忘早期剧情。
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#374151', marginBottom: 6 }}>展示条数（界面渲染）</div>
            <InputNumber
              style={{ width: '100%' }}
              min={1}
              max={500}
              value={roomForm.displayLimit ?? 15}
              onChange={(v) => setRoomForm((s) => ({ ...s, displayLimit: v ?? 15 }))}
            />
            <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 6 }}>
              聊天界面默认只渲染最近的 N 条消息（纯展示，不影响模型上下文）。历史记录仍完整保存在库中，可通过"一键清空"或导出管理。
            </div>
          </div>
        </div>
      </Modal>

      {/* ─── 添加角色弹窗（复用剧情预演的选择器：已选 Tag 可拖拽排序、可单独移除）─── */}
      <AddCharactersModal
        open={addModalOpen}
        characters={availableCharacters}
        onCancel={() => setAddModalOpen(false)}
        onSubmit={handleAddParticipants}
        title="添加在场角色（可拖动排序，按顺序加入）"
        hint="按加入顺序排在在场角色列表："
        okText="添加"
        emptyOptionsText="本书暂无可选角色，请先到「角色管理」添加。"
      />

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

      <style>{`@keyframes blink { 0%,100% { opacity: 1 } 50% { opacity: 0 } }`}</style>
    </div>
  )
}
