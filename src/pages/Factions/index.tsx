import { ApartmentOutlined } from '@ant-design/icons'
import BookSettingEntryPage from '@/components/BookSettingEntryPage'

export default function FactionsPage() {
  return (
    <BookSettingEntryPage
      type="factions"
      title="势力管理"
      subtitle="管理作品中的国家、组织、宗门、公司、家族、阵营与势力关系"
      listTitle="全部势力"
      emptyText="还没有势力，点击新建势力开始设定"
      createText="新建势力"
      nameLabel="势力"
      namePlaceholder="例如：深空航行者联盟"
      descriptionPlaceholder="简要描述势力定位、立场或故事作用"
      detailPlaceholder="填写势力成员、组织结构、资源版图、利益冲突、敌友关系和剧情影响等详细简介"
      icon={<ApartmentOutlined />}
      color="#7C3AED"
      background="#F3E8FF"
    />
  )
}
