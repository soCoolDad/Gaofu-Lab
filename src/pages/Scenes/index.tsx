import { BankOutlined } from '@ant-design/icons'
import BookSettingEntryPage from '@/components/BookSettingEntryPage'

export default function ScenesPage() {
  return (
    <BookSettingEntryPage
      type="scenes"
      title="场景管理"
      subtitle="管理作品中的关键场景、氛围模板、冲突现场与剧情舞台"
      listTitle="全部场景"
      emptyText="还没有场景，点击新建场景开始设定"
      createText="新建场景"
      nameLabel="场景"
      namePlaceholder="例如：海底列车失控夜"
      descriptionPlaceholder="简要描述场景氛围、冲突或故事作用"
      detailPlaceholder="填写场景地点、参与角色、情绪基调、核心冲突、关键转折和后果等详细简介"
      icon={<BankOutlined />}
      color="#2563EB"
      background="#EFF6FF"
    />
  )
}
