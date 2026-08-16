import { useState, useEffect } from 'react'
import { Modal, Checkbox, Typography, Button } from 'antd'
import {
  SafetyCertificateOutlined,
  DatabaseOutlined,
  ApiOutlined,
  WarningOutlined,
} from '@ant-design/icons'

const { Text, Title } = Typography

const DISCLAIMER_ACCEPTED_KEY = 'ainovel-disclaimer-accepted'
const DISCLAIMER_VERSION = 'v1'

const summaryItems = [
  {
    icon: <DatabaseOutlined style={{ color: '#4F46E5', fontSize: 18 }} />,
    title: '数据本地存储',
    description: '您的作品、大纲、设定、聊天记录和 API Key 均保存在本机，不上传服务器，不用于训练。',
  },
  {
    icon: <ApiOutlined style={{ color: '#7C3AED', fontSize: 18 }} />,
    title: '不提供 AI 服务',
    description: '本软件是开源本地工具，AI 能力来自您自行配置的第三方模型服务商，费用与合规由您自行负责。',
  },
  {
    icon: <WarningOutlined style={{ color: '#B45309', fontSize: 18 }} />,
    title: 'AIGC 内容免责',
    description: '大模型生成的内容可能包含不准确或不完整的信息，您对使用和传播这些内容承担全部责任。',
  },
  {
    icon: <SafetyCertificateOutlined style={{ color: '#10B981', fontSize: 18 }} />,
    title: '用途合规',
    description: '请勿使用本软件生成违反当地法律法规、侵犯他人版权或平台规则的内容。',
  },
]

/** 年龄提示条目（单独渲染，视觉上更醒目） */
const ageNotice = {
  icon: <WarningOutlined style={{ color: '#DC2626', fontSize: 18 }} />,
  title: '年龄提示',
  description: '本软件建议 16 岁以上用户使用。大模型生成的内容可能含有不适合未成年人的信息，请监护人妥善监管。',
}

export default function DisclaimerModal() {
  const [visible, setVisible] = useState(false)
  const [confirmDecline, setConfirmDecline] = useState(false)
  const [agreed, setAgreed] = useState(false)

  useEffect(() => {
    const accepted = localStorage.getItem(DISCLAIMER_ACCEPTED_KEY)
    if (!accepted || accepted !== DISCLAIMER_VERSION) {
      setVisible(true)
    }
  }, [])

  const handleAgree = () => {
    localStorage.setItem(DISCLAIMER_ACCEPTED_KEY, DISCLAIMER_VERSION)
    setVisible(false)
  }

  const handleDecline = () => {
    setConfirmDecline(true)
  }

  const handleConfirmDecline = () => {
    setConfirmDecline(false)
    setVisible(false)
    // 触发主进程退出
    try {
      window.api?.app?.quit?.()
    } catch (e) {
      // 兜底：开发环境或非 Electron 环境直接刷新
      window.location.reload()
    }
  }

  return (
    <>
    <Modal
      open={visible}
      closable={false}
      centered
      width={720}
      maskClosable={false}
      destroyOnHidden
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 28px 16px' }}>
          <Button onClick={handleDecline} danger>
            不同意并退出
          </Button>
          <Button
            type="primary"
            onClick={handleAgree}
            disabled={!agreed}
            style={{ background: agreed ? '#4F46E5' : undefined }}
          >
            我已阅读并同意
          </Button>
        </div>
      }
      styles={{
        body: { padding: '20px 28px 8px', maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' },
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 12px',
          }}
        >
          <span style={{ fontSize: 26, color: '#fff', fontWeight: 700 }}>稿</span>
        </div>
        <Title level={4} style={{ margin: 0 }}>
          稿府 Lab · 使用须知
        </Title>
        <Text type="secondary" style={{ fontSize: 13 }}>
          请在使用前阅读以下条款
        </Text>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {summaryItems.map((item) => (
          <div
            key={item.title}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              padding: '8px 12px',
              background: '#F9FAFB',
              borderRadius: 8,
            }}
          >
            <div style={{ flexShrink: 0, marginTop: 1 }}>{item.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 1 }}>
                {item.title}
              </div>
              <div style={{ fontSize: 12, color: '#4B5563', lineHeight: 1.55 }}>{item.description}</div>
            </div>
          </div>
        ))}
      </div>

      {/* 年龄提示 — 独立红色边框区域 */}
      <div
        style={{
          padding: '10px 14px',
          background: '#FEF2F2',
          borderRadius: 8,
          border: '1px solid #FECACA',
          marginBottom: 12,
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}
      >
        <div style={{ flexShrink: 0, marginTop: 1 }}>{ageNotice.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#DC2626', marginBottom: 1 }}>
            {ageNotice.title}
          </div>
          <div style={{ fontSize: 12, color: '#991B1B', lineHeight: 1.55 }}>{ageNotice.description}</div>
        </div>
      </div>

      <div style={{ padding: '10px 0 4px' }}>
        <Checkbox
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          style={{ fontSize: 13 }}
        >
          <Text style={{ fontSize: 13 }}>
            我已阅读并理解上述条款、<Text strong>隐私政策</Text>和<Text strong>用户协议</Text>，同意遵守相关规定
          </Text>
        </Checkbox>
      </div>
    </Modal>

    <Modal
      open={confirmDecline}
      onCancel={() => setConfirmDecline(false)}
      centered
      width={400}
      title={
        <span>
          <WarningOutlined style={{ color: '#B45309', marginRight: 6 }} />
          确认退出
        </span>
      }
      okText="退出软件"
      cancelText="返回"
      okButtonProps={{ danger: true }}
      onOk={handleConfirmDecline}
    >
      <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.7 }}>
        您需要同意免责条款才能使用本软件。点击「退出软件」将立即关闭稿府 Lab。
      </div>
    </Modal>
  </>
  )
}
