# WebMCP 工具助手

基于 Vue 3 的 Chrome MV3 侧边栏插件，可手动调用当前页面的 WebMCP 工具，通过内置 AIChat 对话执行，或通过独立轻量桥接授权标准 MCP 客户端调用。本地手动调用的参数和结果留在浏览器会话中；远程调用的数据经过服务端。

## 加载插件

1. 打开 Chrome 的 `chrome://extensions`，开启“开发者模式”。
2. 点击“加载已解压的扩展程序”，选择本项目 `dist/extension/`。也可解压 `dist/webmcp-extension.zip` 后选择解压目录。
3. 在支持 WebMCP 的业务页面点击插件图标，打开侧边栏。
4. 点击“允许访问当前站点”，只为当前站点授予权限，再选择工具。
5. 在表单中填写参数，点击“校验参数”或“执行工具”；也可切换为 JSON 编辑。示例需主动填入。
6. 更新插件后，在扩展管理页点击“重新加载”，关闭并重新打开侧边栏。

**浏览器能力**：Manifest 的 Chrome 116 是扩展基础 API 下限，不代表 WebMCP 可用版本。原生工具发现依赖实验性 `document.modelContext.getTools()` 与JSON 字符串参数 `executeTool(tool, JSON.stringify(args))`。详见 [兼容性记录](docs/compatibility.md)。不支持该接口的浏览器会显示明确提示。

## 界面语言（0.2.2）

在 **Settings → 界面语言 / Interface language** 中选择 **简体中文** 或 **English**，立即切换，无需重新加载。默认简体中文；选择保存在本机，重开侧栏或浏览器后恢复，已打开的其他侧栏同步切换。不会修改聊天正文、页面工具名称与描述、原始调用结果，也不会清空当前输入或中断 AIChat。

界面文本、提示、按钮、表单占位和无障碍标签使用统一翻译表；运行记录保持原始状态，仅在展示时翻译。新增语言可扩展 `apps/extension/src/ui/i18n/`。本轮验证见 [多语言测试报告](docs/i18n-test-report.md)。

## AIChat（0.2.2）

四个主导航为 Tools、AIChat、Settings 和 Help；原有表单/JSON 参数编辑、历史及远程自动共享行为保留。

1. 在 Settings → 模型配置新增配置名称、Base URL、模型 ID 和 API Key。首版仅实现 **OpenAI Chat Completions 兼容协议**，Base URL 例如 `https://gateway.example/v1`，不要填写完整 `/chat/completions` 路径。
2. 保存时申请模型域名权限。可点击“测试连接”发送最小文本请求，可能产生少量费用；文本成功不等于工具调用已经兼容。
3. 进入 AIChat 并选择模型后，默认授权当前页面全部可执行且接口兼容的工具及数据发送，无需点击启用会话；无工具时自动使用纯聊天。浏览器站点权限仍需在 Tools 中按需授予。
4. 发送任务后默认自动执行已授权工具。展开授权区域可调整工具范围、切回逐次确认或撤销授权；调整时会先停止后续步骤，再应用新授权。主动撤销在切换视图和重开侧栏后仍保持，须手动恢复或新建会话。调用卡片可查看本地原始记录。
5. 停止只阻止后续步骤；已发出的页面操作可能仍完成。切换插件内导航不会停止运行；关闭或刷新侧边栏会中断编排，重新进入恢复记录但不自动续跑。

API Key 默认保存在 `chrome.storage.session`；只有主动勾选“记住 API Key”才保存在本机 `storage.local`，不是系统密钥保险箱。配置持久保存，默认会话 Key 在浏览器重启后需重新填写；不使用 `storage.sync`。Key 只发送至配置的模型端点，不进入工具记录、页面脚本和远程桥接。

聊天和授权工具数据会经过所选模型服务，其保留策略以供应商设置为准。默认不读取整页 DOM、Cookie 或完整 URL query/hash。结果支持配置字段脱敏和明确标记的裁剪；自动脱敏不能识别所有业务敏感信息。用户消息只显示原始正文，不显示身份标签；智能体回复支持 Markdown 标题、列表、引用、表格、代码块和链接。禁用原始 HTML；仅允许 HTTP/HTTPS 链接，图片只显示替代文字，不自动加载远程资源。

每轮最多 8 次模型请求、10 次工具调用、5 分钟；单页面执行仍采用 60 秒后“结果未知”的规则，不自动重试。工具最多 30 个、定义 128 KiB，默认全选超限时提示缩小范围，不静默截取；结果单次最多 64 KiB、每轮 128 KiB。聊天存储最多 1 MiB，全扩展会话软预算 8 MiB。

**验收状态：协议实现完成，真实供应商待验收。** 已使用本地可控 SSE 模型服务与真实原生 WebMCP 完成端到端验证，未使用真实供应商 Key 验证认证、计费或模型效果。不能据此承诺所有兼容网关可用。详见 [AIChat 测试报告](docs/ai-chat-test-report.md)。

## MCP 页面工具共享

默认使用「轻量桥接」：无需原有后端、数据库或账号系统，支持本机 HTTP 与远程 HTTPS。插件只填写服务地址和插件令牌，浏览器身份自动生成；外部 AI 使用独立 Agent 令牌连接 `/mcp`。完成站点访问授权和工具发现后，默认共享页面及全部可执行工具，可手动关闭或取消单项授权。

桥接服务端统一在 `webmcp-server` 项目维护，插件不再附带服务端包。请在服务端项目构建并初始化桥接：

```sh
npm ci
npm run package
node dist/cli.js init
node dist/cli.js serve
```

插件填写 `http://127.0.0.1:38472` 和插件令牌；AI 配置由 init 输出。远程部署与凭证管理见服务端 README。插件连接步骤见 [连接指南](docs/remote-connection.md)，接口见 [桥接协议 v1](docs/bridge-protocol.md)。

连接设置仅保留轻量桥接，不再显示模式选择、设备注册和 Agent 设备授权。已有轻量桥接配置保留；旧服务配置升级时停用并清除旧凭证与共享，需要重新填写桥接配置。

## 参数输入

- 对明确声明 `properties` 的对象 Schema，默认显示字段表单；勾选可选参数后才会传入，必填参数需填写。
- 字符串使用输入框；若要传入空字符串，点击“设为空字符串”。数字不将空白转换为 0，布尔值和枚举使用下拉框，保留原始类型。
- 对象、数组和复杂字段使用局部 JSON 文本框。引用、组合或条件等复杂顶层 Schema 使用完整 JSON 模式，不自动展开。
- “表单 / JSON”切换同步参数；解析失败、含额外字段或字段类型无法映射时保留当前输入并提示。额外属性请在 JSON 中编辑。
- 草稿和输入模式按页面文档、工具和目录版本隔离；返回工具可继续编辑未完成的输入。侧边栏刷新或关闭后草稿清空，调用历史仍由后台保存。
- 不自动应用 Schema 默认值，示例按钮会替换当前输入。两种模式共用原有校验与执行逻辑。

## 开发

使用 Node.js 24、npm 11。依赖精确版本由 `package-lock.json` 锁定。插件构建与默认测试无需服务端工程。跨项目浏览器测试必须显式指定已构建或已安装的桥接模块。`test:remote-browser` 现为轻量桥接浏览器测试的别名。

```sh
npm ci
npm run check
npm test
npm run build
npm run test:extension
npm run test:chat-browser
WEBMCP_BRIDGE_MODULE=/absolute/path/to/webmcp-server/dist/index.js npm run test:bridge-browser
npm run package:extension
```

`npm run dev:extension` 持续构建，修改后在扩展管理页重载插件；不使用远程 HMR。`npm run test:ui` 执行 Vue 组件测试。

### 可操作的 WebMCP 测试网页

```sh
npm run fixture
```

测试页提供订单列表、筛选联动、参数复制、调用记录及工具注册开关。详细步骤见 [测试网页说明](docs/test-page.md)。

访问 `http://127.0.0.1:4177`，在提供相关接口的 Chrome 中按官方说明启用 WebMCP testing。fixture 通过原生注册接口注册三个工具；它不会向不支持的浏览器注入模拟 API。fixture 不进入安装包。

`npm run test:browser` 用独立临时资料目录和测试版 Chromium 验证原生链路。可设置 `BROWSER_EXECUTABLE` 指向已有 Chrome for Testing；未设置时先运行 `npx playwright install chromium`。此脚本仅在**临时安装包副本**中预授予本机 fixture 权限，以跳过自动化无法确认的原生权限弹窗；正式 manifest 保持按需授权。

## 行为与限制

- 一个文档只允许一次执行；超时显示“结果未知”，不会自动重试或解锁。原调用实际结束后解除锁；无法核实则需检查业务状态并刷新页面。
- 切换工具、标签页或关闭侧边栏不取消已经发出的调用；结果按调用标识关联。
- 页面刷新和导航使旧文档失效。工具变更会改变目录版本，旧参数草稿不自动复用。
- 历史最多 100 条，载荷预算 6 MiB；较旧载荷可能被释放。浏览器重启、禁用或重载扩展后会话清空。
- 轻量桥接使用独立插件／Agent 令牌，支持页面共享和逐工具授权；令牌保存在本机，不提供账号登录。
- 仅顶层页面，不支持 iframe 和带 target 的跨文档表单工具；跨文档导航后不会尝试取回结果。
- Schema 支持范围及未验收项见 [测试报告](docs/test-report.md)。

## 项目结构

- `apps/extension/src/ui`：Vue 组件、导航、参数草稿与后台 bridge。
- `apps/extension/src/background`：文档、工具、调用状态及存储。
- `apps/extension/src/content`：隔离世界中的原生 WebMCP 适配器。
- `apps/extension/src/validation`：offscreen 文档与可终止校验 Worker。
- `packages/protocol`、`packages/schema-validation`：类型、命令校验和 Schema 模块。
- `tests`：单元、组件及原生 API fixture；`scripts`：构建、打包和浏览器验证。

详细设计保留于 [实施技术文档](webmcp-extension-implementation.md)。此次实现范围以本 README 和测试报告为准。

设计依据：[aiChat 开发设计](docs/ai-chat-development.md)。首版实现与剩余验收以 [AIChat 测试报告](docs/ai-chat-test-report.md) 为准。
