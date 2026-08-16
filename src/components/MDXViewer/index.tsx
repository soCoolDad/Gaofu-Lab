import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { memo, useMemo } from 'react'
import type { ReactNode } from 'react'
import AiNovelDataBlock from './AiNovelDataBlock'
import ToolCallBlock from './ToolCallBlock'
import './style.css'

interface MDXViewerProps {
  content: string
  className?: string
  style?: React.CSSProperties
  /**
   * 兼容旧调用点。当前实现无需节流（react-markdown 支持增量重渲染），此参数被忽略。
   */
  throttleMs?: number
}

// 判断某个 fenced code 节点是否是 AI 数据块（```data_start;...```）
function isAiNovelDataCodeNode(node: any): boolean {
  if (!node) return false
  const codeNode = Array.isArray(node.children) ? node.children.find((c: any) => c?.tagName === 'code') : null
  const cls: string[] = codeNode?.properties?.className || []
  return cls.some((c) => typeof c === 'string' && c.startsWith('language-data_start'))
}

// 判断某个 fenced code 节点是否是 tool_call 块（```tool_call``` 或其变体）
function isToolCallCodeNode(node: any): boolean {
  if (!node) return false
  const codeNode = Array.isArray(node.children) ? node.children.find((c: any) => c?.tagName === 'code') : null
  const cls: string[] = codeNode?.properties?.className || []
  return cls.some((c) => typeof c === 'string' && /^language-(tool_call|tool_calls|function_call|fc)$/i.test(c))
}

// 流式渲染保护：若 content 中 ``` 数量为奇数，说明尚有未闭合的 fenced code block，
// 会导致 remark 把后续文本（包括下一个 data_start 数据块）当作前一个块的正文，出现"嵌套"错乱。
// 这里在渲染前补上一个虚拟的闭合围栏，保证 markdown 结构稳定。
function ensureFencesBalanced(input: string): string {
  const src = input || ''
  const count = (src.match(/```/g) || []).length
  if (count % 2 === 1) return src + '\n```'
  return src
}

// 双保险规范化：即使上游没跑 normalize（老数据、外部注入等），也在渲染前把
// 相邻 data_start 数据块共用中间 ``` 的情况补齐成"每块独立成对"的结构。
// 与 aiChat.store.ts / ai.ipc.ts 里的 normalizeAiDataBlockFences 逻辑一致。
function normalizeAiDataBlockFences(input: string): string {
  let src = input || ''
  if (!src) return src
  // 前置清洗：把"``` 换行 data_start;...;data_end"合并为"``` data_start;...;data_end"
  // 让 header 成为 fenced code 的 language 标识而不是 body 的第一行文本
  src = src.replace(
    /(^|\n)```[ \t]*\n(data_start;[^;\n]+;[^;\n]+;[^;\n]+;data_end)/g,
    '$1``` $2'
  )
  const rx = /data_start;[^;]+;[^;]+;[^;]+;data_end/gi
  const headers: number[] = []
  let m: RegExpExecArray | null
  while ((m = rx.exec(src)) !== null) headers.push(m.index)
  if (headers.length === 0) return src
  const parts: string[] = []
  let cursor = 0
  for (let i = 0; i < headers.length; i++) {
    const hStart = headers[i]
    let leading = src.slice(cursor, hStart)
    const fencesInLeading = (leading.match(/```/g) || []).length
    if (i === 0) {
      if (fencesInLeading === 0) leading = leading.replace(/\s*$/, '') + '\n``` '
    } else {
      const needed = 2 - fencesInLeading
      if (needed === 2) leading = leading.replace(/\s*$/, '') + '\n```\n\n``` '
      else if (needed === 1) leading = leading.replace(/\s*$/, '') + '\n``` '
    }
    parts.push(leading)
    cursor = hStart
  }
  let tail = src.slice(cursor)
  const tailFences = (tail.match(/```/g) || []).length
  if (tailFences === 0) tail = tail.replace(/\s*$/, '') + '\n```'
  parts.push(tail)
  return parts.join('')
}

// 提到组件外部为稳定引用，避免每次 render 传给 ReactMarkdown 都是新对象
const MD_REMARK_PLUGINS = [remarkGfm]
const MD_COMPONENTS = {
  // 外层 pre：如果子节点是 AI 数据块或 tool_call 块，则父容器退化（1px padding、无背景/边框）
  pre({ node, children, ...rest }: any) {
    if (isAiNovelDataCodeNode(node) || isToolCallCodeNode(node)) {
      return (
        <pre
          style={{
            background: 'transparent',
            border: 'none',
            borderRadius: 0,
            padding: 1,
            margin: "8px 0px",
            overflow: 'visible',
            whiteSpace: 'normal',
          }}
          {...rest}
        >
          {children as ReactNode}
        </pre>
      )
    }
    return <pre {...rest}>{children as ReactNode}</pre>
  },
  code({ inline, className: codeClass, children, node, ...rest }: any) {
    if (inline) {
      return <code className={codeClass} {...rest}>{children}</code>
    }
    const langMatch = /language-([^\s]+)/.exec(codeClass || '')
    const rawLang = langMatch?.[1] || ''
    const meta: string = node?.data?.meta || ''
    const fullInfo = `${rawLang}${meta ? ';' + meta : ''}`
    // 分支 A：AI 数据块（```data_start;...```）
    if (rawLang.startsWith('data_start') || fullInfo.startsWith('data_start')) {
      const body = String(children ?? '').replace(/\n$/, '')
      return <AiNovelDataBlock infoString={fullInfo} body={body} />
    }
    // 分支 B：tool_call / tool_calls / function_call 块 → 渲染成"正在调用 XX 工具"卡片
    if (/^(tool_call|tool_calls|function_call|fc)$/i.test(rawLang)) {
      const body = String(children ?? '').replace(/\n$/, '')
      return <ToolCallBlock body={body} />
    }
    return <code className={codeClass} {...rest}>{children}</code>
  },
}

/**
 * 只读 Markdown 渲染器。
 * 内部使用 react-markdown（+ remark-gfm），对流式增量输入友好。
 * 扩展点：对 fenced code block 中带 data_start 前缀的语言做自定义"AI 数据块"卡片渲染，
 * 且外层 <pre> 退化为无背景 1px padding 的透明容器。
 *
 * 性能：safeContent 通过 useMemo 只在 content 变化时重跑正则，外部包 React.memo，
 * 让 Agent 消息列表在无关状态变化（hover/toolCall 更新等）时不必重解析 AST。
 */
function MDXViewer({ content, className, style }: MDXViewerProps) {
  const safeContent = useMemo(
    () => ensureFencesBalanced(normalizeAiDataBlockFences(content || '')),
    [content],
  )
  return (
    <div className={`mdx-viewer-wrapper ${className || ''}`} style={style}>
      <div className="mdx-viewer-content">
        <ReactMarkdown remarkPlugins={MD_REMARK_PLUGINS} components={MD_COMPONENTS}>
          {safeContent}
        </ReactMarkdown>
      </div>
    </div>
  )
}

export default memo(MDXViewer, (prev, next) => (
  prev.content === next.content &&
  prev.className === next.className &&
  prev.style === next.style
))
