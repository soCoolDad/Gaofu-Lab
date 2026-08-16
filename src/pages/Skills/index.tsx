import { FireOutlined } from '@ant-design/icons'
import BookSettingEntryPage from '@/components/BookSettingEntryPage'

export default function SkillsPage() {
  return (
    <BookSettingEntryPage
      type="skills"
      title="技能管理"
      subtitle="管理作品中的能力体系、招式、天赋、法术与技能设定"
      listTitle="全部技能"
      emptyText="还没有技能，点击新建技能开始设定"
      createText="新建技能"
      nameLabel="技能"
      namePlaceholder="例如：深海回响"
      descriptionPlaceholder="简要描述技能效果、定位或故事作用"
      detailPlaceholder="填写技能来源、触发条件、消耗代价、限制、升级路径和剧情用途等详细简介"
      icon={<FireOutlined />}
      color="#DC2626"
      background="#FEF2F2"
    />
  )
}
