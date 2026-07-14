# V6 视觉回归基准

> 基准日期：2026-07-14。所有桌面测试的**浏览器视口**固定为 **1223 × 1227 CSS px**、`zh-CN`、`Asia/Shanghai`、系统浅色主题与减少动态效果；业务时间固定为 2026-07-13 10:00（UTC+8）。由于使用 `fullPage`，包含 Shell 外边距的 PNG 实际高度可能为 1241px，这不改变基准视口。截图必须在对应功能断言成功后生成，禁止用刷新基线掩盖功能失败。

## 固定设计量尺

| 项目 | 基准值 |
|---|---|
| Shell 外边距 / 圆角 | 14px / 20px |
| 左导航 | 默认 68px；展开 210px；背景 `#202538` |
| Agent | 展开 340px；收起为 0px 且 DOM 移除；背景 `#262b3d` |
| 主背景 / 页面背景 | `#f7f7f9` / `#e9ebf0` |
| 表面 / 边框 / 正文 | `#ffffff` / `#e3e5eb` / `#222738` |
| 主色 / 主操作色 | `#7165ea` / `#5f54d9` |
| 通用 Dialog | `max-width: 520px`，最大高度 `min(760px, 100vh - 32px)`，圆角 18px |
| 快捷 Agent 输入 | `max-width: 630px`，圆角 18px |
| 标准页头按钮顺序 | 快速询问 → 新建任务 → Agent ✦（仅 Agent 收起时） |
| Dialog 页脚按钮顺序 | 次操作/取消 → 主操作/保存；危险确认同样为取消 → 确认 |

## 六个页面

| 页面 / 原型状态 | 视口 | 基准截图 | 必查点 |
|---|---:|---|---|
| 我的任务，Agent 展开 | 1223×1227 | `tasks-agent-expanded-chromium.png` | 68px 导航、340px Agent、页头只有快速询问和新建任务 |
| 我的任务，Agent 收起 | 1223×1227 | `tasks-agent-collapsed-chromium.png` | Agent 深色列完全消失；✦ 位于新建任务右侧 |
| 近期安排 | 1223×1227 | `upcoming-chromium.png` | 七日选择器、当日安排、页头操作顺序 |
| 智能助手工作区 | 1223×1227 | `assistant-chromium.png` | 会话区、执行详情区、输入区完整且不横向溢出 |
| 个人资料 | 1223×1227 | `profile-chromium.png` | 身份卡、两列账户信息、统计卡、退出操作 |
| 登录 / 注册 | 1223×1227 | `login-chromium.png` / `register-chromium.png` | 左侧品牌叙事、右侧表单、注册增加显示名称且主按钮在字段后 |

在 **390×844** 补充人工检查任务页、Agent 抽屉和所有 Dialog：导航不占用桌面列、Agent 使用全宽抽屉、Dialog 四周至少 16px 间距且可滚动。这些状态由响应式功能测试守卫，不作为本节点的像素基线，避免跨浏览器移动端字体栅格造成伪差异。

## 十种弹窗与浮层

| 状态 | 视口 | 截图 / 自动门禁 | 尺寸与按钮顺序 |
|---|---:|---|---|
| 新建任务 | 1223×1227 | `overlay-task-create-chromium.png` | 520px / 18px；取消 → 创建任务 |
| 任务详情 | 1223×1227 | axe + 键盘 | 520px / 18px；页头关闭，页脚编辑任务 |
| 编辑任务 | 1223×1227 | axe + 键盘 | 520px / 18px；取消 → 保存修改 |
| 删除确认 | 1223×1227 | `overlay-task-delete-chromium.png` | 520px / 18px；取消 → 确认删除 |
| 状态筛选 | 1223×1227 | axe + 键盘 | 210px / 13px、锚定触发器；全部 → 进行中 → 已完成 |
| 优先级筛选 | 1223×1227 | axe + 键盘 | 210px / 13px、锚定触发器；全部 → 高 → 中 → 低 |
| 设置 | 1223×1227 | `overlay-settings-chromium.png` | 520px / 18px；取消 → 保存设置 |
| 更换头像 | 1223×1227 | `overlay-avatar-chromium.png` | 520px / 18px；取消 → 保存头像 |
| 快速询问 | 1223×1227 | `overlay-quick-ask-chromium.png` | 630px / 18px；关闭 → 发送 Agent |
| 退出登录确认 | 1223×1227 | axe + 键盘 | 520px / 18px；取消 → 确认退出 |

## Agent 过程状态

| 状态 | 基准截图 | 验收点 |
|---|---|---|
| 运行中 | `agent-running-chromium.png` | 时间线显示“运行中”、当前步骤及等待时间 |
| 失败 | `agent-failure-chromium.png` | 错误说明可读；写操作失败不得显示危险重放按钮 |

基线文件位于 `frontend/e2e/snapshots/`。Chromium 必须使用 `maxDiffPixelRatio: 0.01`；任何更新都需逐张核对导航宽度、Agent 宽度、按钮顺序、弹窗尺寸与上表关键颜色。

规格中的次级文字基准为 `#898e9d`；实现将小字号辅助文字提高到 `#656b7a`，这是为了满足 WCAG 2.2 AA 的 4.5:1 对比度门禁。其余关键色保持原型值。

## 基线逐文件签核

实现代理已逐张检查构图、尺寸和状态。主代理于 2026-07-14 使用两张原始尺寸 contact sheet 复核全部 14 个文件，逐项核对页面构图、导航与 Agent 宽度、按钮顺序、520px/630px 浮层量尺以及 Agent 运行/失败状态，结果全部 PASS。该签核代表仓库交付门禁通过，不冒充额外的用户审批。

| 文件 | 状态 | 原型参照 | 实现代理审阅结果 | 日期 |
|---|---|---|---|---|
| `tasks-agent-expanded-chromium.png` | 主代理视觉终验通过 | V6 tasks + agentExpanded | 68px 导航、340px Agent、操作顺序符合 | 2026-07-14 |
| `tasks-agent-collapsed-chromium.png` | 主代理视觉终验通过 | V6 tasks + agentCollapsed | 深色列移除，✦ 位于新建任务右侧 | 2026-07-14 |
| `upcoming-chromium.png` | 主代理视觉终验通过 | V6 upcoming | 七日条与空日状态完整 | 2026-07-14 |
| `assistant-chromium.png` | 主代理视觉终验通过 | V6 assistant workspace | 会话、工作区、检查器三栏完整 | 2026-07-14 |
| `profile-chromium.png` | 主代理视觉终验通过 | V6 profile | 身份、账户、统计与 Agent 同屏 | 2026-07-14 |
| `login-chromium.png` | 主代理视觉终验通过 | V6 auth login | 品牌叙事与登录表单比例符合 | 2026-07-14 |
| `register-chromium.png` | 主代理视觉终验通过 | V6 auth register | 注册字段与主按钮顺序正确 | 2026-07-14 |
| `overlay-task-create-chromium.png` | 主代理视觉终验通过 | V6 `.modal` | 520px / 18px，字段与页脚完整 | 2026-07-14 |
| `overlay-task-delete-chromium.png` | 主代理视觉终验通过 | V6 danger modal | 520px / 18px，危险操作顺序正确 | 2026-07-14 |
| `overlay-settings-chromium.png` | 主代理视觉终验通过 | V6 settings modal | 设置项与页脚操作完整 | 2026-07-14 |
| `overlay-avatar-chromium.png` | 主代理视觉终验通过 | V6 avatar modal | 预设、上传与保存操作完整 | 2026-07-14 |
| `overlay-quick-ask-chromium.png` | 主代理视觉终验通过 | V6 `.command` | 630px / 18px，输入与发送操作完整 | 2026-07-14 |
| `agent-running-chromium.png` | 主代理视觉终验通过 | V6 Agent trace running | 运行步骤、状态点与输入区可见 | 2026-07-14 |
| `agent-failure-chromium.png` | 主代理视觉终验通过 | V6 Agent trace failed | 失败步骤与错误文本可见，无危险重放 | 2026-07-14 |
