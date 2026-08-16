import { ThunderboltOutlined } from '@ant-design/icons'
import BookSettingEntryPage from '@/components/BookSettingEntryPage'

export default function ForeshadowingsPage() {
  return (
    <BookSettingEntryPage
      type="foreshadowings"
      title="伏笔管理"
      subtitle="管理作品中的伏笔、悬念、线索和回收计划"
      listTitle="全部伏笔"
      emptyText="还没有伏笔，点击新建伏笔开始记录"
      createText="新建伏笔"
      nameLabel="伏笔标题"
      namePlaceholder="例如：主角手上的神秘戒指"
      descriptionPlaceholder="一句话描述这个伏笔的核心内容和作用"
      detailPlaceholder="填写伏笔详情、铺垫方式、出现章节、回收章节、关联人物和后续发展"
      icon={<ThunderboltOutlined />}
      color="#DC2626"
      background="#FEE2E2"
    />
  )
}
