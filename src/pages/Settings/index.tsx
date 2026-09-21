import { Card, Typography, Button, Space, Modal, message, Tooltip, Table, Empty, Select, Input, App, Switch, InputNumber, Checkbox } from 'antd'
import { useEffect, useState } from 'react'
import type { AiApplyLog, SamplingTaskMeta, TaskSamplingConfig } from '@/types/api'
import {
  DeleteOutlined,
  BookOutlined,
  AppstoreOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  WarningOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  DatabaseOutlined,
  ApiOutlined,
  BarChartOutlined,
  GithubOutlined,
  FileTextOutlined,
  MailOutlined,
  FileSearchOutlined,
  MessageOutlined,
  ExportOutlined,
  ImportOutlined,
  LockOutlined,
  MoneyCollectOutlined,
  PlayCircleOutlined,
  TeamOutlined,
  SlidersOutlined,
} from '@ant-design/icons'

import { useModelStore } from '@/stores/model.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useAiSettingsStore } from '@/stores/aiSettings.store'
import packageJson from '../../../package.json'
const packageData = packageJson as {
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function openExternal(url: string, messageApi: ReturnType<typeof App.useApp>['message']) {
  try {
    if (window.api?.shell?.openExternal) {
      messageApi.loading({ content: '正在打开…', key: 'open-ext', duration: 0.5 })
      window.api.shell.openExternal(url).then(() => {
        messageApi.success({ content: '已在浏览器中打开', key: 'open-ext' })
      }).catch((err) => {
        messageApi.error({ content: '打开链接失败：' + (err?.message || err || '未知错误'), key: 'open-ext' })
      })
    } else {
      messageApi.error('无法打开外部链接：API 未初始化')
    }
  } catch (e: any) {
    messageApi.error('打开链接异常：' + (e?.message || e || '未知错误'))
  }
}

function dependencyVersion(name: string) {
  return (packageData.dependencies?.[name] || packageData.devDependencies?.[name] || '未声明').replace(/^[~^]/, '')
}

const techVersionItems = [
  ['Electron', dependencyVersion('electron')],
  ['React', dependencyVersion('react')],
  ['TypeScript', dependencyVersion('typescript')],
  ['Vite', dependencyVersion('vite')],
  ['Ant Design', dependencyVersion('antd')],
  ['Zustand', dependencyVersion('zustand')],
  ['React Router', dependencyVersion('react-router-dom')],
  ['TipTap', dependencyVersion('@tiptap/react')],
  ['Drizzle ORM', dependencyVersion('drizzle-orm')],
  ['better-sqlite3', dependencyVersion('better-sqlite3')],
]

const { Title, Text } = Typography

const typeLabels: Record<string, string> = {
  book_info: '书籍信息',
  book_outline: '书籍大纲',
  volume_list: '分卷列表',
  volume_outline: '分卷大纲',
  chapter_list: '章节列表',
  chapter_outline: '章节大纲',
  chapter_content: '章节正文',
  book_setting: '设定条目',
  delete_entity: '删除操作',
  chapter_snapshot: '章节记忆',
}

const applyModeLabels: Record<string, string> = {
  append: '追加',
  replace: '覆盖',
  insert: '新建',
  merge: '合并',
  update: '更新',
  none: '执行',
}

/**
 * 「任务默认模型参数」面板：每个任务「自定义」模式下可编辑的四个采样参数。
 * （任务清单 key / 名称 / 内置默认温度由后端 electron/utils/sampling.ts 的 SAMPLING_TASKS 下发）
 */
const SAMPLING_PARAM_FIELDS: Array<{
  key: keyof Omit<TaskSamplingConfig, 'mode'>
  label: string
  min: number
  max: number
  step: number
  hint: string
}> = [
  { key: 'temperature', label: '温度（0~2）', min: 0, max: 2, step: 0.1, hint: '控制生成随机性。0=确定性输出，2=高度发散' },
  { key: 'topP', label: '核采样（0~1）', min: 0, max: 1, step: 0.05, hint: '候选词累积概率阈值。越高越多样，与温度二选一调节' },
  { key: 'frequencyPenalty', label: '频率惩罚（-2~2）', min: -2, max: 2, step: 0.1, hint: '按出现次数降低重复词概率' },
  { key: 'presencePenalty', label: '存在惩罚（-2~2）', min: -2, max: 2, step: 0.1, hint: '话题已出现即降权，与次数无关' },
]

export default function SettingsPage() {
  const { loadBooks, books } = useWorkspaceStore()
  const { loadModels } = useModelStore()
  const outputLanguage = useAiSettingsStore((state) => state.outputLanguage)
  const setOutputLanguage = useAiSettingsStore((state) => state.setOutputLanguage)
  const contextDepth = useAiSettingsStore((state) => state.contextDepth)
  const setContextDepth = useAiSettingsStore((state) => state.setContextDepth)
  const injectWritingSettings = useAiSettingsStore((state) => state.injectWritingSettings)
  const setInjectWritingSettings = useAiSettingsStore((state) => state.setInjectWritingSettings)
  const chatHistoryLimit = useAiSettingsStore((state) => state.chatHistoryLimit)
  const setChatHistoryLimit = useAiSettingsStore((state) => state.setChatHistoryLimit)
  const streamTimeout = useAiSettingsStore((state) => state.streamTimeout)
  const setStreamTimeout = useAiSettingsStore((state) => state.setStreamTimeout)
  const writeContextVolumeOutline = useAiSettingsStore((state) => state.writeContextVolumeOutline)
  const setWriteContextVolumeOutline = useAiSettingsStore((state) => state.setWriteContextVolumeOutline)
  const writeContextChapterOutline = useAiSettingsStore((state) => state.writeContextChapterOutline)
  const setWriteContextChapterOutline = useAiSettingsStore((state) => state.setWriteContextChapterOutline)
  const writeContextPrevChapterOutline = useAiSettingsStore((state) => state.writeContextPrevChapterOutline)
  const setWriteContextPrevChapterOutline = useAiSettingsStore((state) => state.setWriteContextPrevChapterOutline)
  const writeContextPrevChapterContent = useAiSettingsStore((state) => state.writeContextPrevChapterContent)
  const setWriteContextPrevChapterContent = useAiSettingsStore((state) => state.setWriteContextPrevChapterContent)
  const writeContextNextChapterOutline = useAiSettingsStore((state) => state.writeContextNextChapterOutline)
  const setWriteContextNextChapterOutline = useAiSettingsStore((state) => state.setWriteContextNextChapterOutline)
  const writeContextPrevChapterMemory = useAiSettingsStore((state) => state.writeContextPrevChapterMemory)
  const setWriteContextPrevChapterMemory = useAiSettingsStore((state) => state.setWriteContextPrevChapterMemory)
  const writeContextTotalMemory = useAiSettingsStore((state) => state.writeContextTotalMemory)
  const setWriteContextTotalMemory = useAiSettingsStore((state) => state.setWriteContextTotalMemory)
  const taskSampling = useAiSettingsStore((state) => state.taskSampling)
  const setTaskSampling = useAiSettingsStore((state) => state.setTaskSampling)
  const resetTaskSampling = useAiSettingsStore((state) => state.resetTaskSampling)
  const { modal, message } = App.useApp()

  // 「任务默认模型参数」的任务注册表：由后端下发（单一数据源 electron/utils/sampling.ts），
  // 新增/改名/改默认温度只需动后端，面板自动跟上。
  const [samplingTasks, setSamplingTasks] = useState<SamplingTaskMeta[]>([])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await window.api?.settings?.getSamplingTasks?.()
        if (!cancelled && Array.isArray(list)) setSamplingTasks(list)
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])
  const hasCustomSampling = Object.values(taskSampling || {}).some((c) => c?.mode === 'custom')

  // 触发全局文档弹窗（在任意页面均可打开，无需跳转）
  const openDoc = (docKey: string, title: string) =>
    window.dispatchEvent(new CustomEvent('open-doc-modal', { detail: { title, docKey } }))

  // 导出数据库
  const [dbExporting, setDbExporting] = useState(false)
  const handleExportDb = async () => {
    setDbExporting(true)
    try {
      const result = await window.api?.app?.exportDb?.()
      if (result?.success) {
        message.success('数据库已导出')
      } else if (result?.reason === 'cancelled') {
        // 用户取消，不提示
      } else {
        message.error('导出失败：' + (result?.reason || '未知错误'))
      }
    } catch (e) {
      message.error('导出异常')
    } finally {
      setDbExporting(false)
    }
  }

  // 导入数据库
  const [dbImporting, setDbImporting] = useState(false)
  const handleImportDb = async () => {
    setDbImporting(true)
    try {
      const result = await window.api?.app?.importDb?.()
      if (result?.success) {
        Modal.confirm({
          title: '导入成功',
          content: '数据库已导入，需要重启应用以加载新数据。是否立即重启？',
          okText: '立即重启',
          cancelText: '稍后手动重启',
          onOk: () => window.api?.app?.relaunch?.(),
        })
      } else if (result?.reason === 'cancelled') {
        // 用户取消，不提示
      } else if (result?.reason === 'same_file') {
        message.info('请勿选择当前正在使用的数据库文件')
      } else if (result?.reason === 'invalid_db') {
        message.error('该文件不是有效的稿府 Lab 数据库')
      } else {
        message.error('导入失败：' + (result?.reason || '未知错误'))
      }
    } catch (e) {
      message.error('导入异常')
    } finally {
      setDbImporting(false)
    }
  }
  const confirmImportDb = () => {
    Modal.confirm({
      title: '导入数据库',
      content: '导入将用所选备份文件覆盖当前所有数据，且不可恢复。确定继续吗？',
      okText: '继续导入',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => handleImportDb(),
    })
  }

  const [runtimeVersions, setRuntimeVersions] = useState<{ electron: string; chrome: string; node: string } | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const v = await window.api?.app?.versions?.()
        if (!cancelled && v) setRuntimeVersions(v)
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])

  const [applyLogsOpen, setApplyLogsOpen] = useState(false)
  const [applyLogsLoading, setApplyLogsLoading] = useState(false)
  const [applyLogs, setApplyLogs] = useState<AiApplyLog[]>([])
  const [applyLogFilter, setApplyLogFilter] = useState<{ bookId: string; outcome: 'success' | 'failed' | ''; keyword: string }>({ bookId: '', outcome: '', keyword: '' })
  const [applyLogsExporting, setApplyLogsExporting] = useState(false)

  useEffect(() => {
    if (!applyLogsOpen) return
    let cancelled = false
    setApplyLogsLoading(true)
    ;(async () => {
      try {
        const logs = await window.api?.ai?.applyLogs?.({
          bookId: applyLogFilter.bookId || null,
          outcome: applyLogFilter.outcome || null,
          keyword: applyLogFilter.keyword.trim() || null,
          limit: 500,
        })
        if (!cancelled) setApplyLogs(Array.isArray(logs) ? logs : [])
      } catch (error: any) {
        if (!cancelled) message.error(error?.message || '读取应用日志失败')
      } finally {
        if (!cancelled) setApplyLogsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [applyLogsOpen, applyLogFilter])

  const handleExportApplyLogs = async () => {
    if (!window.api?.ai?.exportApplyLogs) return
    setApplyLogsExporting(true)
    try {
      const { csv, count } = await window.api.ai.exportApplyLogs({
        bookId: applyLogFilter.bookId || null,
        outcome: applyLogFilter.outcome || null,
        keyword: applyLogFilter.keyword.trim() || null,
        limit: 5000,
      })
      if (!count) {
        message.info('没有可导出的应用日志')
        return
      }
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      a.download = `apply-logs-${stamp}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      message.success(`已导出 ${count} 条`)
    } catch (error: any) {
      message.error(error?.message || '导出失败')
    } finally {
      setApplyLogsExporting(false)
    }
  }

  const refreshWorkspace = async () => {
    await Promise.all([
      loadBooks(),
      loadModels(),
    ])
    window.dispatchEvent(new Event('token-usage-updated'))
  }

  const showConfirm = (title: string, content: string, onConfirm: () => Promise<void>) => {
    modal.confirm({
      title,
      content,
      icon: <WarningOutlined style={{ color: '#EF4444' }} />,
      okText: '确认清空',
      okButtonProps: { danger: true },
      onOk: async () => {
        await onConfirm()
        await refreshWorkspace()
        message.success('已清空')
      },
    })
  }

  const handleClearBooks = () => {
    showConfirm(
      '清空书籍数据',
      '确定要清空所有书籍数据吗？此操作不可恢复。',
      async () => {
        await window.api.settings.clearBooks()
      }
    )
  }

  const handleClearModels = () => {
    showConfirm(
      '清空模型配置',
      '确定要清空所有模型配置数据吗？此操作不可恢复。',
      async () => {
        await window.api.settings.clearModels()
      }
    )
  }

  const handleClearApplyLogs = () => {
    showConfirm(
      '清空应用日志',
      '确定要清空所有应用日志记录吗？此操作不可恢复。',
      async () => {
        await window.api.settings.clearApplyLogs()
      }
    )
  }

  const handleClearChatMessages = () => {
    showConfirm(
      '清空聊天记录',
      '确定要清空所有聊天记录吗？此操作不可恢复。',
      async () => {
        await window.api.settings.clearChatMessages()
        window.dispatchEvent(new Event('chat-messages-cleared'))
      }
    )
  }

  const handleClearTokens = () => {
    showConfirm(
      '清空 Token 统计',
      '确定要清空所有 Token 消耗记录吗？此操作不可恢复。',
      async () => {
        await window.api.settings.clearTokens()
      }
    )
  }

  const handleClearRoleDialogue = () => {
    showConfirm(
      '清空剧情预演数据',
      '确定要清空所有「剧情预演」房间、预演时间线与片段吗？此操作不可恢复。',
      async () => {
        await window.api.settings.clearRoleDialogue()
        window.dispatchEvent(new Event('role-dialogue-cleared'))
      }
    )
  }

  const handleClearChatRoom = () => {
    showConfirm(
      '清空角色聊天室数据',
      '确定要清空所有「角色聊天室」房间、在场角色与聊天记录吗？此操作不可恢复。',
      async () => {
        await window.api.settings.clearChatRoom()
        window.dispatchEvent(new Event('chat-room-cleared'))
      }
    )
  }

  const handleClearAll = () => {
    showConfirm(
      '清空所有数据',
      '确定要清空所有数据吗？包括书籍、模型配置、Token 记录等。此操作不可恢复。',
      async () => {
        await window.api.settings.clearAll()
      }
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0, fontWeight: 600 }}>
          设置
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          数据管理与应用设置
        </Text>
      </div>

      <Card
        variant="borderless"
        style={{ borderRadius: 12, marginBottom: 16 }}
        title={
          <Space>
            <RobotOutlined style={{ color: '#7C3AED' }} />
            <span style={{ fontWeight: 600 }}>「知卷」设置</span>
          </Space>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              padding: '12px 16px',
              background: '#F9FAFB',
              borderRadius: 8,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>思考语言</div>
              <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>「知卷」回复内容的语言，跟随输入会根据你的语言自动调整。</div>
            </div>
            <Select
              value={outputLanguage}
              onChange={(value) => setOutputLanguage(value as 'follow_input' | 'chinese' | 'english')}
              style={{ width: 180, flexShrink: 0 }}
              options={[
                { value: 'follow_input', label: '跟随输入' },
                { value: 'chinese', label: '中文' },
                { value: 'english', label: '英文' },
              ]}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              padding: '12px 16px',
              background: '#F9FAFB',
              borderRadius: 8,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>上下文深度</div>
              <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>预加载数据的详细程度。如果预加载信息不满足需求，模型会通过工具调用补全。</div>
            </div>
            <Select
              value={contextDepth}
              onChange={(value) => setContextDepth(value as 'minimal' | 'balanced' | 'deep')}
              style={{ width: 200, flexShrink: 0 }}
              options={[
                { value: 'minimal', label: <span>精简<span style={{ color: '#9CA3AF', marginLeft: 4 }}>· 仅标题</span></span> },
                { value: 'balanced', label: <span>平衡<span style={{ color: '#9CA3AF', marginLeft: 4 }}>· 标题 + 简介</span></span> },
                { value: 'deep', label: <span>深入<span style={{ color: '#9CA3AF', marginLeft: 4 }}>· 标题 + 详细简介</span></span> },
              ]}
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              padding: '12px 16px',
              background: '#F9FAFB',
              borderRadius: 8,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>携带聊天记录条数</div>
              <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>每轮对话向前携带的历史消息条数（0 表示不携带）。携带越多，消耗 Token 越多，多轮衔接也越连贯。</div>
            </div>
            <InputNumber
              min={0}
              max={100}
              value={chatHistoryLimit}
              onChange={(value) => setChatHistoryLimit(value ?? 0)}
              style={{ width: 120, flexShrink: 0 }}
              addonAfter="条"
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              padding: '12px 16px',
              background: '#F9FAFB',
              borderRadius: 8,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>模型读取超时</div>
              <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>请求总耗时超时，建议 90-180 秒；设 0 表示关闭超时（不推荐，模型真卡住会无限等）。</div>
            </div>
            <InputNumber
              min={0}
              max={600}
              value={streamTimeout}
              onChange={(value) => setStreamTimeout(value ?? 120)}
              style={{ width: 130, flexShrink: 0 }}
              addonAfter="秒"
            />
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              padding: '12px 16px',
              background: '#F9FAFB',
              borderRadius: 8,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>注入作品正文写作设置</div>
              <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>写章节正文时，把作品的写作风格、叙事视角、禁写清单等设置自动注入上下文。</div>
            </div>
            <Switch
              checked={injectWritingSettings}
              onChange={(checked) => setInjectWritingSettings(checked)}
            />
          </div>

          <div
            style={{
              padding: '12px 16px',
              background: '#F9FAFB',
              borderRadius: 8,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 500, color: '#111827', marginBottom: 4 }}>正文写作参考</div>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 12 }}>写章节正文时，自动注入以下上下文供 AI 参考。每项作为独立消息注入，不拼接。</div>
            <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '8px 24px' }}>
              <Checkbox
                checked={writeContextVolumeOutline}
                onChange={(e) => setWriteContextVolumeOutline(e.target.checked)}
              >
                当前卷纲
              </Checkbox>
              <Checkbox
                checked={writeContextChapterOutline}
                onChange={(e) => setWriteContextChapterOutline(e.target.checked)}
              >
                当前章纲
              </Checkbox>
              <Checkbox
                checked={writeContextPrevChapterOutline}
                onChange={(e) => setWriteContextPrevChapterOutline(e.target.checked)}
              >
                上一章章纲
              </Checkbox>
              <Checkbox
                checked={writeContextPrevChapterContent}
                onChange={(e) => setWriteContextPrevChapterContent(e.target.checked)}
              >
                上一章正文
              </Checkbox>
              <Checkbox
                checked={writeContextNextChapterOutline}
                onChange={(e) => setWriteContextNextChapterOutline(e.target.checked)}
              >
                下一章章纲
              </Checkbox>
              <Checkbox
                checked={writeContextPrevChapterMemory}
                onChange={(e) => setWriteContextPrevChapterMemory(e.target.checked)}
              >
                上一章记忆
              </Checkbox>
              <Checkbox
                checked={writeContextTotalMemory}
                onChange={(e) => setWriteContextTotalMemory(e.target.checked)}
              >
                总记忆
              </Checkbox>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              padding: '12px 16px',
              background: '#F9FAFB',
              borderRadius: 8,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>结果应用记录</div>
              <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>查看最近一次「知卷」将结果应用到作品数据的记录。</div>
            </div>
            <Button onClick={() => setApplyLogsOpen(true)}>查看应用日志</Button>
          </div>
        </div>
      </Card>

      {/* 任务默认模型参数 */}
      <Card
        variant="borderless"
        style={{ borderRadius: 12, marginBottom: 16 }}
        title={
          <Space>
            <SlidersOutlined style={{ color: '#0EA5E9' }} />
            <span style={{ fontWeight: 600 }}>任务默认模型参数</span>
          </Space>
        }
        extra={
          hasCustomSampling ? (
            <Tooltip title="清空所有任务的自定义采样参数，全部恢复为「跟随模型」">
              <Button size="small" onClick={resetTaskSampling}>
                全部恢复跟随模型
              </Button>
            </Tooltip>
          ) : null
        }
      >
        <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 12, lineHeight: 1.7 }}>
          每个任务的采样参数取值优先级：
          <Text strong style={{ fontSize: 12 }}>自定义</Text>
          （本面板） → <Text strong style={{ fontSize: 12 }}>模型</Text>
          （「模型管理 → 编辑模型 → 采样参数」里给该模型配置的值） → <Text strong style={{ fontSize: 12 }}>内置默认</Text>
          （仅温度有内置默认，见每项任务名右侧）。
          选择「跟随模型」表示不做任务级覆盖；「自定义」里留空的项也按「跟随模型」处理。
        </div>
        {samplingTasks.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="任务列表加载中…" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {samplingTasks.map((task) => {
              const cfg = taskSampling?.[task.key]
              const isCustom = cfg?.mode === 'custom'
              return (
                <div key={task.key} style={{ padding: '12px 16px', background: '#F9FAFB', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>
                        {task.label}
                        <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                          内置默认 {task.defaultTemperature}
                        </Text>
                      </div>
                      <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>{task.description}</div>
                    </div>
                    <Select
                      value={isCustom ? 'custom' : 'follow'}
                      onChange={(v) => setTaskSampling(task.key, { mode: v as 'follow' | 'custom' })}
                      style={{ width: 140, flexShrink: 0 }}
                      options={[
                        { value: 'follow', label: '跟随模型' },
                        { value: 'custom', label: '自定义' },
                      ]}
                    />
                  </div>
                  {isCustom && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 12,
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: '1px dashed #E5E7EB',
                      }}
                    >
                      {SAMPLING_PARAM_FIELDS.map((field) => (
                        <Tooltip key={field.key} title={field.hint}>
                          <div>
                            <Text type="secondary" style={{ fontSize: 11 }}>{field.label}</Text>
                            <InputNumber
                              style={{ width: 112, display: 'block', marginTop: 2 }}
                              min={field.min}
                              max={field.max}
                              step={field.step}
                              placeholder="跟随模型"
                              value={cfg?.[field.key] ?? null}
                              onChange={(v) => setTaskSampling(task.key, { [field.key]: v ?? null })}
                            />
                          </div>
                        </Tooltip>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* 数据管理 */}
      <Card
        variant="borderless"
        style={{ borderRadius: 12, marginBottom: 16 }}
        title={
          <Space>
            <DeleteOutlined style={{ color: '#EF4444' }} />
            <span style={{ fontWeight: 600 }}>数据管理</span>
          </Space>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: '#F9FAFB',
              borderRadius: 8,
            }}
          >
            <Space>
              <BookOutlined style={{ color: '#4F46E5' }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>清空书籍数据</div>
                <div style={{ fontSize: 12, color: '#9CA3AF' }}>删除所有作品、章节、分卷</div>
              </div>
            </Space>
            <Button danger type="text" onClick={handleClearBooks}>
              清空
            </Button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: '#F9FAFB',
              borderRadius: 8,
            }}
          >
            <Space>
              <AppstoreOutlined style={{ color: '#F59E0B' }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>清空模型配置</div>
                <div style={{ fontSize: 12, color: '#9CA3AF' }}>删除所有模型服务商配置</div>
              </div>
            </Space>
            <Button danger type="text" onClick={handleClearModels}>
              清空
            </Button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: '#F9FAFB',
              borderRadius: 8,
            }}
          >
            <Space>
              <FileSearchOutlined style={{ color: '#8B5CF6' }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>清空应用日志</div>
                <div style={{ fontSize: 12, color: '#9CA3AF' }}>删除所有 AI 结果应用记录</div>
              </div>
            </Space>
            <Button danger type="text" onClick={handleClearApplyLogs}>
              清空
            </Button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: '#F9FAFB',
              borderRadius: 8,
            }}
          >
            <Space>
              <MessageOutlined style={{ color: '#06B6D4' }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>清空聊天记录</div>
                <div style={{ fontSize: 12, color: '#9CA3AF' }}>删除所有「知卷」对话消息</div>
              </div>
            </Space>
            <Button danger type="text" onClick={handleClearChatMessages}>
              清空
            </Button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: '#F9FAFB',
              borderRadius: 8,
            }}
          >
            <Space>
              <PlayCircleOutlined style={{ color: '#A855F7' }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>清空剧情预演数据</div>
                <div style={{ fontSize: 12, color: '#9CA3AF' }}>删除所有预演房间、时间线与片段</div>
              </div>
            </Space>
            <Button danger type="text" onClick={handleClearRoleDialogue}>
              清空
            </Button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: '#F9FAFB',
              borderRadius: 8,
            }}
          >
            <Space>
              <TeamOutlined style={{ color: '#0EA5E9' }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>清空角色聊天室数据</div>
                <div style={{ fontSize: 12, color: '#9CA3AF' }}>删除所有聊天室、在场角色与聊天记录</div>
              </div>
            </Space>
            <Button danger type="text" onClick={handleClearChatRoom}>
              清空
            </Button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: '#F9FAFB',
              borderRadius: 8,
            }}
          >
            <Space>
              <HistoryOutlined style={{ color: '#16A34A' }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>清空 Token 统计</div>
                <div style={{ fontSize: 12, color: '#9CA3AF' }}>删除所有 AI 调用消耗记录</div>
              </div>
            </Space>
            <Button danger type="text" onClick={handleClearTokens}>
              清空
            </Button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: '#F0FDF4',
              borderRadius: 8,
              border: '1px solid #BBF7D0',
            }}
          >
            <Space>
              <ExportOutlined style={{ color: '#059669' }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>导出数据库</div>
                <div style={{ fontSize: 12, color: '#059669' }}>将本地 SQLite 数据库复制为备份文件</div>
              </div>
            </Space>
            <Button
              color="cyan" 
              variant="solid"
              icon={<ExportOutlined />}
              loading={dbExporting}
              onClick={handleExportDb}
              //style={{ background: '#10B981', borderColor: '#10B981' }}
            >
              导出
            </Button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: '#F0FDF4',
              borderRadius: 8,
              border: '1px solid #BBF7D0',
            }}
          >
            <Space>
              <ImportOutlined style={{ color: '#059669' }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>导入数据库</div>
                <div style={{ fontSize: 12, color: '#059669' }}>用备份文件覆盖当前本地数据库</div>
              </div>
            </Space>
            <Button
              color="cyan"
              variant="solid"
              icon={<ImportOutlined />}
              loading={dbImporting}
              onClick={confirmImportDb}
            >
              导入
            </Button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              background: '#FEF2F2',
              borderRadius: 8,
              border: '1px solid #FECACA',
            }}
          >
            <Space>
              <WarningOutlined style={{ color: '#EF4444' }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>清空所有数据</div>
                <div style={{ fontSize: 12, color: '#EF4444' }}>不可恢复，请谨慎操作</div>
              </div>
            </Space>
            <Button danger type="primary" onClick={handleClearAll}>
              清空所有
            </Button>
          </div>
        </div>
      </Card>

      <Card
        variant="borderless"
        style={{ borderRadius: 12, marginBottom: 16 }}
        title={
          <Space>
            <SafetyCertificateOutlined style={{ color: '#10B981' }} />
            <span style={{ fontWeight: 600 }}>关于稿府 Lab与合规说明</span>
          </Space>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div style={{ padding: '12px 14px', background: '#F9FAFB', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>产品名称</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{(packageData as { productName?: string }).productName || '稿府 Lab'}</div>
            </div>
            <div style={{ padding: '12px 14px', background: '#F9FAFB', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>当前版本</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{packageData.version || '未知'}</div>
            </div>
            <div style={{ padding: '12px 14px', background: '#F9FAFB', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>产品定位</div>
              <div style={{ fontSize: 13, color: '#111827', lineHeight: 1.55 }}>本地 AI 创作辅助工具，不提供 AI 服务，不代收模型费用。</div>
            </div>
          </div>

          <div style={{ padding: '12px 14px', background: '#F9FAFB', borderRadius: 8, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <DatabaseOutlined style={{ color: '#4F46E5', fontSize: 18, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 4 }}>数据存储</div>
              <div style={{ fontSize: 12, color: '#4B5563', lineHeight: 1.7 }}>所有作品数据、聊天记录、模型配置和 API Key 以及产品运行产生的数据均保存在您本机的本地数据库中，不会上传服务器，不会用于训练。您可以随时在“数据管理”中清空数据。</div>
            </div>
          </div>

          <div style={{ padding: '12px 14px', background: '#F9FAFB', borderRadius: 8, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <LockOutlined style={{ color: '#10B981', fontSize: 18, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 4 }}>API Key 加密存储</div>
              <div style={{ fontSize: 12, color: '#4B5563', lineHeight: 1.7 }}>您在“模型”页面配置的 API Key 会在写入本地数据库前使用操作系统级加密（Electron safeStorage）进行加密，明文不会落盘。解密仅在请求对应服务商时于本机内存中临时进行。</div>
            </div>
          </div>

          <div style={{ padding: '12px 14px', background: '#F9FAFB', borderRadius: 8, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <ApiOutlined style={{ color: '#7C3AED', fontSize: 18, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 4 }}>上游模型说明</div>
              <div style={{ fontSize: 12, color: '#4B5563', lineHeight: 1.7 }}>本软件不提供大模型服务，AI 能力来自您自行在“模型”页面配置的第三方模型服务商（例如 DeepSeek、通义、豆包等）。API Key、请求次数、账单和内容合规均由您与相应服务商直接负责。</div>
            </div>
          </div>

          <div style={{ padding: '12px 14px', background: '#F9FAFB', borderRadius: 8, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <BarChartOutlined style={{ color: '#0EA5E9', fontSize: 18, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 4 }}>Token 消耗说明</div>
              <div style={{ fontSize: 12, color: '#4B5563', lineHeight: 1.7 }}>本产品会估算运行时所消耗的Token及费用，并展示在 Token 消耗记录中，便于您了解用量与成本。</div>
            </div>
          </div>

          <div style={{ padding: '12px 14px', background: '#F9FAFB', borderRadius: 8, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <MoneyCollectOutlined style={{ color: '#D97706', fontSize: 18, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 4 }}>费用预估说明</div>
              <div style={{ fontSize: 12, color: '#4B5563', lineHeight: 1.7 }}>本软件展示的费用均为基于 Token 用量估算的预估值，仅供参考，不构成实际扣费依据。实际产生的费用，一切以您所使用的第三方模型服务商账单与扣费为准。</div>
            </div>
          </div>

          <div style={{ padding: '12px 14px', background: '#FEF3C7', borderRadius: 8, border: '1px solid #FDE68A', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <WarningOutlined style={{ color: '#B45309', fontSize: 18, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#78350F', marginBottom: 4 }}>AIGC 使用声明</div>
              <div style={{ fontSize: 12, color: '#78350F', lineHeight: 1.7 }}>软件内「知卷」生成的所有内容均由第三方大模型生成，可能包含不准确、不完整或与事实不符的信息。您对使用、发表、传播这些内容负全部责任，请勿用于违反当地法律法规、他人版权或平台规则的用途。发表 AI 参与创作的作品时，建议按平台要求标注 "AI 辅助生成"。</div>
            </div>
          </div>

          <div style={{ padding: '12px 14px', background: '#F9FAFB', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <GithubOutlined style={{ color: '#111827', fontSize: 18 }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>协议与联系方式</span>
            </div>
            <div style={{ fontSize: 12, color: '#4B5563', lineHeight: 1.7 }}>
              本项目基于 <b>Apache License 2.0</b> 开源，作者 <b>soCoolDad</b>。以下协议文档可在应用内直接查看，也可在 GitHub 上查看源码。
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Button
                size="small"
                icon={<FileTextOutlined />}
                onClick={() => openDoc('privacy', '隐私政策')}
              >
                隐私政策
              </Button>
              <Button
                size="small"
                icon={<FileTextOutlined />}
                onClick={() => openDoc('terms', '用户协议')}
              >
                用户协议
              </Button>
              <Button
                size="small"
                icon={<FileTextOutlined />}
                onClick={() => openDoc('license', 'Apache-2.0 许可证')}
              >
                许可证
              </Button>
              <Button
                size="small"
                icon={<FileTextOutlined />}
                onClick={() => openDoc('notice', '版权声明')}
              >
                版权声明
              </Button>
              <Button
                size="small"
                icon={<FileTextOutlined />}
                onClick={() => openDoc('thirdParty', '第三方依赖许可')}
              >
                第三方依赖许可
              </Button>
              <Button
                size="small"
                icon={<GithubOutlined />}
                onClick={() => openExternal('https://github.com/soCoolDad/gaofu-lab', message)}
              >
                GitHub 仓库
              </Button>
              <Button
                size="small"
                icon={<MailOutlined />}
                onClick={() => openExternal('mailto:806516788@qq.com', message)}
              >
                联系作者
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <Card
        variant="borderless"
        style={{ borderRadius: 12 }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <InfoCircleOutlined style={{ color: '#4F46E5', fontSize: 16 }} />
              <div>
                <span style={{ fontWeight: 600, fontSize: 16 }}>Thanks</span>
                <div style={{ fontSize: 12, color: '#9CA3AF', fontWeight: 400, marginTop: 4 }}>
                  以下是核心引用，不分先后；未列出的开源项目，本项目同样心怀感谢。
                </div>
              </div>
            </div>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div style={{ padding: '14px 16px', background: '#F9FAFB', borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>稿府 Lab</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>{packageData.version || '未知'}</div>
          </div>
          {techVersionItems.flatMap(([name, version]) => {
            const items: Array<{ name: string; version: string }> = [{ name, version }]
            // Electron 项后紧跟 Chromium 运行时版本
            if (name === 'Electron' && runtimeVersions?.chrome) {
              items.push({ name: 'Chromium', version: runtimeVersions.chrome })
            }
            return items
          }).map(({ name, version }) => (
            <div key={name} style={{ padding: '14px 16px', background: '#F9FAFB', borderRadius: 8 }}>
              <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 4 }}>{name}</div>
              <div style={{ fontSize: 15, fontWeight: 500, color: '#111827' }}>{version}</div>
            </div>
          ))}
        </div>
      </Card>
      <Modal
        title="应用日志"
        open={applyLogsOpen}
        onCancel={() => setApplyLogsOpen(false)}
        footer={null}
        width={1040}
        centered
        styles={{
          // 内容与容器四边间距统一为 20px；body 使用 flex 纵向布局，让表格独立占据剩余高度并在内部滚动
          body: { height: '66.67vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 20 },
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, flexShrink: 0 }}>
          <Select
            value={applyLogFilter.bookId || ''}
            onChange={(value) => setApplyLogFilter((prev) => ({ ...prev, bookId: value }))}
            style={{ minWidth: 200 }}
            options={[{ label: '全部作品', value: '' }, ...books.map((book) => ({ label: book.title, value: book.id }))]}
          />
          <Select
            value={applyLogFilter.outcome || ''}
            onChange={(value) => setApplyLogFilter((prev) => ({ ...prev, outcome: (value || '') as '' | 'success' | 'failed' }))}
            style={{ minWidth: 140 }}
            options={[
              { label: '全部结果', value: '' },
              { label: '成功', value: 'success' },
              { label: '失败', value: 'failed' },
            ]}
          />
          <Input.Search
            allowClear
            placeholder="按目标关键字搜索"
            style={{ minWidth: 220, flex: 1, maxWidth: 320 }}
            defaultValue={applyLogFilter.keyword}
            onSearch={(value) => setApplyLogFilter((prev) => ({ ...prev, keyword: value }))}
          />
        </div>
        {applyLogs.length === 0 && !applyLogsLoading ? (
          <Empty description="暂无应用日志" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          // 表格容器固定高度：flex:1 占满 body 剩余高度，minHeight:0 防止 flex 溢出，overflow:hidden 让内部滚动
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Table
              size="small"
              loading={applyLogsLoading}
              dataSource={applyLogs}
              rowKey="id"
              pagination={{ pageSize: 20, size: 'small' }}
              // 表格纵向滚动高度 = 弹窗 body 高度(66.67vh) - 上下 padding(20*2=40) - 顶部筛选条(约 48) - 分页栏(约 48) - 表头(约 40)
              scroll={{ y: 'calc(66.67vh - 176px)', x: 900 }}
              sticky
              columns={[
                { title: '时间', dataIndex: 'createdAt', width: 170, render: (v: string) => new Date(v).toLocaleString() },
                { title: '类型', dataIndex: 'resultType', width: 120, render: (v: string) => typeLabels[v] || v },
                { title: '模式', dataIndex: 'applyMode', width: 90, render: (v: string) => applyModeLabels[v] || v },
                { title: '目标', dataIndex: 'targetSummary', ellipsis: true },
                {
                  title: '结果',
                  dataIndex: 'outcome',
                  width: 90,
                  render: (v: 'success' | 'failed', row: AiApplyLog) => (
                    <Tooltip title={v === 'failed' ? row.errorMessage || '失败' : ''}>
                      <span style={{ color: v === 'success' ? '#10B981' : '#EF4444', fontWeight: 500 }}>{v === 'success' ? '成功' : '失败'}</span>
                    </Tooltip>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Modal>
    </div>
  )
}