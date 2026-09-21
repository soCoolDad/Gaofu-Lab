import { useEffect, useState } from 'react'
import { Menu, Button, Modal, Form, Input, InputNumber, message, Tooltip, Select } from 'antd'
import type { MenuProps } from 'antd'
import {
  EditOutlined,
  ContainerOutlined,
  FileTextOutlined,
  BookOutlined,
  FolderOpenOutlined,
  TeamOutlined,
  EnvironmentOutlined,
  InboxOutlined,
  FireOutlined,
  BulbOutlined,
  ThunderboltOutlined,
  BankOutlined,
  ControlOutlined,
  ApartmentOutlined,
  PartitionOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  MessageOutlined,
  SubnodeOutlined,
  NodeExpandOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { BrainOutlined } from '@/icons/BrainOutlined'


function formatNumber(num: number): string {
  if (num >= 1e12) {
    return Math.round(num / 1e12) + '兆'
  }
  if (num >= 1e8) {
    return Math.round(num / 1e8) + '亿'
  }
  if (num >= 1e4) {
    return Math.round(num / 1e4) + '万'
  }
  if (num >= 1000) {
    const k = Math.round(num / 1000)
    // 9500~9999 四舍五入会到 10 千，单位尴尬，直接进位成 1万
    if (k >= 10) return '1万'
    return k + '千'
  }
  return num.toString()
}

const DEFAULT_OPEN_KEYS = ['group-create', 'group-structure', 'group-settings', 'group-book-actions']

type Props = {
  bookTitle: string
  bookId: string
  collapsed?: boolean
}

export default function WorkspaceMenu({ bookTitle, collapsed = false }: Props) {
  const navigate = useNavigate()
  const { bookId } = useParams()
  const location = useLocation()
  const { stats, currentBook, updateBook, deleteBook } = useWorkspaceStore()
  const [editOpen, setEditOpen] = useState(false)
  const [openKeys, setOpenKeys] = useState(DEFAULT_OPEN_KEYS)
  const [form] = Form.useForm()

  useEffect(() => {
    if (editOpen) {
      form.setFieldsValue({
        title: currentBook?.title || bookTitle || '',
        description: currentBook?.description || '',
        detail: currentBook?.detail || '',
        writingStyle: currentBook?.writingStyle || '',
        writingPov: currentBook?.writingPov || '',
        writingWordCountTarget: currentBook?.writingWordCountTarget || '',
        writingTaboo: currentBook?.writingTaboo || '',
        writingConstraint: currentBook?.writingConstraint || '',
      })
    }
  }, [bookTitle, currentBook, editOpen, form])

  useEffect(() => {
    if (!collapsed) setOpenKeys(DEFAULT_OPEN_KEYS)
  }, [collapsed])

  const handleUpdateBook = async (values: { title: string; description?: string; detail?: string; writingStyle?: string; writingPov?: string; writingWordCountTarget?: string; writingTaboo?: string; writingConstraint?: string }) => {
    if (!bookId) return
    try {
      await updateBook(bookId, {
        title: values.title,
        description: values.description || '',
        detail: values.detail || '',
        writingStyle: values.writingStyle || '',
        writingPov: values.writingPov || '',
        // InputNumber 返回 number，转成字符串存库
        writingWordCountTarget: String(values.writingWordCountTarget ?? ''),
        writingTaboo: values.writingTaboo || '',
        writingConstraint: values.writingConstraint || '',
      })
      setEditOpen(false)
      message.success('作品信息已更新')
    } catch {
      message.error('更新失败')
    }
  }

  const handleDeleteBook = () => {
    if (!bookId) return
    Modal.confirm({
      title: '删除当前作品？',
      content: `确定要删除《${bookTitle || '未命名作品'}》吗？作品下的分卷、章节、角色、大纲等数据也会被删除，此操作不可恢复。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteBook(bookId)
        message.success('作品已删除')
        navigate('/')
      },
    })
  }

  const createItems: MenuProps['items'] = [
    { key: 'editor', icon: <EditOutlined />, label: '正文编辑', onClick: () => navigate(`/book/${bookId}/editor`) },
  ]
  const structureItems: MenuProps['items'] = [
    { key: 'chapters', icon: <FileTextOutlined />, label: '章节管理', onClick: () => navigate(`/book/${bookId}/chapters`) },
    { key: 'volumes', icon: <FolderOpenOutlined />, label: '分卷管理', onClick: () => navigate(`/book/${bookId}/volumes`) },
    { key: 'outline', icon: <ContainerOutlined />, label: '大纲管理', onClick: () => navigate(`/book/${bookId}/outline`) },
    { key: 'timeline', icon: <NodeExpandOutlined />, label: '记忆线', onClick: () => navigate(`/book/${bookId}/timeline`) },
    { key: 'memory', icon: <BrainOutlined />, label: '总记忆', onClick: () => navigate(`/book/${bookId}/memory`) },
    { key: 'role-dialogue', icon: <PlayCircleOutlined />, label: '剧情预演', onClick: () => navigate(`/book/${bookId}/role-dialogue`) },
    { key: 'chat-room', icon: <MessageOutlined />, label: '角色聊天室', onClick: () => navigate(`/book/${bookId}/chat-room`) },
    { key: 'style-fingerprint', icon: <SubnodeOutlined />, label: '文风指纹', onClick: () => navigate(`/book/${bookId}/style-fingerprint`) },
  ]
  const settingItems: MenuProps['items'] = [
    { key: 'characters', icon: <TeamOutlined />, label: '角色管理', onClick: () => navigate(`/book/${bookId}/characters`) },
    { key: 'locations', icon: <EnvironmentOutlined />, label: '地点管理', onClick: () => navigate(`/book/${bookId}/locations`) },
    { key: 'items', icon: <InboxOutlined />, label: '物品管理', onClick: () => navigate(`/book/${bookId}/items`) },
    { key: 'skills', icon: <FireOutlined />, label: '技能管理', onClick: () => navigate(`/book/${bookId}/skills`) },
    { key: 'scenes', icon: <BankOutlined />, label: '场景管理', onClick: () => navigate(`/book/${bookId}/scenes`) },
    { key: 'factions', icon: <ApartmentOutlined />, label: '势力管理', onClick: () => navigate(`/book/${bookId}/factions`) },
    { key: 'systems', icon: <PartitionOutlined />, label: '体系管理', onClick: () => navigate(`/book/${bookId}/systems`) },
    { key: 'inspirations', icon: <BulbOutlined />, label: '灵感管理', onClick: () => navigate(`/book/${bookId}/inspirations`) },
    { key: 'foreshadowings', icon: <ThunderboltOutlined />, label: '伏笔管理', onClick: () => navigate(`/book/${bookId}/foreshadowings`) },
  ]
  const systemItems: MenuProps['items'] = [
    { key: 'book-settings', icon: <ControlOutlined />, label: '作品设置', onClick: () => setEditOpen(true) },
  ]
  const items: MenuProps['items'] = collapsed
    ? [...createItems, ...structureItems, ...settingItems, ...systemItems]
    : [
      { key: 'group-create', label: '创作', children: createItems },
      { key: 'group-structure', label: '结构', children: structureItems },
      { key: 'group-settings', label: '设定', children: settingItems },
      { key: 'group-book-actions', label: '系统', children: systemItems },
    ]

  const getSelectedKey = () => {
    const path = location.pathname.split('/').pop() || 'chapters'
    return path
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: collapsed ? '16px 0' : '20px 20px 12px',
          textAlign: collapsed ? 'center' : 'left',
          height: collapsed ? 104 : 'auto',
          minHeight: collapsed ? 104 : 'auto',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
      >
        {collapsed ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#EEF2FF',
                color: '#4F46E5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {(bookTitle || '未命名作品').charAt(0)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, color: '#6B7280', marginTop: 4 }}>
              <Tooltip title={`${stats.totalWords.toLocaleString()} 字`} placement="right">
                <div style={{ fontSize: 10, lineHeight: 1.1, maxWidth: 46, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {formatNumber(stats.totalWords)}字
                </div>
              </Tooltip>
              <Tooltip title={`${stats.totalChapters.toLocaleString()} 章`} placement="right">
                <div style={{ fontSize: 10, lineHeight: 1.1, maxWidth: 46, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {formatNumber(stats.totalChapters)}章
                </div>
              </Tooltip>
            </div>
          </div>
        ) : (
          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div
                style={{
                  fontSize: 11,
                  color: '#9CA3AF',
                  marginBottom: 6,
                  fontWeight: 500,
                }}
              >
                当前作品
              </div>
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: '#111827',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 12,
              }}
            >
              {bookTitle || '未命名作品'}
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <FileTextOutlined style={{ fontSize: 12, color: '#4F46E5' }} />
                <span style={{ fontSize: 12, color: '#6B7280' }}>{formatNumber(stats.totalWords)}字</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <BookOutlined style={{ fontSize: 12, color: '#16A34A' }} />
                <span style={{ fontSize: 12, color: '#6B7280' }}>{stats.totalChapters}章</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        className="sider-menu workspace-menu hide-scrollbar"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '8px 0',
        }}
      >
        <Menu
          mode="inline"
          items={items}
          selectedKeys={[getSelectedKey()]}
          openKeys={collapsed ? [] : openKeys}
          onOpenChange={(keys) => setOpenKeys(keys as string[])}
          inlineCollapsed={collapsed}
          style={{
            borderRight: 0,
            background: 'transparent',
          }}
        />
      </div>

      <div
        style={{
          flexShrink: 0,
          padding: collapsed ? '10px 8px 52px' : '10px 16px 52px',
          background: '#FFFFFF',
        }}
      >
        <Tooltip title="删除作品" placement="right">
          <Button
            danger
            type="text"
            icon={<DeleteOutlined />}
            onClick={handleDeleteBook}
            style={{
              width: '100%',
              height: 38,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 600,
            }}
          />
        </Tooltip>
      </div>
      <Modal
        title="编辑作品信息"
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        footer={null}
        width={960}
      >
        <Form form={form} layout="vertical" onFinish={handleUpdateBook} style={{ display: 'flex', flexDirection: 'column', maxHeight: '70vh' }}>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <Form.Item
              name="title"
              label="作品名称"
              rules={[{ required: true, message: '请输入作品名称' }]}
            >
              <Input placeholder="请输入作品名称" />
            </Form.Item>
            <Form.Item name="description" label="简介">
              <Input.TextArea placeholder="一句话简介，便于列表快速识别" rows={2} />
            </Form.Item>
            <Form.Item name="detail" label="详细简介" extra="可以设定世界观、题材、风格、看点等">
              <Input.TextArea placeholder="请输入作品的详细简介（世界观、题材、主线、风格、看点等）" rows={6} />
            </Form.Item>
            <div style={{ marginBottom: 8, marginTop: 4, fontSize: 13, color: '#374151', fontWeight: 500 }}>正文写作设置</div>
            <Form.Item name="writingWordCountTarget" label="单章期待字数">
              <InputNumber placeholder="例：3000" min={0} step={500} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="writingPov" label="叙述人称">
              <Input placeholder="例：第三人称限知 / 第一人称" />
            </Form.Item>
            <Form.Item name="writingStyle" label="写作风格" extra="示例：冷峻克制 / 中式古典 / 网文爽感。">
              <Input.TextArea placeholder="例：冷峻克制 / 中式古典 / 网文爽感" autoSize={{ minRows: 2, maxRows: 6 }} />
            </Form.Item>
            <Form.Item name="writingTaboo" label="禁写清单" extra="不允许出现的词、剧透、内容等，写手会严守此清单。">
              <Input.TextArea placeholder="逐条列出禁写内容" autoSize={{ minRows: 2, maxRows: 6 }} />
            </Form.Item>
            <Form.Item name="writingConstraint" label="写作约束" extra="对写手的额外要求，如叙事节奏、对话风格、章节结尾方式等。">
              <Input.TextArea placeholder="例：每章结尾留悬念 / 对话占比不低于 30% / 避免大段环境描写" autoSize={{ minRows: 2, maxRows: 6 }} />
            </Form.Item>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setEditOpen(false)}>取消</Button>
            <Button type="primary" htmlType="submit">保存</Button>
          </div>
        </Form>
      </Modal>
    </div>
  )
}