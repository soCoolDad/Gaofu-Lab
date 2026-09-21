import { Modal } from 'antd'
import SkillManagerPanel from '@/components/SkillManagerPanel'

/**
 * AI 技能管理弹窗（编辑器「用技能处理」内使用）。
 * 核心管理 UI 在 SkillManagerPanel；全局管理页在 src/pages/SkillManager。
 */
export default function SkillManagerModal({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged?: () => void }) {
  return (
    <Modal
      title="AI 技能管理"
      open={open}
      onCancel={onClose}
      footer={null}
      width={780}
      centered
      destroyOnClose
      // 固定高度让面板内部撑满：表格超出时在表格内部滚动，而不是撑高整个弹窗
      styles={{ body: { height: '62vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', paddingTop: 8 } }}
    >
      <SkillManagerPanel onChanged={onChanged} />
    </Modal>
  )
}
