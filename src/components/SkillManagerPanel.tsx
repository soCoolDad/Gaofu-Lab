import { useEffect, useState, useCallback, useRef } from 'react'
import { Table, Button, Space, Input, Switch, Popconfirm, Modal, message, Upload, Checkbox, Typography } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, CloudDownloadOutlined, UploadOutlined } from '@ant-design/icons'
import type { AiSkill, SkillDraft } from '@/types/api'
import './SkillManagerPanel.css'

const { Text } = Typography

/**
 * AI 技能管理面板（核心 UI，无 Modal 外壳）：
 * 列出全部技能（含禁用），支持三种新增方式——
 *   1. 新建技能：手动填写提示词（弹窗）
 *   2. GitHub / Zip 导入：粘贴链接或上传压缩包，解析预览后勾选导入（弹窗）
 * 编辑也走同一个表单弹窗。
 *
 * 两处使用：
 * - 全局页面 src/pages/SkillManager（侧边栏「辅助资产 → AI 技能」）
 * - 编辑器内的 SkillManagerModal 弹窗
 */
export default function SkillManagerPanel({ onChanged }: { onChanged?: () => void }) {
  const [skills, setSkills] = useState<AiSkill[]>([])
  const [loading, setLoading] = useState(false)

  // 新建 / 编辑表单弹窗
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<AiSkill | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)

  // 导入弹窗（GitHub 链接 / Zip 上传 → 预览草稿 → 勾选导入）
  const [importOpen, setImportOpen] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [fetching, setFetching] = useState(false)
  const [drafts, setDrafts] = useState<SkillDraft[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [creating, setCreating] = useState(false)

  // 表格内部滚动：容器高度由 flex 撑满，表头固定，行在 .ant-table-body 里滚。
  // scroll.y 需要像素值，用 ResizeObserver 按容器实际高度动态测量。
  const tableBoxRef = useRef<HTMLDivElement>(null)
  const [scrollY, setScrollY] = useState<number | undefined>(undefined)

  useEffect(() => {
    const box = tableBoxRef.current
    if (!box) return
    const compute = () => {
      const thead = box.querySelector<HTMLElement>('.ant-table-thead')
      const headH = thead ? thead.offsetHeight : 39
      const next = Math.floor(box.clientHeight - headH - 2)
      if (next > 0) setScrollY(next)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(box)
    window.addEventListener('resize', compute)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', compute)
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.api.skill.list({ includeDisabled: true })
      setSkills(list || [])
    } catch (e: any) {
      message.error('加载技能失败：' + (e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const notifyChanged = () => {
    load()
    onChanged?.()
  }

  // ─── 新建 / 编辑 ────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null)
    setName('')
    setDescription('')
    setPrompt('')
    setEnabled(true)
    setFormOpen(true)
  }

  const openEdit = (s: AiSkill) => {
    setEditing(s)
    setName(s.name)
    setDescription(s.description)
    setPrompt(s.prompt)
    setEnabled(s.enabled)
    setFormOpen(true)
  }

  const save = async () => {
    if (!name.trim() || !prompt.trim()) {
      message.warning('名称和提示词必填')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        await window.api.skill.update({ id: editing.id, name, description, prompt, enabled })
        message.success('已更新')
      } else {
        await window.api.skill.create({ name, description, prompt, enabled })
        message.success('已创建')
      }
      setFormOpen(false)
      notifyChanged()
    } catch (e: any) {
      message.error('保存失败：' + (e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  // ─── 导入（GitHub / Zip）────────────────────────────────────
  const openImport = () => {
    setUrlInput('')
    setDrafts([])
    setSelected([])
    setImportOpen(true)
  }

  const applyDrafts = (list: SkillDraft[]) => {
    setDrafts(list)
    setSelected(list.map((_, i) => i))
  }

  const importFromUrl = async () => {
    if (!urlInput.trim()) {
      message.warning('请先粘贴技能链接')
      return
    }
    setFetching(true)
    try {
      const res = await window.api.skill.importFromUrl({ url: urlInput.trim() })
      if (!res?.success) {
        message.error(res?.error || '导入失败')
        return
      }
      applyDrafts(res.drafts || [])
      message.success(`解析到 ${(res.drafts || []).length} 个技能，请确认后导入`)
    } catch (e: any) {
      message.error('导入失败：' + (e?.message || e))
    } finally {
      setFetching(false)
    }
  }

  const handleZip = async (file: File) => {
    setFetching(true)
    try {
      const buffer = new Uint8Array(await file.arrayBuffer())
      const res = await window.api.skill.importZip(buffer)
      if (!res?.success) {
        message.error(res?.error || '导入失败')
        return
      }
      applyDrafts(res.drafts || [])
      message.success(`解析到 ${(res.drafts || []).length} 个技能，请确认后导入`)
    } catch (e: any) {
      message.error('导入失败：' + (e?.message || e))
    } finally {
      setFetching(false)
    }
    return false
  }

  const confirmImport = async () => {
    if (!selected.length) {
      message.warning('请先勾选要导入的技能')
      return
    }
    setCreating(true)
    try {
      let ok = 0
      const errors: string[] = []
      for (const idx of selected) {
        const d = drafts[idx]
        if (!d) continue
        const res = await window.api.skill.create({
          name: d.name,
          description: d.description || (d.source ? `导入自 ${d.source}` : ''),
          prompt: d.prompt,
          enabled: true,
        })
        if (res?.success) ok++
        else errors.push(`${d.name}：${res?.error || '未知错误'}`)
      }
      if (errors.length) message.warning(`${ok} 个导入成功，${errors.length} 个失败：${errors.join('；')}`)
      else message.success(`已导入 ${ok} 个技能`)
      setImportOpen(false)
      setDrafts([])
      setSelected([])
      notifyChanged()
    } catch (e: any) {
      message.error('导入失败：' + (e?.message || e))
    } finally {
      setCreating(false)
    }
  }

  // ─── 删除 / 启停 ────────────────────────────────────────────
  const remove = async (id: string) => {
    try {
      await window.api.skill.delete(id)
      message.success('已删除')
      notifyChanged()
    } catch (e: any) {
      message.error('删除失败：' + (e?.message || e))
    }
  }

  const toggleEnabled = async (s: AiSkill, val: boolean) => {
    try {
      await window.api.skill.update({ id: s.id, enabled: val })
      notifyChanged()
    } catch (e: any) {
      message.error('更新失败：' + (e?.message || e))
    }
  }

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true },
    { title: '描述', dataIndex: 'description', key: 'description', ellipsis: true },
    {
      title: '启用',
      key: 'enabled',
      width: 70,
      render: (_: any, s: AiSkill) => <Switch checked={s.enabled} onChange={(v) => toggleEnabled(s, v)} />,
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_: any, s: AiSkill) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(s)}>编辑</Button>
          <Popconfirm title="确认删除该技能？" onConfirm={() => remove(s.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ marginBottom: 12, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建技能</Button>
          <Button icon={<CloudDownloadOutlined />} onClick={openImport}>GitHub / Zip 导入</Button>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
        </Space>
        <span style={{ color: '#9CA3AF', fontSize: 12 }}>
          技能 = 一段系统提示词；在编辑器点「用技能处理」即可对选中文本调用。
        </span>
      </div>

      {/* 新建 / 编辑技能弹窗 */}
      <Modal
        title={editing ? '编辑技能' : '新建技能'}
        open={formOpen}
        onOk={save}
        onCancel={() => setFormOpen(false)}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={640}
        centered
        maskClosable={false}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
          <div>
            <div style={{ fontSize: 12, marginBottom: 4 }}>名称 *</div>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：去 AI 味（humanizer-zh）" />
          </div>
          <div>
            <div style={{ fontSize: 12, marginBottom: 4 }}>描述</div>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="简要说明技能用途" />
          </div>
          <div>
            <div style={{ fontSize: 12, marginBottom: 4 }}>提示词（系统提示词）*</div>
            <Input.TextArea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={10}
              placeholder="直接粘贴技能提示词正文；带 frontmatter 的 SKILL.md 建议走「GitHub / Zip 导入」自动解析"
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12 }}>启用</span>
            <Switch checked={enabled} onChange={setEnabled} />
          </div>
        </div>
      </Modal>

      {/* 导入弹窗：GitHub 链接 / Zip 上传 → 预览 → 勾选导入 */}
      <Modal
        title="导入技能（GitHub / Zip）"
        open={importOpen}
        onCancel={() => { setImportOpen(false); setDrafts([]); setSelected([]) }}
        footer={null}
        width={720}
        centered
        maskClosable={false}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, marginBottom: 4 }}>
              GitHub 链接：支持仓库、目录（tree）或文件（blob）链接，自动识别 SKILL.md
            </div>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://github.com/用户/仓库/tree/main/skills/xxx"
                onPressEnter={importFromUrl}
                allowClear
              />
              <Button type="primary" loading={fetching} onClick={importFromUrl}>获取</Button>
            </Space.Compact>
          </div>

          <div style={{ textAlign: 'center', color: '#D1D5DB', fontSize: 12 }}>—— 或 ——</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Upload accept=".zip" maxCount={1} showUploadList={false} beforeUpload={handleZip} disabled={fetching}>
              <Button icon={<UploadOutlined />} loading={fetching}>上传 Zip 压缩包</Button>
            </Upload>
            <span style={{ color: '#9CA3AF', fontSize: 12 }}>
              包内的 SKILL.md / .md / .txt / .json 会被解析为技能
            </span>
          </div>

          {drafts.length > 0 && (
            <div style={{ borderTop: '1px solid #F3F4F6', paddingTop: 12 }}>
              <div style={{ marginBottom: 8 }}>
                解析到 <Text strong>{drafts.length}</Text> 个技能，勾选要导入的：
              </div>
              <Checkbox.Group
                value={selected}
                onChange={(v) => setSelected(v as number[])}
                style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}
              >
                {drafts.map((d, i) => (
                  <div key={i} style={{ border: '1px solid #F3F4F6', borderRadius: 8, padding: '8px 12px', background: '#FAFAFA' }}>
                    <Checkbox value={i}>
                      <span style={{ fontWeight: 600 }}>{d.name}</span>
                      {d.description && <span style={{ color: '#6B7280', marginLeft: 8, fontSize: 12 }}>{d.description}</span>}
                    </Checkbox>
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginLeft: 24, marginTop: 2 }}>
                      提示词 {d.prompt.length} 字{d.source ? ` · 来源：${d.source}` : ''}
                    </div>
                  </div>
                ))}
              </Checkbox.Group>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <Button type="primary" loading={creating} disabled={!selected.length} onClick={confirmImport}>
                  导入所选（{selected.length}）
                </Button>
                <Button onClick={() => { setDrafts([]); setSelected([]) }}>重新选择</Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <div ref={tableBoxRef} style={{ flex: 1, minHeight: 0 }}>
        <Table
          className="skill-manager-table"
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={skills}
          pagination={false}
          tableLayout="fixed"
          scroll={scrollY ? { y: scrollY } : undefined}
        />
      </div>
    </div>
  )
}
