import { create } from 'zustand'

export type AiSettingsValues = {
  smartContextEnabled: boolean
  outputLanguage: 'follow_input' | 'chinese' | 'english'
  contextDepth: 'minimal' | 'balanced' | 'deep'
  injectWritingSettings: boolean
  /** 每轮对话携带的历史聊天记录条数（0 表示不携带）。携带越多，消耗 Token 越多。 */
  chatHistoryLimit: number
  /**
   * 模型读取超时（秒）。同时作用于：
   *   - 流式 idle 超时：SSE 连续两条数据间超过此时间则自动中断
   *   - 整请求 total 超时：流式 / 非流式请求从发起到结束超过此时间则自动中断
   * 设 0 表示关闭超时（不推荐，模型真卡住会无限等）。
   * 默认 120 秒；上限 600 秒。
   */
  streamTimeout: number
  /** 正文写作参考：写章节正文时注入哪些上下文 */
  writeContextVolumeOutline: boolean
  writeContextChapterOutline: boolean
  writeContextPrevChapterOutline: boolean
  writeContextPrevChapterContent: boolean
  writeContextNextChapterOutline: boolean
  writeContextPrevChapterMemory: boolean
  writeContextTotalMemory: boolean
}

const DEFAULTS: AiSettingsValues = {
  smartContextEnabled: true,
  outputLanguage: 'follow_input',
  contextDepth: 'balanced',
  injectWritingSettings: true,
  chatHistoryLimit: 10,
  streamTimeout: 120,
  writeContextVolumeOutline: true,
  writeContextChapterOutline: true,
  writeContextPrevChapterOutline: true,
  writeContextPrevChapterContent: true,
  writeContextNextChapterOutline: true,
  writeContextPrevChapterMemory: true,
  writeContextTotalMemory: true,
}

/** 把任意（可能残缺/类型不对）的输入与默认值合并，保证字段齐全且类型正确 */
function mergeWithDefaults(raw: Partial<AiSettingsValues> | null | undefined): AiSettingsValues {
  const r = raw || {}
  return {
    smartContextEnabled: r.smartContextEnabled === false ? false : true,
    outputLanguage: (r.outputLanguage as AiSettingsValues['outputLanguage']) || 'follow_input',
    contextDepth: (r.contextDepth as AiSettingsValues['contextDepth']) || 'balanced',
    injectWritingSettings: r.injectWritingSettings === false ? false : true,
    chatHistoryLimit: Number.isFinite(Number(r.chatHistoryLimit)) && Number(r.chatHistoryLimit) >= 0 ? Number(r.chatHistoryLimit) : 10,
    streamTimeout: Number.isFinite(Number(r.streamTimeout)) && Number(r.streamTimeout) >= 0 && Number(r.streamTimeout) <= 600 ? Number(r.streamTimeout) : 120,
    writeContextVolumeOutline: r.writeContextVolumeOutline === false ? false : true,
    writeContextChapterOutline: r.writeContextChapterOutline === false ? false : true,
    writeContextPrevChapterOutline: r.writeContextPrevChapterOutline === false ? false : true,
    writeContextPrevChapterContent: r.writeContextPrevChapterContent === false ? false : true,
    writeContextNextChapterOutline: r.writeContextNextChapterOutline === false ? false : true,
    writeContextPrevChapterMemory: r.writeContextPrevChapterMemory === false ? false : true,
    writeContextTotalMemory: r.writeContextTotalMemory === false ? false : true,
  }
}

type AiSettingsState = AiSettingsValues & {
  setSmartContextEnabled: (value: boolean) => void
  setOutputLanguage: (value: 'follow_input' | 'chinese' | 'english') => void
  setContextDepth: (value: 'minimal' | 'balanced' | 'deep') => void
  setInjectWritingSettings: (value: boolean) => void
  setChatHistoryLimit: (value: number) => void
  setStreamTimeout: (value: number) => void
  setWriteContextVolumeOutline: (value: boolean) => void
  setWriteContextChapterOutline: (value: boolean) => void
  setWriteContextPrevChapterOutline: (value: boolean) => void
  setWriteContextPrevChapterContent: (value: boolean) => void
  setWriteContextNextChapterOutline: (value: boolean) => void
  setWriteContextPrevChapterMemory: (value: boolean) => void
  setWriteContextTotalMemory: (value: boolean) => void
}

/** 从当前 store 状态中提取可持久化的设置值 */
function extractValues(state: AiSettingsValues): AiSettingsValues {
  return {
    smartContextEnabled: state.smartContextEnabled,
    outputLanguage: state.outputLanguage,
    contextDepth: state.contextDepth,
    injectWritingSettings: state.injectWritingSettings,
    chatHistoryLimit: state.chatHistoryLimit,
    streamTimeout: state.streamTimeout,
    writeContextVolumeOutline: state.writeContextVolumeOutline,
    writeContextChapterOutline: state.writeContextChapterOutline,
    writeContextPrevChapterOutline: state.writeContextPrevChapterOutline,
    writeContextPrevChapterContent: state.writeContextPrevChapterContent,
    writeContextNextChapterOutline: state.writeContextNextChapterOutline,
    writeContextPrevChapterMemory: state.writeContextPrevChapterMemory,
    writeContextTotalMemory: state.writeContextTotalMemory,
  }
}

export const useAiSettingsStore = create<AiSettingsState>((set, get) => {
  // 每次写入：先更新内存态，再异步落库到 SQLite（fire-and-forget，不阻塞 UI）
  const persist = () => {
    const values = extractValues(get())
    window.api?.settings?.saveAiSettings(values).catch(() => {})
  }

  return {
    ...DEFAULTS,
    setSmartContextEnabled: (value) => { set({ smartContextEnabled: !!value }); persist() },
    setOutputLanguage: (value) => { set({ outputLanguage: value }); persist() },
    setContextDepth: (value) => { set({ contextDepth: value }); persist() },
    setInjectWritingSettings: (value) => { set({ injectWritingSettings: !!value }); persist() },
    setChatHistoryLimit: (value) => { set({ chatHistoryLimit: Math.max(0, Math.floor(Number(value) || 0)) }); persist() },
    setStreamTimeout: (value) => { set({ streamTimeout: Math.max(0, Math.min(600, Math.floor(Number(value) || 0))) }); persist() },
    setWriteContextVolumeOutline: (value) => { set({ writeContextVolumeOutline: !!value }); persist() },
    setWriteContextChapterOutline: (value) => { set({ writeContextChapterOutline: !!value }); persist() },
    setWriteContextPrevChapterOutline: (value) => { set({ writeContextPrevChapterOutline: !!value }); persist() },
    setWriteContextPrevChapterContent: (value) => { set({ writeContextPrevChapterContent: !!value }); persist() },
    setWriteContextNextChapterOutline: (value) => { set({ writeContextNextChapterOutline: !!value }); persist() },
    setWriteContextPrevChapterMemory: (value) => { set({ writeContextPrevChapterMemory: !!value }); persist() },
    setWriteContextTotalMemory: (value: boolean) => { set({ writeContextTotalMemory: !!value }); persist() },
  }
})

/**
 * 应用启动时调用：从 SQLite 加载已保存的设置覆盖默认值。
 * 若数据库为空，则尝试从旧版本 localStorage（'ainovel.ai.settings'）一次性迁移，
 * 迁移后清除该键，避免与新存储并存。
 */
export async function loadAiSettings() {
  try {
    const data = await window.api.settings.getAiSettings()
    if (data) {
      useAiSettingsStore.setState(mergeWithDefaults(data))
      return
    }
    // 数据库无记录 → 尝试 localStorage 迁移
    try {
      const legacy = localStorage.getItem('ainovel.ai.settings')
      if (legacy) {
        const migrated = mergeWithDefaults(JSON.parse(legacy))
        useAiSettingsStore.setState(migrated)
        await window.api.settings.saveAiSettings(migrated).catch(() => {})
        localStorage.removeItem('ainovel.ai.settings')
      }
    } catch {
      // 迁移失败不影响启动，保持默认值
    }
  } catch {
    // 读取失败保持默认值
  }
}

// ============ 同步 getter：供非 React 代码（agent.store 等）读取当前内存态 ============

export function getAiSmartContextEnabledSetting() {
  return useAiSettingsStore.getState().smartContextEnabled
}

export function getAiOutputLanguageSetting(): 'follow_input' | 'chinese' | 'english' {
  return useAiSettingsStore.getState().outputLanguage
}

export function getAiContextDepthSetting(): 'minimal' | 'balanced' | 'deep' {
  return useAiSettingsStore.getState().contextDepth
}

export function getAiInjectWritingSettingsSetting(): boolean {
  return useAiSettingsStore.getState().injectWritingSettings
}

export function getAiChatHistoryLimitSetting(): number {
  return useAiSettingsStore.getState().chatHistoryLimit
}

export function getAiStreamTimeoutSetting(): number {
  return useAiSettingsStore.getState().streamTimeout
}

export function getAiWriteContextSettings() {
  const s = useAiSettingsStore.getState()
  return {
    writeContextVolumeOutline: s.writeContextVolumeOutline,
    writeContextChapterOutline: s.writeContextChapterOutline,
    writeContextPrevChapterOutline: s.writeContextPrevChapterOutline,
    writeContextPrevChapterContent: s.writeContextPrevChapterContent,
    writeContextNextChapterOutline: s.writeContextNextChapterOutline,
    writeContextPrevChapterMemory: s.writeContextPrevChapterMemory,
    writeContextTotalMemory: s.writeContextTotalMemory,
  }
}
