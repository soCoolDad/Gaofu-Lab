import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface AiNovelDataBlockProps {
  // 完整 info string（当前 UI 不再展示头部，参数保留以便未来扩展）
  infoString?: string
  // 代码块内部原始文本（不含围栏）
  body: string
}

// AI 数据块 body 预处理：让内层 markdown 对 remark-gfm 更稳定。
// AI 输出的中文文本经常带以下几种"隐形陷阱"，都会让 remark 把好好的 heading + 后续内容识别成 indented code block（灰色 pre）：
// - 行首 4+ 半角空格 / tab；
// - 行首/行尾 全角空格 U+3000、不换行空格 U+00A0、零宽字符 U+200B..U+200F、U+FEFF；
// - 尾部残留的 hard break 空格（两空格换行）导致 heading 被合并进上一段。
// 处理步骤：
// 1) 逐行去掉行首各类 whitespace（含全角/不换行/零宽）→ 保证任何 heading 都严格顶格；
// 2) 行尾同样清理；
// 3) 每个 ATX heading（#/##/###/####/#####/######）前后强制补一个空行；
// 4) 合并连续多空行；trim 首尾。
function preprocessAiBlockBody(input: string): string {
  const src = (input || '').replace(/^\uFEFF/, '')
  // 所有会被误识别为"行首 whitespace"的字符：半角空格、tab、全角空格 U+3000、不换行空格 U+00A0、零宽 U+200B..U+200F、U+FEFF
  const LEADING_WS = /^[\s\u3000\u00A0\u200B-\u200F\uFEFF]+/
  const TRAILING_WS = /[\s\u3000\u00A0\u200B-\u200F\uFEFF]+$/
  const cleaned = src.split('\n').map((line) => {
    // 先去掉行首所有 whitespace（这是灰色 pre 的元凶）
    let x = line.replace(LEADING_WS, '')
    // 再去掉行尾各种 whitespace（防止残留 hard break）
    x = x.replace(TRAILING_WS, '')
    return x
  })
  const out: string[] = []
  for (const line of cleaned) {
    const isHeading = /^#{1,6}\s+/.test(line)
    if (isHeading) {
      out.push('')      // heading 前强制空行
      out.push(line)
      out.push('')      // heading 后强制空行
    } else {
      out.push(line)
    }
  }
  // 合并连续空行为单个
  const merged: string[] = []
  let lastBlank = false
  for (const line of out) {
    const isBlank = line === ''
    if (isBlank && lastBlank) continue
    merged.push(line)
    lastBlank = isBlank
  }
  return merged.join('\n').trim()
}

export default function AiNovelDataBlock({ body }: AiNovelDataBlockProps) {
  const normalized = preprocessAiBlockBody(body)
  return (
    <div
      style={{
        border: '1px solid #E5E7EB',
        borderRadius: 8,
        background: '#FFFFFF',
        padding: '10px 12px',
        // 自动换行：长英文/URL 也强制断行，行内保留换行
        wordBreak: 'break-word',
        overflowWrap: 'anywhere',
        whiteSpace: 'normal',
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalized}</ReactMarkdown>
    </div>
  )
}
