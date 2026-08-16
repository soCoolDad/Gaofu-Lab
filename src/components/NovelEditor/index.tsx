import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import CharacterCount from '@tiptap/extension-character-count'
import Highlight from '@tiptap/extension-highlight'
import TiptapTypography from '@tiptap/extension-typography'
import { useEffect, useRef, useCallback, useState } from 'react'
import type { CSSProperties } from 'react'
import { Button, Space, Tooltip, Divider, Badge, Modal, Typography } from 'antd'
import {
  BoldOutlined,
  ItalicOutlined,
  UnderlineOutlined,
  StrikethroughOutlined,
  OrderedListOutlined,
  UnorderedListOutlined,
  UndoOutlined,
  RedoOutlined,
  LoadingOutlined,
  AuditOutlined,
  PlusOutlined,
  MinusOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
} from '@ant-design/icons'
import './editor.css'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeEditorContent(value: string) {
  if (!value) return ''
  if (/<[a-z][\s\S]*>/i.test(value)) return value
  return value
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      if (/^---\s*$/.test(paragraph)) {
        return '<hr>'
      }
      return `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`
    })
    .join('')
}

function getNovelWordCount(text: string) {
  const compact = text.replace(/\s/g, '')
  const chineseCount = (compact.match(/[\u4e00-\u9fa5]/g) || []).length
  const latinWords = text.match(/[a-zA-Z0-9_]+/g) || []
  return chineseCount + latinWords.length
}

const { Text } = Typography

type Props = {
  content: string
  onChange: (html: string, text: string) => void
  onSave?: (content: string) => void
  aiStreaming?: boolean
  streamingText?: string
  onStreamingDone?: () => void
  placeholder?: string
  showToolbar?: boolean
  bookId?: string
  chapterId?: string | null
  onReviewAccepted?: (content: string) => void
  readOnly?: boolean
}

export default function NovelEditor({
  content,
  onChange,
  onSave,
  aiStreaming = false,
  streamingText = '',
  onStreamingDone,
  placeholder = '开始写作……',
  showToolbar = true,
  bookId,
  chapterId,
  onReviewAccepted,
  readOnly = false,
}: Props) {
  const [isAiStreaming, setIsAiStreaming] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [fontSize, setFontSize] = useState(15)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [reviewState, setReviewState] = useState<{ original: string; reviewed: string } | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorRef = useRef<ReturnType<typeof useEditor>>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        horizontalRule: {},
      }),
      Placeholder.configure({ placeholder }),
      CharacterCount,
      Highlight.configure({ multicolor: false }),
      TiptapTypography,
    ],
    content: normalizeEditorContent(content || ''),
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      if (readOnly) return
      const html = editor.getHTML()
      const text = editor.getText()
      onChange(html, text)

      // 防抖自动保存（2秒后）
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        onSave?.(text)
      }, 2000)
    },
    editorProps: {
      attributes: {
        class: `novel-editor-content${readOnly ? ' novel-editor-content-readonly' : ''}`,
      },
    },
  })

  editorRef.current = editor

  // 外部更新内容（切章节时）
  useEffect(() => {
    const normalizedContent = normalizeEditorContent(content || '')
    if (editor && normalizedContent !== editor.getHTML()) {
      editor.commands.setContent(normalizedContent, false)
    }
  }, [content, editor])

  // AI 流式输出
  useEffect(() => {
    if (!editor || !aiStreaming) return
    setIsAiStreaming(true)

    // 追加 AI 生成的内容（打字机效果）
    const currentContent = editor.getText()
    const combined = currentContent + streamingText

    // 简单方案：直接替换完整内容
    editor.commands.setContent(normalizeEditorContent(combined), false)
    onChange(combined, combined)

    if (streamingText.length > 0 && !aiStreaming) {
      setIsAiStreaming(false)
      onStreamingDone?.()
    }
  }, [streamingText, aiStreaming, editor])

  const handleSaveNow = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    editor?.getText() && onSave?.(editor.getText())
  }, [editor, onSave])

  const handleReview = useCallback(async () => {
    if (!editor || !window.api?.ai?.reviewEditorContent) return
    const original = editor.getText().trim()
    if (!original) return
    setReviewing(true)
    try {
      const result = await window.api.ai.reviewEditorContent({ bookId, chapterId, content: original })
      setReviewState({ original, reviewed: result.content })
    } finally {
      setReviewing(false)
    }
  }, [bookId, chapterId, editor])

  const handleAcceptReview = useCallback(() => {
    if (!editor || !reviewState) return
    editor.commands.setContent(normalizeEditorContent(reviewState.reviewed), false)
    onChange(reviewState.reviewed, reviewState.reviewed)
    onSave?.(reviewState.reviewed)
    onReviewAccepted?.(reviewState.reviewed)
    setReviewState(null)
  }, [editor, onChange, onReviewAccepted, onSave, reviewState])

  const editorContentStyle: CSSProperties = {
    fontSize,
  }

  if (!editor) return null

  const wordCount = getNovelWordCount(editor.getText())
  const charCount = editor.storage.characterCount?.characters?.() ?? 0

  return (
    <div className={`novel-editor-wrapper${isFullscreen ? ' novel-editor-wrapper-fullscreen' : ''}`}>
      {showToolbar && (
        <div className="novel-editor-toolbar">
          <Space size={2}>
          <Tooltip title="加粗 (Ctrl+B)">
            <Button
              type="text"
              size="small"
              icon={<BoldOutlined />}
              onClick={() => editor.chain().focus().toggleBold().run()}
              style={{
                color: editor.isActive('bold') ? '#4F46E5' : '#6B7280',
                fontWeight: editor.isActive('bold') ? 700 : 400,
              }}
            />
          </Tooltip>
          <Tooltip title="斜体 (Ctrl+I)">
            <Button
              type="text"
              size="small"
              icon={<ItalicOutlined />}
              onClick={() => editor.chain().focus().toggleItalic().run()}
              style={{ color: editor.isActive('italic') ? '#4F46E5' : '#6B7280' }}
            />
          </Tooltip>
          <Tooltip title="删除线">
            <Button
              type="text"
              size="small"
              icon={<StrikethroughOutlined />}
              onClick={() => editor.chain().focus().toggleStrike().run()}
              style={{ color: editor.isActive('strike') ? '#4F46E5' : '#6B7280' }}
            />
          </Tooltip>
          <Divider type="vertical" style={{ margin: '0 4px' }} />
          <Tooltip title="标题一">
            <Button
              type="text"
              size="small"
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              style={{
                color: editor.isActive('heading', { level: 1 }) ? '#4F46E5' : '#6B7280',
                fontWeight: editor.isActive('heading', { level: 1 }) ? 700 : 400,
                fontSize: editor.isActive('heading', { level: 1 }) ? 16 : 13,
              }}
            >
              H1
            </Button>
          </Tooltip>
          <Tooltip title="标题二">
            <Button
              type="text"
              size="small"
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              style={{
                color: editor.isActive('heading', { level: 2 }) ? '#4F46E5' : '#6B7280',
                fontWeight: editor.isActive('heading', { level: 2 }) ? 700 : 400,
                fontSize: editor.isActive('heading', { level: 2 }) ? 15 : 13,
              }}
            >
              H2
            </Button>
          </Tooltip>
          <Divider type="vertical" style={{ margin: '0 4px' }} />
          <Tooltip title="有序列表">
            <Button
              type="text"
              size="small"
              icon={<OrderedListOutlined />}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              style={{ color: editor.isActive('orderedList') ? '#4F46E5' : '#6B7280' }}
            />
          </Tooltip>
          <Tooltip title="无序列表">
            <Button
              type="text"
              size="small"
              icon={<UnorderedListOutlined />}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              style={{ color: editor.isActive('bulletList') ? '#4F46E5' : '#6B7280' }}
            />
          </Tooltip>
          <Divider type="vertical" style={{ margin: '0 4px' }} />
          <Tooltip title="撤销 (Ctrl+Z)">
            <Button
              type="text"
              size="small"
              icon={<UndoOutlined />}
              onClick={() => editor.chain().focus().undo().run()}
              disabled={!editor.can().undo()}
            />
          </Tooltip>
          <Tooltip title="重做 (Ctrl+Y)">
            <Button
              type="text"
              size="small"
              icon={<RedoOutlined />}
              onClick={() => editor.chain().focus().redo().run()}
              disabled={!editor.can().redo()}
            />
          </Tooltip>
        </Space>

        <Space size={12}>
          {isAiStreaming && (
            <Badge status="processing" text={<span style={{ fontSize: 12, color: '#7C3AED' }}>AI 写作中…</span>} />
          )}
          <span style={{ fontSize: 13, color: '#6B7280' }}>
            {wordCount} 字
          </span>
          <Button type="primary" onClick={handleSaveNow} style={{ minWidth: 88 }}>
            保存
          </Button>
        </Space>
        </div>
      )}



      {!showToolbar && (
        <div className="novel-editor-writing-toolbar">
          <Space size={8}>
            <Tooltip title="减少字号">
              <Button size="small" type="text" icon={<MinusOutlined />} onClick={() => setFontSize((size) => Math.max(12, size - 1))} />
            </Tooltip>
            <Tooltip title="加大字号">
              <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => setFontSize((size) => Math.min(24, size + 1))} />
            </Tooltip>
          </Space>
          <Tooltip title={isFullscreen ? '退出全屏' : '全屏'}>
            <Button
              size="small"
              type="text"
              icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={() => setIsFullscreen((value) => !value)}
            />
          </Tooltip>
        </div>
      )}

      <EditorContent editor={editor} className="novel-editor-area" style={editorContentStyle} />

      {!showToolbar && (
        <div
          style={{
            margin: 0,
            padding: '12px 16px 16px',
            borderTop: '1px solid #F3F4F6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexShrink: 0,
          }}
        >
          <Button
            icon={reviewing ? <LoadingOutlined /> : <AuditOutlined />}
            loading={reviewing}
            onClick={handleReview}
            disabled={!editor.getText().trim()}
            style={{ minWidth: 96 }}
          >
            审查
          </Button>
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
      <Modal
        title="审查结果"
        open={!!reviewState}
        width={980}
        okText="接受并替换正文"
        cancelText="拒绝"
        onOk={handleAcceptReview}
        onCancel={() => setReviewState(null)}
      >
        {reviewState && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <Text strong>原文</Text>
              <div style={{ marginTop: 8, padding: 12, border: '1px solid #E5E7EB', borderRadius: 8, maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
                {reviewState.original}
              </div>
            </div>
            <div>
              <Text strong>审查改写</Text>
              <div style={{ marginTop: 8, padding: 12, border: '1px solid #C7D2FE', borderRadius: 8, maxHeight: 420, overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.8, background: '#F8FAFF' }}>
                {reviewState.reviewed}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
