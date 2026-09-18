# 插件桥接收敛验收

日期：2026-09-17。环境：macOS arm64、Node.js 24.18.0、Chrome for Testing 151.0.7922.34。

## 本轮结果

- 插件 `npm run check` 与 `npm test` 通过：63 项单元／组件测试。没有服务端 workspace，也不读取相邻工程。
- 删除旧设备注册、Agent 设备授权命令、相关后台方法、组件和测试；仅保留旧存储识别与停用逻辑。已有轻量桥接配置和令牌保持不变。
- `npm run package:extension` 与 `npm run test:extension` 通过，扩展 ZIP 已更新。
- 使用明确指定的 `webmcp-server/dist/index.js` 完成 15 项真实浏览器回归：工具发现与执行、文档锁、侧栏关闭、后台和服务重启、重连、撤销、目录及导航变化、超时与晚到结果、浏览器完整重启、错误令牌。
- 集成测试开始前验证生成协议与服务端安装产物完全一致。360px / 420px 设置页无横向溢出，截图与结构化结果见 `screenshots/bridge-*.png` 和 `bridge-browser-results.json`。
- 运行中的桥接从插件仓库切换至服务端项目，沿用原端口、Origin 和令牌；使用原 Agent 令牌成功发现三个 MCP 工具。切换前后共享页面均为 0，未调用用户页面业务工具。

## 独立项目边界

服务端代码、凭证管理、HTTPS 和安装包验收都已迁入 `webmcp-server`，详见该项目 `test-report.md`。插件仓库不再包含桥接服务端源码或安装包副本。

```sh
npm ci
npm run check
npm test
npm run build
WEBMCP_BRIDGE_MODULE=/absolute/path/to/webmcp-server/dist/index.js npm run check:bridge-protocol
WEBMCP_BRIDGE_MODULE=/absolute/path/to/webmcp-server/dist/index.js npm run test:bridge-browser
```

`WEBMCP_BRIDGE_MODULE` 也可指向独立安装的桥接 dist/index.js；`BROWSER_EXECUTABLE` 可指定支持实验性原生 WebMCP 的 Chrome for Testing。测试使用临时配置和浏览器资料目录，不修改用户已有凭证或页面授权。

当前未验收真实公网部署。浏览器集成使用本机 HTTP；服务端另有开启证书校验的本地 HTTPS/WSS 测试。当前环境未安装 Docker，容器只完成配置静态检查，不能视为实际镜像构建通过。
