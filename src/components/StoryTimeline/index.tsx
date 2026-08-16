import React, { useState, useMemo, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { Tooltip, Empty } from 'antd'

interface TimelineClip {
  id: string
  clipType: 'character' | 'location' | 'scene' | 'item' | 'skill' | 'faction' | 'system' | 'inspiration' | string
  entityId?: string
  entityName: string
  chapterId: string
  paragraphStart: number
  paragraphEnd: number
  status: string
  prevClipId: string | null
  nextClipId: string | null
  storylineGroup: string
}

interface ChapterInfo {
  id: string
  title: string
  sortOrder: number
  paragraphCount: number
  hasSnapshot: boolean
  storyTime?: string
}

interface StoryTimelineProps {
  bookId: string
  chapters: ChapterInfo[]
  clips: TimelineClip[]
  onChapterClick?: (chapterId: string) => void
  /** 可见章节区间变化回调（0-based 章节序号），供父层按需加载片段。仅在可见区间真正变化时才触发。 */
  onVisibleChapterRangeChange?: (fromIndex: number, toIndex: number) => void
  height?: number
}

// 命令式 API：暴露给外部页面调用（如"跳到第 X 章"）
export interface StoryTimelineHandle {
  /** 滚动到指定章节序号（0-based）。behavior 默认为 'smooth'。 */
  scrollToChapter: (chapterIndex: number, behavior?: ScrollBehavior) => void
  /** 滚动到章节 id */
  scrollToChapterId: (chapterId: string, behavior?: ScrollBehavior) => void
}

const typeColors: Record<string, { bar: string; text: string }> = {
  character: { bar: '#6366F1', text: '#FFFFFF' },
  location: { bar: '#14B8A6', text: '#FFFFFF' },
  scene: { bar: '#F59E0B', text: '#FFFFFF' },
  item: { bar: '#EC4899', text: '#FFFFFF' },
  skill: { bar: '#8B5CF6', text: '#FFFFFF' },
  faction: { bar: '#EF4444', text: '#FFFFFF' },
  system: { bar: '#0EA5E9', text: '#FFFFFF' },
  inspiration: { bar: '#84CC16', text: '#FFFFFF' },
}

const typeLabels: Record<string, string> = {
  character: '角色',
  location: '地点',
  scene: '场景',
  item: '物品',
  skill: '技能',
  faction: '势力',
  system: '体系',
  inspiration: '灵感',
}

// 轨道显示的固定优先顺序：只有实际存在的 clipType 才显示
// 场景紧跟角色，便于观察谁在什么场景中出现
const trackPriority: Array<string> = ['character', 'scene', 'location', 'item', 'skill', 'faction', 'system', 'inspiration']

const StoryTimelineInner = forwardRef<StoryTimelineHandle, StoryTimelineProps>(function StoryTimeline({
  bookId,
  chapters,
  clips,
  onChapterClick,
  onVisibleChapterRangeChange,
  height = 400,
}, ref) {
  const [hoveredClip, setHoveredClip] = useState<string | null>(null)
  const scrollContainerRef = React.useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  // 章节间距（单位宽度），支持在主线区滚轮缩放
  const [chapterUnit, setChapterUnit] = useState<number>(300)
  // 视口裁剪：当前可见的水平像素范围（世界坐标，相对内容起点），触发 clip 懒渲染
  // 初始给一个较大的范围，等 scroll 事件绑定后自动收敛
  const [viewport, setViewport] = useState<{ left: number; right: number }>({ left: 0, right: 4000 })
  // 主线组 DOM ref：滚动时用 ref 命令式同步更新 transform，跳过 React 重渲染，避免视觉抖动
  const mainLineGroupRef = React.useRef<SVGGElement>(null)
  // 左侧顶部空白 DOM ref：同上，与主线保持视觉对齐
  const labelTopSpacerRef = React.useRef<HTMLDivElement>(null)
  // 右键按住拖动：记录拖动起始位置与初始滚动位置
  const dragStateRef = React.useRef<{ dragging: boolean; startX: number; startY: number; scrollLeft: number; scrollTop: number }>({
    dragging: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0,
  })
  // 左键拖动章节点：记录起始 x 与起始 chapterUnit，禁用章节点 onClick
  const chapterDragRef = useRef<{ dragging: boolean; startX: number; startUnit: number; moved: boolean }>({
    dragging: false, startX: 0, startUnit: 0, moved: false,
  })
  // chapterUnit 的 ref 镜像：scroll effect 不依赖 chapterUnit（避免缩放时反复重绑监听），
  // 但 updateViewport 计算可见区间需要读取最新值，故用 ref 读取，避免捕获过期值。
  const chapterUnitRef = useRef(chapterUnit)
  chapterUnitRef.current = chapterUnit
  // 可见章节区间回调：用 ref 持有最新回调，避免 effect 因父层传入新函数而反复重绑
  const onRangeRef = useRef<((fromIndex: number, toIndex: number) => void) | undefined>(onVisibleChapterRangeChange)
  onRangeRef.current = onVisibleChapterRangeChange
  // 已上报的可见区间（用于去重，避免区间未变时重复触发父层加载）
  const lastRangeRef = useRef<{ from: number; to: number } | null>(null)

  const displayChapters = chapters || []
  const displayClips = clips || []

  const sortedChapters = useMemo(
    () => [...displayChapters].sort((a, b) => a.sortOrder - b.sortOrder),
    [displayChapters]
  )

  // 注册原生 wheel 事件（passive: false）：在主线区域滚轮时阻止默认滚动，改为缩放章节间距
  // 依赖 sortedChapters.length / displayClips.length：数据加载完 svg 挂载后能重新绑定
  useEffect(() => {
    const svg = svgRef.current
    const container = scrollContainerRef.current
    if (!svg || !container) return
    const handleWheel = (e: WheelEvent) => {
      const rect = svg.getBoundingClientRect()
      const y = e.clientY - rect.top
      // 主线上下 12px 范围内视为"主线区"（mainLineTop = 25）
      if (y > 25 + 12) return
      e.preventDefault()
      // 记录鼠标当前对应的世界坐标（相对内容起点）
      const containerRect = container.getBoundingClientRect()
      const mouseWorldX = container.scrollLeft + (e.clientX - containerRect.left) - 56 // labelWidth
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      setChapterUnit((prev) => {
        const next = Math.max(60, Math.min(1200, prev * factor))
        if (prev > 0) {
          const ratio = next / prev
          const newMouseWorldX = mouseWorldX * ratio
          const delta = newMouseWorldX - mouseWorldX
          requestAnimationFrame(() => {
            if (scrollContainerRef.current) {
              scrollContainerRef.current.scrollLeft += delta
            }
          })
        }
        return next
      })
    }
    svg.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      svg.removeEventListener('wheel', handleWheel)
    }
  }, [sortedChapters.length, displayClips.length])

  // 监听滚动容器：维护可视范围 state，用于 clip 视口裁剪懒渲染，并上报可见章节区间供父层按需加载片段。
  // 使用 rAF 节流避免高频更新。注意：本 effect 不依赖 chapterUnit —— 缩放只改变像素布局，不需要重绑监听。
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return
    let rafId: number | null = null
    const BUFFER = 800 // 视口两侧预渲染缓冲（像素）
    const updateViewport = () => {
      rafId = null
      if (!scrollContainerRef.current) return
      const sc = scrollContainerRef.current
      // 世界坐标 = scrollLeft（labelWidth 是 sticky 占位，不进 svg 内部；svg 内容起点即世界坐标 0）
      const left = sc.scrollLeft - BUFFER
      const right = sc.scrollLeft + sc.clientWidth + BUFFER
      setViewport((prev) => {
        if (prev.left === left && prev.right === right) return prev
        return { left, right }
      })
      // 由世界坐标换算可见章节区间（0-based），区间变化才上报父层，避免重复加载
      const n = sortedChapters.length
      if (n > 0 && onRangeRef.current) {
        const unit = chapterUnitRef.current
        const computeIdx = (worldX: number) => {
          const raw = Math.floor((worldX - leftMargin) / unit)
          return Math.max(0, Math.min(n - 1, raw))
        }
        const fromIndex = computeIdx(left)
        const toIndex = computeIdx(right)
        const last = lastRangeRef.current
        if (!last || last.from !== fromIndex || last.to !== toIndex) {
          lastRangeRef.current = { from: fromIndex, to: toIndex }
          onRangeRef.current(fromIndex, toIndex)
        }
      }
    }
    // 主线跟随垂直滚动：在 scroll 事件里同步（非 rAF）写 DOM，与浏览器滚动同步，避免抖动
    const onScroll = () => {
      const sc = scrollContainerRef.current
      if (sc) {
        const y = sc.scrollTop
        if (mainLineGroupRef.current) {
          mainLineGroupRef.current.setAttribute('transform', `translate(0, ${y})`)
        }
        if (labelTopSpacerRef.current) {
          // 用 transform 而非 top，避免触发布局回流
          labelTopSpacerRef.current.style.transform = `translateY(${y}px)`
        }
      }
      if (rafId != null) return
      rafId = requestAnimationFrame(updateViewport)
    }
    // 初始触发一次（同时完成首屏区间上报，触发父层加载可见范围片段）
    updateViewport()
    container.addEventListener('scroll', onScroll, { passive: true })
    // ResizeObserver 兜底：容器尺寸变化（如窗口调整）也要更新
    const ro = new ResizeObserver(() => updateViewport())
    ro.observe(container)
    return () => {
      container.removeEventListener('scroll', onScroll)
      ro.disconnect()
      if (rafId != null) cancelAnimationFrame(rafId)
    }
  }, [sortedChapters.length, displayClips.length])

  // 章节区间采用可缩放宽度：起点 → 第1章节点是第1章区间
  const chapterInfoById = useMemo(() => {
    const map: Record<string, { index: number; paragraphCount: number }> = {}
    sortedChapters.forEach((ch, idx) => {
      map[ch.id] = { index: idx, paragraphCount: Math.max(1, ch.paragraphCount || 1) }
    })
    return map
  }, [sortedChapters])

  const totalWidth = Math.max(sortedChapters.length * chapterUnit, 800)
  const labelWidth = 56
  const leftMargin = 20
  // 尾部预留：最后一章圆点后再多留 60% 章节宽度（且不小于 120px），用于放"最后一章"标签，
  // 让用户在剧情线末尾能明确看出"这里就是当前最新的一章"，而不是被圆点直接切在边界。
  const tailPad = Math.max(120, chapterUnit * 0.6)

  const mainLineTop = 25
  const subTrackHeight = 24
  const clipBarHeight = 6
  const clipHoverHeight = 18

  // 章节节点位置：起点(leftMargin) 之后依次是 leftMargin + (i+1)*chapterUnit
  const getChapterCenterX = (chapterIndex: number) => leftMargin + (chapterIndex + 1) * chapterUnit

  // 命令式 API：暴露给父组件调用（如"滚动到第 X 章"）
  useImperativeHandle(ref, () => ({
    scrollToChapter(chapterIndex: number, behavior: ScrollBehavior = 'smooth') {
      const container = scrollContainerRef.current
      if (!container) return
      const idx = Math.max(0, Math.min(chapterIndex, sortedChapters.length - 1))
      // 目标：让该章节的"起点"（即上一章圆点位置）落在可视窗口靠左
      // 布局关系：第 i 章的圆点 X = leftMargin + (i+1)*chapterUnit，实际是"第 i 章结尾" / "第 i+1 章起点"
      // 因此定位到第 idx 章 = 滚到 idx-1 的圆点位置；idx=0 时直接滚到 leftMargin（书首）
      const startX = idx === 0 ? leftMargin : getChapterCenterX(idx - 1)
      const LEFT_PAD = Math.max(16, chapterUnit * 0.05) // 章节起点前留一点小空隙
      const target = Math.max(0, startX - LEFT_PAD)
      container.scrollTo({ left: target, behavior })
    },
    scrollToChapterId(chapterId: string, behavior: ScrollBehavior = 'smooth') {
      const info = chapterInfoById[chapterId]
      if (!info) return
      this.scrollToChapter(info.index, behavior)
    },
  }), [sortedChapters.length, chapterUnit, chapterInfoById])

  // clip 坐标：把 chapterUnit 均分给本章 paragraphCount 段
  // 每段宽度 = chapterUnit / paragraphCount
  // clip.paragraphStart 是段落索引（0-based）
  // clip 起点 x = 章节起点 + paragraphStart × 每段宽度
  // clip 长度  = (paragraphEnd - paragraphStart + 1) × 每段宽度
  const getClipX = (clip: TimelineClip) => {
    const info = chapterInfoById[clip.chapterId]
    if (!info) return leftMargin
    const perPara = chapterUnit / info.paragraphCount
    const start = Math.max(0, Math.min(clip.paragraphStart, info.paragraphCount - 1))
    return leftMargin + info.index * chapterUnit + start * perPara
  }
  const getClipW = (clip: TimelineClip) => {
    const info = chapterInfoById[clip.chapterId]
    if (!info) return 0
    const perPara = chapterUnit / info.paragraphCount
    const start = Math.max(0, Math.min(clip.paragraphStart, info.paragraphCount - 1))
    const end = Math.max(start, Math.min(clip.paragraphEnd, info.paragraphCount - 1))
    return (end - start + 1) * perPara
  }

  // 轨道分配：算法逻辑与原像素版「完全一致」，仅把坐标空间从像素换成归一化坐标（与 chapterUnit 无关）。
  // 归一化坐标 nX = 章节序号 + 段落起点/段落数、nRight = 章节序号 + (段落终点+1)/段落数。
  // 因为 getClipX/getClipW 对全片段是「统一的 chapterUnit 线性缩放 + 固定 leftMargin 平移」，
  // 缩放只把整张图按比例放大/缩小、不改变任意两片段的相对重叠关系 → 归一化空间的重叠判定 == 像素空间，
  // 故轨道分配结果与旧算法逐字相同。唯一目的是让 tracks 不再依赖 chapterUnit：缩放/拖动章节点不再触发全量重算。
  // 打包规则（与旧版一致）：按 nX 升序；按章节分组、每章内部独立从轨道 0 起分配；同轨道用 .some 与已有片段逐一判重叠。
  const tracks = useMemo(() => {
    const result: Array<{ type: string; subTracks: TimelineClip[][] }> = []

    for (const type of trackPriority) {
      const typeClips = displayClips.filter(c => c.clipType === type)
      if (typeClips.length === 0) continue

      // 归一化几何：不依赖 chapterUnit
      const withGeom = typeClips.map((clip) => {
        const info = chapterInfoById[clip.chapterId]
        if (!info) return null
        const perCount = info.paragraphCount
        const start = Math.max(0, Math.min(clip.paragraphStart, perCount - 1))
        const end = Math.max(start, Math.min(clip.paragraphEnd, perCount - 1))
        const nX = info.index + start / perCount
        const nRight = info.index + (end + 1) / perCount
        return { clip, nX, nRight }
      }).filter((x): x is { clip: TimelineClip; nX: number; nRight: number } => x !== null)

      // 按归一化起点升序：起点越靠前越靠上
      withGeom.sort((a, b) => a.nX - b.nX)

      // 按章节分组，每章内部独立从轨道 0 开始分配
      const chapterGroups = new Map<string, typeof withGeom>()
      for (const item of withGeom) {
        const list = chapterGroups.get(item.clip.chapterId) || []
        list.push(item)
        chapterGroups.set(item.clip.chapterId, list)
      }

      const clipTrackMap = new Map<string, number>()
      for (const [, chapterClips] of chapterGroups) {
        // 与旧版完全一致的打包：每章内已按 nX 升序（起点靠前优先）；每轨道用 .some 与已有片段逐一判重叠
        const tracks: typeof withGeom[] = []
        for (const item of chapterClips) {
          let placed = false
          for (let i = 0; i < tracks.length; i++) {
            const overlap = tracks[i].some(
              (s) => !(item.nRight <= s.nX || s.nRight <= item.nX)
            )
            if (!overlap) {
              tracks[i].push(item)
              clipTrackMap.set(item.clip.id, i)
              placed = true
              break
            }
          }
          if (!placed) {
            tracks.push([item])
            clipTrackMap.set(item.clip.id, tracks.length - 1)
          }
        }
      }

      // 根据 clipTrackMap 构建全局 subTracks
      const maxTrack = clipTrackMap.size > 0
        ? Math.max(...Array.from(clipTrackMap.values()))
        : 0
      const subTracks: TimelineClip[][] = Array.from({ length: maxTrack + 1 }, () => [])
      for (const item of withGeom) {
        const trackIdx = clipTrackMap.get(item.clip.id)!
        subTracks[trackIdx].push(item.clip)
      }

      result.push({ type, subTracks })
    }

    return result
  }, [displayClips, chapterInfoById])

  const getTrackHeight = (track: { type: string; subTracks: TimelineClip[][] }) => {
    return track.subTracks.length * subTrackHeight
  }

  const contentHeight = useMemo(() => {
    let total = mainLineTop + 16
    for (const track of tracks) {
      total += getTrackHeight(track)
    }
    return total
  }, [tracks])

  const svgWidth = totalWidth + leftMargin + tailPad

  const trackTopOffsets = useMemo(() => {
    const offsets: number[] = []
    let y = mainLineTop + 16
    for (const track of tracks) {
      offsets.push(y)
      y += getTrackHeight(track)
    }
    return offsets
  }, [tracks])

  const hasChapters = sortedChapters.length > 0
  const hasClips = displayClips.length > 0

  if (!hasChapters) {
    return (
      <div
        style={{
          height,
          background: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span style={{ color: '#9CA3AF', fontSize: 13 }}>
              暂无章节数据，先创建章节后再来查看记忆线
            </span>
          }
        />
      </div>
    )
  }

  if (!hasClips) {
    return (
      <div
        style={{
          height,
          background: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <div style={{ color: '#9CA3AF', fontSize: 13, textAlign: 'center', lineHeight: 1.6 }}>
              <div>暂无记忆线数据</div>
              <div style={{ fontSize: 12, color: '#B0B8C4', marginTop: 4 }}>
                在编辑器点击「定稿」，由「知卷」生成记忆后自动出现
              </div>
            </div>
          }
        />
      </div>
    )
  }

  return (
    <div
      style={{
        height: height,
        background: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        ref={scrollContainerRef}
        style={{ flex: 1, overflowX: 'auto', overflowY: 'auto', position: 'relative', display: 'flex' }}
      >
        <div
          style={{
            position: 'sticky',
            left: 0,
            width: labelWidth,
            flexShrink: 0,
            background: '#FFFFFF',
            zIndex: 10,
            borderRight: '1px solid #F1F5F9',
          }}
        >
          {/* 顶部空白区：与主线区域高度对齐；用 ref + translateY 保持在容器顶部，跟主线视觉同步 */}
          <div
            ref={labelTopSpacerRef}
            style={{
              height: mainLineTop + 16,
              background: '#FFFFFF',
              position: 'relative',
              zIndex: 11,
              willChange: 'transform',
            }}
          />
          {tracks.map((track, idx) => {
            const trackHeight = getTrackHeight(track)
            return (
              <div
                key={track.type}
                style={{
                  height: trackHeight,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#6B7280',
                  background: idx % 2 === 1 ? '#F9FAFB' : '#FFFFFF',
                }}
              >
                {typeLabels[track.type]}
              </div>
            )
          })}
        </div>

        <div style={{ flexShrink: 0, position: 'relative' }}>
          {/* 主线 + 轨道合并到一个 SVG：整体一起垂直滚动，标签列与轨道永远对齐 */}
          <svg
            ref={svgRef}
            width={svgWidth}
            height={contentHeight}
            style={{ display: 'block', userSelect: 'none' }}
            onContextMenu={(e) => {
              // 阻止右键菜单，允许右键按住拖动
              e.preventDefault()
            }}
            onMouseDown={(e) => {
              // 右键（button === 2）按住开始拖动
              if (e.button !== 2) return
              const container = scrollContainerRef.current
              if (!container) return
              e.preventDefault()
              dragStateRef.current = {
                dragging: true,
                startX: e.clientX,
                startY: e.clientY,
                scrollLeft: container.scrollLeft,
                scrollTop: container.scrollTop,
              }
            }}
            onMouseMove={(e) => {
              // 章节点左键拖动：调整章节间距
              const chDrag = chapterDragRef.current
              if (chDrag.dragging) {
                const dx = e.clientX - chDrag.startX
                if (Math.abs(dx) > 2) chDrag.moved = true
                // 每 1px 位移对应 chapterUnit 变化：正向拖 → 变宽；反向拖 → 变窄
                const next = Math.max(60, Math.min(1200, chDrag.startUnit + dx))
                setChapterUnit(next)
                return
              }
              // 右键按住拖动
              const state = dragStateRef.current
              if (!state.dragging) return
              const container = scrollContainerRef.current
              if (!container) return
              const dx = e.clientX - state.startX
              const dy = e.clientY - state.startY
              container.scrollLeft = state.scrollLeft - dx
              container.scrollTop = state.scrollTop - dy
            }}
            onMouseUp={(e) => {
              if (e.button === 2) dragStateRef.current.dragging = false
              if (e.button === 0 && chapterDragRef.current.dragging) {
                // 左键抬起结束章节点拖动
                chapterDragRef.current.dragging = false
              }
            }}
            onMouseLeave={() => {
              dragStateRef.current.dragging = false
              chapterDragRef.current.dragging = false
            }}
          >
            {/* 主线组已移至 SVG 末尾渲染，以确保滚动时能盖在轨道 clip 之上 */}

            {/* 轨道背景 + 虚线 */}
            {tracks.map((track, trackIdx) => {
              const trackHeight = getTrackHeight(track)
              const isOdd = trackIdx % 2 === 1
              const trackStartY = trackTopOffsets[trackIdx]

              return (
                <g key={`bg-${track.type}`}>
                  <rect
                    x={0}
                    y={trackStartY}
                    width={svgWidth}
                    height={trackHeight}
                    fill={isOdd ? '#F9FAFB' : '#FFFFFF'}
                  />

                  {track.subTracks.map((subTrack, subIdx) => {
                    const subY = trackStartY + subIdx * subTrackHeight
                    return (
                      <line
                        key={`line-${track.type}-${subIdx}`}
                        x1={0}
                        y1={subY + subTrackHeight / 2}
                        x2={svgWidth}
                        y2={subY + subTrackHeight / 2}
                        stroke="#E5E7EB"
                        strokeWidth="1"
                        strokeDasharray="4 4"
                      />
                    )
                  })}
                </g>
              )
            })}

            {/* 章节点垂直虚线：从主线下方延伸到内容底部，作为剧情线的对齐参考（画在轨道背景之上，clip 之下） */}
            <g>
              {sortedChapters.map((chapter, idx) => {
                const x = getChapterCenterX(idx)
                return (
                  <line
                    key={`chapter-guide-${chapter.id}`}
                    x1={x}
                    y1={mainLineTop + 8}
                    x2={x}
                    y2={contentHeight}
                    stroke="#D1D5DB"
                    strokeWidth="1"
                    strokeDasharray="3 4"
                    pointerEvents="none"
                  />
                )
              })}
            </g>

            {/* 轨道 clips */}
            {tracks.map((track, trackIdx) => {
              const trackStartY = trackTopOffsets[trackIdx]
              const colors = typeColors[track.type]

              return (
                <g key={`bars-${track.type}`}>
                  {track.subTracks.map((subTrack, subIdx) => {
                    const subY = trackStartY + subIdx * subTrackHeight

                    return subTrack.map((clip) => {
                      const rawX = getClipX(clip)
                      const rawW = getClipW(clip)
                      // 视口裁剪：不在可视范围内的 clip 直接跳过（懒渲染）
                      if (rawX + rawW < viewport.left || rawX > viewport.right) return null
                      // 底层 rect 保持静态非 hover 尺寸；hover 展开由顶层影子 rect 承担
                      const barH = clipBarHeight
                      const minW = barH
                      const w = Math.max(rawW, minW)
                      const cx = rawX + Math.max(rawW, minW) / 2
                      const x = cx - w / 2
                      const barY = subY + (subTrackHeight - clipBarHeight) / 2
                      // Tooltip 详情
                      const tooltipContent = (
                        <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>{clip.entityName || '（未命名）'}</div>
                          <div style={{ color: 'rgba(255,255,255,0.85)' }}>类型：{typeLabels[clip.clipType] || clip.clipType}</div>
                          <div style={{ color: 'rgba(255,255,255,0.85)' }}>状态：{clip.status || '—'}</div>
                          <div style={{ color: 'rgba(255,255,255,0.85)' }}>段落：{clip.paragraphStart}–{clip.paragraphEnd}</div>
                        </div>
                      )

                      return (
                        <Tooltip key={clip.id} title={tooltipContent} placement="top" mouseEnterDelay={0.15}>
                          <g
                            style={{ cursor: 'pointer' }}
                            onMouseEnter={() => setHoveredClip(clip.id)}
                            onMouseLeave={() => setHoveredClip(null)}
                          >
                            <rect
                              x={x}
                              y={barY}
                              width={w}
                              height={barH}
                              rx={barH / 2}
                              fill={colors.bar}
                            />
                          </g>
                        </Tooltip>
                      )
                    })
                  })}
                </g>
              )
            })}

            {/* 顶层影子层：每个 clip 都渲染一份影子 rect，DOM 常驻不销毁、不排序。
                非 hover 时 opacity=0（完全透明，不覆盖任何其它 clip）；
                hover 时 opacity=1 + 展开尺寸，通过 CSS transition 平滑过渡（含 opacity）。
                因为 DOM 顺序始终保持稳定，浏览器不会在 DOM 移动时重置 transition 状态。 */}
            <g>
              {tracks.map((track, trackIdx) => {
                const trackStartY = trackTopOffsets[trackIdx]
                const colors = typeColors[track.type]
                return track.subTracks.map((subTrack, subIdx) => {
                  const subY = trackStartY + subIdx * subTrackHeight
                  return subTrack.map((clip) => {
                    const rawX = getClipX(clip)
                    const rawW = getClipW(clip)
                    // 视口裁剪：非 hover 且不在视口内的影子直接跳过；hover 中的强制保留（保证动画完整）
                    const isHovered = hoveredClip === clip.id
                    if (!isHovered && (rawX + rawW < viewport.left || rawX > viewport.right)) return null
                    const barH = isHovered ? clipHoverHeight : clipBarHeight
                    const minW = barH
                    const nameLength = (clip.entityName || '').length
                    const requiredW = nameLength > 0 ? nameLength * 11 + 16 : 0
                    const w = isHovered
                      ? Math.max(rawW, requiredW, minW)
                      : Math.max(rawW, clipBarHeight)
                    const baseCenterX = rawX + Math.max(rawW, clipBarHeight) / 2
                    const x = baseCenterX - w / 2
                    const barY = isHovered
                      ? subY + (subTrackHeight - clipHoverHeight) / 2
                      : subY + (subTrackHeight - clipBarHeight) / 2
                    return (
                      <g key={`shadow-${clip.id}`} style={{ pointerEvents: 'none' }}>
                        <rect
                          fill={colors.bar}
                          style={{
                            x,
                            y: barY,
                            width: w,
                            height: barH,
                            rx: barH / 2,
                            ry: barH / 2,
                            opacity: isHovered ? 1 : 0,
                            transition: `x 0.25s ease, y 0.25s ease, width 0.25s ease, height 0.25s ease, rx 0.25s ease, ry 0.25s ease, opacity ${isHovered ? '0.1s' : '0.25s'} ease`,
                          }}
                        />
                        {isHovered && clip.entityName && (
                          <text
                            x={x + 8}
                            y={barY + barH / 2 + 4}
                            fill={colors.text}
                            fontSize="11"
                            fontWeight="500"
                          >
                            {clip.entityName}
                          </text>
                        )}
                      </g>
                    )
                  })
                })
              })}
            </g>

            {/* 主线组：滚动时通过 ref 命令式 setAttribute('transform',...) 与浏览器滚动同步（避免 React 重渲染的一帧延迟造成抖动） */}
            {/* 放在 SVG 末尾以确保盖在轨道 clip 之上；用白色矩形覆盖下方 clip，避免"漏出"背景 */}
            <g ref={mainLineGroupRef} transform="translate(0, 0)" style={{ willChange: 'transform' }}>
              <rect x={0} y={0} width={svgWidth} height={mainLineTop + 16} fill="#FFFFFF" />
              <line
                x1={0}
                y1={mainLineTop}
                x2={sortedChapters.length > 0 ? getChapterCenterX(sortedChapters.length - 1) : svgWidth}
                y2={mainLineTop}
                stroke="#94A3B8"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <Tooltip title="起点" placement="top">
                <g style={{ cursor: 'pointer' }}>
                  <circle
                    cx={leftMargin}
                    cy={mainLineTop}
                    r={5}
                    fill="#64748B"
                  />
                </g>
              </Tooltip>
              {sortedChapters.map((chapter, idx) => (
                <Tooltip key={chapter.id} title={`第${idx + 1}章`} placement="top">
                  <g
                    style={{ cursor: 'ew-resize' }}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return
                      e.stopPropagation()
                      chapterDragRef.current = {
                        dragging: true,
                        startX: e.clientX,
                        startUnit: chapterUnit,
                        moved: false,
                      }
                    }}
                    onClick={() => {
                      if (chapterDragRef.current.moved) {
                        chapterDragRef.current.moved = false
                        return
                      }
                      onChapterClick?.(chapter.id)
                    }}
                  >
                    <circle
                      cx={getChapterCenterX(idx)}
                      cy={mainLineTop}
                      r={4}
                      fill={chapter.hasSnapshot ? '#3B82F6' : '#FFFFFF'}
                      stroke={chapter.hasSnapshot ? '#3B82F6' : '#94A3B8'}
                      strokeWidth="2"
                      style={{ transition: 'all 0.2s ease' }}
                    />
                  </g>
                </Tooltip>
              ))}
              {/* 「最后一章」标签：放在末尾预留区的中央，帮用户直观识别"这是最新一章之后的位置"。
                  只在存在章节时渲染。 */}
              {sortedChapters.length > 0 && (() => {
                const lastX = getChapterCenterX(sortedChapters.length - 1)
                const tailCenterX = lastX + tailPad / 2
                const tailStartX = lastX + 8
                const tailEndX = svgWidth - 8
                return (
                  <g pointerEvents="none">
                    <line
                      x1={tailStartX}
                      y1={mainLineTop}
                      x2={tailEndX}
                      y2={mainLineTop}
                      stroke="#CBD5E1"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      strokeLinecap="round"
                    />
                    <text
                      x={tailCenterX}
                      y={mainLineTop - 10}
                      textAnchor="middle"
                      fontSize={11}
                      fill="#94A3B8"
                      style={{ userSelect: 'none' }}
                    >
                      {/* 最新一章占位 */}
                    </text>
                  </g>
                )
              })()}
            </g>
          </svg>
        </div>
      </div>
    </div>
  )
})

// React.memo：父层翻页/状态变更重建数组时，若章节/片段引用未变则不重渲染、不重算 tracks；
// 配合父层 useMemo 缓存 chapters/clips 数组、useCallback 缓存 onChapterClick 生效。
const StoryTimeline = React.memo(StoryTimelineInner)
export default StoryTimeline
