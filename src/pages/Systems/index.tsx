import { PartitionOutlined } from '@ant-design/icons'
import BookSettingEntryPage from '@/components/BookSettingEntryPage'

export default function SystemsPage() {
  return (
    <BookSettingEntryPage
      type="systems"
      title="体系管理"
      subtitle="管理作品中的修炼体系、魔法体系、科技体系、等级制度、社会规则与世界规则"
      listTitle="全部体系"
      emptyText="还没有体系，点击新建体系开始设定"
      createText="新建体系"
      nameLabel="体系"
      namePlaceholder="例如：星核航行等级体系"
      descriptionPlaceholder="简要描述体系定位、规则或故事作用"
      detailPlaceholder="填写体系层级、运行规则、限制代价、晋升路径、社会影响和剧情约束等详细简介"
      icon={<PartitionOutlined />}
      color="#2563EB"
      background="#EFF6FF"
    />
  )
}
