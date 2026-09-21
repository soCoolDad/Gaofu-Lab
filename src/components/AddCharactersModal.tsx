/**
 * 「添加角色」弹窗（剧情预演 / 角色聊天室共用）
 *
 * 交互：下方点按钮选中角色 → 上方以 Tag 列出已选顺序，Tag 可拖拽实时换位（HTML5 DnD，
 * 按鼠标 X 坐标找最近的目标 tag），叉号可单独移除。提交时按已选顺序返回 id 数组，
 * 调用方决定这个顺序的语义（剧情预演 = 发言顺序；聊天室 = 在场角色排序）。
 *
 * 原先这段实现内联在 pages/RoleDialogue/index.tsx（RunSetupModal），
 * 为了让聊天室的「添加角色」复用同一套交互（含可辨识的移除按钮），抽到这里共享。
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Modal, Tag, Typography } from 'antd'
import { CloseOutlined } from '@ant-design/icons'

const { Text } = Typography

export interface AddCharacterOption {
  id: string
  name: string
}

export function AddCharactersModal(props: {
  open: boolean
  /** 候选角色：只用到 id + name，MergedCharacter / ChatRoomSelectableCharacter 都兼容 */
  characters: AddCharacterOption[]
  onCancel: () => void
  onSubmit: (characterIds: string[]) => void
  /** 弹窗标题 */
  title?: string
  /** 已选列表上方的说明文案 */
  hint?: string
  /** 提交按钮文案 */
  okText?: string
  /** 候选为空时的提示（不传则不显示） */
  emptyOptionsText?: string
}) {
  const {
    open, characters, onCancel, onSubmit,
    title = '选择参与角色（可拖动排序）',
    hint = '按顺序依次自动生成：',
    okText = '确定',
    emptyOptionsText,
  } = props
  const [selected, setSelected] = useState<string[]>([])
  // 拖动中的角色 id（null = 没在拖）
  const [dragId, setDragId] = useState<string | null>(null)
  // 容器 ref：拖动期间用坐标实时重排 selected（让出真位置给用户看）
  const listContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open) setSelected([])
  }, [open])

  // 兜底：HTML5 dragend 在某些情况（drop 在浏览器外、用户按 ESC、drop 目标被拦截等）不触发，
  // 会导致 dragId 永远不为 null、tag 永远显示成"拖动中"样式。
  // 监听 document.dragend 强制清理，确保 dragId 一定会被重置。
  useEffect(() => {
    if (!open) return
    const onDocDragEnd = () => {
      setDragId((cur) => (cur ? null : cur))
    }
    document.addEventListener('dragend', onDocDragEnd)
    return () => document.removeEventListener('dragend', onDocDragEnd)
  }, [open])

  // 用鼠标 X 坐标找最接近的目标 tag（不依赖 e.target，永远准确）：
  //   - 鼠标 X 在第一个 tag 中心左侧 → before 第一个
  //   - 鼠标 X 在最后一个 tag 中心右侧 → after 最后一个
  //   - 否则找中心 X 最接近的 tag，pos 由左右决定
  const findDropTargetByX = (clientX: number, list: string[]): { id: string; pos: 'before' | 'after' } | null => {
    if (!listContainerRef.current) return null
    const tagEls = listContainerRef.current.querySelectorAll<HTMLElement>('[data-addcharacters-tag]')
    if (tagEls.length === 0) return null
    const metas: Array<{ id: string; centerX: number }> = []
    tagEls.forEach((el) => {
      const r = el.getBoundingClientRect()
      const id = el.getAttribute('data-addcharacters-tag')
      if (!id || !list.includes(id)) return
      metas.push({ id, centerX: r.left + r.width / 2 })
    })
    if (metas.length === 0) return null
    if (clientX <= metas[0].centerX) return { id: metas[0].id, pos: 'before' }
    const last = metas[metas.length - 1]
    if (clientX >= last.centerX) return { id: last.id, pos: 'after' }
    let best = metas[0]
    let bestDist = Math.abs(clientX - best.centerX)
    for (let i = 1; i < metas.length; i++) {
      const d = Math.abs(clientX - metas[i].centerX)
      if (d < bestDist) { best = metas[i]; bestDist = d }
    }
    return { id: best.id, pos: clientX < best.centerX ? 'before' : 'after' }
  }

  const toggle = (id: string) => {
    setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id])
  }

  // 拖动期间实时重排：把 source 从 list 里抽出，按 pos 插入到 target 附近。
  // 只有当"目标位置 ≠ 当前位置"时才 setState，避免每帧 setState 引起列表 reflow。
  const reorder = (sourceId: string, targetId: string, pos: 'before' | 'after') => {
    setSelected((s) => {
      const sIdx = s.indexOf(sourceId)
      if (sIdx === -1) return s
      const tIdx = s.indexOf(targetId)
      if (tIdx === -1) return s
      // 抽出 source
      const next = [...s]
      next.splice(sIdx, 1)
      // 重新计算 target 的新下标（splice 后原下标可能平移）
      const newTIdx = next.indexOf(targetId)
      if (newTIdx === -1) return s
      // 算 insertAt；source 原本在 target 之前且要插 before 时需 -1 修正
      const insertAt = pos === 'before' ? newTIdx : newTIdx + 1
      // 边界：insertAt === sIdx 说明没动，直接返回原数组避免无变化 setState
      if (insertAt === sIdx) return s
      next.splice(insertAt, 0, sourceId)
      return next
    })
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      footer={null}
      width={680}
      centered
    >
      <div style={{ marginBottom: 12 }}>
        <Text type="secondary">已选 {selected.length} 位角色，{hint}</Text>
      </div>
      <div
        ref={listContainerRef}
        style={{ marginBottom: 16, minHeight: 40, padding: 8, background: '#F9FAFB', borderRadius: 6 }}
        onDragOver={(e) => {
          // 容器接收 drop + 拖动期间实时重排（让出真位置）
          e.preventDefault()
          if (!dragId) return
          const t = findDropTargetByX(e.clientX, selected)
          if (!t || t.id === dragId) return
          // 实时调 reorder；reorder 内部会判断"位置没变就 return s"，避免每帧 setState
          reorder(dragId, t.id, t.pos)
        }}
        onDrop={(e) => {
          // drop 时已经实时重排过了（onDragOver 在最后一刻也调了 reorder），
          // 这里只需 e.preventDefault() 阻止默认行为，dragId 留给 onDragEnd 清理
          e.preventDefault()
        }}
      >
        {selected.length === 0 ? (
          <Text type="secondary">请从下方选择</Text>
        ) : (
          selected.map((id, idx) => {
            const c = characters.find((x) => x.id === id)
            if (!c) return null
            const isDragging = dragId === id
            return (
              <span
                key={id}
                style={{
                  position: 'relative',
                  display: 'inline-flex',
                  alignItems: 'center',
                  marginBottom: 4,
                  marginRight: 4,
                  // 拖动中的 tag 用 opacity 降低可见度（保留位置 + 不依赖 dragend 恢复），
                  // 配合上面 document.dragend 兜底监听，确保 dragId 一定会被清掉
                  opacity: isDragging ? 0.35 : 1,
                  cursor: isDragging ? 'grabbing' : 'grab',
                }}
              >
                <Tag
                  data-addcharacters-tag={id}
                  color="purple"
                  draggable
                  onDragStart={(e) => {
                    setDragId(id)
                    try { (e as any).nativeEvent?.dataTransfer?.setData('text/plain', id) } catch { /* 非关键 */ }
                  }}
                  onDragEnd={() => {
                    setDragId(null)
                  }}
                  style={{
                    padding: '4px 4px 4px 10px',
                    fontSize: 13,
                    marginBottom: 0,
                    userSelect: 'none',
                  }}
                >
                  <span style={{ marginRight: 4 }}>{idx + 1}. {c.name}</span>
                  {/* 移除按钮：Tag 是浅紫底（purple preset），图标必须用深色才有对比度；
                      常态 = 深紫图标 + 紫色淡底圆，hover = 实心红底白叉，确保一眼可见 */}
                  <span
                    role="button"
                    aria-label="移除该角色"
                    onClick={(e) => { e.stopPropagation(); toggle(id) }}
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: 'rgba(114, 46, 209, 0.14)',
                      color: '#722ED1',
                      cursor: 'pointer',
                      marginLeft: 4,
                      transition: 'background 0.15s, color 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      const t = e.currentTarget as HTMLElement
                      t.style.background = '#DC2626'
                      t.style.color = '#fff'
                    }}
                    onMouseLeave={(e) => {
                      const t = e.currentTarget as HTMLElement
                      t.style.background = 'rgba(114, 46, 209, 0.14)'
                      t.style.color = '#722ED1'
                    }}
                  >
                    <CloseOutlined style={{ fontSize: 10, fontWeight: 700 }} />
                  </span>
                </Tag>
              </span>
            )
          })
        )}
      </div>

      {characters.length === 0 ? (
        emptyOptionsText
          ? <div style={{ color: '#9CA3AF', fontSize: 12 }}>{emptyOptionsText}</div>
          : <Text type="secondary">暂无可选角色</Text>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {characters.map((c) => {
            const isSelected = selected.includes(c.id)
            return (
              <Button
                key={c.id}
                size="small"
                type={isSelected ? 'primary' : 'default'}
                onClick={() => toggle(c.id)}
              >
                {isSelected ? '✓ ' : ''}{c.name}
              </Button>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <Button onClick={onCancel}>取消</Button>
        <Button type="primary" disabled={selected.length === 0} onClick={() => onSubmit(selected)}>
          {okText}
        </Button>
      </div>
    </Modal>
  )
}
