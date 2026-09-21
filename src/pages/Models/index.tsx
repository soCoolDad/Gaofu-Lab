import { useEffect, useState, useMemo } from 'react'
import dayjs from 'dayjs'
import {
  Button, Input, Form, Select, Typography, Divider, InputNumber,
  Modal, message, Spin, Tag, Space, Tooltip, Collapse, Checkbox, Switch, Empty,
  TimePicker, Popconfirm,
} from 'antd'
import {
  PlusOutlined, DeleteOutlined, SaveOutlined, ApiOutlined, EditOutlined,
  ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined, ClusterOutlined,
  DownOutlined, UpOutlined, SettingOutlined,
} from '@ant-design/icons'
import { useModelStore } from '@/stores/model.store'
import { PROVIDER_PLANS, getProviderLabel, modelFullName, type ProviderPlan } from '@/utils/providers'

const { Title, Text } = Typography

// ==================== 常量 ====================

interface PricePreset { inputPrice: number; outputPrice: number }
interface FetchedModel { id: string; name: string; inputPrice?: number; outputPrice?: number }

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

const PROVIDER_PLAN_OPTIONS = Object.entries(PROVIDER_PLANS).map(([value, config]) => ({ value, label: config.label }))

async function fetchModelList(baseUrl: string, apiKey: string): Promise<FetchedModel[]> {
  if (!baseUrl || !apiKey) return []
  const data = await window.api.model.fetchModels(baseUrl, apiKey)
  if (!Array.isArray(data) || data.length === 0) throw new Error('未获取到模型列表')
  return data
}

// ==================== 类型 ====================

type ModelParams = {
  temperature?: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  maxOutputTokens?: number
  maxContextTokens?: number
  mergeSystemMessages?: boolean
}

type NewModelEntry = { modelName: string; name: string } & ModelParams & { billingRules?: any[] }

type SyncStatus = 'added' | 'new' | 'invalid'
type SyncEntry = {
  id: string
  name: string
  localId: string | null
  status: SyncStatus
  checked: boolean
  params: ModelParams
  billingRules: any[]
}

type SaveActions = {
  add: Array<NewModelEntry>
  delete: string[]
  update: { localId: string; params: ModelParams; billingRules: any[] }[]
}

const DAYS_OPTIONS = [1,2,3,4,5,6,7].map(n => ({ label: `周${['一','二','三','四','五','六','日'][n-1]}`, value: n }))

/** 客户端"当前生效规则"识别：与后端 electron/utils/billing.ts 的 resolvePricesFromRules 语义一致。
 *  用于在模型列表 / 弹窗里给用户一个"此刻走哪条规则"的即时反馈。 */
function findActiveBillingRule(
  rules: any[],
  at: Date = new Date(),
): any | null {
  if (!rules || rules.length === 0) return null
  const jsDay = at.getDay()
  const ruleDay = jsDay === 0 ? 7 : jsDay
  const nowHM = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  for (const r of rules) {
    if (!r || !Array.isArray(r.days) || r.days.length === 0) continue
    if (!r.days.includes(ruleDay)) continue
    const start = r.startTime || ''
    const end = r.endTime || ''
    if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) continue
    if (nowHM < start || nowHM > end) continue
    return r
  }
  return null
}

type SelectedModelEntry = {
  id: string
  name: string
  params: ModelParams
}

interface ModelGroup {
  key: string
  provider: string
  providerLabel: string
  baseUrl: string
  apiKey: string
  models: any[]
}

/** 校验计费规则：同一天多条规则必须连续覆盖 00:00~23:59，不能有缺口或重叠 */
function validateBillingRules(rules: any[]): string | null {
  if (!rules || rules.length === 0) return null
  const dayNames = ['一','二','三','四','五','六','日']
  const errors: string[] = []

  for (let day = 1; day <= 7; day++) {
    const dayRules = rules.filter((r: any) => r.days && Array.isArray(r.days) && r.days.includes(day))
    if (dayRules.length === 0) continue

    const sorted = [...dayRules].sort((a: any, b: any) => (a.startTime || '').localeCompare(b.startTime || ''))
    const dn = dayNames[day - 1]

    // 第一条必须从 00:00 开始
    if (sorted[0].startTime !== '00:00') {
      errors.push(`周${dn}：首条规则应从 00:00 开始（当前「${sorted[0].name || '未命名'}」= ${sorted[0].startTime || '未设置'}）`)
    }

    // 最后一条必须到 23:59 结束
    const last = sorted[sorted.length - 1]
    if (last.endTime !== '23:59') {
      errors.push(`周${dn}：末条规则应到 23:59 结束（当前「${last.name || '未命名'}」= ${last.endTime || '未设置'}）`)
    }

    // 相邻规则不能有缺口或重叠
    for (let i = 0; i < sorted.length - 1; i++) {
      const end = sorted[i].endTime || ''
      const nextStart = sorted[i + 1].startTime || ''
      if (!end || !nextStart) continue
      if (end < nextStart) {
        errors.push(`周${dn}：「${sorted[i].name || '未命名'}」→「${sorted[i + 1].name || '未命名'}」有缺口 ${end}~${nextStart}`)
      }
      if (end > nextStart) {
        errors.push(`周${dn}：「${sorted[i].name || '未命名'}」与「${sorted[i + 1].name || '未命名'}」时间重叠`)
      }
    }
  }

  return errors.length > 0 ? errors.join('\n') : null
}

function groupModels(models: any[]): ModelGroup[] {
  const map = new Map<string, ModelGroup>()
  for (const m of models) {
    const key = `${m.provider}|${m.baseUrl || ''}|${m.apiKey}`
    if (!map.has(key)) {
      map.set(key, {
        key, provider: m.provider, providerLabel: getProviderLabel(m.provider),
        baseUrl: m.baseUrl || '', apiKey: m.apiKey, models: [],
      })
    }
    map.get(key)!.models.push(m)
  }
  return Array.from(map.values())
}

// ==================== 模型行 ====================

function ModelRow({
  model, selected, testStatus, onToggleSelect, onEdit, onDelete, onTest, onToggleEnabled,
}: {
  model: any
  selected: boolean
  testStatus: 'testing' | 'success' | 'error' | null
  onToggleSelect: () => void
  onEdit: () => void
  onDelete: () => void
  onTest: () => void
  onToggleEnabled: (enabled: boolean) => void
}) {
  const tags: React.ReactNode[] = []
  if (model.temperature != null) tags.push(<Tag key="t" color="blue" style={{ fontSize: 10, lineHeight: '16px' }}>T:{model.temperature}</Tag>)
  if (model.topP != null) tags.push(<Tag key="p" color="blue" style={{ fontSize: 10, lineHeight: '16px' }}>P:{model.topP}</Tag>)
  if (model.frequencyPenalty != null) tags.push(<Tag key="f" color="blue" style={{ fontSize: 10, lineHeight: '16px' }}>F:{model.frequencyPenalty}</Tag>)
  if (model.presencePenalty != null) tags.push(<Tag key="pr" color="blue" style={{ fontSize: 10, lineHeight: '16px' }}>Pr:{model.presencePenalty}</Tag>)
  if (model.maxOutputTokens) tags.push(<Tag key="mo" color="blue" style={{ fontSize: 10, lineHeight: '16px' }}>输出{model.maxOutputTokens}</Tag>)
  if (model.maxContextTokens) tags.push(<Tag key="mc" color="blue" style={{ fontSize: 10, lineHeight: '16px' }}>上下文{model.maxContextTokens}</Tag>)
  if (model.mergeSystemMessages) tags.push(<Tag key="ms" color="purple" style={{ fontSize: 10, lineHeight: '16px' }}>单system</Tag>)
  if (model.billingRules) {
    let rules: any[]
    try { rules = JSON.parse(model.billingRules || '[]') } catch { rules = [] }
    if (rules.length > 0) {
      const active = findActiveBillingRule(rules)
      if (active) {
        const label = active.name || `${active.startTime}-${active.endTime}`
        tags.push(
          <Tag key="rule-active" color="success" style={{ fontSize: 10, lineHeight: '16px' }}>
            生效·{label}
          </Tag>,
        )
      } else {
        tags.push(
          <Tag key="rule-idle" style={{ fontSize: 10, lineHeight: '16px' }}>
            规则{rules.length}条（未生效）
          </Tag>,
        )
      }
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
      background: selected ? '#F0F4FF' : '#FAFAFA', borderRadius: 8, marginBottom: 4,
      border: selected ? '1px solid #C7D2FE' : '1px solid transparent', transition: 'all 0.15s',
    }}>
      <Checkbox checked={selected} onChange={onToggleSelect} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 500, fontSize: 13, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {model.name}
          </span>
          {model.enabled ? null : <Tag color="default" style={{ fontSize: 10 }}>已禁用</Tag>}
          {tags}
        </div>
        <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>
          {model.modelName}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <Switch size="small" checked={model.enabled} onChange={onToggleEnabled} />
        <Tooltip title="测试连通性">
          <Button type="text" size="small" icon={testStatus === 'testing' ? <Spin size="small" /> : <ApiOutlined />}
            onClick={onTest} disabled={testStatus === 'testing'}
            style={{ color: testStatus === 'success' ? '#52C41A' : testStatus === 'error' ? '#FF4D4F' : undefined, width: 24, padding: 0 }} />
        </Tooltip>
        <Button type="text" size="small" icon={<EditOutlined />} onClick={onEdit} style={{ width: 24, padding: 0 }} />
        <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={onDelete} style={{ width: 24, padding: 0 }} />
      </div>
    </div>
  )
}

// ==================== 计费规则编辑器（状态驱动，非 Form） ====================

function BillingRulesEditor({ rules, onChange }: { rules: any[]; onChange: (rules: any[]) => void }) {
  const addRule = () => {
    onChange([...rules, { name: '', days: [], timeRange: [null, null], inputPrice: null, outputPrice: null, cachedInputPrice: null }])
  }
  const removeRule = (idx: number) => { onChange(rules.filter((_, i) => i !== idx)) }
  const updateRule = (idx: number, field: string, value: any) => {
    onChange(rules.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }
  return (
    <div style={{ marginTop: 8 }}>
      <Text type="secondary" style={{ fontSize: 10 }}>计费规则</Text>
      {rules.map((rule, idx) => (
        <div key={idx} style={{ background: '#F9FAFB', border: '1px solid #F0F0F0', borderRadius: 6, padding: 8, marginBottom: 4 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            <Input size="small" placeholder="规则名称" value={rule.name} onChange={(e) => updateRule(idx, 'name', e.target.value)} style={{ flex: 1 }} />
            <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeRule(idx)} style={{ padding: 0 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            <Select mode="multiple" size="small" style={{ flex: 1 }} options={DAYS_OPTIONS} value={rule.days || []} onChange={(v) => updateRule(idx, 'days', v)} placeholder="适用日" />
            <TimePicker.RangePicker format="HH:mm" size="small" style={{ flex: 1 }} value={rule.timeRange} onChange={(v) => updateRule(idx, 'timeRange', v)} placeholder={["开始","结束"]} />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <InputNumber size="small" style={{ flex: 1 }} min={0} step={0.1} placeholder="输入价" value={rule.inputPrice} onChange={(v) => updateRule(idx, 'inputPrice', v)} addonAfter="元" />
            <InputNumber size="small" style={{ flex: 1 }} min={0} step={0.1} placeholder="输出价" value={rule.outputPrice} onChange={(v) => updateRule(idx, 'outputPrice', v)} addonAfter="元" />
            <InputNumber size="small" style={{ flex: 1 }} min={0} step={0.1} placeholder="缓存价" value={rule.cachedInputPrice} onChange={(v) => updateRule(idx, 'cachedInputPrice', v)} addonAfter="元" />
          </div>
        </div>
      ))}
      <Button type="dashed" size="small" icon=<PlusOutlined /> onClick={addRule} block>添加计费规则</Button>
    </div>
  )
}

// ==================== 添加模型弹窗（同步） ====================

function AddModelsModal({
  open, onCancel, onOk, presetGroup, localModels,
}: {
  open: boolean
  onCancel: () => void
  onOk: (actions: SaveActions, meta: { provider: string; baseUrl: string; apiKey: string }) => Promise<void>
  presetGroup?: { provider: string; baseUrl: string; apiKey: string } | null
  localModels: any[]
}) {
  const [form] = Form.useForm()
  const [providerPlanKey, setProviderPlanKey] = useState<string | null>(null)
  const [customName, setCustomName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [fetching, setFetching] = useState(false)
  const [syncEntries, setSyncEntries] = useState<SyncEntry[]>([])
  const [saving, setSaving] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open && presetGroup) {
      form.setFieldsValue({ baseUrl: presetGroup.baseUrl, apiKey: presetGroup.apiKey })
      setBaseUrl(presetGroup.baseUrl)
      setApiKey(presetGroup.apiKey)
    } else if (open) {
      form.resetFields()
      setProviderPlanKey(null)
      setCustomName('')
      setBaseUrl('')
      setApiKey('')
    }
    if (open) {
      setSyncEntries([])
      setExpandedIds(new Set())
    }
  }, [open, presetGroup])

  const handleProviderChange = (key: string) => {
    setProviderPlanKey(key)
    const config = PROVIDER_PLANS[key]
    if (config?.baseUrl) {
      form.setFieldsValue({ baseUrl: config.baseUrl })
      setBaseUrl(config.baseUrl)
    }
    setSyncEntries([])
  }

  const getProviderKey = () => PROVIDER_PLANS[providerPlanKey!]?.provider || presetGroup?.provider || ''

  const handleFetch = async () => {
    const url = baseUrl || form.getFieldValue('baseUrl') || ''
    const key = apiKey || form.getFieldValue('apiKey') || ''
    if (!url) { message.warning('请先填写 Base URL'); return }
    if (!key) { message.warning('请先填写 API Key'); return }
    setFetching(true)
    try {
      const fetched = await fetchModelList(url, key)
      const providerKey = getProviderKey()
      const localMap = new Map(localModels.filter(m => m.provider === providerKey).map(m => [m.modelName, m]))
      const entries: SyncEntry[] = fetched.map(fm => {
        const local = localMap.get(fm.id)
        if (local) {
          return {
            id: fm.id, name: fm.name || fm.id, localId: local.id,
            status: 'added' as const, checked: true,
            params: {
              temperature: local.temperature, topP: local.topP,
              frequencyPenalty: local.frequencyPenalty, presencePenalty: local.presencePenalty,
              maxOutputTokens: local.maxOutputTokens, maxContextTokens: local.maxContextTokens,
              mergeSystemMessages: !!local.mergeSystemMessages,
            },
            billingRules: local.billingRules ? JSON.parse(local.billingRules).map((r: any) => ({
              ...r,
              timeRange: [r.startTime ? dayjs(r.startTime, 'HH:mm') : null, r.endTime ? dayjs(r.endTime, 'HH:mm') : null],
            })) : [],
          }
        }
        return {
          id: fm.id, name: fm.name || fm.id, localId: null,
          status: 'new' as const, checked: false, params: {}, billingRules: [],
        }
      })
      const fetchedIds = new Set(fetched.map(f => f.id))
      for (const local of localModels) {
        if (local.provider === providerKey && !fetchedIds.has(local.modelName)) {
          entries.push({
            id: local.modelName, name: local.name, localId: local.id,
            status: 'invalid' as const, checked: false,
            params: {
              temperature: local.temperature, topP: local.topP,
              frequencyPenalty: local.frequencyPenalty, presencePenalty: local.presencePenalty,
              maxOutputTokens: local.maxOutputTokens, maxContextTokens: local.maxContextTokens,
              mergeSystemMessages: !!local.mergeSystemMessages,
            },
            billingRules: local.billingRules ? JSON.parse(local.billingRules).map((r: any) => ({
              ...r,
              timeRange: [r.startTime ? dayjs(r.startTime, 'HH:mm') : null, r.endTime ? dayjs(r.endTime, 'HH:mm') : null],
            })) : [],
          })
        }
      }
      setSyncEntries(entries)
      message.success(`已获取 ${fetched.length} 个模型`)
    } catch (err: any) {
      message.error(err?.message || '获取模型列表失败')
    } finally {
      setFetching(false)
    }
  }

  const toggleCheck = (id: string) => {
    setSyncEntries(prev => prev.map(e => e.id === id && e.status !== 'invalid' ? { ...e, checked: !e.checked } : e))
  }

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const updateParam = (id: string, field: keyof ModelParams, value: any) => {
    setSyncEntries(prev => prev.map(e => e.id === id ? { ...e, params: { ...e.params, [field]: value } } : e))
  }

  const updateBillingRules = (id: string, rules: any[]) => {
    setSyncEntries(prev => prev.map(e => e.id === id ? { ...e, billingRules: rules } : e))
  }

  const convertRules = (rules: any[]) => rules.map((r: any) => ({
    ...r,
    startTime: r.timeRange?.[0] ? r.timeRange[0].format('HH:mm') : null,
    endTime: r.timeRange?.[1] ? r.timeRange[1].format('HH:mm') : null,
    timeRange: undefined,
  }))

  const handleSubmit = async () => {
    let url: string, key: string, provider: string
    if (presetGroup) {
      url = presetGroup.baseUrl
      key = presetGroup.apiKey
      provider = presetGroup.provider
    } else {
      const planKey = providerPlanKey
      if (!planKey) { message.warning('请选择供应商'); return }
      const config = PROVIDER_PLANS[planKey]
      provider = planKey === 'openai-compatible' ? (customName || '自定义') : config.provider
      url = baseUrl || form.getFieldValue('baseUrl') || ''
      key = apiKey || form.getFieldValue('apiKey') || ''
      if (!url) { message.warning('请输入 Base URL'); return }
      if (!key) { message.warning('请输入 API Key'); return }
    }

    if (syncEntries.length === 0) { message.warning('请先获取模型列表'); return }

    const addEntries: NewModelEntry[] = []
    const deleteIds: string[] = []
    const updateEntries: { localId: string; params: ModelParams; billingRules: any[] }[] = []

    for (const e of syncEntries) {
      if (e.status === 'new' && e.checked) {
        addEntries.push({ modelName: e.id, name: e.name, ...e.params, billingRules: convertRules(e.billingRules) })
      } else if (e.status === 'added' && !e.checked) {
        if (e.localId) deleteIds.push(e.localId)
      } else if (e.status === 'added' && e.checked) {
        updateEntries.push({ localId: e.localId!, params: e.params, billingRules: convertRules(e.billingRules) })
      }
    }

    if (addEntries.length === 0 && deleteIds.length === 0 && updateEntries.length === 0) {
      message.info('没有需要更改的操作')
      return
    }

    // 校验计费规则：新增 / 更新的模型都要保证规则首尾相接、无缺口无重叠
    for (const a of addEntries) {
      const billingError = validateBillingRules(a.billingRules || [])
      if (billingError) {
        message.error({ content: `新增「${a.name}」计费规则校验失败：\n${billingError}`, duration: 10 })
        return
      }
    }
    for (const u of updateEntries) {
      const billingError = validateBillingRules(u.billingRules)
      if (billingError) {
        message.error({ content: `计费规则校验失败：\n${billingError}`, duration: 10 })
        return
      }
    }

    setSaving(true)
    try {
      await onOk({ add: addEntries, delete: deleteIds, update: updateEntries }, { provider, baseUrl: url, apiKey: key })
    } catch (e: any) {
      message.error(e?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const addCount = syncEntries.filter(e => e.status === 'new' && e.checked).length
  const deleteCount = syncEntries.filter(e => e.status === 'added' && !e.checked).length
  const updateCount = syncEntries.filter(e => e.status === 'added' && e.checked).length
  const invalidCount = syncEntries.filter(e => e.status === 'invalid').length

  return (
    <Modal
      // 分组头部「管理」进来时 presetGroup 有值，语义是管理该组已有模型；
      // 顶部「添加模型」进来时不带预设，语义是从零添加
      title={presetGroup ? `管理模型 · ${getProviderLabel(presetGroup.provider)}` : '添加模型'}
      open={open} onCancel={onCancel} footer={null} width={880} centered destroyOnClose
      bodyStyle={{ maxHeight: '70vh', overflow: 'auto', paddingRight: 8 }}
    >
      {!presetGroup && (
        <>
          <Form form={form} layout="vertical" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 12 }}>
              <Form.Item label="供应商" required style={{ flex: 1 }}>
                <Select options={PROVIDER_PLAN_OPTIONS} placeholder="请选择供应商"
                  value={providerPlanKey} onChange={handleProviderChange} />
              </Form.Item>
              <Form.Item label="Base URL" required style={{ flex: 2 }}>
                <Input placeholder="https://api.example.com/v1" value={baseUrl}
                  onChange={(e) => { setBaseUrl(e.target.value); form.setFieldsValue({ baseUrl: e.target.value }) }} />
              </Form.Item>
            </div>
            {providerPlanKey === 'openai-compatible' && (
              <Form.Item label="自定义供应商名称" required style={{ marginBottom: 12 }}>
                <Input placeholder="输入供应商名称，如 OpenAI、Azure OpenAI、本地 Ollama"
                  value={customName} onChange={(e) => setCustomName(e.target.value)} />
              </Form.Item>
            )}
            <Form.Item label="API Key" required style={{ marginBottom: 0 }}>
              <Input.Password placeholder="sk-xxxxxxxx" value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); form.setFieldsValue({ apiKey: e.target.value }) }} />
            </Form.Item>
          </Form>
        </>
      )}

      <Divider style={{ margin: '12px 0' }} />

      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 13, fontWeight: 500 }}>模型列表</Text>
        <Button type="text" size="small" icon={<ReloadOutlined />} onClick={handleFetch} disabled={fetching || !apiKey}>
          {fetching ? '加载中...' : '获取模型列表'}
        </Button>
      </div>

      {syncEntries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: '#9CA3AF', fontSize: 13 }}>
          {fetching ? <Spin size="small" /> : '点击「获取模型列表」拉取可用模型'}
        </div>
      ) : (
        <div style={{ maxHeight: 450, overflow: 'auto', border: '1px solid #F0F0F0', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', fontSize: 11, color: '#9CA3AF', borderBottom: '1px solid #F5F5F5', position: 'sticky', top: 0, background: '#FAFAFA', zIndex: 1 }}>
            <span>
              待添加 <Text type="success" style={{ fontSize: 11 }}>{addCount}</Text> ·
              待删除 <Text type="danger" style={{ fontSize: 11 }}>{deleteCount}</Text> ·
              更新 <Text type="secondary" style={{ fontSize: 11 }}>{updateCount}</Text>
              {invalidCount > 0 && <> · 已失效 <Text type="warning" style={{ fontSize: 11 }}>{invalidCount}</Text></>}
            </span>
          </div>
          {syncEntries.map((e) => {
            const isExpanded = expandedIds.has(e.id)
            const isInvalid = e.status === 'invalid'
            return (
              <div key={e.id} style={{ borderBottom: '1px solid #F5F5F5', background: isInvalid ? '#FFFBE6' : 'transparent' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: isInvalid ? 'not-allowed' : 'pointer', opacity: isInvalid ? 0.6 : 1 }}
                  onClick={() => !isInvalid && toggleCheck(e.id)}>
                  {isInvalid ? (
                    <span style={{ width: 16, display: 'inline-block' }} />
                  ) : (
                    <Checkbox checked={e.checked} style={{ flexShrink: 0 }} />
                  )}
                  <span style={{ fontSize: 12, fontFamily: 'monospace', flex: 1 }}>{e.id}</span>
                  {e.status === 'added' && e.checked && <Tag color="success" style={{ fontSize: 10 }}>已添加</Tag>}
                  {e.status === 'added' && !e.checked && <Tag color="error" style={{ fontSize: 10 }}>待删除</Tag>}
                  {e.status === 'new' && e.checked && <Tag color="processing" style={{ fontSize: 10 }}>待添加</Tag>}
                  {e.status === 'new' && !e.checked && <Tag style={{ fontSize: 10 }}>未添加</Tag>}
                  {isInvalid && <Tag color="warning" style={{ fontSize: 10 }}>已失效</Tag>}
                  <Button type="text" size="small" icon={isExpanded ? <UpOutlined /> : <DownOutlined />}
                    style={{ padding: 0, flexShrink: 0 }}
                    onClick={(ev) => { ev.stopPropagation(); toggleExpand(e.id) }} />
                </div>
                {isExpanded && (
                  <div style={{ padding: '8px 12px 8px 36px', background: '#F9FAFB' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
                      <div>
                        <Text type="secondary" style={{ fontSize: 10 }}>温度</Text>
                        <InputNumber size="small" style={{ width: '100%' }} min={0} max={2} step={0.1} placeholder="默认"
                          value={e.params.temperature} onChange={(v) => updateParam(e.id, 'temperature', v)} />
                      </div>
                      <div>
                        <Text type="secondary" style={{ fontSize: 10 }}>核采样</Text>
                        <InputNumber size="small" style={{ width: '100%' }} min={0} max={1} step={0.05} placeholder="默认"
                          value={e.params.topP} onChange={(v) => updateParam(e.id, 'topP', v)} />
                      </div>
                      <div>
                        <Text type="secondary" style={{ fontSize: 10 }}>频率惩罚</Text>
                        <InputNumber size="small" style={{ width: '100%' }} min={-2} max={2} step={0.1} placeholder="默认"
                          value={e.params.frequencyPenalty} onChange={(v) => updateParam(e.id, 'frequencyPenalty', v)} />
                      </div>
                      <div>
                        <Text type="secondary" style={{ fontSize: 10 }}>存在惩罚</Text>
                        <InputNumber size="small" style={{ width: '100%' }} min={-2} max={2} step={0.1} placeholder="默认"
                          value={e.params.presencePenalty} onChange={(v) => updateParam(e.id, 'presencePenalty', v)} />
                      </div>
                      <div>
                        <Text type="secondary" style={{ fontSize: 10 }}>输出Token上限</Text>
                        <InputNumber size="small" style={{ width: '100%' }} min={0} step={512} placeholder="16384"
                          value={e.params.maxOutputTokens} onChange={(v) => updateParam(e.id, 'maxOutputTokens', v)} />
                      </div>
                      <div>
                        <Text type="secondary" style={{ fontSize: 10 }}>上下文Token上限</Text>
                        <InputNumber size="small" style={{ width: '100%' }} min={0} step={512} placeholder="不限制"
                          value={e.params.maxContextTokens} onChange={(v) => updateParam(e.id, 'maxContextTokens', v)} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                        <Text type="secondary" style={{ fontSize: 10 }}>单System合并</Text>
                        <Switch size="small" checked={!!e.params.mergeSystemMessages} onChange={(v) => updateParam(e.id, 'mergeSystemMessages', v)} />
                      </div>
                    </div>
                    <BillingRulesEditor rules={e.billingRules} onChange={(rules) => updateBillingRules(e.id, rules)} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 16 }}>
        <div>
          <Text style={{ fontSize: 11 }}>
            {addCount > 0 && <Text type="success">待添加 {addCount} 个</Text>}
            {deleteCount > 0 && <Text type="danger"> · 待删除 {deleteCount} 个</Text>}
            {updateCount > 0 && <Text type="secondary"> · 更新 {updateCount} 个</Text>}
          </Text>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" loading={saving} disabled={syncEntries.length === 0} onClick={handleSubmit}>
            保存
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ==================== 编辑模型弹窗 ====================

function EditModelModal({
  open, onCancel, model, onSave, onDelete, onTestConnection, onBillingRulesSave,
}: {
  open: boolean
  onCancel: () => void
  model: any | null
  onSave: (form: any) => Promise<void>
  onDelete: () => void
  onTestConnection: () => void
  onBillingRulesSave: (rules: any[]) => Promise<void>
}) {
  const [form] = Form.useForm()
  const [testStatus, setTestStatus] = useState<'testing' | 'success' | 'error' | null>(null)
  const [savingRules, setSavingRules] = useState(false)

  // 每次打开弹窗（或切换到另一个模型）时，用当前模型快照重建表单值。
  // 两个关键点，否则「采样参数」会被悄悄清掉：
  //   1) 依赖用 model?.id（身份）而不是 model（对象引用）。父组件保存计费规则时会 setEditModel 出新对象，
  //      若依赖对象会重跑本 effect，把用户刚在表单里改好、还没保存的采样参数回滚成"打开弹窗那一刻的旧快照"
  //      （旧快照里可能是空 → 接着点保存就把空值写回库，表现为"采样参数偶尔丢失"）。
  //   2) 先 resetFields() 清掉上一次打开残留的值（rc-field-form 的 store 在 destroyOnClose 后仍会保留），
  //      再写入本次快照，避免上一个模型/上一次未保存的编辑串到当前模型上。
  useEffect(() => {
    if (!open) return
    form.resetFields()
    if (!model) return
    form.setFieldsValue({
      modelName: model.name,
      modelId: model.modelName,
      temperature: model.temperature ?? undefined,
      topP: model.topP ?? undefined,
      frequencyPenalty: model.frequencyPenalty ?? undefined,
      presencePenalty: model.presencePenalty ?? undefined,
      billingRules: model.billingRules ? JSON.parse(model.billingRules).map((r: any) => ({
        ...r,
        timeRange: [r.startTime ? dayjs(r.startTime, 'HH:mm') : null, r.endTime ? dayjs(r.endTime, 'HH:mm') : null],
      })) : [],
      maxOutputTokens: model.maxOutputTokens ?? undefined,
      maxContextTokens: model.maxContextTokens ?? undefined,
      mergeSystemMessages: !!model.mergeSystemMessages,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.id, open, form])

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setTestStatus(null)
      await onSave(values)
    } catch {}
  }

  // 每条规则卡片底部的「保存」按钮：把当前表单里的整份计费规则立即落库，
  // 不必走弹窗底部的总保存——这样单条增改可以独立确认、独立生效。
  const handleSaveBillingRules = async () => {
    const raw = form.getFieldValue('billingRules') || []
    const rules = raw.map((r: any) => ({
      ...r,
      startTime: r.timeRange?.[0] ? r.timeRange[0].format('HH:mm') : null,
      endTime: r.timeRange?.[1] ? r.timeRange[1].format('HH:mm') : null,
      timeRange: undefined,
    }))
    const err = validateBillingRules(rules)
    if (err) {
      message.error({ content: `计费规则校验失败：\n${err}`, duration: 10 })
      return
    }
    setSavingRules(true)
    try {
      await onBillingRulesSave(rules)
    } finally {
      setSavingRules(false)
    }
  }

  if (!model) return null

  return (
    <Modal title={`编辑模型 · ${model.name}`} open={open} onCancel={onCancel} width={720} centered destroyOnClose
      bodyStyle={{ maxHeight: '70vh', overflow: 'auto', paddingRight: 8 }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button danger icon={<DeleteOutlined />} onClick={onDelete}>删除</Button>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={onCancel}>取消</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave}>保存</Button>
          </div>
        </div>
      }
    >
      <Form form={form} layout="vertical">
        <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 13, fontWeight: 500 }}>模型信息</Text>
          <Button type="text" size="small" icon={<ReloadOutlined />} onClick={onTestConnection}>测试连通性</Button>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item name="modelId" label="模型 ID" style={{ flex: 1 }} rules={[{ required: true, message: '请输入模型 ID' }]}>
            <Input placeholder="例如 deepseek-chat" />
          </Form.Item>
          <Form.Item name="modelName" label="模型名称" style={{ flex: 1 }} rules={[{ required: true, message: '请输入模型名称' }]}>
            <Input placeholder="例如 DeepSeek Chat" />
          </Form.Item>
        </div>
        <Divider style={{ margin: '16px 0' }} />
        <div style={{ marginBottom: 12 }}>
          <Text style={{ fontSize: 13, fontWeight: 500 }}>采样参数</Text>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item name="temperature" label="温度" style={{ flex: 1 }} tooltip="Temperature：控制生成随机性。0=确定性输出，2=高度发散。创作建议 0.7~1.2">
            <InputNumber style={{ width: '100%' }} min={0} max={2} step={0.1} placeholder="默认" />
          </Form.Item>
          <Form.Item name="topP" label="核采样" style={{ flex: 1 }} tooltip="Top P：候选词累积概率阈值。越高越多样。建议 0.7~0.95，与温度二选一调节">
            <InputNumber style={{ width: '100%' }} min={0} max={1} step={0.05} placeholder="默认" />
          </Form.Item>
          <Form.Item name="frequencyPenalty" label="频率惩罚" style={{ flex: 1 }} tooltip="Frequency Penalty：按出现次数降低重复词概率。建议 0~1，过高会导致不通顺">
            <InputNumber style={{ width: '100%' }} min={-2} max={2} step={0.1} placeholder="默认" />
          </Form.Item>
          <Form.Item name="presencePenalty" label="存在惩罚" style={{ flex: 1 }} tooltip="Presence Penalty：话题已出现即降权，与次数无关。建议 0~0.5，配合频率惩罚使用">
            <InputNumber style={{ width: '100%' }} min={-2} max={2} step={0.1} placeholder="默认" />
          </Form.Item>
        </div>
        <div style={{ marginBottom: 12, marginTop: 4 }}>
          <Text style={{ fontSize: 13, fontWeight: 500 }}>计费规则</Text>
        </div>
        <Form.List name="billingRules">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <div key={field.key} style={{ background: '#F9FAFB', border: '1px solid #F0F0F0', borderRadius: 8, padding: 12, marginBottom: 8 }}>
                  <div style={{ marginBottom: 8 }}>
                    <Form.Item name={[field.name, 'name']} label="规则名称" style={{ marginBottom: 0 }}>
                      <Input placeholder="如：工作日下午高峰" size="small" />
                    </Form.Item>
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                    <Form.Item name={[field.name, 'days']} label="适用日" style={{ flex: 2, marginBottom: 0 }}>
                      <Select mode="multiple" size="small" style={{ width: '100%' }}
                        options={[1,2,3,4,5,6,7].map(n => ({ label: `周${['一','二','三','四','五','六','日'][n-1]}`, value: n }))}
                        placeholder="选择适用日" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'timeRange']} label="时间段" style={{ flex: 1, marginBottom: 0 }}>
                      <TimePicker.RangePicker format="HH:mm" size="small" style={{ width: '100%' }} placeholder={["开始", "结束"]} />
                    </Form.Item>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <Form.Item name={[field.name, 'inputPrice']} label="输入价 (元/M)" style={{ flex: 1, marginBottom: 0 }}>
                      <InputNumber style={{ width: '100%' }} min={0} step={0.1} size="small" addonAfter="元" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'outputPrice']} label="输出价 (元/M)" style={{ flex: 1, marginBottom: 0 }}>
                      <InputNumber style={{ width: '100%' }} min={0} step={0.1} size="small" addonAfter="元" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'cachedInputPrice']} label="缓存价 (元/M)" style={{ flex: 1, marginBottom: 0 }} tooltip="Prompt Cache 命中时的输入价格">
                      <InputNumber style={{ width: '100%' }} min={0} step={0.1} size="small" addonAfter="元" />
                    </Form.Item>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, paddingTop: 8, borderTop: '1px dashed #E5E7EB' }}>
                    <Popconfirm
                      title="删除这条计费规则？"
                      description="确认后，从待保存列表移除。点击「保存」或弹窗底部保存才会真正落库。"
                      onConfirm={() => remove(field.name)}
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                    >
                      <Button danger size="small" icon={<DeleteOutlined />}>删除</Button>
                    </Popconfirm>
                    <Button type="primary" size="small" icon={<SaveOutlined />} loading={savingRules} onClick={handleSaveBillingRules}>
                      保存
                    </Button>
                  </div>
                </div>
              ))}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add()} block>添加计费规则</Button>
            </>
          )}
        </Form.List>
        <div style={{ marginBottom: 12, marginTop: 20 }}>
          <Text style={{ fontSize: 13, fontWeight: 500 }}>Token 上限</Text>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <Form.Item name="maxOutputTokens" label="输出上限" style={{ flex: 1 }} tooltip="单次回复最大输出 Token（API max_tokens）。留空使用默认 16384。">
            <InputNumber style={{ width: '100%' }} min={0} step={512} placeholder="默认 16384" />
          </Form.Item>
          <Form.Item name="maxContextTokens" label="输入上限" style={{ flex: 1 }} tooltip="上下文总 Token 软上限。超过则自动丢弃最早的聊天记录。0/留空=不限制。">
            <InputNumber style={{ width: '100%' }} min={0} step={512} placeholder="不限制" />
          </Form.Item>
        </div>
        <div style={{ marginTop: 16 }}>
          <Form.Item name="mergeSystemMessages" valuePropName="checked" label="单 System 合并" style={{ marginBottom: 0 }}
            tooltip="部分模型只接受一条 system 消息（多条会报错）。开启后，调用前自动把上下文中所有 system 消息合并为一条前置消息（内容以双换行拼接）。默认关闭。">
            <Switch checkedChildren="开" unCheckedChildren="关" />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  )
}

// ==================== 主页面 ====================

/**
 * 「编辑模型」保存时，采样参数 / Token 上限的写回规则：
 *   - undefined：本次打开时该输入框本来就是空的（也包含表单初始化异常的极端情况）
 *                → 不把这一项放进 update payload，库里原值保持不变，避免"莫名把已保存的采样参数清成 null"；
 *   - null：用户把输入框清空了（antd InputNumber 清空时回调 null）→ 如实写回 null，表示恢复 provider 默认；
 *   - 数字：用户填写/修改的值 → 如实写回。
 * 这样即便表单层再出问题，也只会"少更新一个字段"，而不会把用户配置好的采样参数擦掉。
 */
function keepIfUnset(key: string, value: any): Record<string, any> {
  return value === undefined ? {} : { [key]: value }
}

export default function ModelsPage() {
  const { models, loadModels, createModel, updateModel, deleteModel } = useModelStore()
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addPresetGroup, setAddPresetGroup] = useState<{ provider: string; baseUrl: string; apiKey: string } | null>(null)
  const [editModel, setEditModel] = useState<any | null>(null)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [modelTestStatuses, setModelTestStatuses] = useState<Record<string, 'testing' | 'success' | 'error' | null>>({})

  useEffect(() => { loadModels() }, [])

  const groups = useMemo(() => groupModels(models), [models])

  const handleAddGlobal = () => { setAddPresetGroup(null); setAddModalOpen(true) }

  const handleAddOk = async (actions: SaveActions, meta: { provider: string; baseUrl: string; apiKey: string }) => {
    try {
      for (const e of actions.add) {
        await createModel({
          name: e.name, provider: meta.provider, apiKey: meta.apiKey,
          modelName: e.modelName, baseUrl: meta.baseUrl,
          maxOutputTokens: e.maxOutputTokens, maxContextTokens: e.maxContextTokens,
          temperature: e.temperature ?? null, topP: e.topP ?? null,
          frequencyPenalty: e.frequencyPenalty ?? null, presencePenalty: e.presencePenalty ?? null,
          billingRules: e.billingRules && e.billingRules.length > 0 ? JSON.stringify(e.billingRules) : null,
          mergeSystemMessages: !!e.mergeSystemMessages,
        })
      }
      for (const id of actions.delete) {
        await deleteModel(id)
      }
      for (const u of actions.update) {
        await updateModel(u.localId, {
          temperature: u.params.temperature ?? null, topP: u.params.topP ?? null,
          frequencyPenalty: u.params.frequencyPenalty ?? null, presencePenalty: u.params.presencePenalty ?? null,
          maxOutputTokens: u.params.maxOutputTokens ?? undefined, maxContextTokens: u.params.maxContextTokens ?? undefined,
          billingRules: u.billingRules.length > 0 ? JSON.stringify(u.billingRules) : null,
          mergeSystemMessages: !!u.params.mergeSystemMessages,
        })
      }
      const parts: string[] = []
      if (actions.add.length > 0) parts.push(`添加 ${actions.add.length} 个`)
      if (actions.delete.length > 0) parts.push(`删除 ${actions.delete.length} 个`)
      if (actions.update.length > 0) parts.push(`更新 ${actions.update.length} 个`)
      message.success(`已${parts.join('，')}`)
      setAddModalOpen(false)
    } catch (e: any) {
      message.error(e?.message || '保存失败')
    }
  }

  const handleSave = async (values: any) => {
    if (!editModel) return
    const rawRules = values.billingRules || []
    // dayjs 对象转 "HH:mm" 字符串
    const rules = rawRules.map((r: any) => ({
      ...r,
      startTime: r.timeRange?.[0] ? r.timeRange[0].format('HH:mm') : null,
      endTime: r.timeRange?.[1] ? r.timeRange[1].format('HH:mm') : null,
      timeRange: undefined,
    }))
    const billingError = validateBillingRules(rules)
    if (billingError) {
      message.error({ content: `计费规则校验失败：\n${billingError}`, duration: 10 })
      return
    }
    try {
      await updateModel(editModel.id, {
        name: values.modelName || values.modelId,
        provider: editModel.provider,
        apiKey: editModel.apiKey,
        modelName: values.modelId,
        baseUrl: editModel.baseUrl,
        // 采样参数 / Token 上限：留空（undefined）= 本次没填 → 不更新，保持库里原值；显式清空（null）才写 null
        ...keepIfUnset('maxOutputTokens', values.maxOutputTokens),
        ...keepIfUnset('maxContextTokens', values.maxContextTokens),
        ...keepIfUnset('temperature', values.temperature),
        ...keepIfUnset('topP', values.topP),
        ...keepIfUnset('frequencyPenalty', values.frequencyPenalty),
        ...keepIfUnset('presencePenalty', values.presencePenalty),
        billingRules: rules.length > 0 ? JSON.stringify(rules) : null,
        mergeSystemMessages: !!values.mergeSystemMessages,
      })
      // 保存成功后把本地快照换成库里的最新行：否则 editModel 一直停留在"打开弹窗那一刻"的值，
      // 之后任何基于 editModel 的写入都会把采样参数等字段改回旧值
      const fresh = useModelStore.getState().models.find((m) => m.id === editModel.id)
      if (fresh) setEditModel(fresh)
      setEditModalOpen(false)
      message.success('保存成功')
    } catch (e: any) {
      message.error(`保存失败：${e?.message || String(e)}`)
    }
  }

  const handleDelete = () => {
    if (!editModel) return
    Modal.confirm({
      title: '确认删除该模型？', okText: '删除', okButtonProps: { danger: true },
      onOk: async () => {
        await deleteModel(editModel.id)
        setEditModalOpen(false)
        setSelectedIds((prev) => prev.filter((id) => id !== editModel.id))
        message.success('已删除')
      },
    })
  }

  // 从「编辑模型」弹窗里的计费规则卡片「保存」按钮过来：只把 billingRules 落库，
  // 其他字段保持原值不动，避免和弹窗底部的全量保存互相覆盖。
  // 注意：这里只更新本地快照的 billingRules 字段（用函数式更新，避免用到过期闭包里的 editModel），
  // 不再用整个 editModel 生成新对象去触发弹窗表单重建——那会把用户刚改还没保存的采样参数回滚掉。
  const handleSaveBillingRules = async (rules: any[]) => {
    if (!editModel) return
    const serialized = rules.length > 0 ? JSON.stringify(rules) : null
    try {
      await updateModel(editModel.id, {
        billingRules: serialized,
      })
      setEditModel((prev: any) => (prev ? { ...prev, billingRules: serialized } : prev))
      message.success('计费规则已保存')
    } catch (e: any) {
      message.error(`保存失败：${e?.message || String(e)}`)
    }
  }

  const handleDeleteSelected = () => {
    if (selectedIds.length === 0) return
    Modal.confirm({
      title: `确认删除选中的 ${selectedIds.length} 个模型？`,
      okText: '删除', okButtonProps: { danger: true },
      onOk: async () => {
        for (const id of selectedIds) await deleteModel(id)
        setSelectedIds([])
        message.success(`已删除 ${selectedIds.length} 个模型`)
      },
    })
  }

  const runTestConnection = async (modelId: string, apiKey: string, baseUrl: string) => {
    setModelTestStatuses((prev) => ({ ...prev, [modelId]: 'testing' }))
    try {
      if (!apiKey || !baseUrl) throw new Error('缺少 API Key 或 Base URL')
      await fetchModelList(baseUrl, apiKey)
      setModelTestStatuses((prev) => ({ ...prev, [modelId]: 'success' }))
      message.success('连接成功')
    } catch (err: any) {
      setModelTestStatuses((prev) => ({ ...prev, [modelId]: 'error' }))
      message.error(err?.message || '连接失败')
    } finally {
      setTimeout(() => {
        setModelTestStatuses((prev) => {
          const next = { ...prev }
          delete next[modelId]
          return next
        })
      }, 3000)
    }
  }

  const handleTestConnection = async () => {
    if (!editModel) return
    await runTestConnection(editModel.id, editModel.apiKey, editModel.baseUrl || '')
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const toggleEnabled = async (id: string, enabled: boolean) => {
    await updateModel(id, { enabled })
  }

  if (models.length === 0) {
    return (
      <div>
        <div style={{ marginBottom: 24 }}>
          <Title level={3} style={{ margin: 0, fontWeight: 600 }}>模型管理</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>配置 AI 模型供应商与 API</Text>
        </div>
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <ClusterOutlined style={{ fontSize: 48, color: '#D1D5DB', marginBottom: 16 }} />
          <div style={{ fontSize: 16, fontWeight: 500, color: '#111827', marginBottom: 8 }}>还没有配置任何模型</div>
          <div style={{ fontSize: 13, color: '#9CA3AF', marginBottom: 20 }}>添加第一个 AI 模型开始创作</div>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAddGlobal}>添加模型</Button>
        </div>
        <AddModelsModal open={addModalOpen} onCancel={() => setAddModalOpen(false)} onOk={handleAddOk} presetGroup={addPresetGroup} localModels={models} />
      </div>
    )
  }

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Title level={3} style={{ margin: 0, fontWeight: 600 }}>模型管理</Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {groups.length} 个供应商 · {models.length} 个模型
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAddGlobal}>添加模型</Button>
      </div>

      {selectedIds.length > 0 && (
        <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: '8px 12px', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 13 }}>已选 {selectedIds.length} 个模型</Text>
          <Space>
            <Button size="small" onClick={() => setSelectedIds([])}>取消选择</Button>
            <Button size="small" danger icon={<DeleteOutlined />} onClick={handleDeleteSelected}>批量删除</Button>
          </Space>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', paddingRight: 8 }}>
        <Collapse defaultActiveKey={groups.map((g) => g.key)} style={{ background: '#FFFFFF' }}
          items={groups.map((group) => ({
            key: group.key,
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                <ClusterOutlined style={{ color: '#4F46E5' }} />
                <span style={{ fontWeight: 600, fontSize: 14 }}>{group.providerLabel}</span>
                <Text type="secondary" style={{ fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {group.baseUrl}
                </Text>
                <Tag color="blue" style={{ flexShrink: 0 }}>{group.models.length} 个模型</Tag>
              </div>
            ),
            extra: (
              <Tooltip title="拉取该供应商的模型列表，批量添加 / 删除 / 调参">
                <Button
                  size="small"
                  icon={<SettingOutlined />}
                  onClick={(ev) => {
                    // 阻止冒泡到 Collapse 头部，否则会连带触发折叠展开
                    ev.stopPropagation()
                    setAddPresetGroup({ provider: group.provider, baseUrl: group.baseUrl, apiKey: group.apiKey })
                    setAddModalOpen(true)
                  }}
                >
                  管理
                </Button>
              </Tooltip>
            ),
            children: (
              <div>
                {group.models.map((model) => (
                  <ModelRow key={model.id} model={model}
                    selected={selectedIds.includes(model.id)}
                    testStatus={modelTestStatuses[model.id] || null}
                    onToggleSelect={() => toggleSelect(model.id)}
                    onEdit={() => { setEditModel(model); setEditModalOpen(true) }}
                    onDelete={() => Modal.confirm({ title: `删除「${model.name}」？`, okText: '删除', okButtonProps: { danger: true }, onOk: async () => { await deleteModel(model.id); setSelectedIds((prev) => prev.filter((x) => x !== model.id)); message.success('已删除') } })}
                    onTest={() => runTestConnection(model.id, model.apiKey, model.baseUrl || '')}
                    onToggleEnabled={(enabled) => toggleEnabled(model.id, enabled)}
                  />
                ))}
              </div>
            ),
          }))}
        />
      </div>

      <AddModelsModal open={addModalOpen} onCancel={() => setAddModalOpen(false)} onOk={handleAddOk} presetGroup={addPresetGroup} localModels={models} />
      <EditModelModal open={editModalOpen} onCancel={() => setEditModalOpen(false)} model={editModel} onSave={handleSave} onDelete={handleDelete} onTestConnection={handleTestConnection} onBillingRulesSave={handleSaveBillingRules} />
    </div>
  )
}
