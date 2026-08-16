# 稿府 Lab PRD

## 一、产品概述

### 1.1 产品名称
稿府 Lab · 本地 AI 创作辅助工具

### 1.2 产品定位
基于 Electron 桌面端的专业级 AI 小说创作工作台，面向网文作者、小说工作室及 AI 辅助创作者，提供从大纲、人物、伏笔到正文写作的全流程 AI 辅助能力。

### 1.3 设计原则
- 干净：界面简洁，信息层级清晰
- 大气：宽屏布局，专业感强
- 精致：细节打磨，交互流畅
- 专业：围绕长篇小说创作场景设计

### 1.4 技术栈
- 桌面端：Electron
- 前端：React + TypeScript + Vite
- UI 框架：Ant Design（定制主题）
- 状态管理：Zustand
- 路由：React Router
- 本地数据库：SQLite
- AI 模型：可配置多模型提供商

---

## 二、目标用户

1. 网文作者：需要管理多本书、高效创作
2. 小说工作室：需要团队协作和标准化流程
3. AI 辅助创作者：深度使用 AI 参与创作全流程
4. 剧情策划：需要管理大纲、人物、世界线
5. 专业写作者：需要沉淀创作资产（人设、伏笔、世界观）

---

## 三、整体信息架构

### 3.1 四栏主布局

```
┌──────────────────────────────────────────────────────────┐
│ App Header（可选）                                        │
├──────────┬──────────────┬──────────────────┬─────────────┤
│ 主导航栏  │ 当前作品菜单  │ 主工作区          │ AI 辅助栏    │
│ 72-240px │ 220-280px    │ 自适应            │ 320-380px   │
└──────────┴──────────────┴──────────────────┴─────────────┘
```

### 3.2 左侧主导航

```
稿府 Lab

[+ 新建作品]

我的书籍
- 深空来信
- 我的高冷老板
- ...

创作资产
- AI 员工
- 模型管理

系统
- 设置
```

### 3.3 中侧当前作品菜单

```
当前作品：深空来信

创作
- 章节管理
- 正文编辑

设定
- 人物管理
- 世界观管理
- 地点管理
- 物品/技能管理

结构
- 大纲管理
- 分卷大纲
- 章节大纲

线索
- 伏笔管理
- 世界线
- 已出场元素
- 灵感管理
```

---

## 四、核心页面详细设计

### 4.1 章节管理页面

**顶部统计卡片**
- 已创作总字数
- 已创作章节数
- 伏笔完成度（7/12）

**章节列表**
- 按分卷分组
- 每章显示：序号、标题、概要、字数
- 操作：锁定 / 编辑 / 删除
- 底部：AI 生成下一章

**右侧 AI 辅助栏**
- 上下文感知
- 快捷操作：生成章节、拆分章节、补全标题

### 4.2 正文编辑页面

**左侧主编辑区**
- 章节标题
- 正文编辑器
- AI 建议卡片（剧情发展提示，可接受/拒绝）

**右侧上下文面板**
- 角色（已出场角色快查）
- 伏笔（当前章节相关伏笔）
- 世界线
- 辅助工具

**底部 / 侧边 AI 输入**
- 快捷指令：续写、润色、扩写、改写
- 自定义对话

### 4.3 大纲管理页面

**左侧大纲编辑区**
- 全书大纲文本
- 支持条目化结构
- 可关联分卷 / 章节

**右侧 AI 辅助栏**
- 扩展冲突
- 检查节奏
- 生成爽点
- 补充伏笔

### 4.4 分卷管理页面

- 分卷列表
- 每卷目标 / 概要
- 卷内章节数统计
- 可拖拽排序
- 右侧 AI 辅助

### 4.5 人物管理页面

- 人物卡片 / 列表
- 人物详情：姓名、身份、性格、动机、外貌、关系网
- 人物标签
- 出场章节统计
- 右侧 AI 辅助补全人设

### 4.6 伏笔管理页面

- 伏笔列表
- 状态：未回收 / 已回收
- 埋设章节 / 回收章节
- 伏笔类型标签
- 关联人物 / 物品 / 地点

### 4.7 世界线管理页面

- 多时间线管理
- 事件节点
- 时间线可视化（后续迭代）
- 关联章节

### 4.8 已出场元素管理

- 已出场人物
- 已出场物品
- 已出场地名
- 已出场技能 / 功法
- 已出场场景

### 4.9 灵感管理页面

- 灵感卡片
- 标签分类
- 关联章节 / 人物
- 灵感状态

### 4.10 标签管理页面

支持多层级标签，可拖动排序：

```
角色
伏笔
世界线
AI 辅助
自定义...
```

用途：
- 给章节打标签
- 给段落打标签
- AI 生成时读取标签上下文

### 4.11 AI 员工管理页面

**左侧员工列表**
- 大纲写手
- 剧情写手
- 文章审核
- 润色编辑
- 伏笔检查员
- 人设管理员

**右侧配置面板**
- 名称
- 模型
- 职能（System Prompt）
- 温度 / 生成参数
- 保存 / 删除

### 4.12 模型管理页面

**左侧模型列表**
- DeepSeek
- DouBao
- 千问
- 自定义 OpenAI 兼容

**右侧配置面板**
- 提供商（下拉选择）
- API Key
- 模型名称
- 基础 URL（自定义时）
- 输入价格 / 百万 Token
- 输出价格 / 百万 Token
- 保存 / 删除

---

## 五、数据模型

### 5.1 Book（书籍）

```ts
type Book = {
  id: string
  title: string
  description?: string
  cover?: string
  createdAt: string
  updatedAt: string
}
```

### 5.2 Volume（分卷）

```ts
type Volume = {
  id: string
  bookId: string
  title: string
  description?: string
  sortOrder: number
}
```

### 5.3 Chapter（章节）

```ts
type Chapter = {
  id: string
  bookId: string
  volumeId?: string
  title: string
  summary?: string
  content: string
  wordCount: number
  status: 'draft' | 'locked' | 'completed'
  sortOrder: number
  createdAt: string
  updatedAt: string
}
```

### 5.4 Character（人物）

```ts
type Character = {
  id: string
  bookId: string
  name: string
  role: 'protagonist' | 'deuteragonist' | 'antagonist' | 'supporting' | 'minor'
  avatar?: string
  description: string
  personality?: string
  motivation?: string
  appearance?: string
  tags: string[]
}
```

### 5.5 Outline（大纲）

```ts
type Outline = {
  id: string
  bookId: string
  type: 'book' | 'volume' | 'chapter'
  targetId?: string
  content: string
  updatedAt: string
}
```

### 5.6 Foreshadowing（伏笔）

```ts
type Foreshadowing = {
  id: string
  bookId: string
  title: string
  description: string
  status: 'open' | 'resolved'
  introducedChapterId?: string
  resolvedChapterId?: string
  tags: string[]
}
```

### 5.7 WorldLine（世界线）

```ts
type WorldLine = {
  id: string
  bookId: string
  title: string
  description: string
  color?: string
}
```

### 5.8 Inspiration（灵感）

```ts
type Inspiration = {
  id: string
  bookId: string
  content: string
  tags: string[]
  createdAt: string
}
```

### 5.9 Tag（标签）

```ts
type Tag = {
  id: string
  bookId?: string
  name: string
  type: 'character' | 'foreshadowing' | 'worldline' | 'ai' | 'custom'
  parentId?: string
  sortOrder: number
}
```

### 5.10 EmployeeAgent（AI 员工）

```ts
type EmployeeAgent = {
  id: string
  name: string
  avatar?: string
  modelId: string
  role: string
  systemPrompt: string
  temperature?: number
  enabled: boolean
}
```

### 5.11 ModelProvider（模型配置）

```ts
type ModelProvider = {
  id: string
  name: string
  provider: 'deepseek' | 'doubao' | 'qianwen' | 'openai-compatible' | 'custom'
  baseUrl?: string
  apiKey: string
  modelName: string
  inputPrice?: number
  outputPrice?: number
  enabled: boolean
}
```

---

## 六、AI 辅助设计

### 6.1 AI 辅助栏（全局复用）

每个主页面右侧都有可折叠的 AI 辅助栏，根据当前页面上下文提供不同的快捷操作。

### 6.2 上下文感知

AI 辅助栏自动感知：
- 当前书籍
- 当前章节 / 分卷
- 当前选中的人物 / 伏笔
- 当前选中的文本
- 当前页面类型

### 6.3 页面专属快捷指令

| 页面 | 快捷操作 |
|---|---|
| 章节管理 | 生成章节、拆分章节、合并章节、补全标题、生成概要 |
| 正文编辑 | 续写、润色、扩写、改写、检查逻辑、生成对话 |
| 大纲管理 | 扩展冲突、检查节奏、补充爽点、生成伏笔、调整结构 |
| 人物管理 | 补全人设、生成动机、设计关系网、生成对白风格 |
| 伏笔管理 | 设计伏笔、规划回收点、检查遗漏 |

### 6.4 AI 员工体系

不同员工负责不同任务，使用不同 System Prompt：
- 大纲写手：擅长整体结构和爽点设计
- 剧情写手：擅长情节推进和冲突设计
- 文章审核：检查逻辑漏洞、人设一致性
- 润色编辑：优化文字表达
- 伏笔检查员：检查伏笔埋设与回收

---

## 七、视觉设计规范

### 7.1 设计风格关键词

- 干净
- 大气
- 精致
- 专业
- 稳重而不沉闷

### 7.2 色彩系统

```
主色：#4F46E5（靛蓝）
主色浅：#EEF2FF
背景：#F6F7FB
卡片：#FFFFFF
边框：#E5E7EB
主文字：#111827
次文字：#6B7280
辅助文字：#9CA3AF
成功：#16A34A
警告：#F59E0B
危险：#EF4444
```

### 7.3 Ant Design 主题配置

```ts
{
  token: {
    colorPrimary: '#4F46E5',
    borderRadius: 10,
    colorBgLayout: '#F6F7FB',
    colorBgContainer: '#FFFFFF',
    colorText: '#111827',
    colorTextSecondary: '#6B7280',
    colorBorder: '#E5E7EB',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 14,
  },
  components: {
    Layout: {
      bodyBg: '#F6F7FB',
      headerBg: '#FFFFFF',
      siderBg: '#FFFFFF',
    },
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
    },
  }
}
```

### 7.4 间距系统

基于 8px 网格：
- 4px / 8px / 12px / 16px / 24px / 32px / 48px / 64px

### 7.5 圆角

- 小元素：6px
- 按钮 / 输入框：8px
- 卡片 / 面板：12px
- 大卡片 / 弹窗：16px

---

## 八、迭代计划

### MVP 阶段（第一版）

目标：跑通核心创作闭环，完成界面原型

**范围：**
1. Electron 主窗口 + 基础项目骨架
2. 四栏主布局框架
3. 左侧主导航（书籍列表）
4. 中侧当前作品菜单
5. 章节管理页面（静态原型）
6. 正文编辑页面（静态原型）
7. AI 辅助栏（静态原型）
8. AI 员工管理页面（静态原型）
9. 模型管理页面（静态原型）
10. Ant Design 定制主题

### 第二阶段：本地数据

**范围：**
1. SQLite 本地数据库
2. 书籍 CRUD
3. 章节 CRUD
4. 分卷管理
5. 模型配置存储
6. AI 员工配置存储
7. 简单大纲管理

### 第三阶段：AI 能力

**范围：**
1. 多模型 Provider 抽象
2. API Key 安全存储
3. AI 聊天基础能力
4. 章节续写
5. 大纲生成
6. 文章润色
7. 价格统计

### 第四阶段：专业创作功能

**范围：**
1. 人物管理
2. 伏笔管理
3. 世界线管理
4. 标签系统
5. 已出场元素管理
6. 灵感管理
7. 上下文自动注入
8. AI 员工深度协作

### 第五阶段：高级功能

**范围：**
1. 富文本编辑器
2. 世界线可视化
3. 人物关系图
4. 多版本管理
5. 导出多种格式
6. 团队协作（可选）

---

## 九、目录结构

```
AINovel/
├── package.json
├── electron/
│   ├── main.ts
│   ├── preload.ts
│   └── ipc/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── routes/
│   ├── layouts/
│   ├── components/
│   ├── pages/
│   ├── stores/
│   ├── types/
│   └── theme/
└── docs/
    └── PRD.md
```
