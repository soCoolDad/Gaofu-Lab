import { Modal, Tag } from 'antd'

/**
 * 章节记忆查看视图（v2 schema）
 *
 * 显示的数据结构对应 electron/agent/types.ts 里的 ChapterMemoryV2：
 *  - storyTime         故事时间
 *  - currentPlot       剧情接续点（lastPlot / lastLocation / lastScene）
 *  - characters[]      角色完整档案（originalSetting / personality / growthArc / vector / state）
 *  - sceneEntities     本章出场实体（characters / items / skills / factions / systems / events）
 *  - foreshadowing[]   本章伏笔
 *  - inspirationsUsed  本章融入的灵感
 *
 * 与旧的 snapshot.tracks / snapshot.locations / snapshot.events 结构完全不兼容 —— 老库若还保留
 * 旧数据，这个视图会显示空/部分字段。按项目规则不考虑旧数据兼容。
 */
interface SnapshotDetailViewProps {
  snapshotData: any | null
  previousSnapshotData?: any | null
  /** 当前章节的剧情线片段，用于纠正 currentPlot 中 AI 混用的场景/地点名称 */
  timelineClips?: Array<{ clipType: string; entityName: string; paragraphEnd?: number }>
}

interface SnapshotViewerModalProps extends SnapshotDetailViewProps {
  open: boolean
  onClose: () => void
  title?: string
}

const eventTypeLabelMap: Record<string, string> = {
  // 基础/通用
  discovery: '发现',
  investigation: '调查',
  attempted_communication: '尝试通讯',
  communication: '通讯',
  conversation: '对话',
  dialogue: '对话',
  discussion: '讨论',
  decision: '抉择',
  revelation: '揭露',
  realization: '醒悟',
  preparation: '准备',
  reflection: '反思',
  accident: '意外',
  // 冲突/战斗
  combat: '战斗',
  battle: '交战',
  war: '战争',
  skirmish: '小规模冲突',
  siege: '围攻',
  ambush: '伏击',
  duel: '决斗',
  assassination: '刺杀',
  conflict: '冲突',
  confrontation: '对峙',
  quarrel: '争吵',
  argument: '争论',
  // 行动/潜入
  exploration: '探索',
  reconnaissance: '侦察',
  stealth: '潜入',
  infiltration: '渗透',
  pursuit: '追捕',
  chase: '追逐',
  escape: '逃亡',
  flight: '逃窜',
  hunt: '狩猎',
  rescue: '救援',
  // 移动/相遇
  arrival: '抵达',
  departure: '离开',
  journey: '旅程',
  travel: '出行',
  reunion: '重逢',
  farewell: '离别',
  parting: '分别',
  separation: '分离',
  meeting: '会面',
  encounter: '偶遇',
  // 情感/关系
  confession: '告白',
  proposal: '求婚',
  marriage: '婚礼',
  courtship: '求爱',
  intimate_act: '亲密互动',
  affair_continuation: '私情延续',
  home_deception: '家庭欺瞒',
  break_up: '决裂',
  divorce: '离异',
  betrayal: '背叛',
  deception: '欺骗',
  conspiracy: '阴谋',
  plot: '算计',
  negotiation: '谈判',
  persuasion: '劝说',
  manipulation: '操纵',
  // 生老病死/伤愈
  birth: '诞生',
  death: '死亡',
  injury: '受伤',
  healing: '疗愈',
  recovery: '康复',
  illness: '染病',
  // 成长/修炼
  training: '修炼',
  breakthrough: '突破',
  awakening: '觉醒',
  transformation: '蜕变',
  summon: '召唤',
  sacrifice: '牺牲',
  // 胁迫/囚禁
  kidnapping: '绑架',
  imprisonment: '囚禁',
  release: '释放',
  torture: '拷问',
  interrogation: '审讯',
  exile: '流放',
  // 地位/权力
  promotion: '晋升',
  demotion: '贬谪',
  inheritance: '继承',
  coronation: '加冕',
  election: '选举',
  // 庆典/仪式
  celebration: '庆典',
  festival: '节庆',
  ritual: '仪式',
  prayer: '祈祷',
  prophecy: '预言',
  dream: '梦境',
  vision: '异象',
  omen: '预兆',
  // 灾难/奇迹
  disaster: '灾祸',
  catastrophe: '浩劫',
  miracle: '奇迹',
  creation: '创造',
  destruction: '毁灭',
  // 阵营
  alliance: '结盟',
  declaration: '宣战',
  truce: '休战',
  planning: '谋划',
  // 其他
  competition: '比试',
  tournament: '竞赛',
  graduation: '毕业',
  mourning: '哀悼',
}

// 角色关系类型 → 中文（查看页「与他人关系」标签）
const relationshipTypeLabelMap: Record<string, string> = {
  love: '爱恋',
  intimate: '亲密',
  crush: '暗恋',
  adore: '倾慕',
  affection: '好感',
  friendship: '友谊',
  ally: '盟友',
  companion: '同伴',
  partner: '搭档',
  family: '亲属',
  parent: '父母',
  sibling: '手足',
  rival: '对手',
  enemy: '仇敌',
  hatred: '仇恨',
  hostile: '敌对',
  dislike: '嫌隙',
  contempt: '鄙夷',
  mistrust: '猜忌',
  distrust: '不信任',
  respect: '敬重',
  admiration: '钦佩',
  mentor: '师长',
  student: '弟子',
  subordinate: '下属',
  superior: '上司',
  loyalty: '效忠',
  devotion: '忠心',
  obligation: '亏欠',
  gratitude: '感恩',
  indebted: '亏欠',
  fear: '畏惧',
  awe: '敬畏',
  curious: '好奇',
  suspicious: '疑心',
  neutral: '中立',
  acquaintance: '相识',
}

const sigLabelMap: Record<string, string> = { low: '低', medium: '中', high: '高', critical: '关键' }
const sigColorMap: Record<string, string> = { low: 'default', medium: 'blue', high: 'orange', critical: 'red' }
const actionLabelMap: Record<string, string> = { planted: '未回收', developing: '推进中', resolved: '已回收' }
const actionColorMap: Record<string, string> = { planted: 'warning', developing: 'processing', resolved: 'success' }

function joinNames(list?: Array<{ name?: string }>): string {
  if (!list || list.length === 0) return '—'
  return list.map((x) => x?.name || '').filter(Boolean).join('、')
}

function VectorBar({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(0, Math.min(100, value || 0))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ color: '#374151', minWidth: 40 }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: '#F1F5F9', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${clamped}%`, height: '100%', background: '#4F46E5' }} />
      </div>
      <span style={{ color: '#6B7280', minWidth: 28, textAlign: 'right' }}>{clamped}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  )
}

export function SnapshotDetailView({ snapshotData, previousSnapshotData = null, timelineClips }: SnapshotDetailViewProps) {
  const mem = snapshotData
  const prev = previousSnapshotData
  if (!mem) return null

  const currentPlot = mem.currentPlot || {}

  // 优先从 timelineClips 取场景/地点名称（clips 的类型分离比 AI 的 currentPlot 更准确）
  const lastClipByType = (type: string) =>
    (timelineClips || [])
      .filter((c) => c.clipType === type)
      .sort((a, b) => (b.paragraphEnd ?? 0) - (a.paragraphEnd ?? 0))[0]
  const clipLastLocationName = lastClipByType('location')?.entityName
  const clipLastSceneName = lastClipByType('scene')?.entityName
  const lastLocationName = clipLastLocationName || currentPlot.lastLocation?.name
  const lastSceneName = clipLastSceneName || currentPlot.lastScene?.name
  const sceneEntities = mem.sceneEntities || {}
  const characters: any[] = Array.isArray(mem.characters) ? mem.characters : []
  const foreshadowings: any[] = Array.isArray(mem.foreshadowing) ? mem.foreshadowing : []
  const inspirations: any[] = Array.isArray(mem.inspirationsUsed) ? mem.inspirationsUsed : []

  // 构建"内部 id → 展示名"映射：分析师给每个实体分配了稳定 id（如 c1/c2/i1/l1），
  // 事件的 participants、关系的 targetId 等字段引用的都是这些 id。
  // 展示时必须映射回名字，不能把 "c1" "l3" 之类的技术标识直接暴露给用户。
  const idToName = new Map<string, string>()
  const collect = (list?: Array<{ id?: string; name?: string }>) => {
    if (!list) return
    for (const x of list) {
      if (x?.id && x?.name) idToName.set(x.id, x.name)
    }
  }
  collect(characters)
  collect(sceneEntities.characters)
  collect(sceneEntities.items)
  collect(sceneEntities.skills)
  collect(sceneEntities.factions)
  collect(sceneEntities.systems)
  collect(sceneEntities.locations)
  collect(sceneEntities.scenes)
  if (currentPlot.lastLocation?.id && currentPlot.lastLocation?.name) idToName.set(currentPlot.lastLocation.id, currentPlot.lastLocation.name)
  if (currentPlot.lastScene?.id && currentPlot.lastScene?.name) idToName.set(currentPlot.lastScene.id, currentPlot.lastScene.name)
  for (const c of characters) {
    collect(c.state?.knownSkills)
    collect(c.state?.holds)
    if (c.state?.location?.id && c.state?.location?.name) idToName.set(c.state.location.id, c.state.location.name)
  }
  const resolveName = (idOrName: string): string => idToName.get(idOrName) || idOrName

  // 上一章角色状态映射，用于 diff（按 id 优先，回退到名字）
  const prevCharMap = new Map<string, any>()
  if (prev?.characters && Array.isArray(prev.characters)) {
    for (const c of prev.characters) prevCharMap.set(c.id || c.name || '', c)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 故事时间 */}
      {mem.storyTime && (
        <div style={{ padding: 12, background: '#F8FAFC', borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>故事时间</div>
          <div style={{ fontSize: 14, color: '#111827' }}>{mem.storyTime}</div>
        </div>
      )}

      {/* 剧情接续点 */}
      {(currentPlot.lastPlot || lastLocationName || lastSceneName || sceneEntities.locations?.length || sceneEntities.scenes?.length) && (
        <Section title="剧情接续点">
          <div style={{ padding: 12, background: '#F8FAFC', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {currentPlot.lastPlot && (
              <div style={{ fontSize: 13, color: '#111827' }}>
                <strong style={{ color: '#374151', marginRight: 6 }}>最后剧情：</strong>{currentPlot.lastPlot}
              </div>
            )}
            {lastLocationName && (
              <div style={{ fontSize: 13, color: '#111827' }}>
                <strong style={{ color: '#374151', marginRight: 6 }}>最后地点：</strong>{lastLocationName}
              </div>
            )}
            {lastSceneName && (
              <div style={{ fontSize: 13, color: '#111827' }}>
                <strong style={{ color: '#374151', marginRight: 6 }}>最后场景：</strong>{lastSceneName}
              </div>
            )}
            {/* 补充展示本章所有地点（sceneEntities.locations） */}
            {sceneEntities.locations?.length > 0 && (
              <div style={{ fontSize: 12, color: '#6B7280' }}>
                <strong style={{ color: '#374151', marginRight: 6 }}>本章地点：</strong>
                {sceneEntities.locations.map((l: any) => l.name + (l.description ? `（${l.description}）` : '')).join('、')}
              </div>
            )}
            {/* 补充展示本章所有场景（sceneEntities.scenes） */}
            {sceneEntities.scenes?.length > 0 && (
              <div style={{ fontSize: 12, color: '#6B7280' }}>
                <strong style={{ color: '#374151', marginRight: 6 }}>本章场景：</strong>
                {sceneEntities.scenes.map((s: any) => s.name + (s.summary ? `（${s.summary}）` : '')).join('、')}
              </div>
            )}
          </div>
        </Section>
      )}

      {/* 本章出场实体 */}
      {(sceneEntities.characters?.length || sceneEntities.items?.length || sceneEntities.skills?.length || sceneEntities.factions?.length || sceneEntities.systems?.length || sceneEntities.events?.length || sceneEntities.locations?.length || sceneEntities.scenes?.length) ? (
        <Section title="本章出场实体">
          <div style={{ padding: 12, background: '#F8FAFC', borderRadius: 8, display: 'grid', gridTemplateColumns: '80px 1fr', rowGap: 6, columnGap: 12, fontSize: 12 }}>
            {sceneEntities.locations?.length > 0 && (
              <>
                <span style={{ color: '#374151', fontWeight: 500 }}>地点</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {sceneEntities.locations.map((loc: any, idx: number) => (
                    <div key={idx} style={{ color: '#111827' }}>
                      {loc.name}{loc.description ? <span style={{ color: '#6B7280' }}>（{loc.description}）</span> : ''}
                    </div>
                  ))}
                </div>
              </>
            )}
            {sceneEntities.scenes?.length > 0 && (
              <>
                <span style={{ color: '#374151', fontWeight: 500 }}>场景</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {sceneEntities.scenes.map((sc: any, idx: number) => (
                    <div key={idx} style={{ color: '#111827' }}>
                      {sc.name}{sc.summary ? <span style={{ color: '#6B7280' }}>（{sc.summary}）</span> : ''}
                    </div>
                  ))}
                </div>
              </>
            )}
            {sceneEntities.characters?.length > 0 && (<><span style={{ color: '#374151', fontWeight: 500 }}>角色</span><span style={{ color: '#111827' }}>{joinNames(sceneEntities.characters)}</span></>)}
            {sceneEntities.items?.length > 0 && (<><span style={{ color: '#374151', fontWeight: 500 }}>物品</span><span style={{ color: '#111827' }}>{joinNames(sceneEntities.items)}</span></>)}
            {sceneEntities.skills?.length > 0 && (<><span style={{ color: '#374151', fontWeight: 500 }}>技能</span><span style={{ color: '#111827' }}>{joinNames(sceneEntities.skills)}</span></>)}
            {sceneEntities.factions?.length > 0 && (<><span style={{ color: '#374151', fontWeight: 500 }}>势力</span><span style={{ color: '#111827' }}>{joinNames(sceneEntities.factions)}</span></>)}
            {sceneEntities.systems?.length > 0 && (<><span style={{ color: '#374151', fontWeight: 500 }}>体系</span><span style={{ color: '#111827' }}>{joinNames(sceneEntities.systems)}</span></>)}
            {sceneEntities.events?.length > 0 && (
              <>
                <span style={{ color: '#374151', fontWeight: 500 }}>事件</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {sceneEntities.events.map((ev: any, idx: number) => (
                    <div key={idx} style={{ color: '#111827' }}>
                      <Tag color="blue">{eventTypeLabelMap[ev.type] || ev.type || '事件'}</Tag>
                      {ev.summary || ''}
                      {ev.participants?.length ? <span style={{ color: '#6B7280' }}>（参与：{ev.participants.map((p: string) => resolveName(p)).join('、')}）</span> : null}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </Section>
      ) : null}

      {/* 角色档案 */}
      {characters.length > 0 && (
        <Section title="角色本章末状态">
          {characters.map((c, idx) => {
            const state = c.state || {}
            const vec = c.vector
            const prevC = prevCharMap.get(c.id || c.name || '')
            const diffs: string[] = []
            if (prevC) {
              const prevState = prevC.state || {}
              if ((prevState.location?.name || '') !== (state.location?.name || '')) {
                diffs.push(`位置 ${prevState.location?.name || '未知'} → ${state.location?.name || '未知'}`)
              }
              if ((prevState.mood || '') !== (state.mood || '') && (prevState.mood || state.mood)) {
                diffs.push(`心境 ${prevState.mood || '—'} → ${state.mood || '—'}`)
              }
              const prevHolds = new Set((prevState.holds || []).map((h: any) => h.name))
              for (const h of (state.holds || [])) {
                if (!prevHolds.has(h.name)) diffs.push(`获得物品 ${h.name}`)
              }
              const currHolds = new Set((state.holds || []).map((h: any) => h.name))
              for (const h of (prevState.holds || [])) {
                if (!currHolds.has(h.name)) diffs.push(`失去物品 ${h.name}`)
              }
              if (prevC.growthArcCurrent && c.growthArc && prevC.growthArcCurrent !== c.growthArc) {
                diffs.push(`成长 ${prevC.growthArcCurrent} → ${c.growthArc}`)
              }
            }
            return (
              <div key={c.id || idx} style={{ padding: 12, background: '#F8FAFC', borderRadius: 8, marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Tag color="purple">角色</Tag>
                  <span style={{ fontWeight: 600, color: '#111827' }}>{c.name}</span>
                  {state.survival && <Tag color="default">{state.survival}</Tag>}
                  {state.injury?.hurt && <Tag color="red">{state.injury.severity || '受伤'}{state.injury.parts?.length ? `（${state.injury.parts.join('、')}）` : ''}</Tag>}
                </div>

                {c.originalSetting && (
                  <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.6, marginBottom: 6 }}>
                    <strong>原始设定：</strong>{c.originalSetting}
                  </div>
                )}
                {c.personality && (
                  <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>
                    <strong>性格：</strong>{c.personality}
                  </div>
                )}
                {c.growthArc && (
                  <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>
                    <strong>成长阶段：</strong>{c.growthArc}
                  </div>
                )}

                {vec && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '4px 12px', margin: '8px 0' }}>
                    <VectorBar label="忠诚" value={vec.loyalty} />
                    <VectorBar label="攻击" value={vec.aggression} />
                    <VectorBar label="理性" value={vec.rationality} />
                    <VectorBar label="信任" value={vec.trust} />
                    <VectorBar label="道德" value={vec.morality} />
                  </div>
                )}

                <div style={{ fontSize: 12, color: '#6B7280', display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
                  {state.location?.name && <span><strong style={{ color: '#374151' }}>位置：</strong>{state.location.name}</span>}
                  {state.mood && <span><strong style={{ color: '#374151' }}>心境：</strong>{state.mood}</span>}
                  {state.speechStyle && <span><strong style={{ color: '#374151' }}>说话风格：</strong>{state.speechStyle}</span>}
                </div>
                {state.knownSkills?.length > 0 && (
                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
                    <strong style={{ color: '#374151' }}>已掌握技能：</strong>{joinNames(state.knownSkills)}
                  </div>
                )}
                {state.holds?.length > 0 && (
                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
                    <strong style={{ color: '#374151' }}>持有物：</strong>{joinNames(state.holds)}
                  </div>
                )}
                {state.knows?.length > 0 && (
                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
                    <strong style={{ color: '#374151' }}>已知线索：</strong>{state.knows.join('；')}
                  </div>
                )}
                {state.relationships?.length > 0 && (
                  <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>
                    <strong style={{ color: '#374151' }}>与他人关系：</strong>
                    {state.relationships.map((r: any) => `${r.targetName || resolveName(r.targetId)}(${relationshipTypeLabelMap[r.type] || r.type} ${r.value >= 0 ? '+' : ''}${r.value})`).join('、')}
                  </div>
                )}

                {diffs.length > 0 && (
                  <div style={{ marginTop: 8, padding: 8, background: '#FFFBEB', borderRadius: 6, border: '1px solid #FEF3C7' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#92400E', marginBottom: 4 }}>本章变化</div>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#92400E' }}>
                      {diffs.map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )
          })}
        </Section>
      )}

      {/* 伏笔 */}
      {foreshadowings.length > 0 && (
        <Section title="伏笔">
          {foreshadowings.map((f, idx) => {
            const rawSig = String(f.significance || '').toLowerCase()
            const rawAction = String(f.action || '').toLowerCase()
            return (
              <div key={f.id || idx} style={{ padding: 12, background: '#FEFDF7', border: '1px solid #F5F1E4', borderRadius: 8, marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Tag color={actionColorMap[rawAction] || 'default'}>{actionLabelMap[rawAction] || f.action || '?'}</Tag>
                  <span style={{ fontWeight: 600, color: '#111827' }}>{f.description}</span>
                  {rawSig && <Tag color={sigColorMap[rawSig] || 'default'} style={{ marginLeft: 'auto' }}>{sigLabelMap[rawSig] || rawSig}</Tag>}
                </div>
                {f.relatedCharacters?.length > 0 && (
                  <div style={{ fontSize: 12, color: '#6B7280' }}>相关角色：{f.relatedCharacters.map((p: string) => resolveName(p)).join('、')}</div>
                )}
              </div>
            )
          })}
        </Section>
      )}

      {/* 灵感 */}
      {inspirations.length > 0 && (
        <Section title="本章融入的灵感">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {inspirations.map((insp, idx) => (
              <Tag key={insp.id || idx} color="green">{insp.name}</Tag>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

export default function SnapshotViewerModal({
  open,
  onClose,
  snapshotData,
  previousSnapshotData = null,
  timelineClips,
  title = '章节记忆查看',
}: SnapshotViewerModalProps) {
  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      width={860}
      centered
      footer={null}
    >
      <div style={{ maxHeight: 560, overflow: 'auto' }}>
        <SnapshotDetailView snapshotData={snapshotData} previousSnapshotData={previousSnapshotData} timelineClips={timelineClips} />
      </div>
    </Modal>
  )
}
