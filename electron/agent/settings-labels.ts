/**
 * 设定类型中英映射
 *
 * 单一来源：所有用到 'characters' | 'locations' | 'items' | ... 的地方都从这里 import，
 * 避免前端、工具层、apply-hooks 各维护一份不一致的映射。
 */

export const SETTING_TYPE_LABELS: Record<string, string> = {
  characters: '角色',
  locations: '地点',
  items: '物品',
  skills: '技能',
  scenes: '场景',
  factions: '势力',
  systems: '体系',
  inspirations: '灵感',
  foreshadowings: '伏笔',
}

export function settingTypeLabel(type: string | null | undefined): string {
  if (!type) return '设定'
  return SETTING_TYPE_LABELS[type] || type
}
