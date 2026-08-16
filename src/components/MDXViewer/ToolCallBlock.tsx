import { ToolOutlined } from '@ant-design/icons'

interface ToolCallBlockProps {
  body: string
}

/**
 * 把 fenced code 块 ```tool_call ...``` 渲染成工具调用胶囊。
 *
 * 正常情况下 ````tool_call``` 块在 agent.store.ts 的 parseToolCallBlocks 中已被提取并
 * 通过 toolCalls 数组渲染为 ToolCallItem 卡片。此组件仅作为流式过程中极短窗口内
 * 数据未闭合时的兜底展示，尽可能从 body 中提取出工具名称。
 */
export default function ToolCallBlock({ body }: ToolCallBlockProps) {
  let name = '调用工具'
  try {
    const trimmed = body.trim()
    if (trimmed) {
      const parsed = JSON.parse(trimmed)
      const items = Array.isArray(parsed) ? parsed : [parsed]
      const first = items[0]
      if (first) {
        name = first.name || first.tool || first.function?.name || '调用工具'
      }
    }
  } catch {}

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        margin: '4px 0',
        fontSize: 13,
        color: '#4338CA',
        background: '#EEF2FF',
        border: '1px solid #C7D2FE',
        borderRadius: 8,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <ToolOutlined style={{ fontSize: 13 }} />
      <span>{name}</span>
    </div>
  )
}
