import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'

const input = `\`\`\` data_start;book;edit;-;data_end
### 标题/书名
沉入深渊
#### 简介
黑暗深渊里的挣扎...
\`\`\``

const html = await unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeStringify)
  .process(input)
console.log(String(html))
