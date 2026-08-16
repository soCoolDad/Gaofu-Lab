import { useEffect, useState } from 'react'
import { Card, Typography, Button, message } from 'antd'
import { SaveOutlined, CopyOutlined } from '@ant-design/icons'
import { useParams } from 'react-router-dom'
import { useWorkspaceStore } from '@/stores/workspace.store'
import MDXEditorWrapper from '@/components/MDXEditorWrapper'

const { Title, Text } = Typography

const defaultOutline = `一、故事背景

二、核心设定

三、主线剧情

四、核心主题

五、人物关系`

export default function OutlinePage() {
  const { bookId } = useParams()
  const { currentBook } = useWorkspaceStore()
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)

  const loadOutline = () => {
    if (!bookId) return
    window.api.outline.getBook(bookId).then((outline) => {
      setContent(outline?.content || defaultOutline)
    })
  }

  useEffect(() => {
    loadOutline()
  }, [bookId])

  useEffect(() => {
    const handleAiApplied = () => loadOutline()
    window.addEventListener('ai-result-applied', handleAiApplied)
    return () => window.removeEventListener('ai-result-applied', handleAiApplied)
  }, [bookId])

  const handleSave = async () => {
    if (!bookId) return
    setSaving(true)
    try {
      await window.api.outline.saveBook(bookId, content)
      message.success('大纲已保存')
    } catch {
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleCopy = () => {
    if (!content.trim()) {
      message.warning('没有可复制的大纲内容')
      return
    }
    window.api.clipboard.writeText(content)
    message.success('大纲已复制')
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        style={{
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div>
          <Title level={3} style={{ margin: 0, fontWeight: 600 }}>
            大纲管理
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            全书大纲与核心设定
          </Text>
        </div>
      </div>

      <Card
        variant="borderless"
        style={{ borderRadius: 12, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        title={<span style={{ fontWeight: 600 }}>{currentBook?.title || '未命名作品'}</span>}
        extra={
          <div style={{ display: 'flex', gap: 8 }}>
            {/* <Button icon={<CopyOutlined />} onClick={handleCopy} title="复制" aria-label="复制" /> */}
            <Button icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button>
          </div>
        }
        styles={{ body: { padding: 0, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderRadius: '0 0 12px 12px', overflow: 'hidden' } }}
      >
        <MDXEditorWrapper
          content={content}
          onChange={(markdown) => setContent(markdown)}
          placeholder="输入大纲内容…"
          variant="outline"
        />
      </Card>
    </div>
  )
}
