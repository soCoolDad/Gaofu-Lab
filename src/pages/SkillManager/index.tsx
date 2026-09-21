import { Card, Typography } from 'antd'
import SkillManagerPanel from '@/components/SkillManagerPanel'

const { Title, Text } = Typography

/**
 * AI 技能（提示词技能）全局管理页：侧边栏「辅助资产 → AI 技能」。
 *
 * 注意与作品内的世界观「技能」页（/book/:bookId/skills）完全无关：
 * 这里的技能是全局通用的系统提示词（如 humanizer-zh 去 AI 味），
 * 在编辑器选中文本后通过「用技能处理」调用。
 */
export default function SkillManagerPage() {
  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0, fontWeight: 600 }}>AI 技能</Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          管理可导入的提示词技能，支持手动新建、GitHub 链接与 Zip 压缩包导入；编辑器选中文本后点「用技能处理」调用
        </Text>
      </div>
      <Card
        variant="borderless"
        style={{ borderRadius: 12, flex: 1, minHeight: 0, overflow: 'hidden' }}
        styles={{ body: { height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' } }}
      >
        <SkillManagerPanel />
      </Card>
    </div>
  )
}
