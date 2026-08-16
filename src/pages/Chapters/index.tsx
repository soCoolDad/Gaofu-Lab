import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Card,
  List,
  Button,
  Tag,
  Space,
  Typography,
  Tooltip,
  Modal,
  Form,
  Input,
  Select,
  Pagination,
  message,
} from 'antd'
import {
  EditOutlined,
  LockOutlined,
  UnlockOutlined,
  PlusOutlined,
  FileTextOutlined,
  BookOutlined,
  DeleteOutlined,
  EyeOutlined,
} from '@ant-design/icons'
import { useWorkspaceStore } from '@/stores/workspace.store'
import type { Chapter } from '@/types/api'
import SnapshotViewerModal from '@/components/SnapshotViewerModal'

const { Title, Text } = Typography

export default function ChaptersPage() {
  const { bookId } = useParams()
  const navigate = useNavigate()
  const {
    chapters,
    volumes,
    stats,
    currentBook,
    createChapter,
    updateChapter,
    deleteChapter,
  } = useWorkspaceStore()

  const [newChapterModal, setNewChapterModal] = useState(false)
  const [editChapterModal, setEditChapterModal] = useState(false)
  const [editingChapter, setEditingChapter] = useState<Chapter | null>(null)
  const [snapshotModal, setSnapshotModal] = useState(false)
  const [currentSnapshot, setCurrentSnapshot] = useState<any>(null)
  const [editingSnapshot, setEditingSnapshot] = useState<any>(null)
  const [previousSnapshot, setPreviousSnapshot] = useState<any>(null)
  const [pagedChapters, setPagedChapters] = useState<Chapter[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(15)
  const [total, setTotal] = useState(0)
  const [volumeFilter, setVolumeFilter] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [form] = Form.useForm()
  const [editForm] = Form.useForm()

  const loadPagedChapters = async (targetPage = page, targetPageSize = pageSize, targetVolume = volumeFilter) => {
    if (!bookId || !window.api?.chapter?.listPaged) return
    setLoading(true)
    try {
      const result = await window.api.chapter.listPaged({
        bookId,
        page: targetPage,
        pageSize: targetPageSize,
        volumeId: targetVolume,
      })
      setPagedChapters(result.items)
      setTotal(result.total)
      setPage(result.page)
      setPageSize(result.pageSize)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPagedChapters(1, pageSize, volumeFilter)
  }, [bookId, volumeFilter])

  useEffect(() => {
    const handleChaptersUpdated = () => {
      loadPagedChapters(page, pageSize, volumeFilter)
    }
    window.addEventListener('chapters-updated', handleChaptersUpdated)
    return () => window.removeEventListener('chapters-updated', handleChaptersUpdated)
  }, [bookId, page, pageSize, volumeFilter])

  // 按分卷分组章节
  const volumeMap = new Map<string | null, typeof chapters>()
  chapters.forEach((ch) => {
    const key = ch.volumeId || null
    if (!volumeMap.has(key)) volumeMap.set(key, [])
    volumeMap.get(key)!.push(ch)
  })

  const handleCreateChapter = async (values: { title: string; summary?: string; volumeId?: string; outline?: string }) => {
    if (!bookId) return
    try {
      const chapter = await createChapter({
        bookId,
        title: values.title,
        summary: values.summary,
        volumeId: values.volumeId,
        outline: values.outline,
      })
      setNewChapterModal(false)
      form.resetFields()
      message.success(`章节「${values.title}」已创建`)
      if (bookId) localStorage.setItem(`ainovel.editor.lastChapter.${bookId}`, chapter.id)
      navigate(`/book/${bookId}/editor`)
    } catch {
      message.error('创建失败')
    }
  }

  const handleOpenEdit = (chapter: typeof chapters[0]) => {
    setEditingChapter(chapter)
    editForm.setFieldsValue({
      title: chapter.title,
      summary: chapter.summary,
      outline: chapter.outline,
      volumeId: chapter.volumeId,
    })
    setEditChapterModal(true)
  }

  const handleEditChapter = async (values: { title: string; summary?: string; outline?: string; volumeId?: string }) => {
    if (!editingChapter) return
    try {
      await updateChapter(editingChapter.id, {
        title: values.title,
        summary: values.summary,
        outline: values.outline,
        volumeId: values.volumeId,
      })
      setEditChapterModal(false)
      setEditingChapter(null)
      editForm.resetFields()
      message.success('章节已更新')
      await loadPagedChapters()
    } catch {
      message.error('更新失败')
    }
  }

  const handleStatusToggle = async (chapter: typeof chapters[0]) => {
    // locked → draft：解锁（允许用户重新发起定稿）
    // finalized → draft：取消定稿（chapter.ipc 会把旧快照置为 invalid）
    // 其它 → locked：手动锁定
    let newStatus: 'draft' | 'locked'
    let actionLabel: string
    if (chapter.status === 'locked') {
      newStatus = 'draft'
      actionLabel = '解锁'
    } else if (chapter.status === 'finalized') {
      newStatus = 'draft'
      actionLabel = '取消定稿'
    } else {
      newStatus = 'locked'
      actionLabel = '锁定'
    }
    await updateChapter(chapter.id, { status: newStatus })
    await loadPagedChapters()
    message.success(`章节已${actionLabel}`)
  }

  const handleDelete = async (id: string) => {
    Modal.confirm({
      title: '确认删除章节？',
      content: '删除后不可恢复',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteChapter(id)
        await loadPagedChapters(page)
        message.success('章节已删除')
      },
    })
  }

  const handleViewSnapshot = async (chapterId: string) => {
    if (!window.api?.ai?.getSnapshot) return
    const snapshot = await window.api.ai.getSnapshot(chapterId)
    if (!snapshot) {
      message.info('该章节暂无记忆')
      return
    }
    const chapter = chapters.find(c => c.id === chapterId)
    let prevSnapshot = null
    if (chapter) {
      const prevChapter = chapters.find(c => c.bookId === chapter.bookId && c.sortOrder === chapter.sortOrder - 1)
      if (prevChapter) {
        prevSnapshot = await window.api.ai.getSnapshot(prevChapter.id)
      }
    }
    setCurrentSnapshot(snapshot)
    // snapshotData 是 DB 中的 JSON 字符串，需解析为对象
    const parseData = (raw: any) => typeof raw === 'string' ? JSON.parse(raw) : raw
    setEditingSnapshot(parseData(snapshot.snapshotData))
    setPreviousSnapshot(prevSnapshot ? parseData(prevSnapshot.snapshotData) : null)
    setSnapshotModal(true)
  }


  const handleOpenEditor = (chapterId: string) => {
    if (bookId) localStorage.setItem(`ainovel.editor.lastChapter.${bookId}`, chapterId)
    navigate(`/book/${bookId}/editor`)
  }

  const volumeOptions = volumes.map((v) => ({ value: v.id, label: v.title }))
  const hasAnyChapter = chapters.length > 0
  const writtenTotal = chapters.filter((chapter) => chapter.wordCount > 0).length
  const filteredWrittenTotal = pagedChapters.filter((chapter) => chapter.wordCount > 0).length
  const displayWrittenTotal = volumeFilter ? filteredWrittenTotal : writtenTotal
  const getVolumeTitle = (chapter: Chapter) => chapter.volumeTitle || volumes.find((v) => v.id === chapter.volumeId)?.title || ''

  if (!currentBook) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <div style={{ fontSize: 16, color: '#6B7280', marginBottom: 16 }}>
          还没有创建作品
        </div>
        <Text type="secondary">
          在左侧点击「新建作品」开始你的创作之旅
        </Text>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <Title level={3} style={{ margin: 0, fontWeight: 600 }}>章节管理</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>管理作品的章节结构</Text>
        </div>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setNewChapterModal(true)}>新建章节</Button>
        </Space>
      </div>

      {!hasAnyChapter ? (
        <Card variant="borderless" style={{ borderRadius: 12, textAlign: 'center', padding: '48px 0' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>
            <FileTextOutlined style={{ fontSize: 48, color: '#4F46E5' }} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 500, color: '#111827', marginBottom: 8 }}>
            还没有章节
          </div>
          <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 20 }}>
            点击「新建章节」开始你的第一个故事
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setNewChapterModal(true)}>
            新建章节
          </Button>
        </Card>
      ) : (
        <Card
          variant="borderless"
          style={{ borderRadius: 12, marginBottom: 16, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
          styles={{ body: { padding: 15, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }}
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <BookOutlined style={{ color: '#4F46E5' }} />
              <span style={{ fontWeight: 600 }}>{volumeFilter ? '筛选章节' : '全部章节'}</span>
              <Tag color="default" style={{ marginLeft: 8 }}>{displayWrittenTotal}/{total} 章</Tag>
            </div>
          }
          extra={
            <Select
              value={volumeFilter || undefined}
              placeholder="全部分卷"
              allowClear
              style={{ width: 220 }}
              options={[
                ...volumeOptions,
                { value: '__none__', label: '未分卷' },
              ]}
              onChange={(value) => setVolumeFilter(value || null)}
            />
          }
        >
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <List
              loading={loading}
              itemLayout="horizontal"
              dataSource={pagedChapters}
              locale={{ emptyText: volumeFilter ? '当前筛选分卷下没有章节' : '暂无章节' }}
              renderItem={(item, index) => (
                <List.Item
                  style={{
                    padding: '14px 12px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    borderBottom: index === pagedChapters.length - 1 ? 'none' : '1px solid #F3F4F6',
                  }}
                  onClick={() => handleOpenEditor(item.id)}
                  actions={[
                    <Tooltip title={item.status === 'locked' ? '定稿中不可编辑' : '编辑'} key="edit">
                      <Button type="text" size="small" icon={<EditOutlined />} disabled={item.status === 'locked'} onClick={(e) => { e.stopPropagation(); if (item.status !== 'locked') handleOpenEdit(item) }} />
                    </Tooltip>,
                    item.status === 'finalized' && (
                      <Tooltip title="查看记忆" key="snapshot">
                        <Button type="text" size="small" icon={<EyeOutlined />} onClick={(e) => { e.stopPropagation(); handleViewSnapshot(item.id) }} />
                      </Tooltip>
                    ),
                    item.status === 'locked' ? (
                      <Tooltip title="解锁（取消定稿流程）" key="unlock">
                        <Button type="text" size="small" icon={<UnlockOutlined />} onClick={(e) => { e.stopPropagation(); handleStatusToggle(item) }} />
                      </Tooltip>
                    ) : item.status === 'finalized' ? (
                      <Tooltip title="取消定稿" key="unlock">
                        <Button type="text" size="small" icon={<UnlockOutlined />} onClick={(e) => { e.stopPropagation(); handleStatusToggle(item) }} />
                      </Tooltip>
                    ) : (
                      <Tooltip title="锁定" key="lock">
                        <Button type="text" size="small" icon={<LockOutlined />} onClick={(e) => { e.stopPropagation(); handleStatusToggle(item) }} />
                      </Tooltip>
                    ),
                    <Tooltip title={item.status === 'locked' ? '定稿中不可删除' : '删除'} key="delete">
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} disabled={item.status === 'locked'} onClick={(e) => { e.stopPropagation(); if (item.status !== 'locked') handleDelete(item.id) }} />
                    </Tooltip>,
                  ].filter(Boolean)}
                >
                  <List.Item.Meta
                    avatar={
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: '#EEF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4F46E5', fontWeight: 600, fontSize: 13 }}>
                        {(page - 1) * pageSize + index + 1}
                      </div>
                    }
                    title={
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontWeight: 500, color: '#111827', fontSize: 14 }}>{item.title}</span>
                        {item.status === 'completed' && <Tag color="success" style={{ margin: 0 }}>已完成</Tag>}
                        {item.status === 'locked' && <Tag color="warning" style={{ margin: 0 }}>已锁定</Tag>}
                        {item.status === 'finalized' && <Tag color="green" style={{ margin: 0 }}>已定稿</Tag>}
                        {item.wordCount === 0 && <Tag color="purple" style={{ margin: 0 }}>空白</Tag>}
                      </div>
                    }
                    description={
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ fontSize: 12, color: '#9CA3AF' }}>{getVolumeTitle(item) || '未分卷'}</div>
                        <div style={{ fontSize: 13, color: '#6B7280' }}>{item.summary || '暂无简介'}</div>
                      </div>
                    }
                  />
                  <div style={{ textAlign: 'right', minWidth: 80 }}>
                    <div style={{ fontSize: 13, color: '#6B7280', fontWeight: 500 }}>
                      {item.wordCount > 0 ? `${item.wordCount} 字` : '—'}
                    </div>
                  </div>
                </List.Item>
              )}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 16, flexShrink: 0 }}>
            <Pagination
              current={page}
              pageSize={pageSize}
              total={total}
              showSizeChanger
              pageSizeOptions={[15, 30, 50]}
              showTotal={(value) => `共 ${value} 章`}
              onChange={(nextPage, nextPageSize) => loadPagedChapters(nextPage, nextPageSize, volumeFilter)}
            />
          </div>
        </Card>
      )}

      {/* 新建章节弹窗 */}
      <Modal title="新建章节" open={newChapterModal} onCancel={() => { setNewChapterModal(false); form.resetFields() }} footer={null} width={640} centered>
        <Form form={form} layout="vertical" onFinish={handleCreateChapter}>
          <Form.Item name="title" label="章节标题" rules={[{ required: true, message: '请输入章节标题' }]}>
            <Input placeholder="例如：第一章 觉醒" />
          </Form.Item>
          <Form.Item name="volumeId" label="所属分卷（可选）">
            <Select placeholder="默认不分卷" allowClear options={volumeOptions} />
          </Form.Item>
          <Form.Item name="summary" label="章节简介（可选）">
            <Input.TextArea placeholder="简述本章剧情…" rows={3} />
          </Form.Item>
          <Form.Item name="outline" label="章节大纲（可选）">
            <Input.TextArea placeholder="详细描述本章的剧情发展、关键事件和人物成长…" rows={6} />
          </Form.Item>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => { setNewChapterModal(false); form.resetFields() }}>取消</Button>
            <Button type="primary" htmlType="submit">创建</Button>
          </div>
        </Form>
      </Modal>

      {/* 编辑章节弹窗 */}
      <Modal title="编辑章节" open={editChapterModal} onCancel={() => { setEditChapterModal(false); setEditingChapter(null); editForm.resetFields() }} footer={null} width="80%">
        <Form form={editForm} layout="vertical" onFinish={handleEditChapter}>
          <Form.Item name="title" label="章节标题" rules={[{ required: true, message: '请输入章节标题' }]}>
            <Input placeholder="例如：第一章 觉醒" />
          </Form.Item>
          <Form.Item name="volumeId" label="所属分卷（可选）">
            <Select placeholder="默认不分卷" allowClear options={volumeOptions} />
          </Form.Item>
          <Form.Item name="summary" label="章节简介（可选）">
            <Input.TextArea placeholder="简述本章剧情…" rows={2} />
          </Form.Item>
          <Form.Item name="outline" label="剧情大纲（可选）">
            <Input.TextArea placeholder="详细描述本章的剧情发展、关键事件和人物成长..." rows={6} />
          </Form.Item>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => { setEditChapterModal(false); setEditingChapter(null); editForm.resetFields() }}>取消</Button>
            <Button type="primary" htmlType="submit">保存</Button>
          </div>
        </Form>
      </Modal>

      {/* 快照查看弹窗 */}
      <SnapshotViewerModal
        open={snapshotModal}
        onClose={() => { setSnapshotModal(false); setCurrentSnapshot(null); setEditingSnapshot(null); setPreviousSnapshot(null) }}
        snapshotData={editingSnapshot}
        previousSnapshotData={previousSnapshot}
      />
    </div>
  )
}
