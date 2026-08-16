import { useEffect, useState } from 'react'
import {
  Card,
  Button,
  Input,
  Form,
  Select,
  Typography,
  Divider,
  InputNumber,
  Modal,
  message,
  Spin,
  Tag,
  Popconfirm,
  Space,
  Tooltip,
} from 'antd'
import { PlusOutlined, DeleteOutlined, SaveOutlined, ApiOutlined, EditOutlined, ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'
import { useModelStore } from '@/stores/model.store'

const { Title, Text } = Typography

interface PricePreset {
  inputPrice: number
  outputPrice: number
}

interface ProviderPlan {
  provider: string
  label: string
  baseUrl: string
}

interface FetchedModel {
  id: string
  name: string
  inputPrice?: number
  outputPrice?: number
}

const PRICE_PRESETS: Record<string, Record<string, PricePreset>> = {
  deepseek: {
    'deepseek-chat': { inputPrice: 1, outputPrice: 2 },
    'deepseek-reasoner': { inputPrice: 2, outputPrice: 8 },
    'deepseek-v3': { inputPrice: 1, outputPrice: 2 },
    'deepseek-v4': { inputPrice: 2, outputPrice: 8 },
    'deepseek-v4-flash': { inputPrice: 0.5, outputPrice: 1.5 },
    'deepseek-v4-pro': { inputPrice: 2, outputPrice: 8 },
  },
  huoshan: {
    'doubao-pro-32k': { inputPrice: 0.5, outputPrice: 1.5 },
    'doubao-pro-128k': { inputPrice: 1, outputPrice: 3 },
    'doubao-pro-256k': { inputPrice: 1.5, outputPrice: 4.5 },
    'doubao-lite-32k': { inputPrice: 0.1, outputPrice: 0.3 },
    'doubao-lite-128k': { inputPrice: 0.2, outputPrice: 0.6 },
    'doubao-lite-256k': { inputPrice: 0.3, outputPrice: 0.9 },
    'doubao-1-5-pro-256k': { inputPrice: 0.8, outputPrice: 2.4 },
    'doubao-1-5-pro-32k': { inputPrice: 0.3, outputPrice: 0.9 },
    'doubao-1-5-lite-32k': { inputPrice: 0.08, outputPrice: 0.24 },
    'doubao-1-5-lite-128k': { inputPrice: 0.15, outputPrice: 0.45 },
  },
  qwen: {
    'qwen-plus': { inputPrice: 0.8, outputPrice: 2 },
    'qwen-turbo': { inputPrice: 0.3, outputPrice: 0.6 },
    'qwen-max': { inputPrice: 2.4, outputPrice: 9.6 },
    'qwen-long': { inputPrice: 0.5, outputPrice: 2 },
    'qwen2.5-72b-instruct': { inputPrice: 1.2, outputPrice: 3.6 },
    'qwen2.5-32b-instruct': { inputPrice: 0.8, outputPrice: 2 },
    'qwen2.5-14b-instruct': { inputPrice: 0.4, outputPrice: 1.2 },
    'qwen2.5-7b-instruct': { inputPrice: 0.2, outputPrice: 0.6 },
    'qwen3-72b': { inputPrice: 1.6, outputPrice: 4.8 },
    'qwen3-32b': { inputPrice: 0.8, outputPrice: 2.4 },
    'qwen3-14b': { inputPrice: 0.4, outputPrice: 1.2 },
    'qwen3-coder-7b': { inputPrice: 0.3, outputPrice: 0.9 },
    'qwen3-coder-14b': { inputPrice: 0.5, outputPrice: 1.5 },
    'qwen3-coder-32b': { inputPrice: 1, outputPrice: 3 },
  },
}

const PROVIDER_PLANS: Record<string, ProviderPlan> = {
  'deepseek': {
    provider: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
  },
  'huoshan-general': {
    provider: 'huoshan',
    label: '火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  },
  'qwen': {
    provider: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  'zhipu': {
    provider: 'zhipu',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  },
  'moonshot': {
    provider: 'moonshot',
    label: '月之暗面 Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
  },
  'baidu-qianfan': {
    provider: 'baidu-qianfan',
    label: '百度千帆',
    baseUrl: 'https://qianfan.baidubce.com/v2',
  },
  'tencent-hunyuan': {
    provider: 'tencent-hunyuan',
    label: '腾讯混元',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
  },
  'minimax': {
    provider: 'minimax',
    label: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
  },
  'stepfun': {
    provider: 'stepfun',
    label: '阶跃星辰 Step',
    baseUrl: 'https://api.stepfun.com/v1',
  },
  'zero-one': {
    provider: 'zero-one',
    label: '零一万物 Yi',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
  },
  'siliconflow': {
    provider: 'siliconflow',
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
  },
  'openai-compatible': {
    provider: 'openai-compatible',
    label: 'OpenAI 协议',
    baseUrl: '',
  },
}

const PROVIDER_PLAN_OPTIONS = Object.entries(PROVIDER_PLANS).map(([value, config]) => ({
  value,
  label: config.label,
}))

function getProviderLabel(provider: string) {
  const plan = Object.values(PROVIDER_PLANS).find((p) => p.provider === provider)
  return plan?.label || provider
}

async function fetchModels(providerPlanKey: string, apiKey: string, baseUrl: string): Promise<FetchedModel[]> {
  if (!baseUrl || !apiKey) return []

  try {
    const data = await window.api.model.fetchModels(baseUrl, apiKey)
    if (Array.isArray(data) && data.length > 0) {
      return data
    }
    throw new Error('未获取到模型列表')
  } catch (error: any) {
    console.error('Failed to fetch models:', error)
    throw new Error(error.message || '获取模型列表失败')
  }
}

function ModelCard({
  model,
  testStatus,
  onEdit,
  onTest,
}: {
  model: any
  testStatus: 'testing' | 'success' | 'error' | null
  onEdit: () => void
  onTest: () => void
}) {
  const providerLabel = getProviderLabel(model.provider)

  return (
    <Card
      hoverable
      style={{ borderRadius: 12, cursor: 'pointer', position: 'relative', height: '100%' }}
      styles={{
        body: { padding: 16, height: '100%', display: 'flex', flexDirection: 'column' },
      }}
      onClick={onEdit}
    >
      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 4, zIndex: 1 }} onClick={(e) => e.stopPropagation()}>
        <Button type="text" size="small" icon={<EditOutlined />} onClick={onEdit} style={{ width: 28, height: 28, padding: 0 }} />
        <Tooltip title="测试连通性">
          <Button
            type="text"
            size="small"
            icon={testStatus === 'testing' ? <Spin size="small" /> : <ApiOutlined />}
            onClick={onTest}
            disabled={testStatus === 'testing'}
            style={{
              width: 28,
              height: 28,
              padding: 0,
              color: testStatus === 'success' ? '#52C41A' : testStatus === 'error' ? '#FF4D4F' : undefined,
            }}
          />
        </Tooltip>
      </div>
      <div style={{ marginBottom: 12, paddingRight: 56, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: 8,
              background: testStatus === 'success' ? '#F6FFED' : testStatus === 'error' ? '#FFF2F0' : testStatus === 'testing' ? '#E6F4FF' : '#EEF2FF',
              color: testStatus === 'success' ? '#52C41A' : testStatus === 'error' ? '#FF4D4F' : testStatus === 'testing' ? '#1890FF' : '#4F46E5',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            {testStatus === 'testing' ? <Spin size="small" /> :
             testStatus === 'success' ? <CheckCircleOutlined /> :
             testStatus === 'error' ? <CloseCircleOutlined /> :
             <ApiOutlined />}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {model.name}
            </div>
            <Tag color="default" style={{ fontSize: 10, marginTop: 2 }}>{providerLabel}</Tag>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0, marginTop: 'auto' }}>
        <div>
          <span style={{ fontSize: 11, color: '#9CA3AF', display: 'block' }}>输入</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#111827' }}>{model.inputPrice || 0} 元/M</span>
        </div>
        <div>
          <span style={{ fontSize: 11, color: '#9CA3AF', display: 'block' }}>输出</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: '#111827' }}>{model.outputPrice || 0} 元/M</span>
        </div>
        <div>
          <span style={{ fontSize: 11, color: '#9CA3AF', display: 'block' }}>缓存命中</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: model.cachedInputPrice != null ? '#16A34A' : '#9CA3AF' }}>
            {model.cachedInputPrice != null ? `${model.cachedInputPrice} 元/M` : '—'}
          </span>
        </div>
      </div>
    </Card>
  )
}

function ModelEditModal({
  open,
  onCancel,
  model,
  onSave,
  onDelete,
  onTestConnection,
}: {
  open: boolean
  onCancel: () => void
  model: any | null
  onSave: (form: any) => Promise<void>
  onDelete: () => void
  onTestConnection: () => void
}) {
  const [form] = Form.useForm()

  useEffect(() => {
    if (model && open) {
      const providerPlanKey = Object.entries(PROVIDER_PLANS).find(
        ([, plan]) => plan.provider === model.provider
      )?.[0]
      form.setFieldsValue({
        providerPlan: providerPlanKey,
        apiKey: model.apiKey,
        modelId: model.modelName,
        modelName: model.name,
        baseUrl: model.baseUrl || '',
        inputPrice: model.inputPrice ?? undefined,
        outputPrice: model.outputPrice ?? undefined,
        cachedInputPrice: model.cachedInputPrice ?? undefined,
        maxOutputTokens: model.maxOutputTokens ?? undefined,
        maxContextTokens: model.maxContextTokens ?? undefined,
      })
    }
  }, [model, open, form])

  const handleProviderPlanChange = (providerPlanKey: string) => {
    const config = PROVIDER_PLANS[providerPlanKey]
    form.setFieldsValue({
      baseUrl: config?.baseUrl || '',
      modelId: '',
      modelName: '',
      inputPrice: undefined,
      outputPrice: undefined,
    })
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      await onSave(values)
    } catch {
    }
  }

  if (!model) return null

  return (
    <Modal
      title={`编辑模型 · ${model.name}`}
      open={open}
      onCancel={onCancel}
      footer={null}
      width={720}
      centered
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item name="providerPlan" label="供应商" style={{ flex: 1 }} rules={[{ required: true, message: '请选择供应商' }]}>
            <Select options={PROVIDER_PLAN_OPTIONS} placeholder="请选择供应商" onChange={handleProviderPlanChange} />
          </Form.Item>
          <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true, message: '请输入 Base URL' }]} style={{ flex: 2 }}>
            <Input placeholder="https://api.example.com/v1" />
          </Form.Item>
        </div>

        <Form.Item name="apiKey" label="API Key" rules={[{ required: true, message: '请输入 API Key' }]}>
          <Input.Password placeholder="sk-xxxxxxxx" />
        </Form.Item>

        <Divider style={{ margin: '16px 0' }} />

        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>模型信息</Text>
          <Space>
            <Button type="text" size="small" icon={<ReloadOutlined />} onClick={onTestConnection}>测试连通性</Button>
          </Space>
        </div>

        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item name="modelId" label="模型 ID" style={{ flex: 1 }} rules={[{ required: true, message: '请输入模型 ID' }]}>
            <Input placeholder="例如 deepseek-chat" />
          </Form.Item>
          <Form.Item name="modelName" label="模型名称" style={{ flex: 1 }} rules={[{ required: true, message: '请输入模型名称' }]}>
            <Input placeholder="例如 DeepSeek Chat" />
          </Form.Item>
        </div>

        <div style={{ marginBottom: 12, marginTop: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>费用（元/M Token）</Text>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item name="inputPrice" label="输入" style={{ flex: 1 }}>
            <InputNumber style={{ width: '100%' }} min={0} step={0.1} addonAfter="元" />
          </Form.Item>
          <Form.Item name="outputPrice" label="输出" style={{ flex: 1 }}>
            <InputNumber style={{ width: '100%' }} min={0} step={0.1} addonAfter="元" />
          </Form.Item>
          <Form.Item name="cachedInputPrice" label="缓存命中价" style={{ flex: 1 }} tooltip="模型服务端 Prompt Cache 命中时的输入价格，留空则使用输入价格">
            <InputNumber style={{ width: '100%' }} min={0} step={0.1} addonAfter="元" />
          </Form.Item>
        </div>

        <div style={{ marginBottom: 12, marginTop: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>Token 上限</Text>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item name="maxOutputTokens" label="输出上限" style={{ flex: 1 }} tooltip="单次回复最大输出 Token 数（对应 API max_tokens）。留空使用默认 16384。章节正文等超长 JSON 建议设大，防止被截断。">
            <InputNumber style={{ width: '100%' }} min={0} step={512} placeholder="默认 16384" />
          </Form.Item>
          <Form.Item name="maxContextTokens" label="输入上限" style={{ flex: 1 }} tooltip="发送给模型的上下文总 Token 软上限。超过则自动丢弃最早的聊天记录，防止超出模型上下文窗口。0/留空 = 不限制。">
            <InputNumber style={{ width: '100%' }} min={0} step={512} placeholder="不限制" />
          </Form.Item>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
          <Button danger icon={<DeleteOutlined />} onClick={onDelete}>删除</Button>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={onCancel}>取消</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>保存</Button>
          </div>
        </div>
      </Form>
    </Modal>
  )
}

function AddModelModal({
  open,
  form,
  onCancel,
  onOk,
  onProviderPlanChange,
  onModelSelect,
  onFetchModels,
  fetchingModels,
  fetchedModels,
  modelSelect,
  setModelSelect,
  apiKey,
}: {
  open: boolean
  form: any
  onCancel: () => void
  onOk: (values: any) => void
  onProviderPlanChange: (providerPlanKey: string) => void
  onModelSelect: (modelId: string) => void
  onFetchModels: () => void
  fetchingModels: boolean
  fetchedModels: FetchedModel[]
  modelSelect?: string
  setModelSelect: (v: string | undefined) => void
  apiKey?: string
}) {
  const providerPlanVal = Form.useWatch('providerPlan', form)

  return (
    <Modal
      title="添加模型"
      open={open}
      onCancel={onCancel}
      footer={null}
      width={720}
      centered
      destroyOnHidden
    >
      <Form form={form} layout="vertical" onFinish={onOk}>
        <div style={{ display: 'flex', gap: 12 }}>
          <Form.Item
            name="providerPlan"
            label="供应商"
            rules={[{ required: true, message: '请选择供应商' }]}
            style={{ flex: 1 }}
          >
            <Select
              options={PROVIDER_PLAN_OPTIONS}
              onChange={(v) => {
                const config = PROVIDER_PLANS[v]
                if (config?.baseUrl) {
                  form.setFieldsValue({ baseUrl: config.baseUrl })
                }
                form.setFieldsValue({ modelId: undefined, modelName: '', inputPrice: undefined, outputPrice: undefined })
                setModelSelect(undefined)
                onProviderPlanChange(v)
              }}
              placeholder="请选择供应商"
            />
          </Form.Item>
          <Form.Item
            name="baseUrl"
            label="Base URL"
            rules={[{ required: true, message: '请输入 Base URL' }]}
            style={{ flex: 2 }}
          >
            <Input placeholder="https://api.example.com/v1" />
          </Form.Item>
        </div>

        <Form.Item name="apiKey" label="API Key" rules={[{ required: true, message: '请输入 API Key' }]}>
          <Input.Password placeholder="sk-xxxxxxxx" />
        </Form.Item>

        <Divider style={{ margin: '12px 0' }} />

        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>模型选择</Text>
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            onClick={onFetchModels}
            disabled={fetchingModels || !apiKey}
          >
            {fetchingModels ? '加载中...' : '获取模型列表'}
          </Button>
        </div>

        <Form.Item label="从获取的模型中选择">
          <Select
            showSearch
            placeholder={providerPlanVal ? (fetchedModels.length > 0 ? '搜索或选择模型' : '请先点击获取模型列表') : '请先选择供应商'}
            optionFilterProp="children"
            filterOption={(input, option) =>
              (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
            }
            value={modelSelect}
            options={fetchedModels.map(m => ({ value: m.id, label: m.id }))}
            onChange={(v) => {
              setModelSelect(v)
              onModelSelect(v)
            }}
            notFoundContent={fetchingModels ? <Spin size="small" /> : <Text type="secondary">点击获取模型列表</Text>}
            allowClear
          />
        </Form.Item>

        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item name="modelId" label="模型 ID" style={{ flex: 1 }}>
            <Input placeholder="例如 deepseek-chat" />
          </Form.Item>
          <Form.Item name="modelName" label="模型名称" style={{ flex: 1 }}>
            <Input placeholder="例如 DeepSeek Chat" />
          </Form.Item>
        </div>

        <div style={{ marginBottom: 12, marginTop: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>费用（元/M Token）</Text>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item name="inputPrice" label="输入" style={{ flex: 1 }}>
            <InputNumber style={{ width: '100%' }} min={0} step={0.1} addonAfter="元" />
          </Form.Item>
          <Form.Item name="outputPrice" label="输出" style={{ flex: 1 }}>
            <InputNumber style={{ width: '100%' }} min={0} step={0.1} addonAfter="元" />
          </Form.Item>
          <Form.Item name="cachedInputPrice" label="缓存命中价" style={{ flex: 1 }} tooltip="模型服务端 Prompt Cache 命中时的输入价格，留空则使用输入价格">
            <InputNumber style={{ width: '100%' }} min={0} step={0.1} addonAfter="元" />
          </Form.Item>
        </div>

        <div style={{ marginBottom: 12, marginTop: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>Token 上限</Text>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item name="maxOutputTokens" label="输出上限" style={{ flex: 1 }} tooltip="单次回复最大输出 Token 数（对应 API max_tokens）。留空使用默认 16384。章节正文等超长 JSON 建议设大，防止被截断。">
            <InputNumber style={{ width: '100%' }} min={0} step={512} placeholder="默认 16384" />
          </Form.Item>
          <Form.Item name="maxContextTokens" label="输入上限" style={{ flex: 1 }} tooltip="发送给模型的上下文总 Token 软上限。超过则自动丢弃最早的聊天记录，防止超出模型上下文窗口。0/留空 = 不限制。">
            <InputNumber style={{ width: '100%' }} min={0} step={512} placeholder="不限制" />
          </Form.Item>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" htmlType="submit">添加</Button>
        </div>
      </Form>
    </Modal>
  )
}

export default function ModelsPage() {
  const { models, loadModels, createModel, updateModel, deleteModel } = useModelStore()
  const [editModal, setEditModal] = useState(false)
  const [selectedModel, setSelectedModel] = useState<any>(null)
  const [newModal, setNewModal] = useState(false)
  const [newForm] = Form.useForm()
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[]>([])
  const [modelSelect, setModelSelect] = useState<string>()
  const [testingConnection, setTestingConnection] = useState(false)
  const [modelTestStatuses, setModelTestStatuses] = useState<Record<string, 'testing' | 'success' | 'error' | null>>({})

  const newApiKey = Form.useWatch('apiKey', newForm)

  useEffect(() => {
    loadModels()
  }, [])

  const handleProviderPlanChange = (providerPlanKey: string, isEdit: boolean = false) => {
    const config = PROVIDER_PLANS[providerPlanKey]
    const targetForm = isEdit ? newForm : newForm
    targetForm.setFieldsValue({
      baseUrl: config?.baseUrl || '',
      modelId: undefined,
      modelName: '',
      inputPrice: undefined,
      outputPrice: undefined,
    })
    if (isEdit) {
      setModelSelect(undefined)
      setFetchedModels([])
    } else {
      setModelSelect(undefined)
      setFetchedModels([])
    }
  }

  const handleFetchModels = async (isEdit: boolean = false) => {
    const targetForm = isEdit ? newForm : newForm
    const providerPlanKey = targetForm.getFieldValue('providerPlan')
    const apiKey = targetForm.getFieldValue('apiKey')
    const baseUrl = targetForm.getFieldValue('baseUrl')

    if (!providerPlanKey) {
      message.warning('请先选择供应商')
      return
    }
    if (!apiKey) {
      message.warning('请先填写 API Key')
      return
    }
    if (!baseUrl) {
      message.warning('请先填写 Base URL')
      return
    }

    setFetchingModels(true)
    try {
      const fetched = await fetchModels(providerPlanKey, apiKey, baseUrl)
      setFetchedModels(fetched)
      message.success(`已获取 ${fetched.length} 个模型`)
    } catch (err: any) {
      message.error(err.message || '获取模型列表失败，请检查 API Key 和 Base URL')
    } finally {
      setFetchingModels(false)
    }
  }

  // 直接测试连通性（不弹确认），供卡片上的"测试连通性"按钮调用。
  // 复用 setModelTestStatuses 状态：头像区域图标按 testing/success/error 变色，3 秒后自动清空。
  const runTestConnection = async (modelId: string, apiKey: string, baseUrl: string) => {
    setModelTestStatuses({ [modelId]: 'testing' })
    try {
      if (!apiKey || !baseUrl) {
        throw new Error('缺少 API Key 或 Base URL')
      }
      await fetchModels('', apiKey, baseUrl)
      setModelTestStatuses({ [modelId]: 'success' })
      message.success('连接成功')
    } catch (err: any) {
      setModelTestStatuses({ [modelId]: 'error' })
      message.error(err?.message || '连接失败')
    } finally {
      setTimeout(() => {
        // 仅清掉当前 model 的状态，避免清掉用户后续又触发的状态
        setModelTestStatuses((prev) => {
          if (!prev[modelId]) return prev
          const next = { ...prev }
          delete next[modelId]
          return next
        })
      }, 3000)
    }
  }

  // 编辑模态框"测试连通性"按钮的 handler：弹确认 + 复用 runTestConnection
  const handleTestConnection = async () => {
    if (!selectedModel) return
    Modal.confirm({
      title: '测试连通性',
      content: `确定要测试「${selectedModel.name}」的连通性吗？测试会调用 /models 接口，不会消耗 Token。`,
      okText: '开始测试',
      cancelText: '取消',
      onOk: () => runTestConnection(selectedModel.id, selectedModel.apiKey, selectedModel.baseUrl),
    })
  }

  const handleModelSelect = (modelId: string, isEdit: boolean = false) => {
    const targetForm = isEdit ? newForm : newForm
    const providerPlanKey = targetForm.getFieldValue('providerPlan')
    const plan = PROVIDER_PLANS[providerPlanKey]
    const presetPrices = PRICE_PRESETS[plan?.provider || '']
    const preset = presetPrices?.[modelId]
    const fetchedModel = fetchedModels.find(m => m.id === modelId)

    const inputPrice = fetchedModel?.inputPrice ?? preset?.inputPrice
    const outputPrice = fetchedModel?.outputPrice ?? preset?.outputPrice

    targetForm.setFieldsValue({
      modelId: modelId,
      modelName: modelId,
      inputPrice: inputPrice,
      outputPrice: outputPrice,
    })
  }

  const handleSave = async (values: any) => {
    if (!selectedModel) return
    try {
      const plan = PROVIDER_PLANS[values.providerPlan]
      await updateModel(selectedModel.id, {
        name: values.modelName || values.name,
        provider: plan?.provider || values.providerPlan,
        apiKey: values.apiKey,
        modelName: values.modelId,
        baseUrl: values.baseUrl,
        inputPrice: values.inputPrice,
        outputPrice: values.outputPrice,
        cachedInputPrice: values.cachedInputPrice,
        maxOutputTokens: values.maxOutputTokens || null,
        maxContextTokens: values.maxContextTokens || null,
      })
      setEditModal(false)
      message.success('保存成功')
    } catch {
      message.error('保存失败')
    }
  }

  const handleDelete = () => {
    if (!selectedModel) return
    Modal.confirm({
      title: '确认删除该模型配置？',
      okText: '删除', okButtonProps: { danger: true },
      onOk: async () => {
        await deleteModel(selectedModel.id)
        setEditModal(false)
        setSelectedModel(null)
        message.success('已删除')
      },
    })
  }

  const handleCreate = async (values: any) => {
    try {
      const plan = PROVIDER_PLANS[values.providerPlan]
      await createModel({
        name: values.modelName || values.name,
        provider: plan?.provider || values.providerPlan,
        apiKey: values.apiKey,
        modelName: values.modelId,
        baseUrl: values.baseUrl,
        inputPrice: values.inputPrice,
        outputPrice: values.outputPrice,
        cachedInputPrice: values.cachedInputPrice,
        maxOutputTokens: values.maxOutputTokens || null,
        maxContextTokens: values.maxContextTokens || null,
      })
      setNewModal(false)
      newForm.resetFields()
      setFetchedModels([])
      setModelSelect(undefined)
      message.success('模型已创建')
    } catch {
      message.error('创建失败')
    }
  }

  const handleEdit = (model: any) => {
    setSelectedModel(model)
    setEditModal(true)
  }

  if (models.length === 0) {
    return (
      <div>
        <div style={{ marginBottom: 24 }}>
          <Title level={3} style={{ margin: 0, fontWeight: 600 }}>模型管理</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>配置 AI 模型供应商与 API</Text>
        </div>
        <Card variant="borderless" style={{ borderRadius: 12, textAlign: 'center', padding: '60px 0' }}>
          <div style={{ fontSize: 16, fontWeight: 500, color: '#111827', marginBottom: 8 }}>还没有配置任何模型</div>
          <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 20 }}>添加第一个 AI 模型开始创作</div>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setNewModal(true)}>添加模型</Button>
        </Card>
        <AddModelModal
          open={newModal}
          form={newForm}
          onCancel={() => { setNewModal(false); newForm.resetFields(); setFetchedModels([]); setModelSelect(undefined) }}
          onOk={handleCreate}
          onProviderPlanChange={handleProviderPlanChange}
          onModelSelect={(v) => handleModelSelect(v, false)}
          onFetchModels={() => handleFetchModels(false)}
          fetchingModels={fetchingModels}
          fetchedModels={fetchedModels}
          modelSelect={modelSelect}
          setModelSelect={setModelSelect}
          apiKey={newApiKey}
        />
      </div>
    )
  }

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Title level={3} style={{ margin: 0, fontWeight: 600 }}>模型管理</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>配置 AI 模型供应商与 API</Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setNewModal(true)}>添加模型</Button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', paddingRight: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {models.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              testStatus={modelTestStatuses[model.id] || null}
              onEdit={() => handleEdit(model)}
              onTest={() => runTestConnection(model.id, model.apiKey, model.baseUrl || '')}
            />
          ))}
        </div>
      </div>

      <AddModelModal
        open={newModal}
        form={newForm}
        onCancel={() => { setNewModal(false); newForm.resetFields(); setFetchedModels([]); setModelSelect(undefined) }}
        onOk={handleCreate}
        onProviderPlanChange={handleProviderPlanChange}
        onModelSelect={(v) => handleModelSelect(v, false)}
        onFetchModels={() => handleFetchModels(false)}
        fetchingModels={fetchingModels}
        fetchedModels={fetchedModels}
        modelSelect={modelSelect}
        setModelSelect={setModelSelect}
        apiKey={newApiKey}
      />

      <ModelEditModal
        open={editModal}
        onCancel={() => setEditModal(false)}
        model={selectedModel}
        onSave={handleSave}
        onDelete={handleDelete}
        onTestConnection={handleTestConnection}
      />
    </div>
  )
}
