import { useState, useRef, useEffect, memo } from 'react'
import { Input, Button, Select, Tooltip, Popover, Tag, Card, Spin, message, Popconfirm, Modal, Tabs } from 'antd'
import {
  SendOutlined,
  StopOutlined,
  ClearOutlined,
  CheckOutlined,
  CloseOutlined,
  ToolOutlined,
  DatabaseOutlined,
  WarningOutlined,
  DownOutlined,
  UpOutlined,
  RightOutlined,
  CopyOutlined,
  SyncOutlined,
  DeleteOutlined,
  UserOutlined,
  RobotOutlined,
  OrderedListOutlined,
  QuestionCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useAgentStore } from '@/stores/agent.store'
import { useModelStore } from '@/stores/model.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import MDXViewer from '@/components/MDXViewer'
import { SnapshotDetailView } from '@/components/SnapshotViewerModal'
import type { AgentMessage, PendingWrite } from '@/types/agent'
import type { ModelProvider } from '@/types/api'

const { TextArea } = Input

function formatCost(value: number, digits: number) {
  return parseFloat((value || 0).toFixed(digits)).toString()
}

// ─── 工具名称映射 ────────────────────────────────────────────

const toolNameMap: Record<string, string> = {
  list_books: '书籍列表',
  get_book: '查看书籍',
  create_book: '创建书籍',
  update_book: '更新书籍',
  list_volumes: '分卷列表',
  create_volumes: '创建分卷',
  update_volume_outline: '更新分卷大纲',
  list_chapters: '章节列表',
  get_chapter: '查看章节',
  get_chapter_content: '获取章节正文',
  create_chapters: '创建章节',
  write_chapter_content: '写章节正文',
  update_chapter_outline: '更新章节大纲',
  get_book_outline: '获取书籍大纲',
  write_book_outline: '写书籍大纲',
  list_settings: '设定列表',
  create_settings: '创建设定',
  delete_entity: '删除对象',
  get_snapshot: '获取记忆',
  list_snapshots: '记忆列表',
  generate_snapshot: '生成记忆',
  get_memory: '获取总记忆',
  get_chapter_memory: '获取章节记忆',
  get_writing_context: '获取写作上下文',
  mark_resume_after_apply: '标记续跑',
  get_volume: '查看分卷',
  update_volume: '更新分卷',
  get_setting: '查看设定条目',
  update_setting: '更新设定条目',
  update_chapter: '更新章节',
  request_user_confirmation: '确认卡片',
}

// ─── 工具调用展示 ────────────────────────────────────────────

function ToolCallItem({ call, result }: { call: any; result: any }) {
  const [expanded, setExpanded] = useState(false)
  const isRunning = result?.success === false && result?.data === null && !result?.error
  const isSuccess = result?.success === true
  const isError = result?.success === false && result?.error !== undefined && result?.error !== null
  const displayName = toolNameMap[call.name] || call.name

  return (
    <div style={{
      border: '1px solid #E5E7EB',
      borderRadius: 8,
      marginBottom: 8,
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '8px 12px',
          background: '#F9FAFB',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
        }}
      >
        {isRunning && (
          <>
            <Spin size="small" />
            <span style={{ color: '#10B981', fontSize: 12 }}>
              {call.name?.startsWith('write_') ? '生成中...' : '执行中...'}
            </span>
          </>
        )}
        {isSuccess && <CheckOutlined style={{ color: '#10B981' }} />}
        {isError && <WarningOutlined style={{ color: '#EF4444' }} />}
        <ToolOutlined style={{ color: '#6B7280' }} />
        <span style={{ fontWeight: 500, color: '#111827' }}>{displayName}</span>
        <span style={{ marginLeft: 'auto' }}>
          {expanded ? <UpOutlined style={{ fontSize: 11, color: '#9CA3AF' }} /> : <DownOutlined style={{ fontSize: 11, color: '#9CA3AF' }} />}
        </span>
      </div>
      {expanded && (
        <div style={{ padding: 12, fontSize: 12, background: '#FFFFFF', maxWidth: '100%', overflowX: 'auto' }}>
          <div style={{ marginBottom: 8, minWidth: 'fit-content' }}>
            <span style={{ fontSize: 11, color: '#6B7280' }}>参数</span>
            <pre style={{ margin: '4px 0 0', padding: 8, background: '#F9FAFB', borderRadius: 6, fontSize: 12, overflow: 'auto', maxHeight: 200, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {JSON.stringify(call.arguments, null, 2)}
            </pre>
          </div>
          {result?.data !== null && result?.data !== undefined && (
            <div style={{ minWidth: 'fit-content' }}>
              <span style={{ fontSize: 11, color: '#6B7280' }}>结果</span>
              <pre style={{ margin: '4px 0 0', padding: 8, background: '#F0FDF4', borderRadius: 6, fontSize: 12, overflow: 'auto', maxHeight: 200, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(result.data, null, 2)}
              </pre>
            </div>
          )}
          {result?.error && (
            <div style={{ minWidth: 'fit-content' }}>
              <span style={{ fontSize: 11, color: '#6B7280' }}>错误</span>
              <pre style={{ margin: '4px 0 0', padding: 8, background: '#FEF2F2', borderRadius: 6, fontSize: 12, color: '#EF4444', overflow: 'auto', maxHeight: 200, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {result.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const MemoizedToolCallItem = memo(ToolCallItem)

// ─── 工具运行状态判定 ────────────────────────────────────────
// agent.store 在收到 toolStart 事件时把 result 初始化为占位符
//   { success: false, data: null }
// 收到 toolEnd 时才替换为真正的结果（success=true 或 error 有值）。
// 所以"工具还在跑"= result 是那个占位符：既没有 error 也没 data 又不 success。
// 也兼容极少数 result 直接是 undefined 的场景。
function isToolRunning(tc: { result: { success: boolean; data: any; error?: string } | undefined }) {
  const r = tc.result
  if (!r) return true
  return r.success === false && r.data === null && !r.error
}

// 会真正"生成大段内容"的写工具白名单。
// 之前用 startsWith('write_') 只覆盖了 write_chapter_content / write_book_outline 两个，
// create_chapters / update_chapter_outline / create_settings 等都没匹配到，导致"内容生成中..."
// 几乎不出现。这里改用显式列表，覆盖所有耗时的写场景。
const CONTENT_GENERATING_TOOLS = new Set<string>([
  'write_chapter_content',
  'write_book_outline',
  'create_chapters',
  'create_volumes',
  'create_settings',
  'update_chapter_outline',
  'update_volume_outline',
  'generate_snapshot',
])
function isContentGeneratingTool(name?: string) {
  return !!name && CONTENT_GENERATING_TOOLS.has(name)
}

// ─── 正在工作 提示 ───────────────────────────────────────────
// AI 已经输出过文字但还没结束流式（可能马上要继续调用工具 / 追加内容），
// 用一个固定的提示显示"还在动"，避免看起来卡死。
// startedAt 用于展示累计耗时（mm:ss），从整条消息创建那一刻开始算，跨轮不会重置。
function WorkingIndicator({ startedAt }: { startedAt?: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const clockTimer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(clockTimer)
  }, [])
  return (
    <div style={{ marginTop: 8, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      <Spin size="small" />
      <span>
        正在工作 · ({typeof startedAt === 'number' ? formatDuration(now - startedAt) : '00:00'})
      </span>
    </div>
  )
}

// 把毫秒差转换成 mm:ss 展示
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// 实时计时器：从 startedAt 起每秒滚动一次，用于"内容生成中(mm:ss)"这类场景
function LiveTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return <span>{formatDuration(now - startedAt)}</span>
}

// ─── PendingWrite 卡片 ───────────────────────────────────────

function PendingWriteCard({
  write,
  onApply,
  applying,
  onDiscard,
  onRerun,
  onReject,
  elapsedMs,
  disabled,
}: {
  write: PendingWrite
  onApply: () => void
  applying: boolean
  onDiscard: () => void
  onRerun: () => void
  onReject: () => void
  /** 生成该结果所用的工具耗时（ms），会在"请进行结果确认"旁展示 */
  elapsedMs?: number
  /** 本条消息仍在流式生成中：卡片可见但暂不可操作（中途应用会导致自动续跑被并发保护吞掉） */
  disabled?: boolean
}) {
  const riskColors: Record<string, string> = {
    low: 'green',
    medium: 'orange',
    high: 'red',
  }
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

  const isRejected = write.rejected === true
  return (
    <Card
      size="small"
      style={{
        width: '100%',
        marginBottom: 8,
        border: write.applied
          ? '1px solid #D1FAE5'
          : isRejected
          ? '1px solid #FCA5A5'
          : '1px solid #E5E7EB',
        background: write.applied
          ? '#F0FDF4'
          : isRejected
          ? '#FEF2F2'
          : '#FFFFFF',
      }}
    >
      {/* 第一行：标题 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <DatabaseOutlined style={{ color: write.applied ? '#10B981' : '#6B7280' }} />
        <span style={{ fontWeight: 500, fontSize: 13, color: '#111827', wordBreak: 'break-all' }}>
          {write.title}
        </span>
      </div>

      {/* 第二行：标签 */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        <Tag color={typeLabels[write.type] ? 'blue' : 'default'} style={{ marginRight: 0, fontSize: 11 }}>
          {typeLabels[write.type] || write.type}
        </Tag>
        <Tag color={riskColors[write.riskLevel]} style={{ marginRight: 0, fontSize: 11 }}>
          {write.riskLevel === 'high' ? '高风险' : write.riskLevel === 'medium' ? '中风险' : '低风险'}
        </Tag>
        {write.applied && (
          <Tag color="success" style={{ marginRight: 0, fontSize: 11 }} icon={<CheckOutlined />}>已应用</Tag>
        )}
        {isRejected && (
          <Tag color="error" style={{ marginRight: 0, fontSize: 11 }} icon={<CloseOutlined />}>已拒绝</Tag>
        )}
      </div>

      {/* 第三行：内容 */}
      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 8, wordBreak: 'break-all' }}>
        {write.type === 'volume_list' || write.type === 'chapter_list' ? (
          write.data?.items?.map((item: any, idx: number) => (
            <div key={idx} style={{ marginBottom: 2 }}>
              <span style={{ fontWeight: 700, color: '#111827' }}>{item.title}</span>
            </div>
          ))
        ) : write.type === 'book_setting' ? (
          write.data?.items?.map((item: any, idx: number) => (
            <div key={idx} style={{ marginBottom: 2 }}>
              <span style={{ fontWeight: 700, color: '#111827' }}>{item.name}</span>
              {item.type && <Tag style={{ marginLeft: 6, fontSize: 10 }}>{item.type}</Tag>}
            </div>
          ))
        ) : null}
      </div>

      {/* 第四行：操作 */}
      {isRejected ? (
        <div style={{
          paddingTop: 8,
          borderTop: '1px solid #FECACA',
          fontSize: 12,
          color: '#B91C1C',
          lineHeight: 1.6,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <CloseOutlined />
            <span style={{ fontWeight: 500 }}>已拒绝</span>
            <span style={{ color: '#9CA3AF' }}>· 链路已停止</span>
          </div>
          {write.rejectReason && (
            <div style={{ paddingLeft: 22, color: '#6B7280' }}>
              原因：{write.rejectReason}
            </div>
          )}
        </div>
      ) : !write.applied ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          paddingTop: 8,
          borderTop: '1px solid #F3F4F6',
        }}>
          <span style={{ fontSize: 12, color: '#9CA3AF' }}>
            {disabled ? '生成结束后可确认' : '请进行结果确认'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tooltip title={disabled ? '等待本次生成结束' : '重跑：让 AI 按你的原因重新生成待确认内容'}>
              <Button
                size="small"
                disabled={disabled}
                onClick={onRerun}
                icon={<ReloadOutlined />}
                style={{
                  width: 32,
                  height: 32,
                  padding: 0,
                  color: '#7C3AED',
                  background: '#FFFFFF',
                  border: '1px solid #DDD6FE',
                  borderRadius: 8,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#F5F3FF'
                  e.currentTarget.style.borderColor = '#A78BFA'
                  e.currentTarget.style.color = '#6D28D9'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#FFFFFF'
                  e.currentTarget.style.borderColor = '#DDD6FE'
                  e.currentTarget.style.color = '#7C3AED'
                }}
              />
            </Tooltip>
            <Tooltip title={disabled ? '等待本次生成结束' : '拒绝本次生成'}>
              <Button
                size="small"
                disabled={disabled}
                onClick={onReject}
                icon={<CloseOutlined />}
                style={{
                  width: 32,
                  height: 32,
                  padding: 0,
                  color: '#DC2626',
                  background: '#FFFFFF',
                  border: '1px solid #FCA5A5',
                  borderRadius: 8,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#FEE2E2'
                  e.currentTarget.style.borderColor = '#EF4444'
                  e.currentTarget.style.color = '#B91C1C'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#FFFFFF'
                  e.currentTarget.style.borderColor = '#FCA5A5'
                  e.currentTarget.style.color = '#DC2626'
                }}
              />
            </Tooltip>
            <Tooltip title={disabled ? '等待本次生成结束' : '确认：写入数据'}>
              <Button
                size="small"
                disabled={disabled}
                loading={applying}
                onClick={onApply}
                icon={<CheckOutlined />}
                style={{
                  width: 32,
                  height: 32,
                  padding: 0,
                  color: write.riskLevel === 'high' ? '#EF4444' : '#10B981',
                  background: '#FFFFFF',
                  border: `1px solid ${write.riskLevel === 'high' ? '#FCA5A5' : '#6EE7B7'}`,
                  borderRadius: 8,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget
                  el.style.background = write.riskLevel === 'high' ? '#EF4444' : '#10B981'
                  el.style.color = '#FFFFFF'
                  el.style.borderColor = write.riskLevel === 'high' ? '#EF4444' : '#10B981'
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget
                  el.style.background = '#FFFFFF'
                  el.style.color = write.riskLevel === 'high' ? '#EF4444' : '#10B981'
                  el.style.borderColor = write.riskLevel === 'high' ? '#FCA5A5' : '#6EE7B7'
                }}
              />
            </Tooltip>
          </div>
        </div>
      ) : (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingTop: 8,
          borderTop: '1px solid #D1FAE5',
          fontSize: 12,
          color: '#059669',
        }}>
          <CheckOutlined />
          已应用{typeLabels[write.type] || write.type}结果
        </div>
      )}
    </Card>
  )
}

const MemoizedPendingWriteCard = memo(PendingWriteCard)

// ─── 消息操作按钮 ────────────────────────────────────────────

function renderIconButton(key: string, title: string, icon: React.ReactNode, onClick: () => void, danger = false) {
  return (
    <Tooltip key={key} title={title}>
      <Button
        type="text"
        size="small"
        icon={icon}
        onClick={onClick}
        style={{ width: 24, height: 24, padding: 0, borderRadius: 6, color: danger ? '#EF4444' : '#6B7280' }}
      />
    </Tooltip>
  )
}

// ─── 上下文弹窗 ──────────────────────────────────────────────

/** 把毫秒格式化为人类可读的运行时长（12ms / 1.2s / 1m 5.2s）。 */
function formatRunDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = ((ms % 60_000) / 1000).toFixed(1)
  return `${minutes}m ${seconds}s`
}

function ContextModal({
  open,
  onCancel,
  contextSnapshot,
}: {
  open: boolean
  onCancel: () => void
  contextSnapshot: AgentMessage['contextSnapshot']
}) {
  const [collapsedRounds, setCollapsedRounds] = useState<Record<number, boolean>>({})
  if (!contextSnapshot) return null
  const { memoryText, tools, userInput, modelName, fullMessages, rounds, chatHistory } = contextSnapshot as any

  const roundsList: Array<{
    label: string
    input?: Array<{ role: string; content: string }>
    output?: Array<{ role: string; content: string }>
    usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number; reasoningTokens?: number }
    durationMs?: number
  }> = (rounds && rounds.length > 0)
    ? rounds
    : (fullMessages && fullMessages.length > 0
        ? [{ label: '全部消息', input: fullMessages }]
        : [])

  const totalMsgCount = roundsList.reduce((sum, r) => sum + (r.input?.length || 0) + (r.output?.length || 0), 0)

  const TOOL_NAME_CN = toolNameMap

  const renderRoundUsageBadge = (usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number; reasoningTokens?: number }) => {
    if (!usage) return null
    const total = (usage.promptTokens || 0) + (usage.completionTokens || 0)
    const missTokens = Math.max(0, (usage.promptTokens || 0) - (usage.cachedTokens || 0))
    return (
      <Tooltip
        placement="left"
        title={
          <div style={{ fontSize: 12, lineHeight: 1.8, minWidth: 180 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span>输入</span>
              <span style={{ fontWeight: 600 }}>{usage.promptTokens}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingLeft: 12, color: '#10B981' }}>
              <span>· 缓存命中</span>
              <span style={{ fontWeight: 400 }}>{usage.cachedTokens ?? 0}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingLeft: 12, color: '#F59E0B' }}>
              <span>· 未命中</span>
              <span style={{ fontWeight: 400 }}>{missTokens}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 4, paddingTop: 4, borderTop: '1px dashed rgba(255,255,255,0.2)' }}>
              <span>输出</span>
              <span style={{ fontWeight: 600 }}>{usage.completionTokens}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingLeft: 12, color: '#8B5CF6' }}>
              <span>· 思考</span>
              <span style={{ fontWeight: 400 }}>{usage.reasoningTokens ?? 0}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingLeft: 12, color: '#0EA5E9' }}>
              <span>· 直出</span>
              <span style={{ fontWeight: 400 }}>{Math.max(0, (usage.completionTokens || 0) - (usage.reasoningTokens || 0))}</span>
            </div>
          </div>
        }
      >
        <span style={{
          fontSize: 12,
          color: '#6B7280',
          background: '#FFFFFF',
          border: '1px solid #E5E7EB',
          padding: '2px 10px',
          borderRadius: 12,
          cursor: 'help',
          userSelect: 'none',
        }}>
          <QuestionCircleOutlined style={{ fontSize: 11, marginRight: 4, color: '#9CA3AF' }} />
          Token 数：{total}
        </span>
      </Tooltip>
    )
  }

  const tabItems = [
    {
      key: 'all',
      label: `所有执行链 (${totalMsgCount})`,
      children: (
        <div style={{ maxHeight: 420, overflow: 'auto' }}>
          {roundsList.length === 0 ? (
            <div style={{ padding: 12, color: '#9CA3AF' }}>无</div>
          ) : (
            roundsList.map((round, roundIdx) => {
              const isCollapsed = !!collapsedRounds[roundIdx]
              return (
                <div key={roundIdx} style={{ marginBottom: 16 }}>
                  <div
                    onClick={() => setCollapsedRounds((prev) => ({ ...prev, [roundIdx]: !prev[roundIdx] }))}
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#4F46E5',
                      padding: '8px 12px',
                      background: '#F5F3FF',
                      borderRadius: 8,
                      marginBottom: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {isCollapsed
                        ? <RightOutlined style={{ fontSize: 10, color: '#6366F1' }} />
                        : <DownOutlined style={{ fontSize: 10, color: '#6366F1' }} />}
                      <span>{round.label}（输入 {round.input?.length || 0} 条 · 输出 {round.output?.length || 0} 条）</span>
                    </span>
                    <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      {round.durationMs !== undefined && round.durationMs !== null && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 8px',
                            fontSize: 12,
                            color: '#0F766E',
                            background: '#F0FDFA',
                            border: '1px solid #99F6E4',
                            borderRadius: 999,
                          }}
                          title="本轮实际耗时"
                        >
                          <ClockCircleOutlined style={{ fontSize: 11 }} />
                          {formatRunDuration(round.durationMs)}
                        </span>
                      )}
                      {renderRoundUsageBadge(round.usage)}
                    </span>
                  </div>
                  {!isCollapsed && (
                    <div style={{ paddingLeft: 12, borderLeft: '2px solid #E5E7EB' }}>
                      {(() => {
                        const inputMsgs = round.input || []
                        const outputMsgs = round.output || []
                        return (
                          <>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginTop: 4, marginBottom: 8 }}>
                              本轮输入
                            </div>
                            {inputMsgs.length === 0 ? (
                              <div style={{ fontSize: 12, color: '#D1D5DB', padding: '6px 12px' }}>无</div>
                            ) : (
                              inputMsgs.map((msg, msgIdx) => {
                                const roleLabel = msg.role === 'system' ? '系统' : msg.role === 'user' ? '用户' : msg.role === 'tool' ? '工具结果' : '调用工具'
                                const bg = msg.role === 'system' ? '#EEF2FF' : msg.role === 'user' ? '#DCFCE7' : '#FEF3C7'
                                const hasContent = !!msg.content
                                const hasToolCalls = !!(msg as any).tool_calls?.length
                                const TOOL_NAME_CN = toolNameMap
                                return (
                                  <div key={msgIdx} style={{
                                    marginBottom: 8,
                                    padding: 10,
                                    background: bg,
                                    borderRadius: 8,
                                  }}>
                                    <div style={{
                                      fontSize: 12,
                                      fontWeight: 700,
                                      color: '#6B7280',
                                      marginBottom: 6,
                                    }}>
                                      {roleLabel}
                                    </div>
                                    {hasContent && (
                                      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.6, margin: 0, marginBottom: hasToolCalls ? 8 : 0, fontFamily: 'inherit' }}>
                                        {msg.content}
                                      </pre>
                                    )}
                                    {hasToolCalls && (
                                      <div>
                                        {(msg as any).tool_calls.map((tc: any, tci: number) => (
                                          <div key={tci} style={{
                                            padding: 8,
                                            background: '#F3F4F6',
                                            borderRadius: 6,
                                            marginBottom: 4,
                                            fontSize: 12,
                                            lineHeight: 1.6,
                                            fontFamily: 'monospace',
                                            color: '#374151',
                                          }}>
                                            <div style={{ fontWeight: 700, color: '#4F46E5', marginBottom: 2 }}>
                                              {TOOL_NAME_CN[tc.function.name] || tc.function.name}
                                            </div>
                                            <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', fontSize: 12 }}>
                                              {(() => {
                                                try {
                                                  return JSON.stringify(JSON.parse(tc.function.arguments), null, 2)
                                                } catch {
                                                  return tc.function.arguments
                                                }
                                              })()}
                                            </pre>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {!hasContent && !hasToolCalls && (
                                      <div style={{ fontSize: 12, color: '#D1D5DB' }}>无</div>
                                    )}
                                  </div>
                                )
                              })
                            )}
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginTop: 8, marginBottom: 8 }}>
                              本轮输出
                            </div>
                            {outputMsgs.length === 0 ? (
                               <div style={{ fontSize: 12, color: '#D1D5DB', padding: '6px 12px' }}>无</div>
                             ) : (
                               outputMsgs.map((msg, msgIdx) => {
                                  const hasContent = !!msg.content
                                  const hasToolCalls = !!(msg as any).tool_calls?.length
                                  const TOOL_NAME_CN = toolNameMap
                                  return (
                                   <div key={msgIdx} style={{
                                     marginBottom: 8,
                                     padding: 10,
                                     background: '#F6F7FB',
                                     borderRadius: 8,
                                   }}>
                                     <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7280', marginBottom: 6 }}>
                                       模型返回
                                     </div>
                                     {hasContent && (
                                       <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.6, margin: 0, marginBottom: hasToolCalls ? 8 : 0, fontFamily: 'inherit' }}>
                                         {msg.content}
                                       </pre>
                                     )}
                                     {hasToolCalls && (
                                       <div>
                                         {(msg as any).tool_calls.map((tc: any, tci: number) => (
                                           <div key={tci} style={{
                                             padding: 8,
                                             background: '#F3F4F6',
                                             borderRadius: 6,
                                             marginBottom: 4,
                                             fontSize: 12,
                                             lineHeight: 1.6,
                                             fontFamily: 'monospace',
                                             color: '#374151',
                                           }}>
                                             <div style={{ fontWeight: 700, color: '#4F46E5', marginBottom: 2 }}>
                                               {TOOL_NAME_CN[tc.function.name] || tc.function.name}
                                             </div>
                                             <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', fontSize: 12 }}>
                                               {(() => {
                                                 try {
                                                   return JSON.stringify(JSON.parse(tc.function.arguments), null, 2)
                                                 } catch {
                                                   return tc.function.arguments
                                                 }
                                               })()}
                                             </pre>
                                           </div>
                                         ))}
                                       </div>
                                     )}
                                     {!hasContent && !hasToolCalls && (
                                       <div style={{ fontSize: 12, color: '#D1D5DB' }}>无</div>
                                     )}
                                   </div>
                                 )
                               })
                             )}
                          </>
                        )
                      })()}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      ),
    },
    {
      key: 'memory',
      label: '创作记忆',
      children: (
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.6, margin: 0, padding: 12, background: '#F9FAFB', borderRadius: 8, maxHeight: 420, overflow: 'auto' }}>
          {memoryText || '无'}
        </pre>
      ),
    },
    {
      key: 'tools',
      label: `可用工具 (${tools.length})`,
      children: (
        <div style={{ maxHeight: 420, overflow: 'auto' }}>
          {tools.map((tool: any) => (
            <div key={tool.name} style={{ marginBottom: 12, padding: 12, background: '#F9FAFB', borderRadius: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>{toolNameMap[tool.name] || tool.name}</div>
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>{tool.description}</div>
            </div>
          ))}
        </div>
      ),
    },
    {
      key: 'chat',
      label: `聊天记录${chatHistory?.length ? ` (${chatHistory.length})` : ''}`,
      children: (
        <div style={{ maxHeight: 420, overflow: 'auto' }}>
          {!chatHistory || chatHistory.length === 0 ? (
            <div style={{ padding: 12, color: '#9CA3AF' }}>本轮未携带聊天记录（可在 「知卷」 设置中调大「携带聊天记录条数」）</div>
          ) : (
            chatHistory.map((msg: any, idx: number) => {
              const isUser = msg.role === 'user'
              return (
                <div key={idx} style={{ marginBottom: 8, padding: 10, background: isUser ? '#DCFCE7' : '#F6F7FB', borderRadius: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#6B7280', marginBottom: 6 }}>
                    {isUser ? '用户' : '「知卷」'}
                  </div>
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.6, margin: 0, fontFamily: 'inherit' }}>
                    {msg.content}
                  </pre>
                </div>
              )
            })
          )}
        </div>
      ),
    },
  ]

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      footer={null}
      centered
      title={`本次请求执行链 · ${modelName}`}
      width={960}
      styles={{ body: { paddingTop: 12, maxHeight: 760 } }}
    >
      <Tabs items={tabItems} defaultActiveKey="all" />
    </Modal>
  )
}

// ─── 应用确认弹窗（可编辑） ──────────────────────────────────

const applyModeLabels: Record<string, string> = {
  append: '追加',
  replace: '覆盖',
  insert: '新建',
  merge: '合并',
  update: '更新',
  none: '执行',
}

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

function ApplyConfirmModal({
  open,
  write,
  onCancel,
  onConfirm,
  applying,
}: {
  open: boolean
  write: PendingWrite | null
  onCancel: () => void
  onConfirm: (modifiedData: any) => void
  applying: boolean
}) {
  const [editData, setEditData] = useState<any>({})

  useEffect(() => {
    if (write) {
      setEditData(JSON.parse(JSON.stringify(write.data || {})))
    }
  }, [write])

  if (!write) return null

  const updateField = (key: string, value: any) => {
    setEditData((prev: any) => ({ ...prev, [key]: value }))
  }

  const updateItem = (idx: number, key: string, value: any) => {
    setEditData((prev: any) => {
      const items = [...(prev.items || [])]
      items[idx] = { ...items[idx], [key]: value }
      return { ...prev, items }
    })
  }

  const renderEditor = () => {
    switch (write.type) {
      case 'book_info':
        return (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 4 }}>书名</label>
              <Input value={editData.title || ''} onChange={(e) => updateField('title', e.target.value)} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 4 }}>简介</label>
              <TextArea value={editData.description || ''} onChange={(e) => updateField('description', e.target.value)} rows={2} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 4 }}>详情</label>
              <TextArea value={editData.detail || ''} onChange={(e) => updateField('detail', e.target.value)} rows={4} />
            </div>
          </>
        )
      case 'book_outline':
        return (
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 4 }}>大纲内容</label>
            <TextArea
              value={editData.content || ''}
              onChange={(e) => updateField('content', e.target.value)}
              rows={16}
              style={{ fontFamily: 'monospace', fontSize: 13 }}
            />
          </div>
        )
      case 'chapter_content':
        // 正文内容不提供 Markdown 预览，只保留纯文本编辑（用户拍板 2026-07-28）。
        return (
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 4 }}>正文内容</label>
            <TextArea
              value={editData.content || ''}
              onChange={(e) => updateField('content', e.target.value)}
              rows={16}
              style={{ fontFamily: 'monospace', fontSize: 13 }}
            />
          </div>
        )
      case 'volume_outline':
      case 'chapter_outline':
        return (
          <div>
            <label style={{ display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 4 }}>大纲内容</label>
            <TextArea value={editData.outline || ''} onChange={(e) => updateField('outline', e.target.value)} rows={16} style={{ fontFamily: 'monospace', fontSize: 13 }} />
          </div>
        )
      case 'volume_list':
        return (
          <div>
            {(editData.items || []).map((item: any, idx: number) => (
              <div key={idx} style={{ marginBottom: 16, padding: 12, border: '1px solid #E5E7EB', borderRadius: 8 }}>
                <div style={{ fontWeight: 700, color: '#111827', marginBottom: 8 }}>分卷 {idx + 1}</div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 4 }}>名称</label>
                  <Input value={item.title || ''} onChange={(e) => updateItem(idx, 'title', e.target.value)} />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 4 }}>简介</label>
                  <TextArea value={item.description || ''} onChange={(e) => updateItem(idx, 'description', e.target.value)} rows={2} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 4 }}>大纲</label>
                  <TextArea value={item.outline || ''} onChange={(e) => updateItem(idx, 'outline', e.target.value)} rows={4} style={{ fontFamily: 'monospace', fontSize: 13 }} />
                </div>
              </div>
            ))}
          </div>
        )
      case 'chapter_list':
        return (
          <div>
            {(editData.items || []).map((item: any, idx: number) => (
              <div key={idx} style={{ marginBottom: 16, padding: 12, border: '1px solid #E5E7EB', borderRadius: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#9CA3AF', marginBottom: 8 }}>章节 {idx + 1}</div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 4 }}>名称</label>
                  <Input value={item.title || ''} onChange={(e) => updateItem(idx, 'title', e.target.value)} />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 4 }}>简介</label>
                  <TextArea value={item.summary || ''} onChange={(e) => updateItem(idx, 'summary', e.target.value)} rows={2} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 4 }}>大纲</label>
                  <TextArea value={item.outline || ''} onChange={(e) => updateItem(idx, 'outline', e.target.value)} rows={4} style={{ fontFamily: 'monospace', fontSize: 13 }} />
                </div>
              </div>
            ))}
          </div>
        )
      case 'book_setting':
        return (
          <div>
            {(editData.items || []).map((item: any, idx: number) => (
              <div key={idx} style={{ marginBottom: 16, padding: 12, border: '1px solid #E5E7EB', borderRadius: 8 }}>
                <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 8 }}>条目 {idx + 1}</div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 4 }}>名称</label>
                  <Input value={item.name || ''} onChange={(e) => updateItem(idx, 'name', e.target.value)} />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 4 }}>简介</label>
                  <TextArea value={item.description || ''} onChange={(e) => updateItem(idx, 'description', e.target.value)} rows={2} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 4 }}>详情</label>
                  <TextArea value={item.detail || ''} onChange={(e) => updateItem(idx, 'detail', e.target.value)} rows={4} />
                </div>
              </div>
            ))}
          </div>
        )
      case 'delete_entity':
        return (
          <div style={{ padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
            此操作无需编辑内容，请直接确认。
          </div>
        )
      case 'chapter_snapshot':
        return (
          <SnapshotDetailView
            snapshotData={editData.snapshotData}
            previousSnapshotData={editData.previousSnapshotData}
          />
        )
      default:
        return (
          <div style={{ padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
            不支持编辑此类型的内容。
          </div>
        )
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title="结果确认"
      width={900}
      centered
      style={{ height: 'calc(100vh * 0.8)', maxHeight: 'none' }}
      styles={{
        body: { height: 'calc(100% - 120px)', overflowY: 'auto' },
      }}
      footer={[
        <Button key="cancel" onClick={onCancel}>取消</Button>,
        <Button
          key="confirm"
          type="primary"
          loading={applying}
          onClick={() => onConfirm(editData)}
          danger={write.riskLevel === 'high'}
        >
          确认保存
        </Button>,
      ]}
    >
      {/* 意图信息 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #F3F4F6' }}>
        <Tag color="blue">{typeLabels[write.type] || write.type}</Tag>
        <Tag color={write.applyMode === 'insert' ? 'green' : write.applyMode === 'replace' ? 'orange' : 'default'}>
          {applyModeLabels[write.applyMode] || write.applyMode}
        </Tag>
        {write.riskLevel === 'high' && (
          <Tag color="red">高风险</Tag>
        )}
        <span style={{ fontSize: 13, color: '#6B7280', marginLeft: 'auto' }}>{write.title}</span>
      </div>

      {/* 可编辑内容 */}
      <div style={{ maxHeight: 480, overflowY: 'auto', paddingRight: 4 }}>
        {renderEditor()}
      </div>
    </Modal>
  )
}

// ─── 消息项 ──────────────────────────────────────────────────
// 用 React.memo 包裹避免消息列表在无关状态变化时（例如 hover 其它消息、input 输入）
// 触发全量重渲染。onXxx 系列 handler 由父组件用 useCallback 稳定引用。
const MessageItem = memo(function MessageItem({
  message,
  onApply,
  onApplyAll,
  onDelete,
  onCopy,
  onRetry,
  onViewContext,
  onDiscard,
  onRerun,
  onReject,
  applyingId,
}: {
  message: AgentMessage
  onApply: (writeId: string) => void
  onApplyAll: () => void
  onDelete: () => void
  onCopy: () => void
  onRetry: () => void
  onViewContext: () => void
  onDiscard: (writeId: string) => void
  onRerun: (writeId: string) => void
  onReject: (writeId: string) => void
  applyingId: string | null
}) {
  const [hovered, setHovered] = useState(false)
  const [showReasoning, setShowReasoning] = useState(true)
  const isUser = message.role === 'user'
  const hasPendingWrites = message.pendingWrites && message.pendingWrites.length > 0
  const unappliedCount = message.pendingWrites?.filter((w) => !w.applied).length || 0
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0
  const hasContext = !!message.contextSnapshot
  const hasRunningTool = message.toolCalls?.some(isToolRunning) || false
  const hasRunningWriteTool = message.toolCalls?.some((tc) => isContentGeneratingTool(tc.call.name) && isToolRunning(tc)) || false
  // 找出正在运行的写工具中最早的 startedAt，作为"内容生成中(mm:ss)"计时基准
  const runningWriteStartedAt = message.toolCalls
    ?.filter((tc) => isContentGeneratingTool(tc.call.name) && isToolRunning(tc) && tc.startedAt)
    .reduce<number | undefined>((min, tc) => (min === undefined ? tc.startedAt : Math.min(min, tc.startedAt || min)), undefined)
  const missCacheTokens = message.usage?.cachedPromptTokens !== undefined
    ? Math.max(0, message.usage.promptTokens - message.usage.cachedPromptTokens)
    : undefined
  // 缓存命中价未填写时，展示上默认回退到输入价格（与模型设置页、后端计费逻辑一致）
  const effectiveCachedPrice = message.usage?.cachedPrice ?? message.usage?.inputPrice

  const getMessageActions = () => {
    const actions: React.ReactNode[] = []
    // 仅用户自己的消息提供「重来」：把该条消息内容回填到输入框，重新发起对话
    if (isUser && !message.streaming) {
      actions.push(renderIconButton('retry', '重来', <SyncOutlined />, onRetry))
    }
    if (!message.streaming && (message.content || '').trim()) {
      actions.push(renderIconButton('copy', '复制', <CopyOutlined />, onCopy))
    }
    if (!isUser && hasContext) {
      actions.push(renderIconButton('context', '查看执行链', <OrderedListOutlined />, onViewContext))
    }
    actions.push(
      <Popconfirm
        key="delete"
        title="删除这条聊天记录？"
        description="删除后无法恢复。"
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        onConfirm={onDelete}
      >
        {/* 不再用 renderIconButton 包 Tooltip：Popconfirm + Tooltip 嵌套时会因为 Tooltip 拦截 onClick，
            导致 Popconfirm 拿不到点击事件、气泡弹不出来。这里直接用 Button，把 title 作为 aria-label 保留。 */}
        <Button
          key="delete-button"
          type="text"
          size="small"
          aria-label="删除"
          icon={<DeleteOutlined />}
          style={{ width: 24, height: 24, padding: 0, borderRadius: 6, color: '#EF4444' }}
        />
      </Popconfirm>
    )
    return actions
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', flexDirection: isUser ? 'row-reverse' : 'row', gap: 10, alignItems: 'flex-start' }}
    >
      {/* 头像 */}
      <div style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        background: isUser ? '#4F46E5' : 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
        color: '#FFFFFF',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        flexShrink: 0,
      }}>
        {isUser ? <UserOutlined /> : <RobotOutlined />}
      </div>

      {/* 消息内容 */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
        {/* 消息卡片容器：包裹工具调用、文本内容、结果卡片。
         * 宽度策略：`maxWidth: 80%` 限制上限，`width: fit-content` 让容器整体宽度**由内容决定**。
         * 用量行和操作按钮在卡片外作为兄弟元素，继承相同的对齐方式但不影响卡片宽度。
         */}
        <div style={{ maxWidth: '80%', width: 'fit-content', display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
          {/* 工具调用 */}
          {hasToolCalls && (
            <div style={{ marginBottom: 8, width: '100%' }}>
              {message.toolCalls!.map((tc) => (
                <MemoizedToolCallItem key={tc.call.id} call={tc.call} result={tc.result} />
              ))}
            </div>
          )}

          {/* 推理模型的"思考过程"：随 reasoning_content 流式增长，可折叠 */}
          {message.reasoningContent && (
            <div style={{ marginBottom: 8, width: '100%' }}>
              <div
                onClick={() => setShowReasoning((v) => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#9CA3AF', cursor: 'pointer', userSelect: 'none' }}
              >
                <DownOutlined style={{ fontSize: 10, transform: showReasoning ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                {message.streaming ? '思考中…' : '思考过程'}
              </div>
              {showReasoning && (
                <div style={{
                  marginTop: 4,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: '#F3F4F6',
                  color: '#6B7280',
                  fontSize: 13,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                  maxHeight: 320,
                  overflowY: 'auto',
                }}>
                  {message.reasoningContent}
                </div>
              )}
            </div>
          )}

          {/* 文本内容 */}
          {(message.content || message.streaming) && (
            <div style={{
              padding: '12px 16px',
              borderRadius: 14,
              background: isUser ? '#DCFCE7' : '#F6F7FB',
              color: isUser ? '#166534' : '#111827',
              fontSize: 14,
              lineHeight: 1.7,
              // 去掉 minWidth，改用 fit-content 让"思考中..."之类的短内容气泡宽度按内容收缩。
              // 由于父容器 maxWidth 已是 80%，气泡自身 maxWidth: 100% 就是 80% 的上限。
              width: 'fit-content',
              maxWidth: '100%',
              boxSizing: 'border-box',
              overflow: 'hidden',
              overflowWrap: 'break-word',
            }}>
            {isUser ? (
              <div>
                {message.autoResumed && (
                  <div style={{
                    fontSize: 11,
                    color: '#7C3AED',
                    marginBottom: 4,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}>
                    <SyncOutlined style={{ fontSize: 11 }} />
                    自动续跑（应用后触发）
                  </div>
                )}
                <span style={{ whiteSpace: 'pre-wrap', display: 'block' }}>{message.content}</span>
              </div>
            ) : (
              <>
                {message.streaming && !message.content && !hasRunningTool && (
                  <span style={{ color: '#6B7280', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Spin size="small" /> 思考中 · (<LiveTimer startedAt={message.createdAt} />)
                  </span>
                )}
                {message.content && (
              // 无论 streaming 与否都走 MDXViewer：
              //   - streaming 期间 MDXViewer 会通过 ensureFencesBalanced 自动补齐未闭合的 ```tool_call fence，
              //     ToolCallBlock 就能立即渲染成胶囊样式（"正在调用 XX 工具"），
              //     用户不会看到裸 JSON 明文渐进渲染。
              //   - streaming 结束后视觉与结构一致，避免"最后一刻突变"。
              <MDXViewer content={message.content} style={{ maxWidth: '100%' }} />
            )}
                {/* 模型调用失败时，在卡片内部再次展示错误原因（与卡片外的红色小标重复，
                    用户明确要求把错误信息放在卡片里面，方便阅读） */}
                {message.errorMessage && !message.aborted && !message.streaming && (
                  <div style={{
                    marginTop: 10,
                    padding: '8px 12px',
                    background: '#FEF2F2',
                    border: '1px solid #FECACA',
                    borderRadius: 8,
                    color: '#B91C1C',
                    fontSize: 13,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}>
                    <span style={{ fontWeight: 600 }}>模型调用失败：</span>
                    {message.errorMessage}
                  </div>
                )}
                {/* 内容生成中：正在跑一个"生成大段内容"的写工具时显示，放在文本下方 */}
                {hasRunningWriteTool && (
                  <span style={{ marginTop: message.content ? 8 : 0, color: '#10B981', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Spin size="small" />
                    <span>
                      内容生成中{runningWriteStartedAt ? <> · (<LiveTimer startedAt={runningWriteStartedAt} />)</> : '...'}
                    </span>
                  </span>
                )}
                {/* AI 输出完一段文本后可能仍在流式调用下一个工具/继续生成；此时补一个"正在工作..."
                    提示，避免看起来像卡死。条件：消息仍在 streaming，且已经有文本内容
                    （thinking / write 的两条提示由前面两处独立分支处理）。 */}
                {message.streaming && message.content && !hasRunningWriteTool && (
                  <WorkingIndicator startedAt={message.createdAt} />
                )}
              </>
            )}
          </div>
        )}

        {/* Pending 写操作（结果卡片）
         * 放在"消息气泡（content）"之后、"Token 行（¥/⏱️ 与右侧操作按钮）"之前，
         * 让用户看到的顺序是：AI 正文 → 应用卡片 → 用量/操作。
         * 位置在气泡外框（maxWidth: 80% 的容器）内，宽度跟随。
         */}
        {hasPendingWrites && (
          <div style={{ marginTop: 12, alignSelf: 'stretch' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: '#6B7280' }}>待应用操作</span>
              {unappliedCount > 1 && (
                <Button type="link" size="small" disabled={message.streaming} onClick={onApplyAll} style={{ padding: 0, fontSize: 12 }}>
                  全部应用（{unappliedCount}）
                </Button>
              )}
              {/* 应用完成后自动续跑提示：本消息里有前置卡（isPrerequisite）且尚未全部应用时显示 */}
              {(() => {
                const prereqs = (message.pendingWrites || []).filter((w: any) => w.isPrerequisite === true)
                const hasUnappliedPrereq = prereqs.some((w) => !w.applied)
                if (!hasUnappliedPrereq) return null
                return (
                  <span style={{
                    marginLeft: 'auto',
                    fontSize: 11,
                    color: '#7C3AED',
                    background: '#F5F3FF',
                    border: '1px solid #DDD6FE',
                    borderRadius: 12,
                    padding: '2px 10px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}>
                    <SyncOutlined style={{ fontSize: 11 }} />
                    应用完成后 AI 会自动继续
                  </span>
                )
              })()}
            </div>
            {message.pendingWrites!.map((write) => {
              // 从 message.toolCalls 里找到产出此 pendingWrite 的工具调用，拿到耗时
              const producingTool = message.toolCalls?.find(
                (tc) => tc.result?.data?.pendingWriteId === write.id,
              )
              const elapsedMs = producingTool?.startedAt && producingTool?.finishedAt
                ? producingTool.finishedAt - producingTool.startedAt
                : undefined
              return (
                <MemoizedPendingWriteCard
                  key={write.id}
                  write={write}
                  onApply={() => onApply(write.id)}
                  applying={applyingId === write.id}
                  onDiscard={() => onDiscard(write.id)}
                  onRerun={() => onRerun(write.id)}
                  onReject={() => onReject(write.id)}
                  elapsedMs={elapsedMs}
                  disabled={message.streaming}
                />
              )
            })}
          </div>
        )}

        {/* Token + 操作按钮 同行
         * 放在消息卡片容器（maxWidth: 80% / width: fit-content）内部，让此行的宽度
         * 恰好等于气泡/工具调用等内容决定的卡片宽度，
         * 从而 `justifyContent: 'space-between'` 能把右侧按钮组顶到卡片右边缘。
         */}
        <div style={{ marginTop: 10, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          {/* 左侧 Token 用量 */}
          <div>
            {message.usage && !message.streaming && (
              <div style={{ fontSize: 11, color: '#9CA3AF', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Tooltip
                  title={
                    <div style={{ whiteSpace: 'normal' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', marginBottom: 8 }}>
                        Token 消耗详情
                        {message.contextSnapshot?.modelName ? ` · ${message.contextSnapshot.modelName}` : ''}
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
                        <span style={{ width: 72, textAlign: 'right', color: '#111827', fontWeight: 600 }}>{message.usage.promptTokens.toLocaleString()}</span>
                        <span style={{ width: 72, textAlign: 'right', color: '#9CA3AF', fontSize: 11 }}>—</span>
                        <span style={{ width: 90, textAlign: 'right', color: '#111827', fontWeight: 600 }}>¥{formatCost((message.usage.missCost || 0) + (message.usage.cacheCost || 0), 6)}</span>
                      </div>

                      {/* 缓存命中（恒显示，缺失取 0） */}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, lineHeight: 2, paddingLeft: 16 }}>
                        <span style={{ flex: 1, color: '#16A34A' }}>· 缓存命中</span>
                        <span style={{ width: 72, textAlign: 'right', color: '#16A34A' }}>{(message.usage.cachedPromptTokens ?? 0).toLocaleString()}</span>
                        <span style={{ width: 72, textAlign: 'right', color: '#16A34A' }}>{effectiveCachedPrice !== undefined ? `¥${effectiveCachedPrice}/M` : '—'}</span>
                        <span style={{ width: 90, textAlign: 'right', color: '#16A34A' }}>¥{formatCost(message.usage.cacheCost ?? 0, 6)}</span>
                      </div>

                      {/* 未命中（恒显示，缺失取 0） */}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, lineHeight: 2, paddingLeft: 16 }}>
                        <span style={{ flex: 1, color: '#F59E0B' }}>· 未命中</span>
                        <span style={{ width: 72, textAlign: 'right', color: '#F59E0B' }}>{(missCacheTokens ?? Math.max(0, (message.usage.promptTokens || 0) - (message.usage.cachedPromptTokens || 0))).toLocaleString()}</span>
                        <span style={{ width: 72, textAlign: 'right', color: '#F59E0B' }}>{message.usage.inputPrice !== undefined ? `¥${message.usage.inputPrice}/M` : '—'}</span>
                        <span style={{ width: 90, textAlign: 'right', color: '#F59E0B' }}>¥{formatCost(message.usage.missCost ?? 0, 6)}</span>
                      </div>

                      {/* 输出 */}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, lineHeight: 2 }}>
                        <span style={{ flex: 1, color: '#64748B' }}>输出</span>
                        <span style={{ width: 72, textAlign: 'right', color: '#111827', fontWeight: 600 }}>{message.usage.completionTokens.toLocaleString()}</span>
                        <span style={{ width: 72, textAlign: 'right', color: '#9CA3AF', fontSize: 11 }}>—</span>
                        <span style={{ width: 90, textAlign: 'right', color: '#111827', fontWeight: 600 }}>¥{formatCost(message.usage.outputCost ?? 0, 6)}</span>
                      </div>

                      {/* 思考（reasoning_tokens，恒显示） */}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, lineHeight: 2, paddingLeft: 16 }}>
                        <span style={{ flex: 1, color: '#8B5CF6' }}>· 思考</span>
                        <span style={{ width: 72, textAlign: 'right', color: '#8B5CF6' }}>{(message.usage.reasoningTokens ?? 0).toLocaleString()}</span>
                        <span style={{ width: 72, textAlign: 'right', color: '#8B5CF6' }}>{message.usage.outputPrice !== undefined ? `¥${message.usage.outputPrice}/M` : '—'}</span>
                        <span style={{ width: 90, textAlign: 'right', color: '#8B5CF6' }}>
                          ¥{formatCost(((message.usage.reasoningTokens || 0) / 1_000_000) * (message.usage.outputPrice || 0), 6)}
                        </span>
                      </div>

                      {/* 直出 = 输出 - 思考（恒显示） */}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, lineHeight: 2, paddingLeft: 16 }}>
                        <span style={{ flex: 1, color: '#0EA5E9' }}>· 直出</span>
                        <span style={{ width: 72, textAlign: 'right', color: '#0EA5E9' }}>{Math.max(0, (message.usage.completionTokens || 0) - (message.usage.reasoningTokens || 0)).toLocaleString()}</span>
                        <span style={{ width: 72, textAlign: 'right', color: '#0EA5E9' }}>{message.usage.outputPrice !== undefined ? `¥${message.usage.outputPrice}/M` : '—'}</span>
                        <span style={{ width: 90, textAlign: 'right', color: '#0EA5E9' }}>
                          ¥{formatCost((Math.max(0, (message.usage.completionTokens || 0) - (message.usage.reasoningTokens || 0)) / 1_000_000) * (message.usage.outputPrice || 0), 6)}
                        </span>
                      </div>

                      {/* 合计 */}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, lineHeight: 2, marginTop: 6, fontWeight: 600, paddingTop: 6, borderTop: '1px dashed #E5E7EB' }}>
                        <span style={{ flex: 1, color: '#111827' }}>合计</span>
                        <span style={{ width: 72, textAlign: 'right', color: '#4F46E5' }}>{message.usage.totalTokens.toLocaleString()}</span>
                        <span style={{ width: 72, textAlign: 'right' }}></span>
                        <span style={{ width: 90, textAlign: 'right', color: '#EF4444' }}>¥{formatCost(message.usage.cost, 6)}</span>
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
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'help' }}>
                    <QuestionCircleOutlined style={{ fontSize: 12, color: '#94A3B8' }} />
                    {message.usage.cost > 0 && (
                      <span style={{ color: '#EF4444', fontWeight: 500 }}>¥{formatCost(message.usage.cost, 4)}</span>
                    )}
                  </span>
                </Tooltip>

                {/* 运行时长（悬浮显示每一步耗时） */}
                {(() => {
                  const rounds = message.contextSnapshot?.rounds
                  if (!rounds || rounds.length === 0) return null
                  const totalMs = rounds.reduce((s, r) => s + (r.durationMs || 0), 0)
                  if (totalMs <= 0) return null
                  return (
                    <Popover
                      placement="top"
                      content={
                        <div style={{ fontSize: 12, minWidth: 240 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 8 }}>运行时长</div>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <tbody>
                              {rounds.map((r, idx) => (
                                <tr key={idx}>
                                  <td style={{ padding: '4px 8px 4px 0', color: '#6B7280', whiteSpace: 'nowrap' }}>{r.label}</td>
                                  <td style={{ textAlign: 'right', padding: '4px 0', color: '#0F766E', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                    {r.durationMs !== undefined && r.durationMs !== null ? formatRunDuration(r.durationMs) : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      }
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'help', marginLeft: 16 }}>
                        <ClockCircleOutlined style={{ fontSize: 12, color: '#94A3B8' }} />
                        <span style={{ color: '#0F766E', fontWeight: 500 }}>{formatRunDuration(totalMs)}</span>
                      </span>
                    </Popover>
                  )
                })()}
              </div>
            )}
          </div>

          {/* 右侧操作按钮 */}
          <div
            style={{
              opacity: hovered ? 1 : 0,
              pointerEvents: hovered ? 'auto' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              padding: '3px 6px',
              borderRadius: 8,
              background: '#F3F4F6',
              transition: 'opacity 0.15s ease',
            }}
          >
            {getMessageActions()}
          </div>
        </div>
        </div>

      {/* 中断标记 */}
      {message.aborted && (
        <div style={{ marginTop: 4, fontSize: 12, color: '#EF4444' }}>已中断</div>
      )}
      </div>
    </div>
  )
}, (prev, next) => (
  // 只比较真正影响 UI 的 props；onXxx 回调虽然每次 render 都是新引用，
  // 但它们只把 msg.id 桥接给父组件的稳定 handler，回调本身不影响该条消息的展示。
  prev.message === next.message &&
  prev.applyingId === next.applyingId
))

// ─── 模型选择器 ──────────────────────────────────────────────

function ModelSelector({
  models,
  value,
  onChange,
}: {
  models: ModelProvider[]
  value: string
  onChange: (id: string) => void
}) {
  const selected = models.find((m) => m.id === value)

  const providerColor = (provider: string) => {
    const map: Record<string, string> = {
      deepseek: '#4F46E5',
      openai: '#10A37F',
      xai: '#111827',
      grok: '#111827',
      anthropic: '#D97757',
      gemini: '#8E75B7',
      custom: '#6B7280',
    }
    return map[provider.toLowerCase()] || '#6B7280'
  }

  const providerInitial = (provider: string) => {
    return provider.charAt(0).toLowerCase()
  }

  return (
    <Select
      value={value}
      onChange={onChange}
      style={{ flex: 1, minWidth: 0 }}
      placeholder="选择模型"
      className="agent-model-select"
      variant="borderless"
      // 触发器可能很窄（尤其侧栏模式），下拉框固定给个合理的最小宽度，避免"deepseek-v4-fla…"这种截断
      popupMatchSelectWidth={false}
      styles={{
        popup: {
          root: { borderRadius: 12, padding: 6, minWidth: 280 },
        },
      }}
      optionLabelProp="label"
      options={models.filter((m) => m.enabled).map((m) => ({
        value: m.id,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: providerColor(m.provider),
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 600,
            }}>
              {providerInitial(m.provider)}
            </div>
            <span>{m.name}</span>
          </div>
        ),
      }))}
      optionRender={(option) => {
        const m = models.find((x) => x.id === option.value)
        if (!m) return null
        const isSelected = m.id === value
        return (
          <div className="agent-model-option">
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: providerColor(m.provider),
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              fontWeight: 600,
            }}>
              {providerInitial(m.provider)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, color: '#111827', fontWeight: 500 }}>{m.name}</div>
              <div style={{ fontSize: 12, color: '#9CA3AF' }}>{m.provider}</div>
            </div>
            {isSelected && (
              <CheckCircleOutlined style={{ color: '#10B981', fontSize: 16 }} />
            )}
          </div>
        )
      }}
    />
  )
}

// ─── 主页面 ──────────────────────────────────────────────────

export default function AgentPage({ isPanel = false }: { isPanel?: boolean }) {
  const { messages, activeRun, sendMessage, stopRun, applyWrite, applyAll, clearMessages, loadMessages, saveMessages } = useAgentStore()
  const { models, loadModels } = useModelStore()
  const { currentBook } = useWorkspaceStore()

  const [input, setInput] = useState('')
  // 从 localStorage 恢复上次选中的模型 ID；下次进入 Agent 页时自动沿用，避免每次都要重选。
  // 记住的是 modelId 本身，若该模型已被删除/禁用会在下方的 useEffect 里回退到第一个启用模型。
  const AGENT_MODEL_LS_KEY = 'agent:selectedModelId'
  const [modelId, setModelIdState] = useState<string>(() => {
    try { return localStorage.getItem(AGENT_MODEL_LS_KEY) || '' } catch { return '' }
  })
  const setModelId = (id: string) => {
    setModelIdState(id)
    try { localStorage.setItem(AGENT_MODEL_LS_KEY, id || '') } catch {}
  }
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [contextMessage, setContextMessage] = useState<AgentMessage | null>(null)
  const [applyConfirm, setApplyConfirm] = useState<{ messageId: string; write: PendingWrite } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)
  // 聊天历史默认只渲染最新 N 条；点击"加载更早"逐批向上展开。
  // 注意：store 里的 messages 必须保持全量（saveMessages 是全量覆盖式持久化，
  // 若只加载部分进 store，自动保存会把更早的历史从数据库抹掉），这里只裁剪**渲染**。
  const DEFAULT_VISIBLE_MESSAGES = 6
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE_MESSAGES)

  // 加载模型列表（首次挂载）
  useEffect(() => {
    loadModels()
  }, [loadModels])

  // 校正 modelId：若 localStorage 里存的模型已经不在启用列表中（被删除 / 被禁用），
  // 或者第一次进入根本没存过，就自动选中第一个启用的模型。这样"记忆模型"与"兜底默认"两件事都覆盖。
  useEffect(() => {
    if (models.length === 0) return
    const stillValid = modelId && models.some((m) => m.id === modelId && m.enabled)
    if (!stillValid) {
      const enabled = models.find((m) => m.enabled)
      if (enabled) setModelId(enabled.id)
    }
  }, [models, modelId])

  // 书籍切换时加载对应的消息（避免旧代码里两个 useEffect 都触发导致 loadMessages 跑 2 次）
  // 同时把可见条数重置为默认值，避免上一本书"展开的更早历史"泄漏到新书视图。
  useEffect(() => {
    setVisibleCount(DEFAULT_VISIBLE_MESSAGES)
    loadMessages(currentBook?.id || null)
  }, [currentBook?.id])

  // 消息变化时自动保存到数据库
  // 依赖 [messages, currentBook?.id]：书切换时也重新排队保存到正确的桶，避免"用新桶写旧内容 / 旧桶写新内容"的漂移。
  // 兜底：内存 messages 为空时**不**触发保存，避免"新建书后短暂读到空桶 → 反手把桶写死为空"这类灾难。
  // 用户想清空聊天时应该走显式的 clearMessages 入口。
  useEffect(() => {
    if (!messages || messages.length === 0) return
    const bookId = currentBook?.id || null
    const debounce = setTimeout(() => {
      saveMessages(bookId)
    }, 1000)
    return () => clearTimeout(debounce)
  }, [messages, currentBook?.id])

  // 监听设置页的清空聊天记录事件
  useEffect(() => {
    const handler = () => {
      clearMessages()
    }
    window.addEventListener('chat-messages-cleared', handler)
    return () => window.removeEventListener('chat-messages-cleared', handler)
  }, [clearMessages])

  // 自动滚动到底部（仅在用户已经在底部时）
  useEffect(() => {
    const scrollContainer = scrollRef.current
    if (!scrollContainer) return
    
    if (isAtBottomRef.current) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight
    }
  }, [messages])

  const handleScroll = () => {
    const scrollContainer = scrollRef.current
    if (!scrollContainer) return
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer
    isAtBottomRef.current = scrollTop + clientHeight >= scrollHeight - 50
  }

  // 展开更早的一批历史消息，并保持当前阅读位置不跳动：
  // 记录展开前的 scrollHeight/scrollTop，渲染后把增量补回 scrollTop。
  const handleLoadEarlier = () => {
    const sc = scrollRef.current
    const prevHeight = sc?.scrollHeight ?? 0
    const prevTop = sc?.scrollTop ?? 0
    isAtBottomRef.current = false
    setVisibleCount((c) => c + DEFAULT_VISIBLE_MESSAGES)
    requestAnimationFrame(() => {
      const sc2 = scrollRef.current
      if (sc2) sc2.scrollTop = prevTop + (sc2.scrollHeight - prevHeight)
    })
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text) return
    if (!modelId) {
      message.warning('请先选择模型')
      return
    }

    // 检查是否有未应用的 PendingWrite
    const hasUnappliedWrites = messages.some((m) => m.pendingWrites?.some((w) => !w.applied))
    if (hasUnappliedWrites) {
      message.warning('请先在下方结果处确认结果')
      return
    }

    setInput('')
    await sendMessage({
      bookId: currentBook?.id || null,
      modelId,
      userInput: text,
    })
  }

  const handleApply = (messageId: string, writeId: string) => {
    const write = messages.find((m) => m.id === messageId)?.pendingWrites?.find((w) => w.id === writeId)
    if (!write) return
    setApplyConfirm({ messageId, write })
  }

  const handleApplyConfirm = async (modifiedData: any) => {
    if (!applyConfirm) return
    const { messageId, write } = applyConfirm
    setApplyConfirm(null)
    setApplyingId(write.id)
    try {
      const result = await applyWrite(messageId, write.id, modelId, modifiedData)
      if (result?.success) {
        message.success(result.message)
        if (result.sideEffects?.length) {
          message.info(result.sideEffects.join('；'), 5)
        }
      } else {
        message.error(result?.message || '应用失败')
      }
    } finally {
      setApplyingId(null)
    }
  }

  const handleApplyAll = async (messageId: string) => {
    const results = await applyAll(messageId, modelId)
    if (results) {
      const successCount = results.filter((r: any) => r.success).length
      message.success(`已应用 ${successCount}/${results.length} 项操作`)
    }
  }

  const handleDiscard = (messageId: string, writeId: string) => {
    const state = useAgentStore.getState()
    const msg = state.messages.find((m) => m.id === messageId)
    const write = msg?.pendingWrites?.find((w) => w.id === writeId)
    if (!write) return

    Modal.confirm({
      title: '确认放弃该操作？',
      content: (
        <div>
          <div style={{ marginBottom: 4 }}>操作：<strong>{write.title}</strong></div>
          <div style={{ fontSize: 13, color: '#6B7280' }}>放弃后该操作将被移除，无法恢复。</div>
        </div>
      ),
      okText: '确认放弃',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        // 走 store 的 discardWrite（会正确处理续跑判定 —— 目前实现是不触发续跑）
        useAgentStore.getState().discardWrite(messageId, writeId)
        message.info('已放弃该操作')
      },
    })
  }

  // 重跑：弹窗让用户填写"重跑原因"，以 user 身份发给模型让 AI 重新调 request_user_confirmation
  const handleRerun = (messageId: string, writeId: string) => {
    const state = useAgentStore.getState()
    const msg = state.messages.find((m) => m.id === messageId)
    const write = msg?.pendingWrites?.find((w) => w.id === writeId)
    if (!write) return

    let reason = ''
    Modal.confirm({
      title: '重跑该卡片',
      icon: <ReloadOutlined style={{ color: '#7C3AED' }} />,
      content: (
        <div>
          <div style={{ marginBottom: 8 }}>
            操作：<strong>{write.title}</strong>
          </div>
          <div style={{ marginBottom: 6, fontSize: 13, color: '#374151' }}>
            重跑原因（可选，AI 会按此重新生成待确认内容）：
          </div>
          <Input.TextArea
            rows={3}
            maxLength={500}
            placeholder="例：缺少次要人物动机；把视角从第一改为第三..."
            onChange={(e) => { reason = e.target.value; document.getElementById('rerunCount')!.textContent = `${e.target.value.length} / 500` }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4, fontSize: 12, color: '#9CA3AF' }}>
            <span id="rerunCount">0 / 500</span>
          </div>
        </div>
      ),
      okText: '重跑',
      cancelText: '取消',
      okButtonProps: { type: 'primary' },
      onOk: async () => {
        await useAgentStore.getState().rerunWrite(messageId, writeId, reason || '')
        message.success('已触发重跑')
      },
    })
  }

  // 拒绝：弹窗让用户填写"拒绝原因"，以 user 身份发给模型让 AI 停止整条链路
  const handleReject = (messageId: string, writeId: string) => {
    const state = useAgentStore.getState()
    const msg = state.messages.find((m) => m.id === messageId)
    const write = msg?.pendingWrites?.find((w) => w.id === writeId)
    if (!write) return

    let reason = ''
    Modal.confirm({
      title: '拒绝该卡片',
      icon: <CloseOutlined style={{ color: '#DC2626' }} />,
      content: (
        <div>
          <div style={{ marginBottom: 8 }}>
            操作：<strong>{write.title}</strong>
          </div>
          <div style={{
            marginBottom: 8,
            padding: '6px 10px',
            background: '#FEF2F2',
            border: '1px solid #FCA5A5',
            borderRadius: 6,
            fontSize: 12,
            color: '#B91C1C',
          }}>
            拒绝后，AI 将停止整条链路，不会再调用任何工具。
          </div>
          <div style={{ marginBottom: 6, fontSize: 13, color: '#374151' }}>
            拒绝原因（可选，会展示给 AI）：
          </div>
          <Input.TextArea
            rows={3}
            maxLength={500}
            placeholder="例：与前文设定冲突；该方向不可行..."
            onChange={(e) => { reason = e.target.value; document.getElementById('rejectCount')!.textContent = `${e.target.value.length} / 500` }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4, fontSize: 12, color: '#9CA3AF' }}>
            <span id="rejectCount">0 / 500</span>
          </div>
        </div>
      ),
      okText: '拒绝并停止',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        await useAgentStore.getState().rejectWrite(messageId, writeId, reason || '')
        message.success('已拒绝，链路将停止')
      },
    })
  }

  const handleCopy = async (content: string) => {
    const text = (content || '').toString()
    if (!text) {
      message.warning('内容为空')
      return
    }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        window.api?.clipboard?.writeText?.(text)
      }
      message.success('已复制')
    } catch (err) {
      try {
        window.api?.clipboard?.writeText?.(text)
        message.success('已复制')
      } catch {
        message.error('复制失败')
      }
    }
  }

  const handleRetry = async (messageId: string) => {
    const msg = messages.find((m) => m.id === messageId)
    if (!msg || msg.role !== 'user') return
    setInput(msg.content)
  }

  const isRunning = !!activeRun
  const selectedModel = models.find((m) => m.id === modelId)

  return (
    <div style={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column', 
      backgroundColor: '#FFFFFF', 
      borderRadius: isPanel ? 0 : 18, 
      border: isPanel ? 'none' : '1px solid #E5E7EB', 
      overflow: 'hidden', 
      boxShadow: isPanel ? 'none' : '0 18px 45px rgba(15, 23, 42, 0.08)',
    }}>
      {/* 顶部工具栏 */}
      <div style={{
        padding: '10px 20px',
        borderBottom: '1px solid #F3F4F6',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        minWidth: 0,
      }}>
        <div style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          flexShrink: 0,
          fontWeight: 600,
        }}>
          知
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#111827', marginBottom: 8, paddingLeft: 4 }}>
            「知卷」
          </div>
          <div style={{ paddingLeft: 4 }}>
            <ModelSelector models={models} value={modelId} onChange={setModelId} />
          </div>
        </div>
      </div>

      {/* 消息列表 */}
      <div ref={scrollRef} onScroll={handleScroll} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '20px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {messages.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', color: '#9CA3AF', fontSize: 13, maxWidth: 220 }}>
              <RobotOutlined style={{ fontSize: 32, marginBottom: 12, opacity: 0.5 }} />
              <div>你好，我是「知卷」！</div>
            </div>
          </div>
        ) : (
          <>
            {messages.length > visibleCount && (
              <div style={{ textAlign: 'center', flexShrink: 0 }}>
                <Button
                  size="small"
                  type="text"
                  style={{ fontSize: 12, color: '#6B7280' }}
                  onClick={handleLoadEarlier}
                >
                  加载更早的消息（还有 {messages.length - visibleCount} 条）
                </Button>
              </div>
            )}
            {messages.slice(-visibleCount).map((msg) => (
            <MessageItem
              key={msg.id}
              message={msg}
              onApply={(writeId) => handleApply(msg.id, writeId)}
              onApplyAll={() => handleApplyAll(msg.id)}
              onDiscard={(writeId) => handleDiscard(msg.id, writeId)}
              onRerun={(writeId) => handleRerun(msg.id, writeId)}
              onReject={(writeId) => handleReject(msg.id, writeId)}
              onDelete={() => {
                // 从 store 里最新的 messages 出发，避免闭包捕获旧引用导致误删
                const store = useAgentStore.getState()
                const cur = store.messages
                const idx = cur.findIndex((m) => m.id === msg.id)
                if (idx < 0) return
                const newMessages = [...cur.slice(0, idx), ...cur.slice(idx + 1)]
                store.setMessages(newMessages)
                // 立即持久化到 DB（saveBatch 是全量覆盖），不等 debounce
                store.saveMessages(currentBook?.id || null).catch((e) => {
                  console.error('[Agent] 删除消息后持久化失败', e)
                })
              }}
              onCopy={() => handleCopy(msg.content || '')}
              onRetry={() => handleRetry(msg.id)}
              onViewContext={() => setContextMessage(msg)}
              applyingId={applyingId}
            />
            ))}
          </>
        )}
      </div>

      {/* 输入区域 */}
      <div style={{ padding: '16px 20px 20px', borderTop: '1px solid #F3F4F6', opacity: selectedModel ? 1 : 0.5, pointerEvents: selectedModel ? 'auto' : 'none' }}>
        <div style={{ border: '1px solid #D9D9D9', borderRadius: 12, background: '#FFFFFF', padding: '8px 10px 10px', transition: 'border-color 0.15s ease, box-shadow 0.15s ease' }}>
          <TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={selectedModel ? '输入指令，或描述你想要的剧情...' : '请先选择模型'}
            rows={3}
            disabled={!selectedModel || isRunning}
            variant="borderless"
            style={{ resize: 'none', padding: 0, boxShadow: 'none' }}
            onPressEnter={(e) => {
              if (e.shiftKey) return
              e.preventDefault()
              handleSend()
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#9CA3AF' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Popconfirm
                title="清空全部聊天记录？"
                description="清空后无法恢复。"
                okText="清空"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                disabled={messages.length === 0}
                onConfirm={clearMessages}
              >
                <Tooltip title="清空聊天记录">
                  <Button icon={<ClearOutlined />} disabled={messages.length === 0 || isRunning} style={{ width: 36, padding: 0 }} />
                </Tooltip>
              </Popconfirm>
              {isRunning ? (
                <Button danger icon={<StopOutlined />} onClick={stopRun}>
                  停止
                </Button>
              ) : (
                <Button type="primary" icon={<SendOutlined />} onClick={handleSend} disabled={!input.trim()}>
                  发送
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <ContextModal
        open={!!contextMessage}
        onCancel={() => setContextMessage(null)}
        contextSnapshot={contextMessage?.contextSnapshot}
      />

      <ApplyConfirmModal
        open={!!applyConfirm}
        write={applyConfirm?.write || null}
        onCancel={() => setApplyConfirm(null)}
        onConfirm={handleApplyConfirm}
        applying={!!applyingId}
      />
    </div>
  )
}
