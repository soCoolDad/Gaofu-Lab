import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import Highlight from '@tiptap/extension-highlight'
import TiptapTypography from '@tiptap/extension-typography'
import { useEffect, useRef, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { Button, Space, Tooltip, Divider, Input, Badge, Dropdown } from 'antd'
import {
  BoldOutlined,
  ItalicOutlined,
  StrikethroughOutlined,
  OrderedListOutlined,
  UnorderedListOutlined,
  BlockOutlined,
  CodeOutlined,
  PlusOutlined,
  MinusOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  DownOutlined,
} from '@ant-design/icons'
import './editor.css'

const { TextArea } = Input

interface MarkdownEditorProps {
  content: string
  onChange: (html: string, text: string) => void
  placeholder?: string
  variant?: 'outline' | 'writing'
  onSave?: (content: string) => void
  aiStreaming?: boolean
  streamingText?: string
  onStreamingDone?: () => void
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function unescapeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** 将纯文本/MD 转为 HTML 供 Tiptap 初始化 */
function toHtml(value: string): string {
  if (!value) return ''
  if (/<[a-z][\s\S]*>/i.test(value)) return value
  return markdownToHtml(value)
}

/** 将 HTML 转为 Markdown 源码 */
function htmlToMarkdown(html: string): string {
  if (!html) return ''
  let md = html
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n')
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n')
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n')
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
    return '\n' + content.trim().split('\n').map((line: string) => '> ' + line.trim()).join('\n') + '\n'
  })
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, content) => {
    const items = content.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || []
    return '\n' + items.map((item: string) => {
      const text = item.replace(/<li[^>]*>([\s\S]*?)<\/li>/i, '$1').trim()
      return '- ' + text.replace(/<br\s*\/?>/gi, '\n  ')
    }).join('\n') + '\n'
  })
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, content) => {
    const items = content.match(/<li[^>]*>([\s\S]*?)<\/li>/gi) || []
    return '\n' + items.map((item: string, index: number) => {
      const text = item.replace(/<li[^>]*>([\s\S]*?)<\/li>/i, '$1').trim()
      return `${index + 1}. ` + text.replace(/<br\s*\/?>/gi, '\n   ')
    }).join('\n') + '\n'
  })
  md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
  md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
  md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
  md = md.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
  md = md.replace(/<s[^>]*>(.*?)<\/s>/gi, '~~$1~~')
  md = md.replace(/<del[^>]*>(.*?)<\/del>/gi, '~~$1~~')
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
  md = md.replace(/<br\s*\/?>/gi, '\n')
  md = md.replace(/<[^>]+>/g, '')
  md = unescapeHtml(md)
  md = md.replace(/\n{3,}/g, '\n\n')
  return md.trim()
}

/** 将 Markdown 源码转为 HTML */
function markdownToHtml(md: string): string {
  if (!md) return ''
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let inList: 'ul' | 'ol' | null = null
  let listItems: string[] = []

  const flushList = () => {
    if (!inList || listItems.length === 0) return
    html.push(`<${inList}>${listItems.join('')}</${inList}>`)
    listItems = []
    inList = null
  }

  const inline = (text: string) => {
    return escapeHtml(text)
      .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
      .replace(/~~([^~\n]+?)~~/g, '<s>$1</s>')
      .replace(/`([^`\n]+?)`/g, '<code>$1</code>')
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      flushList()
      continue
    }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      flushList()
      const level = heading[1].length
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/)
    if (bullet) {
      if (inList !== 'ul') flushList()
      inList = 'ul'
      listItems.push(`<li>${inline(bullet[1])}</li>`)
      continue
    }
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/)
    if (ordered) {
      if (inList !== 'ol') flushList()
      inList = 'ol'
      listItems.push(`<li>${inline(ordered[1])}</li>`)
      continue
    }
    const quote = trimmed.match(/^>\s*(.*)$/)
    if (quote) {
      flushList()
      html.push(`<blockquote><p>${inline(quote[1])}</p></blockquote>`)
      continue
    }
    flushList()
    html.push(`<p>${inline(trimmed)}</p>`)
  }
  flushList()
  return html.join('')
}

function getNovelWordCount(text: string) {
  const compact = text.replace(/\s/g, '')
  const chineseCount = (compact.match(/[\u4e00-\u9fa5]/g) || []).length
  const latinWords = text.match(/[a-zA-Z0-9_]+/g) || []
  return chineseCount + latinWords.length
}

export default function MarkdownEditor({
  content,
  onChange,
  placeholder = '输入内容…',
  variant = 'outline',
  onSave,
  aiStreaming = false,
  streamingText = '',
  onStreamingDone,
}: MarkdownEditorProps) {
  const [sourceMode, setSourceMode] = useState(false)
  const [sourceText, setSourceText] = useState('')
  const [isAiStreaming, setIsAiStreaming] = useState(false)
  const [fontSize, setFontSize] = useState(15)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const internalChangeRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isWriting = variant === 'writing'

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder }),
      ...(isWriting ? [CharacterCount, Highlight.configure({ multicolor: false }), TiptapTypography] : []),
    ],
    content: toHtml(content || ''),
    onUpdate: ({ editor }) => {
      internalChangeRef.current = true
      const html = editor.getHTML()
      const md = htmlToMarkdown(html)
      onChange(html, md)

      if (isWriting && onSave) {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
          onSave(md)
        }, 2000)
      }
    },
    editorProps: {
      attributes: {
        class: isWriting ? 'md-editor-content md-writing-content' : 'md-editor-content',
      },
    },
  })

  useEffect(() => {
    if (internalChangeRef.current) {
      internalChangeRef.current = false
      return
    }
    const html = toHtml(content || '')
    if (editor && html !== editor.getHTML()) {
      editor.commands.setContent(html, false)
    }
  }, [content, editor])

  // AI 流式输出
  useEffect(() => {
    if (!editor || !aiStreaming || !isWriting) return
    setIsAiStreaming(true)

    const currentContent = editor.getText()
    const combined = currentContent + streamingText
    editor.commands.setContent(toHtml(combined), false)
    onChange(combined, combined)

    if (streamingText.length > 0 && !aiStreaming) {
      setIsAiStreaming(false)
      onStreamingDone?.()
    }
  }, [streamingText, aiStreaming, editor, isWriting, onChange, onStreamingDone])

  const toggleSourceMode = () => {
    if (!sourceMode && editor) {
      setSourceText(htmlToMarkdown(editor.getHTML()))
      setSourceMode(true)
    } else if (sourceMode && editor) {
      const html = markdownToHtml(sourceText)
      editor.commands.setContent(html, false)
      internalChangeRef.current = true
      onChange(html, sourceText)
      if (isWriting && onSave) {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
          onSave(sourceText)
        }, 2000)
      }
      setSourceMode(false)
    }
  }

  const handleSaveNow = useCallback(() => {
    if (!onSave) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    const md = sourceMode ? sourceText : (editor ? htmlToMarkdown(editor.getHTML()) : '')
    md && onSave(md)
  }, [onSave, sourceMode, sourceText, editor])

  if (!editor) return null

  const btnStyle = (active: boolean) => ({
    color: active ? '#4F46E5' : '#6B7280',
    fontWeight: active ? 700 : 400,
  })

  const wordCount = isWriting ? getNovelWordCount(sourceMode ? sourceText : htmlToMarkdown(editor.getHTML())) : 0
  const editorContentStyle: CSSProperties = { fontSize }

  const wrapperClass = [
    'md-editor-wrapper',
    isWriting ? 'md-writing-wrapper' : '',
    isFullscreen ? 'md-editor-fullscreen' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={wrapperClass}>
      <div className="md-editor-toolbar">
        <Space size={2}>
          <Tooltip title="加粗 (Ctrl+B)">
            <Button
              type="text"
              size="small"
              icon={<BoldOutlined />}
              disabled={sourceMode}
              onClick={() => editor.chain().focus().toggleBold().run()}
              style={btnStyle(editor.isActive('bold'))}
            />
          </Tooltip>
          <Tooltip title="斜体 (Ctrl+I)">
            <Button
              type="text"
              size="small"
              icon={<ItalicOutlined />}
              disabled={sourceMode}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              style={btnStyle(editor.isActive('italic'))}
            />
          </Tooltip>
          <Tooltip title="删除线">
            <Button
              type="text"
              size="small"
              icon={<StrikethroughOutlined />}
              disabled={sourceMode}
              onClick={() => editor.chain().focus().toggleStrike().run()}
              style={btnStyle(editor.isActive('strike'))}
            />
          </Tooltip>
          <Divider type="vertical" style={{ margin: '0 4px' }} />
          <Dropdown
            disabled={sourceMode}
            menu={{
              items: [
                { key: 'h1', label: '标题一', onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
                { key: 'h2', label: '标题二', onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
                { key: 'h3', label: '标题三', onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
                { key: 'p', label: '正文', onClick: () => editor.chain().focus().setParagraph().run() },
              ],
            }}
          >
            <Button
              type="text"
              size="small"
              disabled={sourceMode}
              style={btnStyle(editor.isActive('heading'))}
            >
              <Space size={2}>
                <span style={{ fontWeight: 600 }}>
                  {editor.isActive('heading', { level: 1 }) ? 'H1' : editor.isActive('heading', { level: 2 }) ? 'H2' : editor.isActive('heading', { level: 3 }) ? 'H3' : 'H'}
                </span>
                <DownOutlined style={{ fontSize: 10 }} />
              </Space>
            </Button>
          </Dropdown>
          <Divider type="vertical" style={{ margin: '0 4px' }} />
          <Dropdown
            disabled={sourceMode}
            menu={{
              items: [
                { key: 'bullet', label: '无序列表', icon: <UnorderedListOutlined />, onClick: () => editor.chain().focus().toggleBulletList().run() },
                { key: 'ordered', label: '有序列表', icon: <OrderedListOutlined />, onClick: () => editor.chain().focus().toggleOrderedList().run() },
              ],
            }}
          >
            <Button
              type="text"
              size="small"
              icon={editor.isActive('orderedList') ? <OrderedListOutlined /> : <UnorderedListOutlined />}
              disabled={sourceMode}
              style={btnStyle(editor.isActive('bulletList') || editor.isActive('orderedList'))}
            />
          </Dropdown>
        </Space>

        <Space size={8}>
          <Tooltip title="减少字号">
            <Button size="small" type="text" icon={<MinusOutlined />} onClick={() => setFontSize((s) => Math.max(12, s - 1))} />
          </Tooltip>
          <Tooltip title="加大字号">
            <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => setFontSize((s) => Math.min(24, s + 1))} />
          </Tooltip>
        </Space>

        <div style={{ flex: 1 }} />

        <Space size={2}>
          <Tooltip title={sourceMode ? '返回富文本编辑' : '编辑 Markdown 源码'}>
            <Button
              type="text"
              size="small"
              icon={<CodeOutlined />}
              onClick={toggleSourceMode}
              style={btnStyle(sourceMode)}
            />
          </Tooltip>
          <Tooltip title={isFullscreen ? '退出全屏' : '全屏'}>
            <Button
              size="small"
              type="text"
              icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={() => setIsFullscreen((v) => !v)}
            />
          </Tooltip>
        </Space>
      </div>

      {sourceMode ? (
        <TextArea
          value={sourceText}
          onChange={(e) => {
            setSourceText(e.target.value)
            internalChangeRef.current = true
            onChange('', e.target.value)
            if (isWriting && onSave) {
              if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
              saveTimerRef.current = setTimeout(() => {
                onSave(e.target.value)
              }, 2000)
            }
          }}
          className={`md-editor-source ${isWriting ? 'md-writing-source' : ''}`}
          placeholder="输入 Markdown 源码…"
          style={{
            flex: 1,
            minHeight: 0,
            resize: 'none',
            border: 'none',
            fontSize: fontSize,
            lineHeight: isWriting ? 2 : 1.9,
            fontFamily: isWriting ? 'inherit' : "'SF Mono', 'Menlo', monospace",
            background: isWriting ? '#FFFFFF' : '#FAFAFA',
            padding: isWriting ? '20px 25px' : 16,
            outline: 'none',
          }}
        />
      ) : (
        <EditorContent
          editor={editor}
          className={`md-editor-area ${isWriting ? 'md-writing-area' : ''}`}
          style={editorContentStyle}
        />
      )}

      {isWriting && (
        <div className="md-writing-footer">
          <Space size={16}>
            {isAiStreaming && (
              <Badge status="processing" text={<span style={{ fontSize: 12, color: '#7C3AED' }}>AI 写作中…</span>} />
            )}
            <span style={{ fontSize: 13, color: '#6B7280' }}>
              {wordCount} 字
            </span>
            <Button type="primary" onClick={handleSaveNow} style={{ minWidth: 96 }}>
              保存
            </Button>
          </Space>
        </div>
      )}
    </div>
  )
}
