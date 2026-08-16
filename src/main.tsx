import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, App as AntdApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { HashRouter, useNavigate } from 'react-router-dom'
import App from './App'
import { themeConfig } from './theme/antdTheme'
import { loadAiSettings } from './stores/aiSettings.store'
import './theme/global.css'

// 启动时从 SQLite 加载 Agent（「知卷」）设置（覆盖默认值；首次运行会从旧 localStorage 迁移）
loadAiSettings()

function AppWrapper() {
  const navigate = useNavigate()

  useEffect(() => {
    const handleNavigate = (event: any) => {
      const path = event.detail?.path
      if (path) {
        navigate(path)
      }
    }

    window.addEventListener('navigate-to', handleNavigate)

    return () => {
      window.removeEventListener('navigate-to', handleNavigate)
    }
  }, [navigate])

  return <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <AntdApp>
        <HashRouter>
          <AppWrapper />
        </HashRouter>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
)
