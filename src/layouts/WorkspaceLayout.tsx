import { useEffect, useState, useRef, useCallback } from 'react'
import { Outlet, useLocation, useParams } from 'react-router-dom'
import { Layout, Button, Tooltip, Skeleton } from 'antd'
import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons'
import AppSidebar from '@/components/AppSidebar'
import WorkspaceMenu from '@/components/WorkspaceMenu'
import AgentPanel from '@/pages/Agent'
import TitleBar from '@/components/TitleBar'
import ResizeHandle from '@/components/ResizeHandle'
import { useWorkspaceStore } from '@/stores/workspace.store'

const { Sider, Content } = Layout

const WORKSPACE_LAYOUT_STATE_KEY = 'ainovel.workspace.layoutState'
const RIGHT_PANEL_MIN_WIDTH = 300
const RIGHT_PANEL_MAX_WIDTH = 500
const RIGHT_PANEL_DEFAULT_WIDTH = 340

function readLayoutState() {
  try {
    const saved = localStorage.getItem(WORKSPACE_LAYOUT_STATE_KEY)
    return saved ? JSON.parse(saved) : {}
  } catch {
    return {}
  }
}

export default function WorkspaceLayout() {
  const { bookId } = useParams()
  const location = useLocation()
  const currentBook = useWorkspaceStore((s) => s.currentBook)
  const workspaceLoading = useWorkspaceStore((s) => s.loading)
  const currentBookId = useWorkspaceStore((s) => s.currentBookId)
  const setCurrentBook = useWorkspaceStore((s) => s.setCurrentBook)
  const loadBooks = useWorkspaceStore((s) => s.loadBooks)

  // 折叠状态
  const [leftCollapsed, setLeftCollapsed] = useState(() => readLayoutState().leftCollapsed ?? true)
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(() => readLayoutState().workspaceCollapsed ?? true)
  const [rightCollapsed, setRightCollapsed] = useState(() => !!readLayoutState().rightCollapsed)
  const [rightPanelWidth, setRightPanelWidth] = useState(() => readLayoutState().rightPanelWidth || RIGHT_PANEL_DEFAULT_WIDTH)
  const isResizingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  // 初始化加载书籍列表
  useEffect(() => {
    loadBooks()
  }, [])

  // 路由变化时同步 currentBook
  useEffect(() => {
    if (bookId) {
      setCurrentBook(bookId)
    }
  }, [bookId])

  useEffect(() => {
    localStorage.setItem(WORKSPACE_LAYOUT_STATE_KEY, JSON.stringify({
      leftCollapsed,
      workspaceCollapsed,
      rightCollapsed,
      rightPanelWidth,
    }))
  }, [leftCollapsed, workspaceCollapsed, rightCollapsed, rightPanelWidth])

  const handleRightResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizingRef.current = true
    startXRef.current = e.clientX
    startWidthRef.current = rightPanelWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return
      const delta = startXRef.current - e.clientX
      const newWidth = Math.min(RIGHT_PANEL_MAX_WIDTH, Math.max(RIGHT_PANEL_MIN_WIDTH, startWidthRef.current + delta))
      setRightPanelWidth(newWidth)
    }

    const handleMouseUp = () => {
      isResizingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [rightPanelWidth])

  // 是否有选中书籍
  const hasBook = !!(currentBook && bookId)
  const isChatPage = location.pathname === '/chat'



  return (
    <Layout style={{ height: '100vh', background: '#F6F7FB' }}>
      <TitleBar
        hasBook={hasBook && !isChatPage}
        rightCollapsed={rightCollapsed}
        onToggleRight={() => setRightCollapsed(!rightCollapsed)}
      />
      <Layout style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* 左侧导航 */}
        <Sider
          width={leftCollapsed ? 64 : 260}
          collapsedWidth={64}
          collapsed={leftCollapsed}
          style={{
            background: '#FFFFFF',
            borderRight: '1px solid #E5E7EB',
            overflow: 'hidden',
            transition: 'width 0.2s',
            position: 'relative',
          }}
        >
          <AppSidebar collapsed={leftCollapsed} onCollapse={setLeftCollapsed} />
        </Sider>

        {/* 当前作品菜单（仅书籍页面显示） */}
        {hasBook && !isChatPage && (
          <Sider
            width={workspaceCollapsed ? 56 : 220}
            collapsedWidth={56}
            collapsed={workspaceCollapsed}
            style={{
              background: '#FFFFFF',
              borderRight: '1px solid #E5E7EB',
              overflow: 'hidden',
              transition: 'width 0.2s',
              position: 'relative',
            }}
          >
            <WorkspaceMenu
              bookTitle={currentBook?.title || ''}
              bookId={bookId || ''}
              collapsed={workspaceCollapsed}
            />
            <Tooltip title={workspaceCollapsed ? '展开' : '收起'} placement="right">
              <Button
                type="text"
                size="small"
                icon={workspaceCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setWorkspaceCollapsed(!workspaceCollapsed)}
                style={{
                  position: 'absolute',
                  bottom: 12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              />
            </Tooltip>
          </Sider>
        )}

        {/* 主内容区 */}
        <Content
          style={{
            padding: hasBook ? '20px 24px' : '24px',
            overflow: 'auto',
            background: '#F6F7FB',
            minWidth: 0,
            flex: 1,
          }}
        >
          {/* 切书期间显示骨架屏，避免"点了没反应"感（此时 store 正在拉章节/分卷/统计） */}
          {bookId && (workspaceLoading || currentBookId !== bookId) ? (
            <div style={{ padding: 8 }}>
              <Skeleton active title paragraph={{ rows: 2 }} />
              <div style={{ height: 16 }} />
              <Skeleton active title={false} paragraph={{ rows: 6 }} />
              <div style={{ height: 16 }} />
              <Skeleton active title={false} paragraph={{ rows: 6 }} />
            </div>
          ) : (
            <Outlet />
          )}
        </Content>

        {/* 「知卷」栏（仅书籍页面显示） */}
        {hasBook && !isChatPage && (
          <div
            style={{
              width: rightCollapsed ? 0 : rightPanelWidth,
              flexShrink: 0,
              position: 'relative',
              transition: rightCollapsed ? 'width 0.2s' : 'none',
              overflow: 'hidden',
            }}
          >
            {!rightCollapsed && (
              <ResizeHandle
                orientation="vertical"
                onResizeStart={handleRightResizeStart}
                title="拖动调整知卷面板宽度"
              />
            )}
            <div style={{ width: '100%', height: '100%', background: '#FFFFFF', overflow: 'hidden', borderLeft: '1px solid #E5E7EB' }}>
              <AgentPanel isPanel />
            </div>
          </div>
        )}
      </Layout>
    </Layout>
  )
}