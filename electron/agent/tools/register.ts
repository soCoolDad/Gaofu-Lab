/**
 * 工具注册入口
 *
 * 导入所有工具并注册到注册表
 */

import { registerTools } from './index'
import { crudTools } from './crud.tools'
import { snapshotTools } from './snapshot.tools'
import { confirmationTools } from './confirmation.tool'

/** 注册所有 Agent 工具
 */
export function registerAllTools() {
  registerTools([...crudTools, ...snapshotTools, ...confirmationTools])
}

// 模块加载时自动注册
registerAllTools()
