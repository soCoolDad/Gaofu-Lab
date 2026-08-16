import React, { useEffect, useState, useMemo } from 'react'
import {
  Typography, Card, Space, Button, Tag, Input, Modal, message, Tooltip,
  Descriptions, Badge, Empty, Spin, Collapse
} from 'antd'
import {
  ToolOutlined, ReadOutlined, EditOutlined, SettingOutlined,
  BgColorsOutlined, CameraOutlined, BookOutlined, UndoOutlined,
  CheckOutlined, ExclamationCircleOutlined, FileSearchOutlined, FormOutlined
} from '@ant-design/icons'
import type { ToolPromptInfo } from '../../types/api'

const { Title, Text, Paragraph } = Typography
const { TextArea } = Input

// ─── 类别图标映射 ───────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  book: <BookOutlined />,
  volume: <BgColorsOutlined />,
  chapter: <EditOutlined />,
  outline: <ReadOutlined />,
  setting: <SettingOutlined />,
  snapshot: <CameraOutlined />,
  system: <ToolOutlined />,
}

const CATEGORY_LABELS: Record<string, string> = {
  book: '书籍',
  volume: '分卷',
  chapter: '章节',
  outline: '大纲',
  setting: '设定',
  snapshot: '记忆',
  system: '系统',
}

const MODE_LABELS: Record<string, string> = {
  read: '查询',
  write: '写操作',
}

// 工具图标：读取类用 FileSearchOutlined，写入类用 FormOutlined
const TOOL_MODE_ICON = (mode?: string): React.ReactNode =>
  mode === 'write' ? <FormOutlined /> : <FileSearchOutlined />

// ─── 工具英文名 → 中文名映射 ──────────────────────────────────

const TOOL_NAME_MAP: Record<string, string> = {
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

/** 工具显示名：优先中文，无映射时回退英文 */
const toolDisplayName = (name: string): string => TOOL_NAME_MAP[name] || name

// ─── 将类别按逻辑分组 ──────────────────────────────────────────

const CATEGORY_GROUPS: Array<{ label: string; categories: string[] }> = [
  { label: '书籍', categories: ['book'] },
  { label: '大纲', categories: ['outline'] },
  { label: '分卷', categories: ['volume'] },
  { label: '章节', categories: ['chapter'] },
  { label: '设定', categories: ['setting'] },
  { label: '记忆', categories: ['snapshot'] },
  { label: '系统', categories: ['system'] },
]

// 工具操作类型（更细的粒度：列表 / 详情 / 大纲 / 正文 / 新增 / 更新 / 生成 / 删除）
// 用于在工具集页面按「实体 → 操作」展示，与模型工具目录的分组口径一致。
const OPERATION_OF: Record<string, string> = {
  list_books: '列表', list_volumes: '列表', list_chapters: '列表', list_settings: '列表', list_snapshots: '列表',
  get_book: '详情', get_chapter: '详情', get_snapshot: '详情', get_volume: '详情', get_setting: '详情',
  get_book_outline: '大纲', write_book_outline: '大纲', update_volume_outline: '大纲', update_chapter_outline: '大纲',
  get_chapter_content: '正文', write_chapter_content: '正文',
  create_book: '新增', create_volumes: '新增', create_chapters: '新增', create_settings: '新增',
  update_book: '更新', update_volume: '更新', update_chapter: '更新', update_setting: '更新',
  generate_snapshot: '生成',
  delete_entity: '删除',
  request_user_confirmation: '通用',
}
const OPERATION_ORDER = ['列表', '详情', '大纲', '正文', '新增', '更新', '生成', '删除', '通用']

export default function ToolsPage() {
  const [tools, setTools] = useState<ToolPromptInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTool, setSelectedTool] = useState<ToolPromptInfo | null>(null)
  const [editingPrompt, setEditingPrompt] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [resetModalOpen, setResetModalOpen] = useState(false)

  // 加载工具列表
  useEffect(() => {
    loadTools()
  }, [])

  const loadTools = async () => {
    setLoading(true)
    try {
      const list = await window.api.agent.getToolPrompts()
      setTools(list)
      if (list.length > 0 && !selectedTool) {
        setSelectedTool(list[0])
      }
    } catch (e: any) {
      message.error('加载工具列表失败：' + (e.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }

  // 选中工具时同步编辑区
  useEffect(() => {
    if (selectedTool) {
      setEditingPrompt(selectedTool.currentPrompt || '')
    }
  }, [selectedTool])

  // 保存提示词
  const handleSave = async () => {
    if (!selectedTool) return
    // 检查是否和当前值相同
    if (editingPrompt === selectedTool.currentPrompt) {
      message.info('提示词未修改')
      return
    }
    setSaving(true)
    try {
      const result = await window.api.agent.updateToolPrompt(selectedTool.name, editingPrompt)
      if (result.success) {
        message.success(`「${selectedTool.name}」提示词已保存`)
        // 刷新工具列表以更新状态
        const list = await window.api.agent.getToolPrompts()
        setTools(list)
        const updated = list.find((t) => t.name === selectedTool.name)
        if (updated) setSelectedTool(updated)
      } else {
        message.error('保存失败：' + (result.error || '未知错误'))
      }
    } catch (e: any) {
      message.error('保存失败：' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  // 重置为默认
  const handleReset = async () => {
    if (!selectedTool) return
    try {
      const result = await window.api.agent.updateToolPrompt(selectedTool.name, null)
      if (result.success) {
        message.success(`「${selectedTool.name}」已重置为默认提示词`)
        const list = await window.api.agent.getToolPrompts()
        setTools(list)
        const updated = list.find((t) => t.name === selectedTool.name)
        if (updated) setSelectedTool(updated)
      } else {
        message.error('重置失败：' + (result.error || '未知错误'))
      }
    } catch (e: any) {
      message.error('重置失败：' + (e.message || '未知错误'))
    } finally {
      setResetModalOpen(false)
    }
  }

  // 按分组整理工具列表
  const groupedTools = useMemo(() => {
    const map: Record<string, ToolPromptInfo[]> = {}
    for (const tool of tools) {
      if (!map[tool.category]) map[tool.category] = []
      map[tool.category].push(tool)
    }
    return CATEGORY_GROUPS.map((group) => ({
      ...group,
      tools: (group.categories.flatMap((cat) => map[cat] || [])).sort(
        (a, b) =>
          OPERATION_ORDER.indexOf(OPERATION_OF[a.name] || '') -
          OPERATION_ORDER.indexOf(OPERATION_OF[b.name] || ''),
      ),
    })).filter((g) => g.tools.length > 0)
  }, [tools])

  // 参数格式化为可读形式
  const formatParams = (tool: ToolPromptInfo) => {
    const params = tool.parameters || {}
    return Object.entries(params).map(([key, schema]: [string, any]) => {
      const isRequired = (tool.required || []).includes(key)
      let typeLabel = schema.type || 'any'
      if (schema.type === 'array' && schema.items?.type) {
        typeLabel = `array<${schema.items.type}>`
      } else if (schema.type === 'object' && schema.properties) {
        const props = Object.keys(schema.properties).join(', ')
        typeLabel = `object{${props}}`
      }
      if (schema.enum) {
        typeLabel = schema.enum.join(' | ')
      }
      return { key, typeLabel, description: schema.description || '', required: isRequired }
    })
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
        <Spin size="large" tip="加载工具列表..." />
      </div>
    )
  }

  return (
    <div>
      {/* 页面标题 */}
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0, fontWeight: 600 }}>
          <Space>
            <ToolOutlined />
            工具集
          </Space>
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          查看系统工具定义，管理工具提示词
        </Text>
      </div>

      {/* 主体：左右分栏 */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* 左侧：工具列表 */}
        <div style={{ width: 280, flexShrink: 0 }}>
          <Card
            variant="borderless"
            style={{ borderRadius: 12, maxHeight: 'calc(100vh - 170px)' }}
            styles={{ body: { padding: '8px 0', overflowY: 'auto', maxHeight: 'calc(100vh - 170px)' } }}
          >
            {groupedTools.map((group) => (
              <div key={group.label} style={{ marginBottom: 4 }}>
                <div style={{
                  padding: '8px 16px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#9CA3AF',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}>
                  {group.label}
                </div>
                {group.tools.map((tool) => (
                  <div
                    key={tool.name}
                    onClick={() => setSelectedTool(tool)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 16px',
                      cursor: 'pointer',
                      borderRadius: 0,
                      background: selectedTool?.name === tool.name ? '#EFF6FF' : 'transparent',
                      borderLeft: selectedTool?.name === tool.name ? '3px solid #3B82F6' : '3px solid transparent',
                      transition: 'all 0.15s',
                    }}
                  >
                    <span style={{ fontSize: 14, color: '#6B7280' }}>
                      {TOOL_MODE_ICON(tool.mode)}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: '#111827',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {toolDisplayName(tool.name)}
                      </div>
                      <div style={{
                        fontSize: 11,
                        color: '#9CA3AF',
                        fontFamily: 'monospace',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {tool.name}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {tool.hasPromptOverride && (
                        <Tooltip title="提示词已自定义">
                          <Badge status="processing" />
                        </Tooltip>
                      )}
                      <Tag
                        color="default"
                        style={{ fontSize: 10, lineHeight: '18px', margin: 0, color: tool.mode === 'write' ? '#D97706' : '#2563EB' }}
                      >
                        {OPERATION_OF[tool.name] || MODE_LABELS[tool.mode] || tool.mode}
                      </Tag>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </Card>
        </div>

        {/* 右侧：工具详情 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {selectedTool ? (
            <>
              {/* 工具基本信息 */}
              <Card
                variant="borderless"
                style={{ borderRadius: 12, marginBottom: 16 }}
                styles={{ body: { padding: '20px 24px' } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <Space align="center">
                    <Title level={4} style={{ margin: 0, fontWeight: 600 }}>
                      {toolDisplayName(selectedTool.name)}
                    </Title>
                    <Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
                      {selectedTool.name}
                    </Text>
                    {selectedTool.hasPromptOverride && (
                      <Tag color="blue">提示词已自定义</Tag>
                    )}
                  </Space>
                  <Space>
                    <Tag
                      color={selectedTool.mode === 'write' ? 'orange' : 'blue'}
                      icon={TOOL_MODE_ICON(selectedTool.mode)}
                    >
                      {MODE_LABELS[selectedTool.mode] || selectedTool.mode}
                    </Tag>
                    <Tag icon={CATEGORY_ICONS[selectedTool.category] || <ToolOutlined />}>
                      {CATEGORY_LABELS[selectedTool.category] || selectedTool.category}
                    </Tag>
                  </Space>
                </div>

                <Paragraph style={{ color: '#6B7280', fontSize: 13, marginBottom: 16 }}>
                  {selectedTool.description}
                </Paragraph>

                {/* 参数表（默认折叠） */}
                {Object.keys(selectedTool.parameters || {}).length > 0 && (
                  <Collapse
                    defaultActiveKey={[]}
                    bordered={false}
                    items={[
                      {
                        key: 'params',
                        label: (
                          <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase' }}>
                            参数
                          </Text>
                        ),
                        children: (
                          <Descriptions
                            size="small"
                            column={1}
                            style={{ marginTop: 8 }}
                            labelStyle={{
                              fontFamily: 'monospace',
                              fontSize: 12,
                              fontWeight: 600,
                              color: '#374151',
                              background: '#F3F4F6',
                              padding: '4px 8px',
                              borderRadius: 4,
                              width: 320,
                              minWidth: 320,
                              maxWidth: 320,
                              verticalAlign: 'top',
                            }}
                            contentStyle={{
                              padding: '4px 8px',
                              fontSize: 12,
                            }}
                          >
                            {formatParams(selectedTool).map((param) => (
                              <Descriptions.Item
                                key={param.key}
                                label={
                                  <span>
                                    {param.key}
                                    {param.required && <span style={{ color: '#EF4444', marginLeft: 4 }}>*</span>}
                                    <span style={{ color: '#9CA3AF', fontWeight: 400, marginLeft: 8 }}>
                                      {param.typeLabel}
                                    </span>
                                  </span>
                                }
                              >
                                {param.description}
                              </Descriptions.Item>
                            ))}
                          </Descriptions>
                        ),
                      },
                    ]}
                  />
                )}
              </Card>

              {/* 提示词编辑器 */}
              <Card
                variant="borderless"
                style={{ borderRadius: 12 }}
                styles={{ body: { padding: '20px 24px' } }}
                title={
                  <Space>
                    <span style={{ fontWeight: 500 }}>提示词编辑</span>
                    {selectedTool.hasPromptOverride && (
                      <Tag color="blue" style={{ marginLeft: 0 }}>已覆盖默认值</Tag>
                    )}
                  </Space>
                }
                extra={
                  <Space>
                    {selectedTool.hasPromptOverride && (
                      <Button
                        size="small"
                        danger
                        type="text"
                        icon={<UndoOutlined />}
                        onClick={() => setResetModalOpen(true)}
                      >
                        恢复默认
                      </Button>
                    )}
                    <Button
                      size="small"
                      type="primary"
                      icon={<CheckOutlined />}
                      loading={saving}
                      onClick={handleSave}
                    >
                      保存
                    </Button>
                  </Space>
                }
              >
                <div style={{
                  marginBottom: 8,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    修改后会覆盖默认提示词。保存后立即生效，后续模型调用该工具时将使用此版本。
                  </Text>
                </div>
                <TextArea
                  value={editingPrompt}
                  onChange={(e) => setEditingPrompt(e.target.value)}
                  placeholder="该工具暂无提示词"
                  rows={14}
                  style={{
                    fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", monospace',
                    fontSize: 13,
                    lineHeight: 1.7,
                    background: '#FAFBFC',
                  }}
                />
              </Card>
            </>
          ) : (
            <Card variant="borderless" style={{ borderRadius: 12, minHeight: 400 }}>
              <Empty description="请从左侧选择一个工具查看详情" />
            </Card>
          )}
        </div>
      </div>

      {/* 确认重置弹窗 */}
      <Modal
        open={resetModalOpen}
        title={
          <Space>
            <ExclamationCircleOutlined style={{ color: '#EF4444' }} />
            确认恢复默认
          </Space>
        }
        onOk={handleReset}
        onCancel={() => setResetModalOpen(false)}
        okText="确认恢复"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <Paragraph>
          确定要将 <Text code>{selectedTool?.name}</Text> 的提示词恢复为系统默认版本吗？
        </Paragraph>
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          此操作会删除您的自定义提示词，恢复为系统内置的默认提示词。此操作不可撤销。
        </Paragraph>
      </Modal>
    </div>
  )
}
