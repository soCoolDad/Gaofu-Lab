import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Card, Empty, Form, Input, List, Modal, Tag, Typography, message } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'
import type { BookSettingEntry, BookSettingEntryType } from '@/types/api'
import { useWorkspaceStore } from '@/stores/workspace.store'
import MDXViewer from '@/components/MDXViewer'
import MDXEditorWrapper from '@/components/MDXEditorWrapper'

const { Title, Text } = Typography

// Form.Item 适配器：把受控的 value/onChange 桥接到 MDXEditorWrapper 的 content/onChange
// 这样 detail 字段既能享受 Markdown 编辑体验（工具栏、源码切换、全屏），又不破坏 Form 的表单校验和提交
function MdxEditorField({ value, onChange, placeholder }: { value?: string; onChange?: (v: string) => void; placeholder?: string }) {
  // MDXEditorWrapper 内部按 flex 布局撑满父容器，外层给一个固定的最小高度以便在弹窗里有像样的编辑区
  return (
    <div style={{ height: 260, border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
      <MDXEditorWrapper
        content={value || ''}
        onChange={(md) => onChange?.(md)}
        placeholder={placeholder}
        variant="outline"
      />
    </div>
  )
}

type Props = {
  type: BookSettingEntryType
  title: string
  subtitle: string
  listTitle: string
  emptyText: string
  createText: string
  nameLabel: string
  namePlaceholder: string
  descriptionPlaceholder: string
  detailPlaceholder: string
  icon: ReactNode
  color: string
  background: string
}

export default function BookSettingEntryPage(props: Props) {
  const { bookId } = useParams()
  const { currentBook } = useWorkspaceStore()
  const [entries, setEntries] = useState<BookSettingEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<BookSettingEntry | null>(null)
  const [form] = Form.useForm()

  const loadEntries = async () => {
    if (!bookId || !window.api?.bookSetting?.list) return
    setLoading(true)
    try {
      const data = await window.api.bookSetting.list({ bookId, type: props.type })
      setEntries(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadEntries()
  }, [bookId, props.type])

  useEffect(() => {
    const handleBookSettingsUpdated = () => loadEntries()
    window.addEventListener('book-settings-updated', handleBookSettingsUpdated)
    window.addEventListener('ai-result-applied', handleBookSettingsUpdated)
    return () => {
      window.removeEventListener('book-settings-updated', handleBookSettingsUpdated)
      window.removeEventListener('ai-result-applied', handleBookSettingsUpdated)
    }
  }, [bookId, props.type])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (entry: BookSettingEntry) => {
    setEditing(entry)
    form.setFieldsValue({
      name: entry.name,
      description: entry.description,
      detail: entry.detail,
    })
    setModalOpen(true)
  }

  const handleSubmit = async (values: { name: string; description?: string; detail?: string }) => {
    if (!bookId) return
    try {
      if (editing) {
        await window.api.bookSetting.update(editing.id, values)
        message.success('设定已更新')
      } else {
        await window.api.bookSetting.create({ bookId, type: props.type, ...values })
        message.success('设定已创建')
      }

      setModalOpen(false)
      setEditing(null)
      form.resetFields()
      await loadEntries()
      window.dispatchEvent(new Event('book-settings-updated'))
    } catch (error: any) {
      message.error(error?.message || '保存失败')
    }
  }

  const handleDelete = async (id: string) => {
    await window.api.bookSetting.delete(id)
    message.success('设定已删除')
    await loadEntries()
    window.dispatchEvent(new Event('book-settings-updated'))
  }

  if (!currentBook) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <Text type="secondary">请先选择或创建一个作品</Text>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Title level={3} style={{ margin: 0, fontWeight: 600 }}>{props.title}</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>{props.subtitle}</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{props.createText}</Button>
      </div>

      <Card
        variant="borderless"
        style={{ borderRadius: 12 }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: props.color }}>{props.icon}</span>
            <span style={{ fontWeight: 600 }}>{props.listTitle}</span>
            <Tag color="default" style={{ marginLeft: 8 }}>{entries.length} 条</Tag>
          </div>
        }
      >
        {entries.length === 0 && !loading ? (
          <Empty description={props.emptyText} />
        ) : (
          <List
            loading={loading}
            dataSource={entries}
            renderItem={(entry) => (
              <List.Item
                actions={[
                  <Button key="edit" type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(entry)} />,
                  <Button key="delete" type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(entry.id)} />,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: props.background, color: props.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                      {entry.name.charAt(0)}
                    </div>
                  }
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600, color: '#111827' }}>{entry.name}</span>
                    </div>
                  }
                  description={
                    <div style={{ color: '#6B7280', fontSize: 13 }}>
                      <div>{entry.description || '暂无一句话简介'}</div>
                      {entry.detail && (
                        <div style={{ marginTop: 6 }}>
                          <MDXViewer content={entry.detail} />
                        </div>
                      )}
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      <Modal
        title={editing ? `编辑${props.nameLabel}` : `新建${props.nameLabel}`}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields() }}
        footer={null}
        width={820}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: `请输入${props.nameLabel}名称` }]}>
            <Input placeholder={props.namePlaceholder} />
          </Form.Item>
          <Form.Item name="description" label="一句话简介">
            <Input placeholder={props.descriptionPlaceholder} />
          </Form.Item>
          <Form.Item name="detail" label="详细简介">
            <MdxEditorField placeholder={props.detailPlaceholder} />
          </Form.Item>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => { setModalOpen(false); setEditing(null); form.resetFields() }}>取消</Button>
            <Button type="primary" htmlType="submit">保存</Button>
          </div>
        </Form>
      </Modal>
    </div>
  )
}
