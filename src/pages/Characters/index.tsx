import { TeamOutlined } from '@ant-design/icons'
import BookSettingEntryPage from '@/components/BookSettingEntryPage'

export default function CharactersPage() {
  return (
    <BookSettingEntryPage
      type="characters"
      title="角色管理"
      subtitle="管理作品人物设定、角色定位、人物动机和成长弧光"
      listTitle="全部角色"
      emptyText="还没有角色，点击新建角色开始设定"
      createText="新建角色"
      nameLabel="角色名称"
      namePlaceholder="例如：林深"
      descriptionPlaceholder="简要描述角色身份、目标或故事作用"
      detailPlaceholder="填写外貌、性格、背景、动机、关系、成长弧光、关键秘密等详细设定"
      icon={<TeamOutlined />}
      color="#4F46E5"
      background="#EEF2FF"
    />
  )
}
