import { BulbOutlined } from '@ant-design/icons'
import BookSettingEntryPage from '@/components/BookSettingEntryPage'

export default function InspirationsPage() {
  return (
    <BookSettingEntryPage
      type="inspirations"
      title="灵感管理"
      subtitle="管理作品中的创意、桥段、台词、主题和临时想法"
      listTitle="全部灵感"
      emptyText="还没有灵感，点击新建灵感开始记录"
      createText="新建灵感"
      nameLabel="灵感"
      namePlaceholder="例如：主角第一次意识到世界是循环的"
      descriptionPlaceholder="一句话概括这个灵感的核心作用"
      detailPlaceholder="填写完整灵感内容、可用桥段、适用章节、关联人物和后续扩展方向"
      icon={<BulbOutlined />}
      color="#D97706"
      background="#FEF3C7"
    />
  )
}
