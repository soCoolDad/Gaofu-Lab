import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Checkbox, Col, Dropdown, Popover, Row, Select, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { SettingOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import type { TokenUsageLog, TokenUsageLogFilter, TokenUsageSummary } from '@/types/api'
import { modelFullName } from '@/utils/providers'

const { Title, Text } = Typography

function formatTimeParts(value: string) {
  const date = new Date(value)
  return {
    date: date.toLocaleDateString('zh-CN'),
    time: date.toLocaleTimeString('zh-CN', { hour12: false }),
  }
}

function formatCost(value: number) {
  return `¥ ${value.toFixed(4)}`
}

function formatMoney6(v: number) {
  if (!v) return '¥0'
  if (v < 0.01) return `¥${v.toFixed(6)}`
  return `¥${v.toFixed(4)}`
}
function formatPriceM(v?: number | null) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  if (n === 0) return '—'
  return `¥${n}/M`
}

/**
 * 统一的 Token 明细表格（用于列表费用 Popover 与顶部合计 Tooltip）。
 *
 * 参数为一次调用（或一段时间聚合）的 Token 与价格信息，
 * 返回带 5 列的表格 UI：项目 / 数量 / 单价 / 费用。
 */
function usageBreakdownTable(args: {
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  reasoningTokens: number
  inputPrice: number
  outputPrice: number
  cachedPrice: number
  darkTheme?: boolean
  title?: string
  /** 是否显示"单价 / 费用"两列，默认 true。跨模型聚合时可传 false 隐藏。 */
  showPricing?: boolean
  /** 是否显示表格底部"总计"行，默认 true。 */
  showTotalRow?: boolean
}) {
  const {
    promptTokens, completionTokens, cachedTokens, reasoningTokens,
    inputPrice, outputPrice, cachedPrice, darkTheme = false, title, showPricing = true, showTotalRow = true,
  } = args
  const missTokens = Math.max(promptTokens - cachedTokens, 0)
  const directTokens = Math.max(completionTokens - reasoningTokens, 0)
  const cachedCost = (cachedTokens / 1_000_000) * cachedPrice
  const missCost = (missTokens / 1_000_000) * inputPrice
  const inputCost = cachedCost + missCost
  const reasoningCost = (reasoningTokens / 1_000_000) * outputPrice
  const directCost = (directTokens / 1_000_000) * outputPrice
  const outputCost = reasoningCost + directCost
  const totalTokens = promptTokens + completionTokens
  const totalCost = inputCost + outputCost

  const mainColor = darkTheme ? '#FFFFFF' : '#111827'
  const softColor = darkTheme ? 'rgba(255,255,255,0.75)' : '#9CA3AF'
  const borderColor = darkTheme ? 'rgba(255,255,255,0.15)' : '#E5E7EB'
  const totalHl = darkTheme ? '#818CF8' : '#4F46E5'
  const totalCostHl = darkTheme ? '#FBBF24' : '#F97316'
  const rowPad = '4px 8px'
  const mainRowPad = '6px 8px'

  return (
    <div style={{ fontSize: 12, minWidth: 340 }}>
      {title && (
        <div style={{
          fontSize: 13,
          fontWeight: 600,
          color: mainColor,
          padding: '4px 8px 8px',
          borderBottom: `1px solid ${borderColor}`,
          marginBottom: 4,
        }}>
          {title}
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${borderColor}` }}>
            <th style={{ textAlign: 'left', padding: '4px 8px', color: softColor, fontWeight: 400, whiteSpace: 'nowrap' }}>项目</th>
            <th style={{ textAlign: 'right', padding: '4px 8px', color: softColor, fontWeight: 400, whiteSpace: 'nowrap' }}>数量</th>
            {showPricing && <th style={{ textAlign: 'right', padding: '4px 8px', color: softColor, fontWeight: 400, whiteSpace: 'nowrap' }}>单价</th>}
            {showPricing && <th style={{ textAlign: 'right', padding: '4px 8px', color: softColor, fontWeight: 400, whiteSpace: 'nowrap' }}>费用</th>}
          </tr>
        </thead>
        <tbody>
          {/* 输入（主项） */}
          <tr>
            <td style={{ padding: mainRowPad, color: mainColor, whiteSpace: 'nowrap' }}>输入</td>
            <td style={{ textAlign: 'right', padding: mainRowPad, color: mainColor, fontWeight: 600, whiteSpace: 'nowrap' }}>{promptTokens.toLocaleString()}</td>
            {showPricing && <td style={{ textAlign: 'right', padding: mainRowPad, color: softColor, whiteSpace: 'nowrap' }}>—</td>}
            {showPricing && <td style={{ textAlign: 'right', padding: mainRowPad, color: mainColor, fontWeight: 600, whiteSpace: 'nowrap' }}>{formatMoney6(inputCost)}</td>}
          </tr>
          {/* · 缓存命中 */}
          <tr>
            <td style={{ padding: `${rowPad.split(' ')[0]} 8px ${rowPad.split(' ')[0]} 20px`, color: '#16A34A', whiteSpace: 'nowrap' }}>· 缓存命中</td>
            <td style={{ textAlign: 'right', padding: rowPad, color: '#16A34A', fontWeight: 400, whiteSpace: 'nowrap' }}>{cachedTokens.toLocaleString()}</td>
            {showPricing && <td style={{ textAlign: 'right', padding: rowPad, color: '#16A34A', fontWeight: 400, whiteSpace: 'nowrap' }}>{formatPriceM(cachedPrice)}</td>}
            {showPricing && <td style={{ textAlign: 'right', padding: rowPad, color: '#16A34A', fontWeight: 400, whiteSpace: 'nowrap' }}>{formatMoney6(cachedCost)}</td>}
          </tr>
          {/* · 未命中 */}
          <tr>
            <td style={{ padding: `${rowPad.split(' ')[0]} 8px ${rowPad.split(' ')[0]} 20px`, color: '#F59E0B', whiteSpace: 'nowrap' }}>· 未命中</td>
            <td style={{ textAlign: 'right', padding: rowPad, color: '#F59E0B', fontWeight: 400, whiteSpace: 'nowrap' }}>{missTokens.toLocaleString()}</td>
            {showPricing && <td style={{ textAlign: 'right', padding: rowPad, color: '#F59E0B', fontWeight: 400, whiteSpace: 'nowrap' }}>{formatPriceM(inputPrice)}</td>}
            {showPricing && <td style={{ textAlign: 'right', padding: rowPad, color: '#F59E0B', fontWeight: 400, whiteSpace: 'nowrap' }}>{formatMoney6(missCost)}</td>}
          </tr>
          {/* 输出（主项） */}
          <tr>
            <td style={{ padding: mainRowPad, color: mainColor, whiteSpace: 'nowrap' }}>输出</td>
            <td style={{ textAlign: 'right', padding: mainRowPad, color: mainColor, fontWeight: 600, whiteSpace: 'nowrap' }}>{completionTokens.toLocaleString()}</td>
            {showPricing && <td style={{ textAlign: 'right', padding: mainRowPad, color: softColor, whiteSpace: 'nowrap' }}>—</td>}
            {showPricing && <td style={{ textAlign: 'right', padding: mainRowPad, color: mainColor, fontWeight: 600, whiteSpace: 'nowrap' }}>{formatMoney6(outputCost)}</td>}
          </tr>
          {/* · 思考 */}
          <tr>
            <td style={{ padding: `${rowPad.split(' ')[0]} 8px ${rowPad.split(' ')[0]} 20px`, color: '#8B5CF6', whiteSpace: 'nowrap' }}>· 思考</td>
            <td style={{ textAlign: 'right', padding: rowPad, color: '#8B5CF6', fontWeight: 400, whiteSpace: 'nowrap' }}>{reasoningTokens.toLocaleString()}</td>
            {showPricing && <td style={{ textAlign: 'right', padding: rowPad, color: '#8B5CF6', fontWeight: 400, whiteSpace: 'nowrap' }}>{formatPriceM(outputPrice)}</td>}
            {showPricing && <td style={{ textAlign: 'right', padding: rowPad, color: '#8B5CF6', fontWeight: 400, whiteSpace: 'nowrap' }}>{formatMoney6(reasoningCost)}</td>}
          </tr>
          {/* · 直出 */}
          <tr>
            <td style={{ padding: `${rowPad.split(' ')[0]} 8px ${rowPad.split(' ')[0]} 20px`, color: '#0EA5E9', whiteSpace: 'nowrap' }}>· 直出</td>
            <td style={{ textAlign: 'right', padding: rowPad, color: '#0EA5E9', fontWeight: 400, whiteSpace: 'nowrap' }}>{directTokens.toLocaleString()}</td>
            {showPricing && <td style={{ textAlign: 'right', padding: rowPad, color: '#0EA5E9', fontWeight: 400, whiteSpace: 'nowrap' }}>{formatPriceM(outputPrice)}</td>}
            {showPricing && <td style={{ textAlign: 'right', padding: rowPad, color: '#0EA5E9', fontWeight: 400, whiteSpace: 'nowrap' }}>{formatMoney6(directCost)}</td>}
          </tr>
        </tbody>
        {showTotalRow && (
          <tfoot>
            <tr style={{ borderTop: `2px solid ${borderColor}` }}>
              <td style={{ padding: '8px 8px 4px', color: mainColor, fontWeight: 700, whiteSpace: 'nowrap' }}>总计</td>
              <td style={{ textAlign: 'right', padding: '8px 8px 4px', color: totalHl, fontWeight: 700, whiteSpace: 'nowrap' }}>{totalTokens.toLocaleString()}</td>
              {showPricing && <td style={{ padding: '8px 8px 4px' }}></td>}
              {showPricing && <td style={{ textAlign: 'right', padding: '8px 8px 4px', color: totalCostHl, fontWeight: 700, whiteSpace: 'nowrap' }}>{formatMoney6(totalCost)}</td>}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

function tokenBreakdownContent(record: TokenUsageLog) {
  const inputPrice = Number(record.modelInputPrice || 0)
  const outputPrice = Number(record.modelOutputPrice || 0)
  const cachedPrice = record.modelCachedInputPrice != null ? Number(record.modelCachedInputPrice) : inputPrice
  return usageBreakdownTable({
    promptTokens: record.promptTokens || 0,
    completionTokens: record.completionTokens || 0,
    cachedTokens: record.cachedPromptTokens || 0,
    reasoningTokens: record.reasoningTokens || 0,
    inputPrice,
    outputPrice,
    cachedPrice,
    title: `消耗详情 · ${record.modelName || '未知模型'}`,
  })
}

function costBreakdownContent(record: TokenUsageLog) {
  // 已弃用：列表费用列现在也复用 tokenBreakdownContent（同一个统一表格样式）。
  // 保留以兼容旧引用；如无引用可删除。
  return tokenBreakdownContent(record)
}

type ColumnKey =
  | 'createdAt'
  | 'modelName'
  | 'bookTitle'
  | 'target'
  | 'intent'
  | 'promptTokens'
  | 'completionTokens'
  | 'totalTokens'
  | 'cost'

const defaultVisibleColumns: ColumnKey[] = ['createdAt', 'modelName', 'intent', 'totalTokens', 'cost']

const columnOptions: Array<{ label: string; value: ColumnKey }> = [
  { label: '时间', value: 'createdAt' },
  { label: '模型', value: 'modelName' },
  { label: '作品', value: 'bookTitle' },
  { label: '位置', value: 'target' },
  { label: '动作', value: 'intent' },
  { label: '输入', value: 'promptTokens' },
  { label: '输出', value: 'completionTokens' },
  { label: '总计', value: 'totalTokens' },
  { label: '费用', value: 'cost' },
]

/**
 * 把 Agent 落库时写入的中文动作字符串拆成单个标签，并分别着色。
 *
 * 数据源：token_usage_logs.action 由新 Agent 在写入时直接存中文（如"生成章节记忆"、
 * "创建章节 + 写作正文"、"对话"）。组合动作用" + "拼接，这里拆开后分别着色展示。
 */
function describeIntentTags(row: { action: string }): Array<{ label: string; color?: string }> {
  const action = row.action || '—'
  if (action === '—') return [{ label: action }]
  return action.split(' + ').map((part) => {
    const a = part.trim()
    if (a === '对话') return { label: a }
    if (a.includes('生成章节记忆') || a.includes('定稿')) return { label: a, color: 'magenta' }
    if (a.startsWith('创建')) return { label: a, color: 'green' }
    if (a.startsWith('编辑') || a.startsWith('写作')) return { label: a, color: 'blue' }
    if (a.startsWith('删除')) return { label: a, color: 'red' }
    if (a.startsWith('查看') || a.startsWith('拉取')) return { label: a }
    return { label: a }
  })
}

type FilterState = Pick<TokenUsageLogFilter, 'range' | 'modelId' | 'bookTitle' | 'action'>

const defaultFilters: FilterState = {
  range: 'today',
  modelId: null,
  bookTitle: null,
  action: null,
}

const allColumns: Array<ColumnsType<TokenUsageLog>[number] & { key: ColumnKey }> = [
  {
    title: '时间',
    dataIndex: 'createdAt',
    key: 'createdAt',
    render: (text) => {
      const parts = formatTimeParts(text)
      return (
        <div style={{ fontSize: 13, color: '#6B7280', lineHeight: 1.35 }}>
          <div>{parts.date}</div>
          <div style={{ color: '#9CA3AF' }}>{parts.time}</div>
        </div>
      )
    },
  },
  {
    title: '模型',
    dataIndex: 'modelName',
    key: 'modelName',
    ellipsis: true,
    render: (text) => <span style={{ fontSize: 13 }}>{text || '—'}</span>,
  },
  {
    title: '作品',
    dataIndex: 'bookTitle',
    key: 'bookTitle',
    ellipsis: true,
    render: (_, record) => {
      if (record.bookTitle) {
        // book_id 在书籍被删除后会被置 NULL，但书名快照保留：据此区分"作品已删除"
        return record.bookId
          ? <span style={{ fontSize: 13, color: '#111827' }}>{record.bookTitle}</span>
          : <span style={{ fontSize: 13, color: '#9CA3AF' }}>作品已删除</span>
      }
      return <span style={{ fontSize: 13, color: '#9CA3AF' }}>—</span>
    },
  },
  {
    title: '位置',
    key: 'target',
    ellipsis: true,
    render: (_, record) => <span style={{ fontSize: 13, color: '#6B7280' }}>{record.chapterTitle || record.volumeTitle || record.contextType}</span>,
  },
  {
    title: '动作',
    key: 'intent',
    render: (_, record) => {
      const tags = describeIntentTags(record)
      return (
        <Space size={4} wrap>
          {tags.map((tag, idx) => (
            <Tag key={idx} color={tag.color} style={{ fontSize: 12 }}>{tag.label}</Tag>
          ))}
        </Space>
      )
    },
  },
  {
    title: '输入',
    dataIndex: 'promptTokens',
    key: 'promptTokens',
    align: 'right',
    render: (num) => <span style={{ fontSize: 13 }}>{num.toLocaleString()}</span>,
  },
  {
    title: '输出',
    dataIndex: 'completionTokens',
    key: 'completionTokens',
    align: 'right',
    render: (num) => <span style={{ fontSize: 13 }}>{num.toLocaleString()}</span>,
  },
  {
    title: '总计',
    dataIndex: 'totalTokens',
    key: 'totalTokens',
    align: 'right',
    render: (num, record) => (
      <Popover content={tokenBreakdownContent(record)} placement="left" trigger="hover">
        <span style={{ fontSize: 13, fontWeight: 500, color: '#4F46E5', cursor: 'default' }}>
          {num.toLocaleString()}
        </span>
      </Popover>
    ),
  },
  {
    title: '费用',
    dataIndex: 'cost',
    key: 'cost',
    align: 'right',
    render: (cost, record) => (
      <Popover content={tokenBreakdownContent(record)} placement="left" trigger="hover">
        <span style={{ fontSize: 13, fontWeight: 500, color: '#16A34A', cursor: 'default' }}>
          {formatCost(cost)}
        </span>
      </Popover>
    ),
  },
]

export default function TokenLogsPage() {
  const [logs, setLogs] = useState<TokenUsageLog[]>([])
  const [summary, setSummary] = useState<TokenUsageSummary>({
    todayTokens: 0,
    todayCachedTokens: 0,
    todayCost: 0,
    todayCalls: 0,
    monthCost: 0,
    monthCachedTokens: 0,
    monthCalls: 0,
    byModel: [],
  })
  const [filterSummary, setFilterSummary] = useState({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedPromptTokens: 0,
    reasoningTokens: 0,
    cost: 0,
    calls: 0,
  })
  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const [loading, setLoading] = useState(false)
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(defaultVisibleColumns)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)
  const [total, setTotal] = useState(0)
  // 下拉维度的去重数据（独立于筛选结果，避免筛选项随当前页一起被过滤掉）
  const [bookFacets, setBookFacets] = useState<Array<{ bookTitle: string; deleted: boolean }>>([])
  const [modelFacets, setModelFacets] = useState<Array<{ modelId: string; modelName: string; provider: string | null }>>([])
  const [actionFacets, setActionFacets] = useState<string[]>([])

  const columns = useMemo<ColumnsType<TokenUsageLog>>(
    () => allColumns.filter((column) => visibleColumns.includes(column.key)),
    [visibleColumns],
  )

  const modelOptions = useMemo(
    () => modelFacets.map((m) => ({ value: m.modelId, label: modelFullName(m) })),
    [modelFacets],
  )

  const actionOptions = useMemo(
    () => actionFacets.map((a) => ({ value: a, label: a })),
    [actionFacets],
  )

  /**
   * 按模型分组的费用汇总（用于"合计费用"悬浮弹窗）。
   * 数据源：当前页返回的 logs（已按筛选条件过滤）。
   */
  const feeByModel = useMemo(() => {
    const map = new Map<string, { modelName: string; totalTokens: number; cost: number; calls: number }>()
    logs.forEach((log) => {
      const key = log.modelId || log.modelName || 'unknown'
      const cur = map.get(key)
      if (cur) {
        cur.totalTokens += log.totalTokens || 0
        cur.cost += log.cost || 0
        cur.calls += log.calls || 1
      } else {
        map.set(key, {
          modelName: log.modelName || '未知模型',
          totalTokens: log.totalTokens || 0,
          cost: log.cost || 0,
          calls: log.calls || 1,
        })
      }
    })
    // 按费用倒序
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost)
  }, [logs])

  const bookOptions = useMemo(
    () => bookFacets.map((b) => ({
      value: b.bookTitle,
      label: b.deleted ? `${b.bookTitle}（已删除）` : b.bookTitle,
    })),
    [bookFacets],
  )

  const loadFacets = async () => {
    if (!window.api?.ai?.tokenLogFacets) return
    try {
      const facets = await window.api.ai.tokenLogFacets()
      setBookFacets(facets.books)
      setModelFacets(facets.models)
      setActionFacets(facets.actions)
    } catch {
      /* 忽略维度加载失败，下拉项为空不影响列表 */
    }
  }

  const loadData = async (targetPage = page, targetPageSize = pageSize, targetFilters = filters) => {
    setLoading(true)
    try {
      if (!window.api?.ai?.tokenLogs || !window.api?.ai?.tokenSummary) return
      const [logData, summaryData] = await Promise.all([
        window.api.ai.tokenLogs({ page: targetPage, pageSize: targetPageSize, ...targetFilters }),
        window.api.ai.tokenSummary(),
      ])
      setLogs(logData.items)
      setTotal(logData.total)
      setPage(logData.page)
      setPageSize(logData.pageSize)
      setFilterSummary(logData.summary)
      setSummary(summaryData)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadFacets()
    loadData(1, pageSize, filters)
  }, [])

  const handleFilterChange = (patch: Partial<FilterState>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    loadData(1, pageSize, next)
  }

  const handleResetFilters = () => {
    setFilters(defaultFilters)
    loadData(1, pageSize, defaultFilters)
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0, fontWeight: 600 }}>Token 消耗记录</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          查看 AI 调用的 Token 消耗明细
        </Text>
      </div>

      {/* 数据卡片合并为单张卡片，置于筛选区之上 */}
      <Card variant="borderless" style={{ borderRadius: 12, marginBottom: 16 }}>
        <Row gutter={0} align="middle">
          <Col span={8} style={{ borderRight: '1px solid #F1F5F9', paddingLeft: 8, paddingRight: 8 }}>
            <Popover
              placement="right"
              content={usageBreakdownTable({
                promptTokens: filterSummary.promptTokens || 0,
                completionTokens: filterSummary.completionTokens || 0,
                cachedTokens: filterSummary.cachedPromptTokens || 0,
                reasoningTokens: filterSummary.reasoningTokens || 0,
                // 聚合跨多个模型，无统一单价/费用，故隐藏这两列
                inputPrice: 0,
                outputPrice: 0,
                cachedPrice: 0,
                showPricing: false,
                // 顶部合计弹窗：不重复标题（外部已有"合计消耗 Token"），也不需要"总计"行
                showTotalRow: false,
              })}
            >
              <div style={{ display: 'inline-block', cursor: 'help' }}>
                <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 8 }}>合计消耗 Token</div>
                <div style={{ fontSize: 24, fontWeight: 600, color: '#111827' }}>{filterSummary.totalTokens.toLocaleString()}</div>
              </div>
            </Popover>
          </Col>
          <Col span={8} style={{ borderRight: '1px solid #F1F5F9', paddingLeft: 16, paddingRight: 8 }}>
            <Popover
              placement="bottom"
              content={
                <div style={{ fontSize: 12, minWidth: 320 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                        <th style={{ textAlign: 'left', padding: '4px 8px', color: '#9CA3AF', fontWeight: 400, whiteSpace: 'nowrap' }}>模型</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px', color: '#9CA3AF', fontWeight: 400, whiteSpace: 'nowrap' }}>调用</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px', color: '#9CA3AF', fontWeight: 400, whiteSpace: 'nowrap' }}>Token</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px', color: '#9CA3AF', fontWeight: 400, whiteSpace: 'nowrap' }}>费用</th>
                      </tr>
                    </thead>
                    <tbody>
                      {feeByModel.length === 0 && (
                        <tr>
                          <td colSpan={4} style={{ padding: '16px', textAlign: 'center', color: '#9CA3AF' }}>暂无数据</td>
                        </tr>
                      )}
                      {feeByModel.map((item) => (
                        <tr key={item.modelName}>
                          <td style={{ padding: '6px 8px', color: '#111827', whiteSpace: 'nowrap' }}>{item.modelName}</td>
                          <td style={{ textAlign: 'right', padding: '6px 8px', color: '#111827', whiteSpace: 'nowrap' }}>{item.calls}</td>
                          <td style={{ textAlign: 'right', padding: '6px 8px', color: '#4F46E5', whiteSpace: 'nowrap' }}>{item.totalTokens.toLocaleString()}</td>
                          <td style={{ textAlign: 'right', padding: '6px 8px', color: '#16A34A', fontWeight: 600, whiteSpace: 'nowrap' }}>{formatMoney6(item.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                    {feeByModel.length > 0 && (
                      <tfoot>
                        <tr style={{ borderTop: '2px solid #E5E7EB' }}>
                          <td style={{ padding: '8px 8px 4px', color: '#111827', fontWeight: 700, whiteSpace: 'nowrap' }}>总计</td>
                          <td style={{ textAlign: 'right', padding: '8px 8px 4px', color: '#111827', fontWeight: 700, whiteSpace: 'nowrap' }}>{filterSummary.calls}</td>
                          <td style={{ textAlign: 'right', padding: '8px 8px 4px', color: '#4F46E5', fontWeight: 700, whiteSpace: 'nowrap' }}>{filterSummary.totalTokens.toLocaleString()}</td>
                          <td style={{ textAlign: 'right', padding: '8px 8px 4px', color: '#F97316', fontWeight: 700, whiteSpace: 'nowrap' }}>{formatMoney6(filterSummary.cost)}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              }
            >
              <div style={{ display: 'inline-block', cursor: 'help' }}>
                <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 8 }}>合计费用</div>
                <div style={{ fontSize: 24, fontWeight: 600, color: '#16A34A' }}>{formatCost(filterSummary.cost)}</div>
              </div>
            </Popover>
          </Col>
          <Col span={8} style={{ paddingLeft: 16, paddingRight: 8 }}>
            <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 8 }}>模型调用次数</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: '#111827' }}>{filterSummary.calls} 次</div>
          </Col>
        </Row>
      </Card>

      <Card variant="borderless" style={{ borderRadius: 12, marginBottom: 16 }}>
        <Space wrap size={12}>
          <Select
            value={filters.range}
            style={{ width: 120 }}
            options={[
              { value: 'today', label: '今日' },
              { value: 'week', label: '近 7 天' },
              { value: 'month', label: '本月' },
              { value: 'all', label: '全部' },
            ]}
            onChange={(value) => handleFilterChange({ range: value as FilterState['range'] })}
          />
          <Select
            value={filters.modelId || undefined}
            placeholder="模型"
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 160 }}
            options={modelOptions}
            onChange={(value) => handleFilterChange({ modelId: value || null })}
          />
          <Select
            value={filters.action || undefined}
            placeholder="动作"
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 160 }}
            options={actionOptions}
            onChange={(value) => handleFilterChange({ action: value || null })}
          />
          <Select
            value={filters.bookTitle || undefined}
            placeholder="作品"
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 160 }}
            options={bookOptions}
            onChange={(value) => handleFilterChange({ bookTitle: value || null })}
          />
          <Button onClick={handleResetFilters}>重置</Button>
        </Space>
      </Card>

      <Card
        variant="borderless"
        style={{ borderRadius: 12 }}
        title={<span style={{ fontWeight: 600 }}>消耗明细</span>}
        extra={
          <Dropdown
            trigger={['click']}
            popupRender={() => (
              <div style={{ padding: 12, background: '#fff', borderRadius: 8, boxShadow: '0 6px 16px rgba(0, 0, 0, 0.08)' }}>
                <Checkbox.Group
                  value={visibleColumns}
                  onChange={(values) => setVisibleColumns(values as ColumnKey[])}
                  // 每列宽度按内容自适应 + 单项不换行，避免"System 输入"这类长标签被压窄换行
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(2, max-content)', columnGap: 24, rowGap: 8, whiteSpace: 'nowrap' }}
                  options={columnOptions}
                />
              </div>
            )}
          >
            <Button icon={<SettingOutlined />}>显示列</Button>
          </Dropdown>
        }
      >
        <Table
          columns={columns}
          dataSource={logs}
          rowKey="id"
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            pageSizeOptions: [15, 30, 50],
            showTotal: (value) => `共 ${value} 条`,
            onChange: (nextPage, nextPageSize) => loadData(nextPage, nextPageSize, filters),
          }}
          size="middle"
          loading={loading}
        />
      </Card>
    </div>
  )
}
