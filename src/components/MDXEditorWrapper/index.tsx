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
import '@mdxeditor/editor/style.css'
import './style.css'

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
}, ref) {
  const editorRef = useRef<MDXEditorMethods>(null)
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
    </div>
  )
})

export default MDXEditorWrapper
