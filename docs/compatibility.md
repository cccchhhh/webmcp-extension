# 兼容性与实现说明

## 版本与接口

- 开发核查日期：2026-09-17。
- Node.js 24.18.0、npm 11.16.0；Vue 3.5.42、Vite 8.3.0、TypeScript 5.9.3、jsonschema 1.5.0。所有依赖见锁文件。
- 原生 fixture 注册：`navigator.modelContext.registerTool`。
- 扩展隔离世界发现：`document.modelContext.getTools()`，只接受 `tool.window === window` 的顶层工具。
- 执行：`document.modelContext.executeTool(tool, JSON.stringify(arguments))`，只调用一次。测试版 151.0.7922.34 对对象参数返回 `Failed to parse input arguments`，因此本轮锁定其已验证的字符串契约；不通过捕获异常自动重试。后续切换浏览器 API 契约需重新验收适配器。
- 变化通知：`document.modelContext.ontoolchange`。
- 缺少接口时明确显示不支持，不覆写注册函数，也不退回 DOM 操作或任意脚本执行。

## 浏览器测试配置

Chrome for Testing 151.0.7922.34，macOS arm64，独立临时资料目录，headless Chromium。测试启动使用 `WebMCPTesting` 与 Blink 的 `WebMCP,WebMCPTesting` 开关。这些是本次测试组合，不是所有 Chrome 的兼容承诺。

日常 Chrome 可依据官方说明，在 `chrome://flags/#enable-webmcp-testing` 开启测试功能并重启浏览器。网站是否满足 origin isolation 和 permissions policy 也会影响能力。安装前请确认目标版本提供上述发现与执行接口。

Manifest 的最低版本 116 仅用于基础扩展 API。Chrome 153 已安装于本机，但此次自动化运行使用独立的 Chrome for Testing 151，不把日常 Chrome 153 列为已验收。

## CSP 与权限

脚本、CSS、Vue runtime 和校验器全部打包到本地；没有 `eval`、运行时模板编译或 CDN。CSP 允许 HTTPS/WSS 及 `127.0.0.1` / `localhost` 的 HTTP/WS，连接配置仅接受 HTTPS origin 或本机 HTTP origin，保存时按需请求服务主机权限。令牌只经后台 HTTP Authorization 发送；WebSocket URL 不携带凭证。

权限用途：sidePanel 显示界面；tabs 读取活动标签页 URL 与标题，让切换到尚未授权的站点时仍能显示正确的授权入口（不授予页面内容访问）；activeTab 与 scripting 访问用户操作的标签页并注入适配器；storage 保存设置和会话；webNavigation 追踪文档；alarms 核验绝对截止时间；offscreen 承载可终止的校验 Worker。HTTP/HTTPS 主机权限仅按站点请求。

校验器 Worker 超过 500ms 即终止，避免复杂正则或递归阻塞后台。官方 draft-07 元 Schema 内嵌，不联网取引用。`format` 仅作注解；嵌套 `$id`、远程引用、未知约束或其他方言被明确拒绝。不同机器可能因预算不足而拒绝复杂 Schema。

## 参考

- [Chrome WebMCP 文档](https://developer.chrome.com/docs/ai/webmcp)
- [官方 Inspector 的适配器参考](https://github.com/beaufortfrancois/model-context-tool-inspector/blob/main/content.js)
- [draft-07 元 Schema](https://json-schema.org/draft-07/schema)

这些来源用于选择接口；具体通过结果以本项目测试报告为准。

首轮对目标设计的补充：增加 `tabs` 元信息权限与 `offscreen` 校验权限；没有添加 `identity`，远程版本仍采用手动填入令牌，不包含 OAuth 登录。工具目录不写入会话存储，后台重启后从当前真实文档重新发现，避免大型 Schema 占满会话配额。调用元数据、结果和执行锁仍按会话恢复。
