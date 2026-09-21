import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  tablePlugin,
  imagePlugin,
  frontmatterPlugin,
  codeBlockPlugin,
  markdownShortcutPlugin,
  toolbarPlugin,
  diffSourcePlugin,
  realmPlugin,
  addImportVisitor$,
  BlockTypeSelect,
  Separator,
  viewMode$,
  applyFormat$,
  currentFormat$,
  IS_BOLD,
  type MDXEditorMethods,
} from '@mdxeditor/editor'
import { useCellValue, usePublisher } from '@mdxeditor/gurx'
import { BoldOutlined, CodeOutlined, FullscreenOutlined, FullscreenExitOutlined } from '@ant-design/icons'
import { $createParagraphNode, $createTextNode } from 'lexical'
import { toMarkdown } from 'mdast-util-to-markdown'
import { Modal, Select, Input, Button, Space, message } from 'antd'
import { ToolOutlined } from '@ant-design/icons'
import '@mdxeditor/editor/style.css'
import './style.css'
import SkillManagerModal from '@/components/SkillManagerModal'
import type { AiSkill } from '@/types/api'

// 兜底 import visitor：把所有未被其它 visitor 匹配的 mdast 节点，
// 用 mdast-util-to-markdown 重新序列化成源码字符串，作为普通段落文本原样输出到编辑器。
// 这样即使遇到没注册插件的 markdown 结构（例如某些 directive、自定义 HTML 等），
// 也不会抛错、不会切到源码视图，用户在富文本视图下看到的就是原始文本。
const fallbackImportVisitorPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addImportVisitor$]: {
        // 放到 visitors 数组末尾（其它插件已注册过更精确的匹配），
        // 这里对任何 mdast 节点都返回 true，作为兜底。
        testNode: () => true,
        visitNode({ mdastNode, actions }: any) {
          let text = ''
          try {
            // mdast-util-to-markdown 需要根节点，包一层再取序列化结果
            text = toMarkdown({ type: 'root', children: [mdastNode] } as any).trim()
          } catch {
            // 极端情况下直接读 value/name/type 拼接
            text = mdastNode?.value || mdastNode?.name || `<${mdastNode?.type || 'unknown'}>`
          }
          if (!text) return
          const paragraph = $createParagraphNode()
          paragraph.append($createTextNode(text))
          actions.addAndStepInto(paragraph)
        },
      },
    })
  },
})

interface MDXEditorWrapperProps {
  content: string
  onChange?: (markdown: string) => void
  placeholder?: string
  variant?: 'outline' | 'writing' | 'readonly'
  onSave?: (content: string) => void
  className?: string
  style?: React.CSSProperties
  /** 当前写作使用的模型 id（技能处理时传给后端调用模型；缺省时后端用第一个可用模型兜底） */
  modelId?: string | null
  /** 当前书籍上下文（技能处理的 token 消耗记账归到这本书） */
  bookId?: string | null
  bookTitle?: string | null
}

function BoldToggleButton() {
  const currentFormat = useCellValue(currentFormat$)
  const applyFormat = usePublisher(applyFormat$)
  const active = (currentFormat & IS_BOLD) !== 0
  return (
    <button
      type="button"
      className={`mdx-tb-btn ${active ? 'active' : ''}`}
      title="加粗"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => applyFormat('bold')}
    >
      <BoldOutlined />
    </button>
  )
}

function SourceToggleButton() {
  const viewMode = useCellValue(viewMode$)
  const setViewMode = usePublisher(viewMode$)
  const active = viewMode === 'source'
  return (
    <button
      type="button"
      className={`mdx-tb-btn ${active ? 'active' : ''}`}
      title={active ? '返回编辑' : '源码'}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setViewMode(active ? 'rich-text' : 'source')}
    >
      <CodeOutlined />
    </button>
  )
}

function FullscreenButton({ fullscreen, onToggle }: { fullscreen: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`mdx-tb-btn ${fullscreen ? 'active' : ''}`}
      title={fullscreen ? '退出全屏' : '全屏'}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onToggle}
    >
      {fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
    </button>
  )
}

export interface MDXEditorWrapperHandle {
  save: () => void
}

const MDXEditorWrapper = forwardRef<MDXEditorWrapperHandle, MDXEditorWrapperProps>(function MDXEditorWrapper({
  content,
  onChange,
  placeholder = '输入内容…',
  variant = 'outline',
  onSave,
  className,
  style,
  modelId,
  bookId,
  bookTitle,
}, ref) {
  const editorRef = useRef<MDXEditorMethods>(null)
  const [skillApplyOpen, setSkillApplyOpen] = useState(false)
  const [skillManageOpen, setSkillManageOpen] = useState(false)
  const [skillList, setSkillList] = useState<AiSkill[]>([])
  const [selectedSkillId, setSelectedSkillId] = useState<string | undefined>()
  const [applyInput, setApplyInput] = useState('')
  const [applyResult, setApplyResult] = useState('')
  const [applying, setApplying] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const internalChangeRef = useRef(false)
  const [fullscreen, setFullscreen] = useState(false)

  const isWriting = variant === 'writing'
  const isReadonly = variant === 'readonly'

  useEffect(() => {
    if (internalChangeRef.current) {
      internalChangeRef.current = false
      return
    }
    if (editorRef.current && content !== editorRef.current.getMarkdown()) {
      editorRef.current.setMarkdown(content || '')
    }
  }, [content])

  useEffect(() => {
    if (!fullscreen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', handleKey)
    }
  }, [fullscreen])

  const handleChange = useCallback(() => {
    if (!editorRef.current || !onChange) return
    internalChangeRef.current = true
    const markdown = editorRef.current.getMarkdown()
    onChange(markdown)

    if (isWriting && onSave) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        onSave(markdown)
      }, 2000)
    }
  }, [onChange, onSave, isWriting])

  const handleSaveNow = useCallback(() => {
    if (!onSave || !editorRef.current) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    const markdown = editorRef.current.getMarkdown()
    onSave(markdown)
  }, [onSave])

  useImperativeHandle(ref, () => ({
    save: handleSaveNow,
  }), [handleSaveNow])

  // ─── AI 技能：「用技能处理」 ────────────────────────────────
  const openSkillApply = useCallback(async () => {
    if (!editorRef.current) return
    // 优先用编辑器内选区文本，否则取全文（onMouseDown 已 preventDefault 保留选区）
    const selection = typeof window !== 'undefined' ? window.getSelection() : null
    const selected = selection && selection.toString().trim()
    const input = selected || editorRef.current.getMarkdown() || ''
    setApplyInput(input)
    setApplyResult('')
    setSelectedSkillId(undefined)
    setSkillApplyOpen(true)
    try {
      const list = await window.api.skill.list()
      setSkillList(list || [])
    } catch (e: any) {
      message.error('加载技能失败：' + (e?.message || e))
    }
  }, [])

  const handleSkillApply = useCallback(async () => {
    if (!selectedSkillId) {
      message.warning('请先选择一个技能')
      return
    }
    if (!applyInput.trim()) {
      message.warning('待处理文本为空')
      return
    }
    setApplying(true)
    setApplyResult('')
    try {
      const res = await window.api.skill.invoke({
        skillId: selectedSkillId,
        content: applyInput,
        modelId: modelId ?? null,
        bookId: bookId ?? null,
        bookTitle: bookTitle ?? null,
      })
      // 后端已落 token_usage_logs，通知侧边栏刷新今日消耗
      window.dispatchEvent(new Event('token-usage-updated'))
      if (!res?.success) {
        message.error('技能处理失败：' + (res?.error || '未知错误'))
        return
      }
      setApplyResult(res.content || '')
    } catch (e: any) {
      window.dispatchEvent(new Event('token-usage-updated'))
      message.error('技能处理失败：' + (e?.message || e))
    } finally {
      setApplying(false)
    }
  }, [selectedSkillId, applyInput, modelId, bookId, bookTitle])

  const handleSkillAccept = useCallback(() => {
    if (!editorRef.current) return
    const full = editorRef.current.getMarkdown() || ''
    const result = applyResult
    // 若当初用的是选区（applyInput 是全文的子集且能在全文定位），替换该片段；否则整篇替换
    let next = result
    if (applyInput && applyInput !== full) {
      const idx = full.indexOf(applyInput)
      if (idx >= 0) {
        next = full.slice(0, idx) + result + full.slice(idx + applyInput.length)
      } else {
        message.warning('未在原文本中定位到选中内容，已用处理结果替换全文')
      }
    }
    editorRef.current.setMarkdown(next || '')
    setSkillApplyOpen(false)
    setApplyResult('')
  }, [applyInput, applyResult])

  return (
    <div
      className={`mdx-editor-wrapper ${isWriting ? 'mdx-writing-wrapper' : ''} ${isReadonly ? 'mdx-readonly-wrapper' : ''} ${fullscreen ? 'mdx-fullscreen' : ''} ${className || ''}`}
      style={style}
    >
      <MDXEditor
        ref={editorRef}
        markdown={content || ''}
        onChange={handleChange}
        placeholder={placeholder}
        readOnly={isReadonly}
        plugins={
          isReadonly
            ? [
                headingsPlugin(),
                listsPlugin(),
                quotePlugin(),
                thematicBreakPlugin(),
                linkPlugin(),
                linkDialogPlugin(),
                tablePlugin(),
                imagePlugin(),
                frontmatterPlugin(),
                codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
                markdownShortcutPlugin(),
                // 兜底：任何未被上面 visitor 处理的 mdast 节点都会走这里，
                // 原样序列化为纯文本插入，不再抛"Parsing of the following markdown structure failed"错误。
                fallbackImportVisitorPlugin(),
              ]
            : [
                headingsPlugin(),
                listsPlugin(),
                quotePlugin(),
                thematicBreakPlugin(),
                linkPlugin(),
                linkDialogPlugin(),
                tablePlugin(),
                imagePlugin(),
                frontmatterPlugin(),
                codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
                markdownShortcutPlugin(),
                fallbackImportVisitorPlugin(),
                diffSourcePlugin({ viewMode: 'rich-text' }),
                toolbarPlugin({
                  toolbarContents: () => (
                    <div className="mdx-toolbar-row">
                      <div className="mdx-toolbar-left">
                        <BoldToggleButton />
                        <Separator />
                        <BlockTypeSelect />
                      </div>
                      <div className="mdx-toolbar-right">
                        {isWriting && (
                          <button
                            type="button"
                            className="mdx-tb-btn"
                            title="用技能处理（选中文本后调用 AI 技能）"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={openSkillApply}
                          >
                            <ToolOutlined />
                            <span style={{ marginLeft: 4 }}>用技能处理</span>
                          </button>
                        )}
                        <SourceToggleButton />
                        <FullscreenButton fullscreen={fullscreen} onToggle={() => setFullscreen((v) => !v)} />
                      </div>
                    </div>
                  ),
                }),
              ]
        }
        // 遇到无法识别的 markdown 结构时，只在控制台记录（fallbackImportVisitorPlugin 已经把内容原样输出，不会阻塞 UI）。
        onError={(payload) => {
          // eslint-disable-next-line no-console
          console.warn('[MDXEditor] 未识别的 markdown 结构，已原样保留：', payload.error)
        }}
        contentEditableClassName={`mdx-editor-content ${isWriting ? 'mdx-writing-content' : ''}`}
      />

      {/* AI 技能：用技能处理（手动触发） */}
      <Modal
        title="用技能处理"
        open={skillApplyOpen}
        onCancel={() => setSkillApplyOpen(false)}
        footer={null}
        width={880}
        centered
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13 }}>技能：</span>
            <Select
              style={{ minWidth: 280 }}
              placeholder="选择一个技能"
              value={selectedSkillId}
              onChange={setSelectedSkillId}
              options={skillList.map((s) => ({ value: s.id, label: s.name }))}
            />
            <Button size="small" onClick={() => setSkillManageOpen(true)}>管理技能</Button>
            <span style={{ color: '#9CA3AF', fontSize: 12 }}>
              先选中文本再点「用技能处理」只处理选区；未选中则处理全文。
            </span>
          </div>
          <div>
            <div style={{ fontSize: 12, marginBottom: 4 }}>待处理文本</div>
            <Input.TextArea value={applyInput} onChange={(e) => setApplyInput(e.target.value)} rows={6} />
          </div>
          <Space>
            <Button type="primary" loading={applying} onClick={handleSkillApply}>处理</Button>
            <Button type="primary" disabled={!applyResult} onClick={handleSkillAccept}>接受并替换</Button>
            <Button onClick={() => setSkillApplyOpen(false)}>关闭</Button>
          </Space>
          {applyResult && (
            <div>
              <div style={{ fontSize: 12, margin: '8px 0 4px' }}>处理结果</div>
              <Input.TextArea value={applyResult} readOnly rows={6} style={{ background: '#F8FAFF' }} />
            </div>
          )}
        </div>
      </Modal>

      <SkillManagerModal
        open={skillManageOpen}
        onClose={() => setSkillManageOpen(false)}
        onChanged={() => {
          window.api.skill.list().then(setSkillList).catch(() => {})
        }}
      />
    </div>
  )
})

export default MDXEditorWrapper
