import { useEffect, useState } from 'react'
import { Modal } from 'antd'
import MDXViewer from '@/components/MDXViewer'
import LICENSE_TEXT from '../../../LICENSE?raw'
import NOTICE_TEXT from '../../../NOTICE?raw'
import THIRD_PARTY_TEXT from '../../../THIRD_PARTY_LICENSES.md?raw'
import PRIVACY_TEXT from '../../../docs/PRIVACY.md?raw'
import TERMS_TEXT from '../../../docs/TERMS.md?raw'

const docKeyMap: Record<string, { title: string; content: string }> = {
  privacy: { title: '隐私政策', content: PRIVACY_TEXT },
  terms: { title: '用户协议', content: TERMS_TEXT },
  license: { title: 'Apache-2.0 许可证', content: LICENSE_TEXT },
  notice: { title: '版权声明', content: NOTICE_TEXT },
  thirdParty: { title: '第三方依赖许可', content: THIRD_PARTY_TEXT },
}

/**
 * 全局文档弹窗：监听 `open-doc-modal` 自定义事件，在任意页面直接打开隐私政策 / 用户协议，
 * 无需跳转设置页。设置页内的按钮也可直接 dispatch 同一事件。
 */
export default function DocModal() {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  useEffect(() => {
    const handler = (e: CustomEvent<{ title: string; docKey: string }>) => {
      const { docKey, title: evtTitle } = e.detail || {}
      const entry = docKeyMap[docKey]
      if (!entry) return
      setTitle(evtTitle || entry.title)
      setContent(entry.content)
      setOpen(true)
    }
    window.addEventListener('open-doc-modal', handler as EventListener)
    return () => window.removeEventListener('open-doc-modal', handler as EventListener)
  }, [])

  return (
    <Modal
      open={open}
      onCancel={() => setOpen(false)}
      title={title}
      footer={null}
      width={880}
      centered
      styles={{ body: { maxHeight: '70vh', overflow: 'auto', padding: '20px 24px' } }}
    >
      <MDXViewer content={content} />
    </Modal>
  )
}
