# WebMCP 测试网页

启动：在项目根目录运行 `npm run fixture`，然后使用支持 WebMCP 的 Chrome 打开 **http://127.0.0.1:4177**。不要直接以 file:// 打开，插件只支持 HTTP/HTTPS 页面。

页面包含四条内存订单、筛选控件、工具参数示例及调用记录，无需后端、数据库或登录。刷新即重置。

## 测试步骤

1. 打开插件并允许访问当前站点，应发现三个工具。
2. 执行 `set_order_list_query`，参数 `{"query":"键盘"}`，页面应剩两条订单。
3. 执行 `select_order_filter_options`，参数 `{"labels":["待支付"]}`，页面应无匹配订单。
4. 将上述参数改为 `{"labels":[]}` 清除状态筛选，再执行 `query_orders`，参数 `{}`，返回两条键盘订单。
5. 任意工具输入 `{"fail":true}`，返回明确业务错误，页面状态不变。
6. 输入 `{"delay":3000}` 检查等待状态；输入 `{"delay":65000}` 检查插件在 60 秒后显示未知并继续保留执行锁，65 秒返回后解锁。
7. 输入 `{"delay":"错误类型"}`，插件应在调用前阻止执行，因此页面调用记录不会增加。
8. 在没有在途调用时点击“暂停工具注册”，插件应显示无工具；点击“重新注册工具”恢复三个工具。

右侧按钮只复制 JSON，不会执行工具。左侧手动筛选是普通页面操作，不会计入 WebMCP 调用次数。调用记录最近显示 20 条，完整计数在当前页面内存中保留。

## 实现与验证

- 页面：`tests/fixtures/index.html`；工具注册与业务逻辑：`tests/fixtures/tools.js`。
- 优先使用 `document.modelContext.registerTool`，兼容已有测试环境的 `navigator.modelContext` 入口。注销使用原生 unregisterTool 或注册时传入的 AbortSignal，不注入模拟 API。[Chrome 官方注册与注销说明](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- 已在 Chrome for Testing 151.0.7922.34 通过插件验证：注册、订单筛选联动、业务错误、调用记录、注销与重新注册、360px 布局。
- 测试脚本：先启动网页，再执行 `node scripts/test-fixture.mjs`；浏览器路径可通过 `BROWSER_EXECUTABLE` 指定。临时测试扩展副本预授予本机站点权限，正式插件权限不变。
- [桌面截图](screenshots/fixture-desktop.png)、[手机宽度截图](screenshots/fixture-mobile.png)。
