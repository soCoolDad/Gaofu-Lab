# 贡献指南

感谢你对 **稿府 Lab** 的关注！

## 快速开始

1. Fork 本仓库到你的 GitHub 账号；
2. Clone 到本地并新建分支：

```bash
git clone https://github.com/<your-name>/gaofu-lab.git
cd gaofu-lab
git checkout -b feat/your-feature
```

3. 安装依赖：

```bash
npm install
```

4. 本地开发：

```bash
npm run electron:dev
```

## 提交规范

- 提交信息建议遵循 [Conventional Commits](https://www.conventionalcommits.org/) 风格，例如：

```
feat: 新增知卷设置面板
fix: 修复预览表格分页高度计算错误
docs: 补充 README 免责声明
refactor: 拆分 AiAssistantPanel 中的上下文构建逻辑
```

- 一次 PR 尽量只做一件事，方便 review。
- 代码需通过：

```bash
npx tsc --noEmit
npx vite build
```

- 如果修改了 UI，请附带截图或说明。

## 项目结构（简要）

```
src/               前端渲染进程（React + TypeScript）
  components/      通用组件与 AI 面板
  pages/           路由页面
  stores/          Zustand 状态
  types/           全局类型
electron/          主进程 & IPC
  ipc/             主进程 IPC 处理器
  db/              SQLite / Drizzle schema
public/            静态资源
```

## 反馈

- Bug / 功能建议：请在 GitHub Issues 中提交，务必附带复现步骤和环境信息。
- 涉及安全漏洞的问题：请**不要**直接开 Issue，参考 [SECURITY.md](./SECURITY.md) 通过邮件私下反馈。
- 邮箱：**806516788@qq.com**

## 许可证

提交的所有代码将以 **Apache License 2.0** 许可发布。参见根目录 [LICENSE](../LICENSE)。
