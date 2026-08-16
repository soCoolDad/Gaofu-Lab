import { Button, Dropdown } from 'antd'
import { RobotOutlined, MenuOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { MenuProps } from 'antd'

interface Props {
  hasBook?: boolean
  rightCollapsed?: boolean
  onToggleRight?: () => void
}

export default function TitleBar({ hasBook, rightCollapsed, onToggleRight }: Props) {
  const navigate = useNavigate()
  const aiButtonActive = !!hasBook && !rightCollapsed
  const aiButtonTitle = hasBook ? (rightCollapsed ? '展开「知卷」' : '收起「知卷」') : '与「知卷」聊天'

  const handleAiClick = () => {
    if (hasBook && onToggleRight) {
      onToggleRight()
      return
    }
    navigate('/agent')
  }

  // 标题栏菜单项
  const handleMenuAction: MenuProps['onClick'] = ({ key }) => {
    switch (key) {
      case 'settings':
        navigate('/settings')
        break
      case 'devtools':
        window.api?.app?.devtools()
        break
      case 'welcome':
        navigate('/')
        break
      case 'privacy':
        // 通过自定义事件触发设置页打开隐私政策弹窗
        window.dispatchEvent(new CustomEvent('open-doc-modal', { detail: { title: '隐私政策', docKey: 'privacy' } }))
        break
      case 'terms':
        window.dispatchEvent(new CustomEvent('open-doc-modal', { detail: { title: '用户协议', docKey: 'terms' } }))
        break
      case 'about':
        navigate('/settings')
        break
      default:
        break
    }
  }

  const menuItems: MenuProps['items'] = [
    { key: 'settings', label: '设置' },
    { type: 'divider' },
    { key: 'devtools', label: '打开开发者工具' },
    { type: 'divider' },
    { key: 'privacy', label: '隐私政策' },
    { key: 'terms', label: '用户协议' },
    { type: 'divider' },
    { key: 'welcome', label: '欢迎页' },
    { type: 'divider' },
    { key: 'about', label: '关于稿府 Lab' },
  ]

  return (
    <div
      className="drag-region"
      style={{
        height: 44,
        background: '#FFFFFF',
        borderBottom: '1px solid #E5E7EB',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        position: 'relative',
      }}
    >
      {/* 居中：应用名称 */}
      <span
        style={{
          fontSize: 13,
          color: '#6B7280',
          fontWeight: 500,
          letterSpacing: 0.5,
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      >
        稿府 Lab
      </span>

      {/* 红灯后：菜单按钮 */}
      <div style={{ position: 'absolute', left: 76, top: '50%', transform: 'translateY(-50%)' }}>
        <Dropdown menu={{ items: menuItems, onClick: handleMenuAction }} trigger={['click']} placement="bottomLeft">
          <Button
            type="text"
            size="small"
            icon={<MenuOutlined />}
            className="no-drag"
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              color: '#6B7280',
              background: 'transparent',
              border: '1px solid transparent',
              boxShadow: 'none',
            }}
          />
        </Dropdown>
      </div>

      {/* 右侧：知卷按钮 + 占位（避免和红绿灯重叠） */}
      <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: 4 }}>
        <Button
          type="text"
          size="small"
          icon={<RobotOutlined />}
          onClick={handleAiClick}
          className="no-drag"
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            color: aiButtonActive ? '#4F46E5' : '#111827',
            background: aiButtonActive ? '#EEF2FF' : 'transparent',
            border: aiButtonActive ? '1px solid #C7D2FE' : '1px solid transparent',
            boxShadow: 'none',
          }}
        />
      </div>
    </div>
  )
}
