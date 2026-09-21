import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Select,
  Tag,
  Typography,
  message,
  Spin,
  Tooltip,
} from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import type { StyleFingerprint, StyleFingerprintSample } from '@/types/api'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { modelFullName } from '@/utils/providers'

const { Title, Text } = Typography

type ModelOption = {
  id: string
  name: string
  modelName: string
  enabled: boolean
}

export default function StyleFingerprintPage() {
  const { bookId } = useParams()
  const { currentBook } = useWorkspaceStore()
  const [fingerprints, setFingerprints] = useState<StyleFingerprint[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<StyleFingerprint | null>(null)
  const [form] = Form.useForm()

  const [models, setModels] = useState<ModelOption[]>([])
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [extractingId, setExtractingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [extractModalFp, setExtractModalFp] = useState<StyleFingerprint | null>(null)
  const [extractModalModelId, setExtractModalModelId] = useState<string>('')
  const [reasonText, setReasonText] = useState('')
  const reasonRef = useRef<string>('')

  const loadFingerprints = async () => {
    if (!bookId || !window.api?.styleFingerprint?.list) return
    setLoading(true)
    try {
      const data = await window.api.styleFingerprint.list(bookId)
      setFingerprints(data)
    } finally {
      setLoading(false)
    }
  }

  const loadModels = async () => {
    if (!window.api?.model?.list) return
    try {
      const list = await window.api.model.list()
      const enabled = list.filter((m: ModelOption) => m.enabled)
      setModels(enabled)
      setSelectedModelId((prev) => prev || enabled[0]?.id || '')
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    loadFingerprints()
    loadModels()
  }, [bookId])

  // 提取 reasoning 流式监听
  useEffect(() => {
    if (!window.api?.styleFingerprint?.onExtractReasoning) return
    const off = window.api.styleFingerprint.onExtractReasoning((payload) => {
      reasonRef.current += payload.delta
      setReasonText(reasonRef.current)
    })
    return off
  }, [])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ name: '', description: '', samples: [''] })
    setModalOpen(true)
  }

  const openEdit = (fp: StyleFingerprint) => {
    setEditing(fp)
    const samples = fp.samples.length > 0 ? fp.samples : [{ content: '' }]
    form.setFieldsValue({
      name: fp.name,
      description: fp.description,
      samples: samples.map((s) => s.content),
    })
    setModalOpen(true)
  }

  const handleSubmit = async (values: {
    name: string
    description?: string
    samples: string[]
  }) => {
    if (!bookId) return
    const samples: StyleFingerprintSample[] = (values.samples || [])
      .map((c) => ({ content: c }))
      .filter((s) => s.content && s.content.trim())
    if (samples.length === 0) {
      message.error('请至少提供一段范本')
      return
    }
    if (!editing && !selectedModelId) {
      message.error('请选择提取模型')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await window.api.styleFingerprint.update({
          id: editing.id,
          name: values.name,
          description: values.description || '',
          samples,
        })
        message.success('指纹已更新（范本变更后需重新提取）')
      } else {
        // 新建：创建后立即提取生成约束摘要，一步完成
        const created = await window.api.styleFingerprint.create({
          bookId,
          name: values.name,
          description: values.description || '',
          samples,
        })
        const fpId = created?.id
        if (fpId) {
          setExtractingId(fpId)
          reasonRef.current = ''
          setReasonText('')
          const res = await window.api.styleFingerprint.extract({ id: fpId, modelId: selectedModelId })
          if (res.success) {
            message.success('指纹已创建并提取文风摘要')
          } else {
            message.warning('指纹已创建，但提取失败，可稍后点「重新提取」')
          }
        } else {
          message.warning('指纹已创建，但提取失败，可稍后点「重新提取」')
        }
      }
      setModalOpen(false)
      setEditing(null)
      form.resetFields()
      await loadFingerprints()
    } catch (error: any) {
      message.error(error?.message || '保存失败')
    } finally {
      setSaving(false)
      setExtractingId(null)
      setTimeout(() => setReasonText(''), 3000)
    }
  }

  const handleDelete = async (id: string) => {
    await window.api.styleFingerprint.delete(id)
    message.success('指纹已删除')
    await loadFingerprints()
  }

  const handleSetDefault = async (id: string) => {
    const res = await window.api.styleFingerprint.setDefault(id)
    if (res.success) {
      message.success('已设为本书激活指纹，写作时将自动注入该文风约束')
      await loadFingerprints()
    } else {
      message.error(res.message || '设置失败')
    }
  }

  // 点"提取文风"→ 弹出垂直居中弹窗选模型
  const openExtractModal = (fp: StyleFingerprint) => {
    if (models.length === 0) {
      message.error('未配置可用模型，请先在「模型管理」添加并启用模型')
      return
    }
    setExtractModalModelId(selectedModelId || models[0]?.id || '')
    setExtractModalFp(fp)
  }

  const confirmExtract = async () => {
    if (!extractModalFp || !extractModalModelId) return
    const fp = extractModalFp
    const modelId = extractModalModelId
    setSelectedModelId(modelId) // 记住本次选择，下次默认
    setExtractModalFp(null) // 先关弹窗
    setExtractingId(fp.id)
    reasonRef.current = ''
    setReasonText('')
    try {
      const res = await window.api.styleFingerprint.extract({ id: fp.id, modelId })
      if (res.success) {
        message.success('文风摘要已生成')
        await loadFingerprints()
      } else {
        message.error(res.message || '提取失败')
      }
    } catch (error: any) {
      message.error(error?.message || '提取失败')
    } finally {
      setExtractingId(null)
      setTimeout(() => setReasonText(''), 3000)
    }
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
          <Title level={3} style={{ margin: 0, fontWeight: 600 }}>文风指纹</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            从范本提取量化文风特征，写作时作为硬约束注入；写完自动校验吻合度，降低 AI 味
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建指纹</Button>
      </div>

      <Card
        variant="borderless"
        style={{ borderRadius: 12 }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: '#4F46E5' }}><ThunderboltOutlined /></span>
            <span style={{ fontWeight: 600 }}>本书指纹</span>
            <Tag color="default" style={{ marginLeft: 8 }}>{fingerprints.length} 个</Tag>
          </div>
        }
      >
        {fingerprints.length === 0 && !loading ? (
          <Empty description="还没有文风指纹。粘贴一段你写的旧作或喜欢的作者文本，提取属于这本书的文风指纹" />
        ) : (
          <List
            loading={loading}
            dataSource={fingerprints}
            renderItem={(fp) => (
              <List.Item
                actions={[
                  <Tooltip key="extract" title="从范本提取量化特征并生成约束摘要（调用模型）">
                    <Button
                      size="small"
                      icon={<ThunderboltOutlined />}
                      loading={extractingId === fp.id}
                      disabled={!fp.summary && models.length === 0}
                      onClick={() => openExtractModal(fp)}
                    >
                      {fp.summary ? '重新提取' : '提取文风'}
                    </Button>
                  </Tooltip>,
                  !fp.isDefault && fp.summary ? (
                    <Button
                      key="setDefault"
                      size="small"
                      type="primary"
                      ghost
                      icon={<CheckCircleOutlined />}
                      onClick={() => handleSetDefault(fp.id)}
                    >
                      设为激活
                    </Button>
                  ) : null,
                  <Button key="edit" type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(fp)} />,
                  <Button key="delete" type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(fp.id)} />,
                ]}
              >
                <List.Item.Meta
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, color: '#111827' }}>{fp.name}</span>
                      {fp.isDefault ? (
                        <Tag color="green">激活中</Tag>
                      ) : fp.summary ? (
                        <Tag color="default">未激活</Tag>
                      ) : (
                        <Tag color="orange">待提取</Tag>
                      )}
                      {fp.samples.length > 0 && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {fp.samples.length} 段范本
                        </Text>
                      )}
                    </div>
                  }
                  description={
                    <div>
                      {fp.description && (
                        <div style={{ color: '#6B7280', fontSize: 13, marginBottom: 6 }}>{fp.description}</div>
                      )}
                      {fp.summary ? (
                        <div
                          style={{
                            background: '#F9FAFB',
                            border: '1px solid #E5E7EB',
                            borderRadius: 8,
                            padding: '8px 12px',
                            fontSize: 12,
                            color: '#374151',
                            whiteSpace: 'pre-wrap',
                            lineHeight: 1.7,
                          }}
                        >
                          {fp.summary}
                        </div>
                      ) : (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          尚未提取文风摘要，点击「提取文风」生成（将调用模型，约几秒）
                        </Text>
                      )}
                      {fp.summary && fp.metrics && fp.metrics.totalChars > 0 && (
                        <div style={{ marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: '#9CA3AF' }}>
                          <span>样本 {fp.metrics.totalChars} 字</span>
                          <span>平均句长 {fp.metrics.avgSentenceLength} 字</span>
                          <span>短句占比 {(fp.metrics.shortSentenceRatio * 100).toFixed(0)}%</span>
                          <span>对话占比 {(fp.metrics.dialogueRatio * 100).toFixed(0)}%</span>
                          <span>AI 套路词 {fp.metrics.aiClicheDensity}/千字</span>
                        </div>
                      )}
                      {extractingId === fp.id && reasonText && (
                        <div style={{ marginTop: 8 }}>
                          <Spin size="small" />
                          <div
                            style={{
                              background: '#F3F4F6',
                              borderRadius: 6,
                              padding: '6px 10px',
                              fontSize: 11,
                              color: '#6B7280',
                              whiteSpace: 'pre-wrap',
                              maxHeight: 120,
                              overflowY: 'auto',
                            }}
                          >
                            {reasonText.slice(-600)}
                          </div>
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
        title={editing ? '编辑文风指纹' : '新建文风指纹'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields() }}
        footer={null}
        width={760}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ samples: [''] }}>
          <Form.Item name="name" label="指纹名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：我的文风 / 战斗场景文风 / 日常文风" />
          </Form.Item>
          <Form.Item name="description" label="说明（可选）">
            <Input placeholder="这个指纹用在哪类场景" />
          </Form.Item>
          {!editing && (
            <Form.Item label="提取模型" required tooltip="用于从范本生成量化文风约束摘要">
              <Select
                style={{ width: '100%' }}
                placeholder="选择用于生成约束摘要的模型"
                value={selectedModelId || undefined}
                onChange={setSelectedModelId}
                options={models.map((m) => ({ label: modelFullName(m), value: m.id }))}
                disabled={saving}
              />
            </Form.Item>
          )}
          <Form.Item label="范本样本（至少 1 段，建议每段 800 字以上）">
            <Form.List name="samples">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((field) => (
                    <div key={field.key} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
                      <Form.Item {...field} noStyle style={{ flex: 1 }}>
                        <Input.TextArea
                          placeholder="粘贴一段你写的旧作，或你喜欢的作者文本"
                          autoSize={{ minRows: 4, maxRows: 10 }}
                        />
                      </Form.Item>
                      {fields.length > 1 && (
                        <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                      )}
                    </div>
                  ))}
                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add('')} block>
                    添加一段范本
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>
          {saving && !editing && (
            <div style={{ marginBottom: 12, padding: 12, background: '#F9FAFB', borderRadius: 8, fontSize: 12, color: '#6B7280', lineHeight: 1.6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Spin size="small" />
                <span>正在提取文风摘要，请稍候...</span>
              </div>
              {reasonText && (
                <div style={{ marginTop: 8, maxHeight: 100, overflow: 'auto', fontFamily: 'monospace', fontSize: 11, color: '#9CA3AF', whiteSpace: 'pre-wrap' }}>
                  {reasonText}
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => { setModalOpen(false); setEditing(null); form.resetFields() }} disabled={saving}>取消</Button>
            <Button type="primary" htmlType="submit" loading={saving}>{!editing ? '保存并提取' : '保存'}</Button>
          </div>
        </Form>
      </Modal>

      {/* 提取文风弹窗：垂直居中，让选模型这一步更聚焦 */}
      <Modal
        title="选择提取模型"
        open={!!extractModalFp}
        onCancel={() => setExtractModalFp(null)}
        centered
        width={420}
        destroyOnClose
        footer={null}
      >
        <div style={{ marginBottom: 12, fontSize: 13, color: '#6B7280', lineHeight: 1.6 }}>
          为「{extractModalFp?.name}」选择用于生成文风约束摘要的模型：
        </div>
        <Select
          style={{ width: '100%' }}
          placeholder="选择模型"
          value={extractModalModelId || undefined}
          onChange={setExtractModalModelId}
          options={models.map((m) => ({ label: modelFullName(m), value: m.id }))}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <Button onClick={() => setExtractModalFp(null)}>取消</Button>
          <Button
            type="primary"
            loading={extractingId === extractModalFp?.id}
            disabled={!extractModalModelId}
            onClick={confirmExtract}
          >
            提取
          </Button>
        </div>
      </Modal>
    </div>
  )
}
