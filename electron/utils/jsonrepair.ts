/**
 * 轻量 JSON repair 工具：替代第三方 jsonrepair 依赖。
 *
 * 目标不是做 100% 完备的 JSON 修复器，而是覆盖 AI 模型最常输出的 5 类不合法 JSON：
 *   1. 字符串里混用单引号（key 或 value）→ 转成双引号
 *   2. 无引号的裸 key（JS object 写法）→ 补上双引号
 *   3. 对象/数组末尾的尾逗号（trailing comma）→ 去掉
 *   4. 字符串值内部出现未转义的换行或双引号 → 转义掉
 *   5. 被 ```json 代码块 / Markdown 包裹（仅作为兜底清理，非核心路径）
 *
 * 修复失败时抛错，调用方用 try/catch 回退到"无法解析"分支，
 * 这与之前 jsonrepair 的行为完全一致，不影响上层语义。
 *
 * 本文件独立、无第三方依赖，确保打包（asar）后不会出现 MODULE_NOT_FOUND。
 *
 * 重要约束：jsonrepair 必须「自包含」——不能引用任何模块级变量/函数，
 * 只能引用全局（JSON/Error/RegExp）。model-caller 通过 jsonrepair.toString()
 * 把它注入 Worker（eval 模式下拿不到模块作用域），引用外部标识符会直接 ReferenceError。
 */

export function jsonrepair(input: any): string {
  if (typeof input !== 'string') {
    throw new Error('jsonrepair: input must be a string')
  }

  const findLastNonSpace = (buf: string[]): number => {
    for (let k = buf.length - 1; k >= 0; k--) {
      if (!/^\s$/.test(buf[k])) return k
    }
    return -1
  }

  const trimTrailingComma = (buf: string[]): void => {
    // 从后往前：跳过空白，若是 ',' 就去掉
    let k = buf.length - 1
    while (k >= 0 && /^\s$/.test(buf[k])) k--
    if (k >= 0 && buf[k] === ',') {
      buf.splice(k, 1)
    }
  }

  // 1) 外层 markdown 代码块清理（```json ... ``` / ``` ... ```）
  let src = input.trim()
  if (src.startsWith('```')) {
    src = src.replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/```$/, '').trim()
  }

  // 2) 先试直接 parse，本来就是合法 JSON 直接返回，避免任何改动
  try {
    JSON.parse(src)
    return src
  } catch {
    // 继续修复
  }

  // 3) 字符级扫描修复：用状态机区分"在字符串内"与"在结构里"
  //    识别出：
  //      - 字符串的起止位置（遇到 '"'、"'"）
  //      - 在字符串内：把未转义的 '"'、换行、反斜杠修正
  //      - 在结构内：把单引号当作字符串定界符 → 改成双引号
  //                   把 尾逗号（逗号后面紧跟 ] 或 } 或 EOF）移除
  //                   把 裸 key（冒号前面的 identifier）补上双引号
  const out: string[] = []
  const n = src.length
  let i = 0
  // 字符栈
  const stack: Array<'{' | '['> = []

  const inObject = (): boolean => stack.length > 0 && stack[stack.length - 1] === '{'
  const inArray = (): boolean => stack.length > 0 && stack[stack.length - 1] === '['

  // 找出最近一次结构输出的位置，用于"裸 key"检测时截取
  // 我们采用更简单的思路：不在字符串时，当遇到 ":"，
  // 回溯 out 中最后一个连续 [A-Za-z0-9_$-]，给它裹上 ""
  while (i < n) {
    const ch = src[i]

    // —— 结构区（不在字符串内）—————————————————————————————
    if (ch === '"') {
      // 开始一个双引号字符串，按 JSON 规则原样走，遇到字符串内裸引号/换行做修复
      out.push('"')
      i++
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (i >= n) {
          // 字符串没闭合，补一个双引号结束
          out.push('"')
          break
        }
        const c = src[i]
        if (c === '\\') {
          out.push(c)
          i++
          if (i < n) { out.push(src[i]); i++ }
          continue
        }
        if (c === '"') {
          // 字符串结束。这里必须做 1 位前瞻判断：
          //   - 下一个非空白字符如果是 : , } ] 或 EOF，说明这才是真结束
          //   - 否则这是字符串内部未转义的双引号，应该写成 \"
          // 但是在"修复"语义下，AI 常把中文逗号、特殊字符混进去，
          // 我们只做"最保守"的判断：下一个非空白字符属于 JSON 结构符就认为结束
          let j = i + 1
          while (j < n && /\s/.test(src[j])) j++
          const next = j < n ? src[j] : ''
          if (next === '' || next === ':' || next === ',' || next === '}' || next === ']') {
            out.push('"')
            i++
            break
          } else {
            // 当作字符串内的未转义双引号 → 转义
            out.push('\\"')
            i++
            continue
          }
        }
        if (c === '\n' || c === '\r' || c === '\t') {
          // 字符串内未转义的控制字符 → 转义
          if (c === '\n') out.push('\\n')
          else if (c === '\r') out.push('\\r')
          else out.push('\\t')
          i++
          continue
        }
        out.push(c)
        i++
      }
      continue
    }

    if (ch === "'") {
      // 单引号被当作字符串边界 → 改成双引号，并按同样规则扫描内部
      out.push('"')
      i++
      while (true) {
        if (i >= n) { out.push('"'); break }
        const c = src[i]
        if (c === '\\') {
          out.push(c); i++
          if (i < n) { out.push(src[i]); i++ }
          continue
        }
        if (c === "'") {
          let j = i + 1
          while (j < n && /\s/.test(src[j])) j++
          const next = j < n ? src[j] : ''
          if (next === '' || next === ':' || next === ',' || next === '}' || next === ']') {
            out.push('"'); i++; break
          } else {
            out.push("'"); i++; continue
          }
        }
        if (c === '"') {
          // 单引号字符串内的双引号：JSON 字符串里可以直接放，但这里保持与原逻辑一致，不转义也 OK
          // 因为外面是双引号包裹，双引号必须转义
          out.push('\\"'); i++; continue
        }
        if (c === '\n' || c === '\r' || c === '\t') {
          if (c === '\n') out.push('\\n')
          else if (c === '\r') out.push('\\r')
          else out.push('\\t')
          i++
          continue
        }
        out.push(c); i++
      }
      continue
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch as any)
      out.push(ch); i++
      continue
    }
    if (ch === '}') {
      // 去尾逗号：如果 out 最后一个非空白是 ','，把它删掉
      trimTrailingComma(out)
      if (stack.length && stack[stack.length - 1] === '{') stack.pop()
      out.push('}'); i++
      continue
    }
    if (ch === ']') {
      trimTrailingComma(out)
      if (stack.length && stack[stack.length - 1] === '[') stack.pop()
      out.push(']'); i++
      continue
    }

    // 裸 key 识别：在 object 内、且当前字符属于 [A-Za-z_$]，
    // 且向前回溯"最后一个非空白字符"是 { 或 ,（刚开了个新 key）
    if (inObject() && /[A-Za-z_$]/.test(ch)) {
      // 找到 out 末尾的非空白字符
      const lastNonSpace = findLastNonSpace(out)
      const prevChar = lastNonSpace >= 0 ? out[lastNonSpace] : ''
      if (prevChar === '{' || prevChar === ',') {
        // 读取完整 identifier（允许 ASCII 字母数字 _ $ - 用于带 dash 的 key 也能修）
        const start = i
        while (i < n && /[A-Za-z0-9_$\-]/.test(src[i])) i++
        const key = src.slice(start, i)
        out.push('"', key, '"')
        continue
      }
    }

    // 数字 / true / false / null 这种直接原样输出都 OK，正则化没意义
    // 直接 push
    out.push(ch)
    i++
  }

  // 4) 扫完后仍可能有末尾逗号悬在最后（外层结构没闭合也算合法 JSON5 不合法 JSON），
  //    统一对 ] } 前的尾逗号再扫一遍
  const finalStr = out.join('').replace(/,(\s*[}\]])/g, '$1')

  // 5) 验证：修完再 parse 一次，不行就抛错，让上层走"解析失败"分支
  JSON.parse(finalStr)
  return finalStr
}

export default jsonrepair
