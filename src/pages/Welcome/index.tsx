import { Typography, Button } from 'antd'
import {
  PlusOutlined,
  MessageOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import './index.css'

const { Title, Text } = Typography

export default function WelcomePage() {
  const navigate = useNavigate()

  const handleCreateBook = () => {
    window.dispatchEvent(new Event('ainovel-open-create-book'))
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px',
      }}
    >
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: 24,
          background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 32,
        }}
      >
        <span style={{ fontSize: 48, color: '#fff', fontWeight: 700 }}>稿</span>
      </div>

      <Title level={2} style={{ margin: 0, fontWeight: 600, marginBottom: 12 }}>
        稿府 Lab
      </Title>

      <Text type="secondary" style={{ fontSize: 15, marginBottom: 40, textAlign: 'center' }}>
        让「知卷」常伴你的身边
      </Text>

      <div style={{ textAlign: 'center' }}>
        <Text type="secondary" style={{ fontSize: 13, marginRight: 8 }}>
          你可以
        </Text>
        <Button type="link" icon={<PlusOutlined />} onClick={handleCreateBook} style={{ paddingInline: 4 }}>
          新建书籍
        </Button>
        <Text type="secondary" style={{ fontSize: 13, marginInline: 2 }}>
          、
        </Text>
        <Button type="link" icon={<MessageOutlined />} onClick={() => navigate('/agent')} style={{ paddingInline: 4 }}>
          与「知卷」聊聊
        </Button>
      </div>
    </div>
  )
}
