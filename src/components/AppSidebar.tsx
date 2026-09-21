import { useEffect, useState, useMemo } from 'react'
import { Menu, Button, Modal, Form, Input, message, Tooltip, Popover, Typography } from 'antd'
import type { MenuProps } from 'antd'
import {
  BookOutlined,
  PlusOutlined,
  UserOutlined,
  SettingOutlined,
  BlockOutlined,
  FormatPainterOutlined,
  HistoryOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  CheckOutlined,
  DownOutlined,
  RightOutlined,
  ToolOutlined,
} from '@ant-design/icons'

const { Text } = Typography
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useWorkspaceStore } from '@/stores/workspace.store'

type Props = {
  collapsed: boolean
  onCollapse: (collapsed: boolean) => void
}

export default function AppSidebar({ collapsed, onCollapse }: Props) {
  const navigate = useNavigate()
  const { bookId } = useParams()
  const location = useLocation()
  const books = useWorkspaceStore((s) => s.books)
  const createBook = useWorkspaceStore((s) => s.createBook)
  const setCurrentBook = useWorkspaceStore((s) => s.setCurrentBook)
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()
  const [collapsedModels, setCollapsedModels] = useState<Set<string>>(new Set())

  const toggleModel = (modelKey: string) => {
    setCollapsedModels((prev) => {
      const next = new Set(prev)
      if (next.has(modelKey)) next.delete(modelKey)
      else next.add(modelKey)
      return next
    })
  }

  useEffect(() => {
    const handleOpenCreateBook = () => setModalOpen(true)
    window.addEventListener('ainovel-open-create-book', handleOpenCreateBook)
    return () => window.removeEventListener('ainovel-open-create-book', handleOpenCreateBook)
  }, [])

  const bookItems: MenuProps['items'] = useMemo(() => books.map((book) => ({
    key: book.id,
    icon: collapsed ? null : <BookOutlined />,
    label: collapsed ? '' : book.title,
    onClick: () => handleSelectBook(book.id),
  })), [books, collapsed])

  const handleSelectBook = async (id: string) => {
    await setCurrentBook(id)
    // 从主菜单进入书籍时，默认打开正文编辑页而不是章节列表
    navigate(`/book/${id}/editor`)
  }

  const handleCreateBook = async (values: { title: string; description?: string }) => {
    try {
      const book = await createBook(values.title, values.description)
      // 新建作品后也直接进入正文编辑页
      navigate(`/book/${book.id}/editor`)
      setModalOpen(false)
      form.resetFields()
      message.success(`作品「${values.title}」已创建`)
    } catch {
      message.error('创建失败')
    }
  }

  // 创作资产：Agent
  const creativeItems: MenuProps['items'] = [
    {
      key: 'agent',
      icon: <UserOutlined />,
      label: collapsed ? '' : '「知卷」',
      onClick: () => navigate('/agent'),
    },
  ]

  // 辅助资产：模型管理、AI 技能、工具集、Token 消耗
  const assistantItems: MenuProps['items'] = [
    {
      key: 'models',
      icon: <BlockOutlined />,
      label: collapsed ? '' : '模型管理',
      onClick: () => navigate('/models'),
    },
    {
      key: 'skills',
      icon: <FormatPainterOutlined />,
      label: collapsed ? '' : 'AI 技能',
      onClick: () => navigate('/skills'),
    },
    {
      key: 'tools',
      icon: <ToolOutlined />,
      label: collapsed ? '' : '工具集',
      onClick: () => navigate('/tools'),
    },
    {
      key: 'token-logs',
      icon: <HistoryOutlined />,
      label: collapsed ? '' : 'Token 消耗',
      onClick: () => navigate('/token-logs'),
    },
  ]

  // 系统：设置
  const systemItems: MenuProps['items'] = [
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: collapsed ? '' : '设置',
      onClick: () => navigate('/settings'),
    },
  ]

  // 获取当前选中 key
  const getSelectedKey = () => {
    const path = location.pathname
    if (bookId) return bookId
    const topPath = path.split('/').filter(Boolean)[0]
    return topPath || ''
  }

  const [tokenSummary, setTokenSummary] = useState({
    todayTokens: 0,
    todayCost: 0,
    todayCalls: 0,
    monthCost: 0,
    byModel: [] as Array<{
      modelId: string | null
      modelName: string | null
      totalTokens: number
      promptTokens: number
      completionTokens: number
      cachedPromptTokens: number
      reasoningTokens?: number
      cost: number
      inputPrice?: number | null
      outputPrice?: number | null
      cachedInputPrice?: number | null
    }>,
  })

  useEffect(() => {
    const loadTokenSummary = () => {
      if (!window.api?.ai?.tokenSummary) return
      window.api.ai.tokenSummary().then(setTokenSummary).catch(() => { })
    }
    loadTokenSummary()
    window.addEventListener('token-usage-updated', loadTokenSummary)
    return () => window.removeEventListener('token-usage-updated', loadTokenSummary)
  }, [location.pathname])

  const todayTokens = tokenSummary.todayTokens
  const todayCost = tokenSummary.todayCost
  const modelConsumptions = tokenSummary.byModel
  const totalTokensAll = modelConsumptions.reduce((s, m) => s + Number(m.promptTokens || 0) + Number(m.completionTokens || 0), 0)
  const totalFee = modelConsumptions.reduce((s, m) => s + Number(m.cost || 0), 0)

  const formatMoney = (v: number) => {
    if (!v) return '¥0'
    // 小于 1 分钱显示 6 位，其余显示 4 位
    if (v < 0.01) return `¥${v.toFixed(6)}`
    return `¥${v.toFixed(4)}`
  }
  const formatPrice = (v?: number | null) => (v == null || Number.isNaN(Number(v)) ? '—' : `¥${Number(v)}/M`)

  const formatCompactNumber = (value: number | undefined | null) => {
    if (value === undefined || value === null) return '0'
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
    if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`
    return value.toLocaleString()
  }

  const isPathActive = (path: string) => location.pathname.startsWith(path)
  const collapsedButtonStyle = (active: boolean): React.CSSProperties => ({
    width: 40,
    height: 40,
    minWidth: 40,
    padding: 0,
    borderRadius: 10,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    background: active ? '#EEF2FF' : undefined,
    color: active ? '#4F46E5' : undefined,
  })

  const consumptionContent = (
    <div style={{ padding: '4px 0', minWidth: 480, width: 'max-content', maxWidth: '80vw', maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 12, paddingLeft: 12 }}>
        <Text style={{ fontSize: 12, color: '#6B7280' }}>各模型消耗明细 · 今日</Text>
      </div>
      {modelConsumptions.length === 0 ? (
        <div style={{ padding: '64px 16px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>今日暂无消耗</div>
      ) : (
        <>
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {modelConsumptions.map((item, modelIdx) => {
          const promptTokens = Number(item.promptTokens || 0)
          const completionTokens = Number(item.completionTokens || 0)
          const cachedTokens = Number(item.cachedPromptTokens || 0)
          const missTokens = Math.max(promptTokens - cachedTokens, 0)
          const reasoningTokens = Number(item.reasoningTokens || 0)
          const directTokens = Math.max(completionTokens - reasoningTokens, 0)
          const inputPrice = item.inputPrice == null ? 0 : Number(item.inputPrice)
          const outputPrice = item.outputPrice == null ? 0 : Number(item.outputPrice)
          const cachedPrice = item.cachedInputPrice == null ? inputPrice : Number(item.cachedInputPrice)
          const cachedCost = (cachedTokens / 1_000_000) * cachedPrice
          const missCost = (missTokens / 1_000_000) * inputPrice
          const inputCost = cachedCost + missCost
          const reasoningCost = (reasoningTokens / 1_000_000) * outputPrice
          const directCost = (directTokens / 1_000_000) * outputPrice
          const outputCost = reasoningCost + directCost
          const modelTotalTokens = promptTokens + completionTokens
          const modelTotalCost = inputCost + outputCost

          const modelKey = item.modelId || item.modelName || `unknown-${modelIdx}`

          return (
            <div key={modelKey} style={{ marginTop: modelIdx === 0 ? 0 : 16, padding: 0 }}>
              <div
                onClick={() => toggleModel(modelKey)}
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#111827',
                  padding: '8px 12px',
                  background: '#F3F4F6',
                  borderRadius: collapsedModels.has(modelKey) ? 8 : '8px 8px 0 0',
                  borderBottom: collapsedModels.has(modelKey) ? 'none' : '1px solid #E5E7EB',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  userSelect: 'none',
                }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 700, color: '#111827' }}>
                  {collapsedModels.has(modelKey) ? <RightOutlined style={{ fontSize: 10, color: '#9CA3AF', marginRight: 6 }} /> : <DownOutlined style={{ fontSize: 10, color: '#9CA3AF', marginRight: 6 }} />}
                  {item.modelName || '未知模型'}
                </span>
                <span style={{ flex: 1, textAlign: 'right', fontSize: 11, fontWeight: 400, color: '#9CA3AF' }}>Tokens:{modelTotalTokens.toLocaleString()}</span>
                <span style={{ flex: 1, textAlign: 'right', fontSize: 11, fontWeight: 400, color: '#F97316' }}>费用:{formatMoney(modelTotalCost)}</span>
              </div>
              {!collapsedModels.has(modelKey) && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '6px 12px', color: '#111827', whiteSpace: 'nowrap' }}>输入</td>
                    <td style={{ textAlign: 'right', padding: '6px 12px', color: '#111827', fontWeight: 600, whiteSpace: 'nowrap' }}>{promptTokens.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', padding: '6px 12px', color: '#9CA3AF', whiteSpace: 'nowrap' }}>—</td>
                    <td style={{ textAlign: 'right', padding: '6px 12px', color: '#111827', fontWeight: 600, whiteSpace: 'nowrap' }}>{formatMoney(inputCost)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 12px 4px 24px', color: '#16A34A', whiteSpace: 'nowrap' }}>· 缓存命中</td>
                    <td style={{ textAlign: 'right', padding: '4px 12px', color: '#16A34A', fontWeight: 400, whiteSpace: 'nowrap' }}>{cachedTokens.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', padding: '4px 12px', color: '#16A34A', fontWeight: 400, whiteSpace: 'nowrap' }}>{formatPrice(cachedPrice)}</td>
                    <td style={{ textAlign: 'right', padding: '4px 12px', color: '#16A34A', fontWeight: 400, whiteSpace: 'nowrap' }}>{formatMoney(cachedCost)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 12px 4px 24px', color: '#F59E0B', whiteSpace: 'nowrap' }}>· 未命中</td>
                    <td style={{ textAlign: 'right', padding: '4px 12px', color: '#F59E0B', fontWeight: 400, whiteSpace: 'nowrap' }}>{missTokens.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', padding: '4px 12px', color: '#F59E0B', fontWeight: 400, whiteSpace: 'nowrap' }}>{formatPrice(inputPrice)}</td>
                    <td style={{ textAlign: 'right', padding: '4px 12px', color: '#F59E0B', fontWeight: 400, whiteSpace: 'nowrap' }}>{formatMoney(missCost)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '6px 12px', color: '#111827', whiteSpace: 'nowrap' }}>输出</td>
                    <td style={{ textAlign: 'right', padding: '6px 12px', color: '#111827', fontWeight: 600, whiteSpace: 'nowrap' }}>{completionTokens.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', padding: '6px 12px', color: '#9CA3AF', whiteSpace: 'nowrap' }}>—</td>
                    <td style={{ textAlign: 'right', padding: '6px 12px', color: '#111827', fontWeight: 600, whiteSpace: 'nowrap' }}>{formatMoney(outputCost)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 12px 4px 24px', color: '#8B5CF6', whiteSpace: 'nowrap' }}>· 思考</td>
                    <td style={{ textAlign: 'right', padding: '4px 12px', color: '#8B5CF6', fontWeight: 400, whiteSpace: 'nowrap' }}>{reasoningTokens.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', padding: '4px 12px', color: '#8B5CF6', fontWeight: 400, whiteSpace: 'nowrap' }}>{formatPrice(outputPrice)}</td>
                    <td style={{ textAlign: 'right', padding: '4px 12px', color: '#8B5CF6', fontWeight: 400, whiteSpace: 'nowrap' }}>{formatMoney(reasoningCost)}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '4px 12px 4px 24px', color: '#0EA5E9', whiteSpace: 'nowrap' }}>· 直出</td>
                    <td style={{ textAlign: 'right', padding: '4px 12px', color: '#0EA5E9', fontWeight: 400, whiteSpace: 'nowrap' }}>{directTokens.toLocaleString()}</td>
                    <td style={{ textAlign: 'right', padding: '4px 12px', color: '#0EA5E9', fontWeight: 400, whiteSpace: 'nowrap' }}>{formatPrice(outputPrice)}</td>
                    <td style={{ textAlign: 'right', padding: '4px 12px', color: '#0EA5E9', fontWeight: 400, whiteSpace: 'nowrap' }}>{formatMoney(directCost)}</td>
                  </tr>
                  <tr style={{ background: '#FAFAFA' }}>
                    <td style={{ padding: '6px 12px', color: '#4F46E5', fontWeight: 600, whiteSpace: 'nowrap' }}>合计</td>
                    <td style={{ textAlign: 'right', padding: '6px 12px', color: '#4F46E5', fontWeight: 600, whiteSpace: 'nowrap' }}>{modelTotalTokens.toLocaleString()}</td>
                    <td style={{ padding: '6px 12px' }}></td>
                    <td style={{ textAlign: 'right', padding: '6px 12px', color: '#F97316', fontWeight: 600, whiteSpace: 'nowrap' }}>{formatMoney(modelTotalCost)}</td>
                  </tr>
                </tbody>
              </table>
              )}
            </div>
          )
        })}
        </div>
        </>
      )}
      {modelConsumptions.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: '2px solid #E5E7EB' }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px' }}>
             <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#111827' }}>总计</span>
             <span style={{ flex: 1, textAlign: 'center', fontSize: 12, color: '#4F46E5', fontWeight: 700 }}>Tokens:{totalTokensAll.toLocaleString()}</span>
             <span style={{ flex: 1, textAlign: 'right', fontSize: 12, color: '#F97316', fontWeight: 700 }}>费用:{formatMoney(totalFee)}</span>
           </div>
        </div>
      )}
    </div>
  )

  const bookSelectContent = (
    <div style={{ width: 320, maxHeight: 380, overflowY: 'auto', padding: 4 }}>
      {books.length === 0 ? (
        <div style={{ padding: '18px 16px', color: '#9CA3AF', fontSize: 14 }}>暂无作品</div>
      ) : (
        books.map((book) => {
          const selected = book.id === bookId
          const title = book.title || '未命名作品'
          const subtitle = book.description || '暂无简介'
          return (
            <div
              key={book.id}
              onClick={() => handleSelectBook(book.id)}
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                cursor: 'pointer',
                display: 'grid',
                gridTemplateColumns: '42px 1fr 24px',
                alignItems: 'center',
                gap: 12,
                background: selected ? '#F3F4F6' : 'transparent',
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 9,
                  background: selected ? '#4F46E5' : '#6B7280',
                  color: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  fontWeight: 700,
                }}
              >
                {title.charAt(0)}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, lineHeight: 1.25, color: '#111827', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {title}
                </div>
                <div style={{ marginTop: 3, fontSize: 13, lineHeight: 1.2, color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {subtitle}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                {selected && <CheckOutlined style={{ color: '#10B981', fontSize: 20 }} />}
              </div>
            </div>
          )
        })
      )}
    </div>
  )

  if (collapsed) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          padding: '12px 8px 60px',
          position: 'relative',
        }}
      >
        {/* Logo + 折叠按钮 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Tooltip title="让「知卷」常伴你的身边" placement="right">
            <div
              onClick={() => navigate('/agent')}
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontWeight: 700,
                fontSize: 16,
                cursor: 'pointer',
              }}
            >
              稿
            </div>
          </Tooltip>
        </div>

        {/* 新建作品 */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
          <Tooltip title="新建作品" placement="right">
            <Button
              type="text"
              icon={<PlusOutlined />}
              onClick={() => setModalOpen(true)}
              style={collapsedButtonStyle(false)}
            />
          </Tooltip>
        </div>

        {/* 书籍选择 */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
          <Popover content={bookSelectContent} placement="rightTop" trigger="hover" arrow={false} styles={{ body: { padding: 6, borderRadius: 16 } }}>
            <Button
              type={bookId ? 'primary' : 'text'}
              icon={<BookOutlined />}
              style={collapsedButtonStyle(false)}
            />
          </Popover>
        </div>

        {/* 菜单图标 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <Tooltip title="「知卷」" placement="right">
            <Button type="text" icon={<UserOutlined />} onClick={() => navigate('/agent')} style={collapsedButtonStyle(isPathActive('/agent'))} />
          </Tooltip>
          <Tooltip title="模型管理" placement="right">
            <Button type="text" icon={<BlockOutlined />} onClick={() => navigate('/models')} style={collapsedButtonStyle(isPathActive('/models'))} />
          </Tooltip>
          <Tooltip title="AI 技能" placement="right">
            <Button type="text" icon={<FormatPainterOutlined />} onClick={() => navigate('/skills')} style={collapsedButtonStyle(isPathActive('/skills'))} />
          </Tooltip>
          <Tooltip title="工具集" placement="right">
            <Button type="text" icon={<ToolOutlined />} onClick={() => navigate('/tools')} style={collapsedButtonStyle(isPathActive('/tools'))} />
          </Tooltip>
          <Tooltip title="Token 消耗" placement="right">
            <Button type="text" icon={<HistoryOutlined />} onClick={() => navigate('/token-logs')} style={collapsedButtonStyle(isPathActive('/token-logs'))} />
          </Tooltip>
          <Tooltip title="设置" placement="right">
            <Button type="text" icon={<SettingOutlined />} onClick={() => navigate('/settings')} style={collapsedButtonStyle(isPathActive('/settings'))} />
          </Tooltip>
        </div>

        {/* 今日消耗（折叠状态） */}
        <Popover
          content={consumptionContent}
          placement="rightBottom"
          trigger="hover"
          arrow={false}
          align={{ offset: [0, 0] }}
        >
          <div
            onClick={() => navigate('/token-logs')}
            style={{
              padding: '7px 4px',
              borderRadius: 6,
              background: '#F9FAFB',
              textAlign: 'center',
              cursor: 'pointer',
              minWidth: 40,
            }}
          >
            <div style={{ fontSize: 9, fontWeight: 500, color: '#9CA3AF', lineHeight: 1.1, marginBottom: 3 }}>
              Token
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', lineHeight: 1.2 }}>
              {formatCompactNumber(todayTokens)}
            </div>
          </div>
        </Popover>

        {/* 折叠按钮 */}
        <div style={{ position: 'absolute', bottom: 12, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
          <Tooltip title="展开导航" placement="right">
            <Button
              type="text"
              size="small"
              icon={<MenuUnfoldOutlined />}
              onClick={() => onCollapse(false)}
              style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            />
          </Tooltip>
        </div>

        {/* 新建作品弹窗 */}
        <Modal
          title="新建作品"
          open={modalOpen}
          onCancel={() => { setModalOpen(false); form.resetFields() }}
          footer={null}
          width={420}
        >
          <Form form={form} layout="vertical" onFinish={handleCreateBook}>
            <Form.Item
              name="title"
              label="作品名称"
              rules={[{ required: true, message: '请输入作品名称' }]}
            >
              <Input placeholder="例如：星际征途" />
            </Form.Item>
            <Form.Item name="description" label="简介（可选）">
              <Input.TextArea placeholder="一句话描述你的故事…" rows={3} />
            </Form.Item>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={() => { setModalOpen(false); form.resetFields() }}>取消</Button>
              <Button type="primary" htmlType="submit">创建作品</Button>
            </div>
          </Form>
        </Modal>
      </div>
    )
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 12px 60px',
        position: 'relative',
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: '0 12px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div
          onClick={() => navigate('/agent')}
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', borderRadius: 14, padding: 8, margin: -8 }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: 18,
            }}
          >
            稿
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color: '#111827' }}>稿府 Lab</div>
            <div style={{ fontSize: 12, color: '#9CA3AF' }}>让「知卷」常伴你的身边</div>
          </div>
        </div>
      </div>

      {/* 新建作品 */}
      <div style={{ padding: '0 8px 12px' }}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          block
          style={{ height: 40, borderRadius: 10, fontWeight: 500 }}
          onClick={() => setModalOpen(true)}
        >
          新建作品
        </Button>
      </div>

      <div className="sider-menu hide-scrollbar" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {/* 我的书籍 */}
        <div style={{ padding: '8px 16px 6px', fontSize: 11, fontWeight: 600, color: '#9CA3AF', letterSpacing: 0.8 }}>
          我的书籍
        </div>
        <Menu
          mode="inline"
          selectedKeys={[getSelectedKey()]}
          items={bookItems}
          style={{ borderRight: 0, background: 'transparent' }}
        />

        {books.length === 0 && (
          <div style={{ padding: '8px 16px', fontSize: 13, color: '#9CA3AF' }}>
            暂无作品
          </div>
        )}

        {/* 创作资产 */}
        <div style={{ padding: '8px 16px 6px', fontSize: 11, fontWeight: 600, color: '#9CA3AF', letterSpacing: 0.8 }}>
          创作资产
        </div>
        <Menu
          mode="inline"
          selectedKeys={[getSelectedKey()]}
          items={creativeItems}
          style={{ borderRight: 0, background: 'transparent' }}
        />

        {/* 辅助资产 */}
        <div style={{ padding: '8px 16px 6px', fontSize: 11, fontWeight: 600, color: '#9CA3AF', letterSpacing: 0.8 }}>
          辅助资产
        </div>
        <Menu
          mode="inline"
          selectedKeys={[getSelectedKey()]}
          items={assistantItems}
          style={{ borderRight: 0, background: 'transparent' }}
        />

        {/* 系统 */}
        <div style={{ padding: '8px 16px 6px', fontSize: 11, fontWeight: 600, color: '#9CA3AF', letterSpacing: 0.8 }}>
          系统
        </div>
        <Menu
          mode="inline"
          selectedKeys={[getSelectedKey()]}
          items={systemItems}
          style={{ borderRight: 0, background: 'transparent' }}
        />
      </div>

      {/* 今日消耗 */}
      <Popover
        content={consumptionContent}
        placement="rightBottom"
        trigger="hover"
        arrow={false}
        align={{ offset: [0, 0] }}
      >
        <div
          onClick={() => navigate('/token-logs')}
          style={{
            padding: '12px 16px',
            margin: '8px 8px 0',
            borderRadius: 10,
            background: '#F9FAFB',
            cursor: 'pointer',
          }}
        >
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>今日消耗</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2 }}>Token</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>
                {todayTokens.toLocaleString()}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2 }}>费用（预计）</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#16A34A' }}>
                ¥ {todayCost.toFixed(4)}
              </div>
            </div>
          </div>
        </div>
      </Popover>

      {/* 折叠按钮 */}
      <div style={{ position: 'absolute', bottom: 12, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
        <Tooltip title="收起导航" placement="right">
          <Button
            type="text"
            size="small"
            icon={<MenuFoldOutlined />}
            onClick={() => onCollapse(true)}
            style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          />
        </Tooltip>
      </div>

      {/* 新建作品弹窗 */}
      <Modal
        title="新建作品"
        open={modalOpen}
        onCancel={() => { setModalOpen(false); form.resetFields() }}
        footer={null}
        width={420}
      >
        <Form form={form} layout="vertical" onFinish={handleCreateBook}>
          <Form.Item
            name="title"
            label="作品名称"
            rules={[{ required: true, message: '请输入作品名称' }]}
          >
            <Input placeholder="例如：星际征途" />
          </Form.Item>
          <Form.Item name="description" label="简介（可选）">
            <Input.TextArea placeholder="一句话描述你的故事…" rows={3} />
          </Form.Item>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => { setModalOpen(false); form.resetFields() }}>取消</Button>
            <Button type="primary" htmlType="submit">创建作品</Button>
          </div>
        </Form>
      </Modal>
    </div>
  )
}