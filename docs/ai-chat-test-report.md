# AIChat 与原型界面交付报告

日期：2026-09-18。版本：0.2.1。状态：**协议实现完成，真实供应商待验收**。

## 实现范围

- 按最新原型增加 Tools / AIChat / Settings / Help；模型配置和远程桥接分开，保留原有参数表单、JSON 编辑、历史和远程自动共享。
- 多模型配置、浏览器会话或本机凭证、域名授权、最小连接测试、OpenAI Chat Completions SSE、纯聊天和真实页面工具往返。
- 默认授权全部兼容工具并自动执行，可调整范围、切换逐次确认或撤销。主动撤销跨视图与重开保留，目录变化后须重新绑定；超预算提示缩小范围，不静默截取。模型服务、原生页面工具和外部桥接不共享授权。
- 移除页面上下文栏；用户消息右对齐且不显示身份标签。智能体使用本地 Markdown 渲染，禁用 HTML、危险链接及图片加载，代码和表格局部滚动。
- 七个设计命令已实现，另增加 `CHECK_CHAT_GRANT`，在网络请求与聊天存储前复查所有权、配置版本及目标。ACK 返回调用 ID，不代表工具完成。
- 后台以调用上下文区分 manual / remoteAgent / aiChat；重复 invocation 只执行一次，参数替换拒绝；持久映射在结果裁剪后保留到浏览器会话结束。
- 工具结果按配置递归脱敏（包括可解析的 JSON 文本结果）、结构化裁剪；不完整 SSE 不执行工具，未知结果不重试，迟到结果更新原卡片。
- Web Locks 串行化扩展上下文间的存储预算检查。聊天检查点与完整轮次保存在 session；重开只恢复记录，不自动执行。接管会话使旧执行授权失效。

## 自动化验证

类型检查通过；12 个测试文件、105 项单元与组件测试通过；生产构建、CSP/安装包检查通过。桥接协议未改变，沿用 0.2.0 一致性检查结果。

本次新增默认全部自动授权、主动撤销不反弹、范围调整、目录失效与超预算恢复、第二侧栏不接管、工具别名稳定，以及 Markdown 常用语法、未完成流、HTML/链接/图片安全边界和历史滚动测试。

单元与组件测试覆盖：分块 UTF-8/SSE、工具 ID 与参数聚合、流未完整结束、认证错误、凭证回显保护、别名与 Schema 边界、结果脱敏、并发去重、参数批准绑定、撤销/停止/Port 断开、会话接管、ACK 未返回时按 invocation 恢复、共享锁、存储失败、结果释放、串行工具消息配对、未知状态阻断、输入法发送与文本转义、凭证存储和配额。

浏览器环境为 macOS arm64 / Chrome for Testing 151.0.7922.34，独立临时用户目录，启用原生 WebMCP 实验功能。

- [AIChat 浏览器结果](chat-browser-results.json)：两个模型配置，文本连接测试，默认全部自动执行与手动切换逐次确认的真实原生工具闭环，撤销跨视图与重开保持、原始记录跳转、停止慢流、清除密钥、Markdown 安全渲染及 360/420/1000px 布局。
- [手动调用浏览器结果](browser-results.json)：原生发现、参数校验、表单/JSON、业务错误、记录隔离、重载与后台恢复、导航失效、真实 60 秒超时及第 65 秒迟到结果等原有回归。
- [桥接浏览器结果](bridge-browser-results.json)：15 组外部 MCP 联调，包括令牌、页面工具授权、手动与 Agent 共享锁、重启恢复、断线恢复、权限撤销和未知结果。
- 正式 manifest 不增加预授权域名；模型与业务域名使用原有按需权限。安装包检查验证 CSP、入口与无远程代码加载。

截图：[360px 对话](screenshots/chat-360.png)、[420px 对话](screenshots/chat-420.png)、[宽屏对话](screenshots/chat-1000.png)。

复现命令：

```sh
npm run check
npm test
npm run build
npm run test:extension
WEBMCP_BRIDGE_MODULE=/absolute/path/to/webmcp-server/dist/index.js npm run check:bridge-protocol
npm run test:chat-browser
npm run test:browser
WEBMCP_BRIDGE_MODULE=/absolute/path/to/webmcp-server/dist/index.js npm run test:bridge-browser
npm run package:extension
```

测试优先使用 `BROWSER_EXECUTABLE`，其次使用已安装 Playwright 浏览器；macOS 可回退到已有 Chrome for Testing 缓存。

## 验收边界

本地模型假服务仅用于稳定验证协议和扩展链路，不进入安装包。没有使用真实供应商凭证进行认证、真实模型工具能力、计费、上下文窗口或兼容网关验收；上线前须记录实际服务、模型、Chrome 版本、日期和限制。

手动调用与桥接浏览器报告为 0.2.0 回归基线，本次未重复执行这两套浏览器测试；相关后台及桥接协议未修改。

浏览器自动化以扩展页面加载相同侧栏入口，临时副本预授予 localhost 权限。原生侧边栏拖动、真实模型域名权限弹窗和供应商浏览器直连限制仍需人工验收。首版不包含语法高亮、公式、Mermaid、附件、跨标签任务、跨重启聊天历史、Responses/Anthropic/Gemini 原生协议或后台持续运行。
