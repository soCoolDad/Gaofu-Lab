import { useEffect, useState } from 'react'
import {
  Card,
  List,
  Button,
  Input,
  Form,
  Typography,
  Space,
  Tag,
  Modal,
  message,
  Tooltip,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  BookOutlined,
} from '@ant-design/icons'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useParams } from 'react-router-dom'

const { Title, Text } = Typography
const { TextArea } = Input

export default function VolumesPage() {
  const { bookId } = useParams()
  const {
    currentBook,
    volumes,
    chapters,
    loadVolumes,
    loadChapters,
    createVolume,
    updateVolume,
    deleteVolume,
  } = useWorkspaceStore()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()
  const [createModal, setCreateModal] = useState(false)
  const [createForm] = Form.useForm()

  useEffect(() => {
    if (bookId) {
      loadVolumes(bookId)
      loadChapters(bookId)
    }
  }, [bookId])

  const editing = editingId ? volumes.find((v) => v.id === editingId) : null

  const getChapterCount = (volumeId: string) => {
    return chapters.filter((c) => c.volumeId === volumeId).length
  }

  const openEditModal = (id: string) => {
    const volume = volumes.find((v) => v.id === id)
    if (!volume) return
    setEditingId(id)
    setModalOpen(true)
    // 用 requestAnimationFrame 保证 Modal 挂载后再 setFieldsValue，避免 destroyOnClose 场景下 form 实例未连接
    requestAnimationFrame(() => {
      form.setFieldsValue({
        title: volume.title,
        description: volume.description || '',
        outline: volume.outline || '',
      })
    })
  }

  const closeEditModal = () => {
    setModalOpen(false)
    setEditingId(null)
    form.resetFields()
  }

  const handleCreate = async (values: { title: string; description?: string; outline?: string }) => {
    if (!bookId) return
    try {
      await createVolume({
        bookId,
        title: values.title,
        description: values.description,
        outline: values.outline,
        sortOrder: volumes.length,
      })
      setCreateModal(false)
      createForm.resetFields()
      message.success('分卷创建成功')
    } catch {
      message.error('创建失败')
    }
  }

  const handleSave = async () => {
    if (!editingId) return
    try {
      const values = await form.validateFields()
      await updateVolume(editingId, values)
      message.success('保存成功')
      closeEditModal()
    } catch (err: any) {
      if (err?.errorFields) return
      message.error('保存失败')
    }
  }

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: '确认删除该分卷？',
      content: '删除后该分卷下的章节将变为未分卷状态',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteVolume(id)
        message.success('已删除')
        if (editingId === id) closeEditModal()
      },
    })
  }

  if (!currentBook) {
    return (
      <div style={{ padding: 24 }}>
        <Text type="secondary">请先选择一本书</Text>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Title level={3} style={{ margin: 0, fontWeight: 600 }}>分卷管理</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>管理作品的分卷结构与剧情规划</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModal(true)}>
          新建分卷
        </Button>
      </div>

      {volumes.length === 0 ? (
        <Card variant="borderless" style={{ borderRadius: 12, textAlign: 'center', padding: '60px 0', flex: 1 }}>
          <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>
            <BookOutlined />
          </div>
          <div style={{ fontSize: 16, fontWeight: 500, color: '#111827', marginBottom: 8 }}>还没有分卷</div>
          <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 20 }}>创建你的第一个分卷，开始规划故事结构</div>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModal(true)}>新建分卷</Button>
        </Card>
      ) : (
        <Card
          variant="borderless"
          style={{ flex: 1, borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          styles={{ body: { flex: 1, padding: 15, overflow: 'auto' } }}
          title={<div style={{ fontSize: 14, fontWeight: 600 }}>分卷列表 · 共 {volumes.length} 卷</div>}
        >
          <List
            dataSource={volumes}
            renderItem={(item, index) => (
              <List.Item
                key={item.id}
                style={{
                  padding: '14px 12px',
                  borderRadius: 10,
                  cursor: 'pointer',
                  // 与章节管理保持一致：靠 borderBottom 分隔而非每 item 独立卡片背景
                  borderBottom: index === volumes.length - 1 ? 'none' : '1px solid #F3F4F6',
                }}
                actions={[
                  <Tooltip title="编辑分卷" key="edit">
                    <Button type="text" icon={<EditOutlined />} onClick={() => openEditModal(item.id)} style={{ color: '#4F46E5' }} />
                  </Tooltip>,
                  <Tooltip title="删除分卷" key="delete">
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDelete(item.id)} />
                  </Tooltip>,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: '#EEF2FF', color: '#4F46E5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 }}>
                      卷{index + 1}
                    </div>
                  }
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontWeight: 500, fontSize: 14, color: '#111827' }}>{item.title}</span>
                      <Tag color="blue" style={{ marginRight: 0 }}>{getChapterCount(item.id)} 章</Tag>
                    </div>
                  }
                  description={
                    <div style={{ fontSize: 13, color: '#6B7280' }}>{item.description || '暂无分卷简介'}</div>
                  }
                />
              </List.Item>
            )}
          />
        </Card>
      )}

      {/* 编辑分卷弹窗 */}
      <Modal
        title={editing ? `编辑分卷 · ${editing.title}` : '编辑分卷'}
        open={modalOpen}
        onCancel={closeEditModal}
        width={820}
        centered
        destroyOnClose
        footer={
          <Space>
            <Button onClick={closeEditModal}>取消</Button>
            <Button type="primary" onClick={handleSave}>保存</Button>
          </Space>
        }
      >
        {editing && (
          <Form form={form} layout="vertical">
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <Tag color="purple">第 {volumes.findIndex((v) => v.id === editing.id) + 1} 卷</Tag>
              <Tag color="blue">{getChapterCount(editing.id)} 章</Tag>
            </div>
            <Form.Item name="title" label="分卷标题" rules={[{ required: true, message: '请输入分卷标题' }]}>
              <Input placeholder="输入分卷标题" />
            </Form.Item>
            <Form.Item name="description" label="分卷简介">
              <TextArea
                rows={3}
                placeholder="简要描述本卷的主要内容和剧情走向"
                style={{ resize: 'none' }}
              />
            </Form.Item>
            <Form.Item name="outline" label="分卷剧情大纲">
              <TextArea
                rows={12}
                placeholder="详细描述本卷的剧情发展、关键事件和人物成长..."
                style={{ resize: 'none', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.7 }}
              />
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* 新建分卷弹窗 */}
      <Modal title="新建分卷" open={createModal} onCancel={() => { setCreateModal(false); createForm.resetFields() }} footer={null} width={640} centered>
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="title" label="分卷标题" rules={[{ required: true, message: '请输入分卷标题' }]}>
            <Input placeholder="输入分卷标题，如：第一卷 初入江湖" />
          </Form.Item>
          <Form.Item name="description" label="分卷简介">
            <TextArea rows={3} placeholder="简要描述本卷的主要内容" style={{ resize: 'none' }} />
          </Form.Item>
          <Form.Item name="outline" label="分卷大纲">
            <TextArea rows={6} placeholder="详细描述本卷的剧情走向、关键事件和人物成长…" style={{ resize: 'none' }} />
          </Form.Item>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <Button onClick={() => { setCreateModal(false); createForm.resetFields() }}>取消</Button>
            <Button type="primary" htmlType="submit">创建</Button>
          </div>
        </Form>
      </Modal>
    </div>
  )
}
