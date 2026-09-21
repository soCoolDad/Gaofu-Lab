import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Card, Input, message, Modal, Space, Spin, Tag, Typography } from 'antd'
import { EditOutlined, SaveOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons'
import { BrainOutlined } from '@/icons/BrainOutlined'
import MDXViewer from '@/components/MDXViewer'
import { useWorkspaceStore } from '@/stores/workspace.store'

const { Title, Text, Paragraph } = Typography

/**
 * 全书总记忆页面
 *
 * 独立内页：查看自然语言视图 / 编辑 JSON 数据 / 删除总记忆。
 * 总记忆由定稿自动聚合生成，此页面支持手动编辑（覆盖 book_memory.data）。
 */
export default function BookMemoryPage() {
  const { bookId } = useParams<{ bookId: string }>()
  const currentBook = useWorkspaceStore((s) => s.currentBook)

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [rawJson, setRawJson] = useState('')
  const [naturalLanguage, setNaturalLanguage] = useState('')
  const [empty, setEmpty] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  const loadMemory = async () => {
    if (!bookId) return
    setLoading(true)
    try {
      const res = await window.api.ai.getBookMemory(bookId)
      if (!res || res.empty) {
        setEmpty(true)
        setNaturalLanguage('')
        setRawJson('')
        setUpdatedAt(null)
      } else {
        setEmpty(false)
        setNaturalLanguage(res.naturalLanguage || '')
        setRawJson(res.raw?.data || '')
        setUpdatedAt(res.raw?.updatedAt || null)
      }
    } catch (e: any) {
      message.error(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMemory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId])

  const handleEdit = () => {
    if (!rawJson) {
      message.warning('无可编辑的数据')
      return
    }
    // 格式化 JSON 方便编辑
    try {
      const parsed = JSON.parse(rawJson)
      setRawJson(JSON.stringify(parsed, null, 2))
    } catch {
      // 已是格式化文本，保持原样
    }
    setEditing(true)
  }

  const handleSave = async () => {
    if (!bookId) return
    try {
      JSON.parse(rawJson)
    } catch {
      message.error('数据格式错误，不是合法的 JSON')
      return
    }
    setSaving(true)
    try {
      const res = await window.api.ai.updateBookMemory({ bookId, data: rawJson })
      if (res.success) {
        message.success('总记忆已保存')
        setEditing(false)
        await loadMemory()
      } else {
        message.error(res.message || '保存失败')
      }
    } catch (e: any) {
      message.error(e?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = () => {
    if (!bookId) return
    Modal.confirm({
      title: '删除全书总记忆',
      width: 540,
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      content: (
        <div style={{ fontSize: 13, lineHeight: 1.8, color: '#374151' }}>
          <div style={{ color: '#B45309', fontWeight: 500, marginBottom: 10 }}>
            此操作不可恢复，请谨慎确认。
          </div>
          <div>将清空本书的<strong>全书总记忆</strong>，并连带删除：</div>
          <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
            <li>所有章节的<strong>记忆线片段</strong>（角色 / 地点 / 场景等轨迹）</li>
            <li>所有章节的<strong>章节记忆</strong>（定稿快照）</li>
          </ul>
          <div>
            删除后，本书所有已定稿章节将<strong>回退为「待定稿」</strong>状态，需要重新发起定稿才能再次生成记忆；
            正文内容不受影响。
          </div>
        </div>
      ),
      onOk: async () => {
        try {
          await window.api.ai.deleteBookMemory(bookId)
          message.success('已删除全书总记忆')
          setEditing(false)
          await loadMemory()
        } catch (e) {
          console.error('删除总记忆失败：', e)
          message.error('删除总记忆失败')
        }
      },
    })
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
      {/* 头部 */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Title level={3} style={{ margin: 0, fontWeight: 600 }}>
            <BrainOutlined style={{ color: '#4F46E5', marginRight: 8 }} />
            全书总记忆
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            聚合全书定稿记忆，记录角色 / 地点 / 物品 / 剧情等轨迹
            {updatedAt && <Tag color="blue" style={{ marginLeft: 8 }}>更新于 {new Date(updatedAt).toLocaleString('zh-CN')}</Tag>}
          </Text>
        </div>
        {!editing ? (
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadMemory} disabled={loading}>刷新</Button>
            {!empty && (
              <>
                <Button icon={<EditOutlined />} onClick={handleEdit}>编辑</Button>
                <Button danger icon={<DeleteOutlined />} onClick={handleDelete}>删除</Button>
              </>
            )}
          </Space>
        ) : (
          <Space>
            <Button onClick={() => { setEditing(false); loadMemory() }} disabled={saving}>取消</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>保存</Button>
          </Space>
        )}
      </div>

      {/* 内容区 */}
      <Card variant="borderless" style={{ borderRadius: 12 }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <Spin />
          </div>
        ) : empty ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <BrainOutlined style={{ fontSize: 48, color: '#D1D5DB', marginBottom: 16 }} />
            <div style={{ color: '#6B7280', fontSize: 14 }}>
              暂无总记忆。请先定稿章节，系统会自动生成并聚合记忆。
            </div>
          </div>
        ) : editing ? (
          <div>
            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.6 }}>
              编辑 JSON 数据，保存后将覆盖当前总记忆。下次定稿时系统会基于此数据继续增量合并。
              修改前请确认 JSON 格式正确。
            </Paragraph>
            <Input.TextArea
              value={rawJson}
              onChange={(e) => setRawJson(e.target.value)}
              rows={24}
              style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}
            />
          </div>
        ) : (
          <div style={{ fontSize: 13, lineHeight: 1.75, color: '#1F2937' }}>
            <MDXViewer content={naturalLanguage} />
          </div>
        )}
      </Card>
    </div>
  )
}
