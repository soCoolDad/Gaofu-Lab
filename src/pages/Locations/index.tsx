import { EnvironmentOutlined } from '@ant-design/icons'
import BookSettingEntryPage from '@/components/BookSettingEntryPage'

export default function LocationsPage() {
  return (
    <BookSettingEntryPage
      type="locations"
      title="地点管理"
      subtitle="管理作品中的地图区域、重要场景与地点设定"
      listTitle="全部地点"
      emptyText="还没有地点，点击新建地点开始设定"
      createText="新建地点"
      nameLabel="地点"
      namePlaceholder="例如：沉入深海研究站"
      descriptionPlaceholder="简要描述地点定位、功能或故事作用"
      detailPlaceholder="填写地点环境、历史背景、势力归属、危险等级、关联剧情等详细简介"
      icon={<EnvironmentOutlined />}
      color="#059669"
      background="#ECFDF5"
    />
  )
}
