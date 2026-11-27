# 浏览器回归验证

`infrastructure-regressions.mjs` 使用当前前端源码启动隔离的 Vite 服务，在 Chromium 中验证界面和 API 请求载荷。测试替换的是网络响应，不替换 React 组件；每个场景使用独立浏览器上下文，外部请求被阻断，环境目录为空，不读取生产凭据。

这些场景验证渲染、交互、错误状态与前端请求契约。数据库迁移、实际权限校验及采集结果需要配合 Worker 和 Agent 的回归验证，不能由截图代替。

## 运行

需要已经安装的 Playwright 和兼容的 Chromium。若 Playwright 不在项目模块解析路径中，显式传入其入口；若使用已有浏览器，传入可执行文件：

```sh
node frontend/browser/infrastructure-regressions.mjs \
  --playwright-module /path/to/playwright/index.mjs \
  --browser-executable /path/to/chromium \
  --output .tmp/cvm-ui-review
```

`--browser-executable` 也可通过 `CF_MONITOR_BROWSER_EXECUTABLE` 提供。省略时使用 Playwright 已安装的默认 Chromium。`--selection CVM-03` 只运行指定前缀；默认 `ALL` 运行全部场景。

| 场景 | 主要风险 |
| --- | --- |
| CVM-01 | 资产创建、搜索与 Command Palette 键盘操作 |
| CVM-02 | 发现候选导入与来源证据 |
| CVM-03 | Markdown 注入、版本冲突保留草稿、适用资产类型 |
| CVM-04 | 基线报告的证据可信度、Machine Token 创建/轮换/吊销 |
| CVM-05 | 手机深色布局、配置未知值及导航 |
| CVM-06 | 缺失心跳保持未知、公开统计信息 |
| CVM-07 | 手机监控策略、DNS/维护窗口完整回显、反向资产关联 |
| CVM-08 | 资产分组/批量标签、准确到期时间、VPS 固定绑定、拓扑方向 |
| CVM-09 | 请求失败不显示为空成功、缩小 Context 失败不扩大导出范围 |
| CVM-10 | 默认关闭管理员恢复、独立恢复凭据请求 |
| CVM-11 | 容器资源缺测及 Harness 报告来源 |
| CVM-12-desktop / mobile | Monitor 公开 VPS/网站网格，浅色与深色，无横向溢出 |
| CVM-13 | 主题导入/导出、未保存目标配置预览、iframe 脚本隔离、明确保存才写入 |

输出包括场景结果、实际请求清单和 PNG 截图。截图全部使用示例数据，不代表生产资产状态。输出目录可删除后重建；请勿把临时测试凭据与生产凭据混用。

原有 `chart-theme-regressions.mjs`、`reaudit-regressions.mjs` 等脚本继续用于图表主题、隐藏网址、多标签页同步及成熟监控功能的回归。

## 相关核心验证

```sh
node --test frontend/test/infrastructure-core.test.mjs \
  frontend/src/components/website-hide-url.test.mjs \
  frontend/src/pages/admin/account.mfa.test.mjs
node --test worker/src/routes/theme.preview.test.mjs
npm --prefix frontend run lint
npm --prefix frontend run build
```

主题路由测试加载实际 Hono 路由、配置校验和 CSS 生成代码，仅替换数据库及平台 I/O，并断言预览不会创建、激活或保存主题。
