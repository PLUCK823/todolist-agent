# Agent TodoList 前端

Agent TodoList 的 React 前端工程。当前目录仅完成 Vite 脚手架初始化，产品页面尚未迁移到 `src/`。

## 实现前必读

前端页面不得从默认 Vite 模板继续自由扩展。实现时按以下顺序读取：

1. [UI 高保真原型设计](../docs/superpowers/specs/2026-07-13-agent-todolist-prototype-design.md)
2. [V6 可交互页面原型](../.superpowers/brainstorm/40507-1783945975/content/workspace-full-flow-v6.html)
3. [产品需求文档](../docs/PRD.md)
4. [API 接口文档](../docs/API.md)
5. [前端开发工作流](../docs/WORKFLOW.md#5-前端开发工作流)

设计文档规定产品规则和完成标准；V6 原型是视觉层级、页面构图、动效与交互顺序的基准。

## 当前状态

- 已有：React、TypeScript、Vite、ESLint 脚手架
- 未实现：产品布局、页面、组件、API 层、Agent 通信和测试
- 未安装：TailwindCSS、Axios、前端测试框架

当前 `package.json` 使用 React 19、TypeScript 6 和 Vite 8，与早期架构文档中的目标版本不同。开始实现前需在实施计划中确认沿用当前版本还是调整依赖，并同步更新相关技术文档。

## 本地运行

```bash
pnpm install
pnpm dev
```

默认开发地址由 `vite.config.ts` 决定。构建和检查：

```bash
pnpm build
pnpm lint
pnpm preview
```

## 原型与生产代码的边界

`.superpowers/` 中的 V6 文件是设计评审原型，不是生产前端代码。实现时应将其拆分为设计规格第 10 节定义的 React 组件，并通过 Mock 数据或正式 API 驱动状态，不直接把单文件 HTML 复制到 `src/`。
