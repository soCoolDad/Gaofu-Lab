import { InboxOutlined } from '@ant-design/icons'
import BookSettingEntryPage from '@/components/BookSettingEntryPage'

export default function ItemsPage() {
  return (
    <BookSettingEntryPage
      type="items"
      title="物品管理"
      subtitle="管理作品中的关键道具、装备、线索与特殊物品设定"
      listTitle="全部物品"
      emptyText="还没有物品，点击新建物品开始设定"
      createText="新建物品"
      nameLabel="物品"
      namePlaceholder="例如：黑匣子残片"
      descriptionPlaceholder="简要描述物品外观、用途或故事作用"
      detailPlaceholder="填写物品来源、能力限制、持有人、关联线索和剧情影响等详细简介"
      icon={<InboxOutlined />}
      color="#F97316"
      background="#FFF7ED"
    />
  )
}
