import { create } from 'zustand'
import type {
  ChatRoomCharacterModel,
  ChatRoomMessage,
  ChatRoomParticipant,
  ChatRoomRoom,
  ChatRoomSelectableCharacter,
  ChatRoomSender,
  CreateChatRoomInput,
  UpdateChatRoomInput,
} from '@/types/api'

/** 「知卷」model 选择的 localStorage key（与 pages/Agent/index.tsx 保持一致） */
export const AGENT_MODEL_LS_KEY = 'agent:selectedModelId'

function readAgentFallbackModelId(): string | null {
  try {
    const v = localStorage.getItem(AGENT_MODEL_LS_KEY)
    return v && v.trim() ? v : null
  } catch {
    return null
  }
}

/** 前端临时标记：哪些消息正在流式（不落库，仅 UI 用） */
export type UiChatRoomMessage = ChatRoomMessage & { __streaming?: boolean }

let listenersInitialized = false

type ChatRoomState = {
  rooms: ChatRoomRoom[]
  currentRoomId: string | null
  participants: ChatRoomParticipant[]
  messages: UiChatRoomMessage[]
  selectableCharacters: ChatRoomSelectableCharacter[]
  /** 角色在定稿记忆（bookMemory）里的最后状态：characterId -> 格式化文本 */
  characterMemoryStates: Record<string, string>
  loading: boolean
  generating: boolean
  error: string | null

  loadRooms: (bookId: string) => Promise<void>
  createRoom: (data: CreateChatRoomInput) => Promise<ChatRoomRoom | null>
  updateRoom: (id: string, data: UpdateChatRoomInput) => Promise<void>
  deleteRoom: (id: string) => Promise<void>
  setCurrentRoom: (id: string | null) => Promise<void>

  loadParticipants: (roomId: string) => Promise<void>
  loadMessages: (roomId: string) => Promise<void>
  loadSelectableCharacters: (bookId: string) => Promise<void>
  loadCharacterMemoryStates: (bookId: string, characterIds: string[]) => Promise<void>

  addParticipant: (roomId: string, characterId: string) => Promise<void>
  removeParticipant: (id: string) => Promise<void>
  reorderParticipants: (roomId: string, orderedIds: string[]) => Promise<void>

  setCharacterModel: (bookId: string, characterId: string, modelId: string | null) => Promise<void>
  getCharacterModel: (bookId: string, characterId: string) => Promise<ChatRoomCharacterModel | null>

  clearMessages: (roomId: string) => Promise<void>
  deleteMessage: (id: string) => Promise<void>

  sendTurn: (userContent: string, sender: ChatRoomSender) => Promise<void>
  characterSpeak: (roomId: string, characterId: string) => Promise<void>
  initListeners: () => void
  /** 数据管理全局清空后，重置前端所有聊天室状态（房间/在场角色/消息/记忆状态） */
  resetAll: () => void
  clearError: () => void
}

export const useChatRoomStore = create<ChatRoomState>((set, get) => ({
  rooms: [],
  currentRoomId: null,
  participants: [],
  messages: [],
  selectableCharacters: [],
  characterMemoryStates: {},
  loading: false,
  generating: false,
  error: null,

  loadRooms: async (bookId) => {
    set({ loading: true })
    try {
      const rooms = await window.api.chatRoom.listRooms(bookId)
      set({ rooms })
    } finally {
      set({ loading: false })
    }
  },

  createRoom: async (data) => {
    const room = await window.api.chatRoom.createRoom(data)
    set((s) => ({ rooms: [room, ...s.rooms] }))
    return room
  },

  updateRoom: async (id, data) => {
    const room = await window.api.chatRoom.updateRoom(id, data)
    set((s) => ({ rooms: s.rooms.map((r) => (r.id === id ? room : r)) }))
  },

  deleteRoom: async (id) => {
    await window.api.chatRoom.deleteRoom(id)
    set((s) => ({
      rooms: s.rooms.filter((r) => r.id !== id),
      currentRoomId: s.currentRoomId === id ? null : s.currentRoomId,
      participants: s.currentRoomId === id ? [] : s.participants,
      messages: s.currentRoomId === id ? [] : s.messages,
    }))
  },

  setCurrentRoom: async (id) => {
    set({ currentRoomId: id, participants: [], messages: [], characterMemoryStates: {}, error: null })
    if (!id) return
    const room = get().rooms.find((r) => r.id === id)
    if (room) {
      await Promise.all([
        get().loadParticipants(id),
        get().loadMessages(id),
        get().loadSelectableCharacters(room.bookId),
      ])
      const cids = get().participants.map((p) => p.characterId)
      if (cids.length) await get().loadCharacterMemoryStates(room.bookId, cids)
    }
  },

  loadParticipants: async (roomId) => {
    const participants = await window.api.chatRoom.listParticipants(roomId)
    set({ participants })
  },

  loadMessages: async (roomId) => {
    const messages = await window.api.chatRoom.listMessages(roomId)
    // 关键：listMessages 返回的是后端原始数据（不带 __streaming 字段），
    // 之前用 set({ messages }) 直接覆盖，__streaming 字段从 raw row 里是 undefined → 已不显示光标。
    // 但在 characterSpeak 的 await 流程里，await 调用的 listMessages 可能与 onMessageStart/Complete
    // 的 setState 出现顺序竞态——若 onMessageStart 先 set（__streaming: true）再被 loadMessages 覆盖，
    // 旧气泡瞬间消失→再被 re-create 出现，过程中 React 可能短暂显示"输入光标"挂在错误的气泡上。
    // 为彻底杜绝：覆盖时把所有消息 __streaming 显式置 false（listMessages 永远代表"已落库"，
    // 不可能还在流式累积），再单独按最新的"自己 / 角色"消息保留 __streaming（罕见场景）。
    set({
      messages: messages.map((m) => ({ ...m, __streaming: false })),
    })
  },

  loadSelectableCharacters: async (bookId) => {
    const selectableCharacters = await window.api.chatRoom.listCharacters(bookId)
    set({ selectableCharacters })
  },

  loadCharacterMemoryStates: async (bookId, characterIds) => {
    if (!characterIds.length) return
    const states = await window.api.chatRoom.getCharacterMemoryStates(bookId, characterIds)
    // 合并而非整体替换：增量添加角色时不能把已加载的其他角色状态清掉
    set((s) => ({ characterMemoryStates: { ...s.characterMemoryStates, ...states } }))
  },

  addParticipant: async (roomId, characterId) => {
    const p = await window.api.chatRoom.addParticipant(roomId, characterId)
    set((s) => ({ participants: [...s.participants, p] }))
    const bookId = get().rooms.find((r) => r.id === roomId)?.bookId
    if (bookId) {
      await get().loadCharacterMemoryStates(bookId, [characterId])
    }
  },

  removeParticipant: async (id) => {
    await window.api.chatRoom.removeParticipant(id)
    set((s) => {
      const target = s.participants.find((p) => p.id === id)
      const characterMemoryStates = target ? { ...s.characterMemoryStates } : s.characterMemoryStates
      if (target) delete characterMemoryStates[target.characterId]
      return {
        participants: s.participants.filter((p) => p.id !== id),
        characterMemoryStates,
      }
    })
  },

  reorderParticipants: async (roomId, orderedIds) => {
    console.log('[chatRoom store] reorderParticipants called, roomId=', roomId, 'orderedIds=', orderedIds)
    const updated = await window.api.chatRoom.reorderParticipants(roomId, orderedIds)
    console.log('[chatRoom store] reorderParticipants got back ids:', updated.map((u) => u.id), 'sortOrders:', updated.map((u) => u.sortOrder))
    set({ participants: updated })
  },

  setCharacterModel: async (bookId, characterId, modelId) => {
    await window.api.chatRoom.setCharacterModel(bookId, characterId, modelId)
  },

  getCharacterModel: async (bookId, characterId) => {
    return await window.api.chatRoom.getCharacterModel(bookId, characterId)
  },

  clearMessages: async (roomId) => {
    await window.api.chatRoom.clearMessages(roomId)
    set({ messages: [] })
  },

  deleteMessage: async (id) => {
    const roomId = get().currentRoomId
    await window.api.chatRoom.deleteMessage(id)
    if (roomId) await get().loadMessages(roomId)
  },

  sendTurn: async (userContent, sender) => {
    const roomId = get().currentRoomId
    if (!roomId || get().generating) return
    const trimmed = (userContent || '').trim()

    // 乐观插入用户/扮演者消息
    if (trimmed) {
      set((s) => {
        const maxOrder = s.messages.reduce((m, x) => Math.max(m, x.order), 0)
        const isChar = sender.role === 'character'
        return {
          messages: [
            ...s.messages,
            {
              id: `tmp_${Date.now()}`,
              roomId,
              order: maxOrder + 1,
              role: sender.role,
              characterId: isChar ? sender.characterId : null,
              characterName: isChar ? sender.characterName : null,
              content: trimmed,
              errorNotice: null,
              reasoning: null,
              modelId: null,
              modelMessages: null,
              usage: null,
              createdAt: new Date().toISOString(),
              // 关键：用户/扮演者消息**不是流式累积的**——内容用户已经输入完整，
              // 不应显示"打字中"光标。__streaming 只用于 onMessageStart 启动的、真正由模型流式累积的角色消息。
              __streaming: false,
            },
          ],
        }
      })
    }

    set({ generating: true, error: null })
    try {
      await window.api.chatRoom.sendTurn({
        roomId,
        userContent: trimmed,
        sender,
        agentFallbackModelId: readAgentFallbackModelId(),
      })
      // turnDone 监听里会重新拉取权威消息列表；这里兜底再拉一次
      // 关键：listMessages 拉回的是后端已落库数据，乐观插入的 tmp_xxx 消息会被覆盖；
      // 但为了保险（万一 React 把 setState 合并后乐观消息短暂挂着），显式置 __streaming: false
      const messages = await window.api.chatRoom.listMessages(roomId)
      set({ messages: messages.map((m) => ({ ...m, __streaming: false })) })
    } catch (e: any) {
      set({ error: e?.message || '生成失败' })
      // 失败时拉取一次，清掉可能残留的占位/乐观消息
      const messages = await window.api.chatRoom.listMessages(roomId)
      set({ messages: messages.map((m) => ({ ...m, __streaming: false })) })
    } finally {
      set({ generating: false })
    }
  },

  characterSpeak: async (roomId, characterId) => {
    if (get().generating) return
    set({ generating: true, error: null })
    try {
      await window.api.chatRoom.characterSpeak(roomId, characterId)
      const messages = await window.api.chatRoom.listMessages(roomId)
      // 显式清 __streaming：listMessages 拉回的是已落库数据，理论上不该还在流式
      set({ messages: messages.map((m) => ({ ...m, __streaming: false })) })
    } catch (e: any) {
      set({ error: e?.message || '生成失败' })
      const messages = await window.api.chatRoom.listMessages(roomId)
      set({ messages: messages.map((m) => ({ ...m, __streaming: false })) })
    } finally {
      set({ generating: false })
    }
  },

  initListeners: () => {
    if (listenersInitialized) return
    listenersInitialized = true

    const matchRoom = (payloadRoomId: string) => payloadRoomId === get().currentRoomId

    window.api.chatRoom.onMessageStart((payload) => {
      if (!matchRoom(payload.roomId)) return
      set((s) => {
        // 若该消息 id 已存在（理论不会），跳过
        if (s.messages.some((m) => m.id === payload.messageId)) return s
        const maxOrder = s.messages.reduce((m, x) => Math.max(m, x.order), 0)
        return {
          messages: [
            ...s.messages,
            {
              id: payload.messageId,
              roomId: payload.roomId,
              order: Math.max(payload.order, maxOrder + 1),
              role: 'character',
              characterId: payload.characterId,
              characterName: payload.characterName,
              content: '',
              errorNotice: null,
              reasoning: null,
              modelId: null,
              modelMessages: null,
              usage: null,
              createdAt: new Date().toISOString(),
              __streaming: true,
            },
          ],
        }
      })
    })

    window.api.chatRoom.onMessageDelta((payload) => {
      if (!matchRoom(payload.roomId)) return
      if (!payload.delta) return
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === payload.messageId
            ? { ...m, content: (m.content || '') + payload.delta, __streaming: true }
            : m,
        ),
      }))
    })

    // 推理模型的"思考过程"流式推送：累加到 reasoning 字段
    window.api.chatRoom.onMessageReasoning((payload) => {
      if (!matchRoom(payload.roomId)) return
      if (!payload.delta) return
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === payload.messageId
            ? { ...m, reasoning: (m.reasoning || '') + payload.delta }
            : m,
        ),
      }))
    })

    window.api.chatRoom.onMessageComplete((payload) => {
      if (!matchRoom(payload.roomId)) return
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === payload.messageId ? { ...payload.message, __streaming: false } : m,
        ),
      }))
      // 模型调用已落库 token_usage_logs，通知主菜单刷新今日 Token 汇总
      window.dispatchEvent(new Event('token-usage-updated'))
    })

    window.api.chatRoom.onMessageError((payload) => {
      if (!matchRoom(payload.roomId)) return
      set((s) => ({
        messages: s.messages.filter((m) => m.id !== payload.messageId),
        error: payload.error || '角色发言失败',
      }))
    })

    window.api.chatRoom.onTurnDone((payload) => {
      if (!matchRoom(payload.roomId)) return
      // 重新拉取权威消息列表（覆盖乐观用户消息 + 占位）
      get().loadMessages(payload.roomId).then(() => {
        set({ generating: false })
      })
    })
  },

  clearError: () => set({ error: null }),

  resetAll: () =>
    set({
      rooms: [],
      currentRoomId: null,
      participants: [],
      messages: [],
      selectableCharacters: [],
      characterMemoryStates: {},
      generating: false,
      error: null,
    }),
}))
