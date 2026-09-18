# 首轮本地插件测试报告

日期：2026-09-17。本文保留首轮本地插件与参数表单验收记录。远程功能已在后续实现并联调，远程历史记录见 [桥接测试报告](bridge-test-report.md)，0.2.0 最新交付与完整回归见 [AIChat 测试报告](ai-chat-test-report.md)。

## 参数表单更新验收

本次新增 Schema 表单与 JSON 双模式，后台调用协议保持不变。

- 类型检查、36 项单元/组件测试、生产构建及安装包检查通过。
- 新增测试覆盖字段类型、必填/未填写、空字符串、0、false、枚举原始类型、非法数字/JSON、可选字段取消、复杂 Schema 回退、额外字段保护、特殊属性名、双模式同步、未完成草稿恢复和校验期间禁止重复提交。
- `scripts/test-fixture.mjs` 在 Chrome for Testing 151.0.7922.34 中通过真实扩展执行三个订单工具，验证表单填写、业务错误、无效输入未发送、调用锁、工具切换与草稿恢复。
- 360px / 420px 表单无横向溢出；长字段名与描述可换行，HTML 文本未创建 DOM；键盘可移动焦点。截图见 [360px 表单](screenshots/argument-form-360.png) 和 [420px 表单](screenshots/argument-form-420.png)。
- 下文原有 60 秒超时、后台重启等全链路结果保留自首轮验收；本次更新未重复运行该完整长耗时套件，其 JSON 编辑入口已适配新模式切换。

复现表单集成测试：先 `npm run fixture`，再设置 `BROWSER_EXECUTABLE` 后运行 `node scripts/test-fixture.mjs`。同样只为临时测试安装包授予 localhost 权限，正式包仍按需申请权限。

## 自动化结果

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 通过，Vue 与 TypeScript 类型检查 |
| `npm test` | 36 项通过，3 个测试文件 |
| `npm run build` | 通过，生成可加载的 MV3 安装目录 |
| `npm run test:extension` | 通过，入口文件、CSP、动态执行及模拟代码检查 |
| `npm run package:extension` | 通过，生成 `dist/webmcp-extension.zip` |
| 原生 WebMCP 浏览器集成 | 18 组场景通过，见 `browser-results.json` |

单元与组件测试覆盖 Schema 元校验、draft-07 类型/必填/额外字段、组合与本地引用、条件/依赖/元组、数值/字符串约束、format 注解、默认示例、非法消息、超时锁、晚到结果、历史配额、文本转义、工具选择、设备保存、共享禁用和五种能力状态。

## 浏览器实测

环境：macOS arm64，Chrome for Testing **151.0.7922.34**，独立临时用户资料目录；headless 模式开启 WebMCP 测试功能。fixture 通过浏览器原生注册接口创建工具，生产插件没有模拟执行路径。

通过项目：

1. 原生工具发现、Schema 获取、JSON 参数校验与实际执行。
2. 返回内容保留、明确业务错误识别、切换工具不串结果、草稿隔离。
3. 执行期间按钮禁用；fixture 计数验证每个操作只实际执行一次。
4. 侧边栏页面重载时后台调用持续执行，记录可以恢复。
5. 使用 CDP 停止独立测试浏览器的 service workers，重启后重新发现目录并追踪原在途调用，没有重放。
6. SPA 导航使目录和草稿失效；真实工具注册变化触发目录更新。
7. 跨文档刷新期间的调用显示结果未知，旧结果不投递到新文档。
8. 设备名称保存；页面共享默认关闭。后续远程连接与授权验收见远程测试报告。
9. 360px、420px、1000px 无页面横向溢出；长工具名可换行，长 JSON 在结果区域滚动；键盘能进入可聚焦控件。
10. 恶意正则校验超过 500ms 后被 Worker 终止，后台保持可用。
11. **真实 60 秒等待超时**后结果显示未知且执行锁仍在；第 65 秒原始 Promise 返回后显示“后续已返回”并解锁。fixture 计数仍为 1。
12. 工具描述中的 HTML 以文本呈现，未执行或插入 DOM。

浏览器脚本以扩展页面标签页承载相同的 sidepanel 入口，验证 Vue 页面与真实后台、content script、offscreen Worker 的完整消息链。浏览器原生侧边栏容器的鼠标拖动和系统权限弹窗尚未自动验收。

## 权限测试说明

完整原生调用自动化只在**临时测试副本**中添加本机 fixture 的 host permission，用于绕过 headless 的系统授权弹窗。正式安装包没有 `host_permissions`，仅有 `optional_host_permissions`。

另提供 `node scripts/browser-test.mjs --permission-only`，使用正式 manifest 验证尚未授权的站点正确显示“允许访问当前站点”，不会误判为受限页面。真正点击后的 Chrome 授权弹窗仍需人工确认。

## 实测发现与修正

- Chrome 151 原生执行接口拒绝对象参数，返回 `Failed to parse input arguments`；适配器改为一次性传入 JSON 字符串，不捕获失败后自动重试。
- 原生返回值为 JSON 字符串，保留原字符串，并仅解析结构化 `isError` 标志进行业务错误分类。
- Worker 重启时仅恢复记录不足以恢复工具详情，现已向真实文档重新发现目录。
- 历史配额仅计算历史载荷；大型工具目录不写入 session storage，防止挤占记录空间。
- 增加 `tabs` 元信息权限，使切换到未授权站点时能展示正确的 origin 授权入口；页面内容访问仍需逐站点授权。

## 尚未验收

- 用户实际 provider-web 订单页面、真实订单业务结果及第二个业务项目。
- 日常 Chrome 153、其他 Chrome 版本、Windows/Linux 和没有实验开关的目标环境。
- 原生侧边栏容器拖动、Chrome 站点权限弹窗确认/拒绝。浏览器完全退出再启动的后续验证见远程报告。
- 首轮未包含远程功能；后续已实现并验收本地真实 MCP → 插件 → 页面链路。生产 OAuth 环境与账号登录不在本次实现范围。

这些未验收项不影响已验证的 fixture 本地调用结论，但不能据此宣称完整远程项目或所有浏览器版本已可用。

## 证据与复现

- [机器结果](browser-results.json)
- [360px 首页](screenshots/home-360.png)
- [420px 首页](screenshots/home-420.png)
- [桌面宽度首页](screenshots/home-1000.png)
- [真实调用结果](screenshots/result-420.png)
- [长名称 / 长结果页面](screenshots/long-result-360.png)
- 构建、测试和安装命令见 [README](../README.md)。完整浏览器测试约需 80 秒，包含真实超时等待。
