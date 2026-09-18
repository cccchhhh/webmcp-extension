# Agent 实际参数测试

日期：2026-09-17T08:12:39.137Z

目标：本机已共享原生 fixture 的 set_order_list_query，通过真实 Agent MCP 调用。

共 29 个用例：24 个符合预期，5 个发现参数行为差异，0 个其他断言失败。

| 参数 | 用例 | 实参 | 结果 | 耗时 |
| --- | --- | --- | --- | --- |
| query | 关键词匹配 | `{"query":"键盘"}` | passed | 75 ms |
| query | 精确订单号 | `{"query":"TEST-1002"}` | passed | 63 ms |
| query | 英文大小写匹配 | `{"query":"test-1001"}` | passed | 63 ms |
| query | 无匹配结果 | `{"query":"__NO_MATCH_AGENT_TEST__"}` | passed | 55 ms |
| query | 空字符串清空 | `{"query":""}` | passed | 58 ms |
| query | 省略所有参数 | `{}` | passed | 59 ms |
| labels | 空数组 | `{"query":"键盘","labels":[]}` | passed | 68 ms |
| labels | 已支付 | `{"query":"键盘","labels":["已支付"]}` | finding | 61 ms |
| labels | 待支付 | `{"query":"键盘","labels":["待支付"]}` | finding | 60 ms |
| labels | 两个枚举值 | `{"query":"键盘","labels":["已支付","待支付"]}` | finding | 59 ms |
| labels | 单独传 labels | `{"labels":["待支付"]}` | finding | 56 ms |
| delay | 零延迟 | `{"query":"键盘","delay":0}` | passed | 63 ms |
| delay | 150ms 延迟 | `{"query":"键盘","delay":150}` | passed | 210 ms |
| fail | 显式 false | `{"query":"TEST-1004","fail":false}` | passed | 59 ms |
| fail | 显式 true 不应修改状态 | `{"query":"不应生效","fail":true}` | passed | 58 ms |
| all | 四参数组合正常路径 | `{"query":"键盘","labels":["待支付"],"delay":80,"fail":false}` | finding | 141 ms |
| all | 四参数组合业务错误 | `{"query":"不应生效","labels":["已支付"],"delay":80,"fail":true}` | passed | 149 ms |
| query | 拒绝数字 | `{"query":123}` | passed | 37 ms |
| query | 拒绝 null | `{"query":null}` | passed | 36 ms |
| labels | 拒绝字符串 | `{"labels":"已支付"}` | passed | 36 ms |
| labels | 拒绝非法枚举 | `{"labels":["退款"]}` | passed | 37 ms |
| labels | 拒绝重复项 | `{"labels":["已支付","已支付"]}` | passed | 36 ms |
| labels | 拒绝非字符串元素 | `{"labels":[1]}` | passed | 33 ms |
| delay | 拒绝负数 | `{"delay":-1}` | passed | 37 ms |
| delay | 拒绝小数 | `{"delay":0.5}` | passed | 34 ms |
| delay | 拒绝超上限 | `{"delay":90001}` | passed | 35 ms |
| delay | 拒绝字符串 | `{"delay":"150"}` | passed | 34 ms |
| fail | 拒绝字符串 | `{"fail":"true"}` | passed | 34 ms |
| schema | 拒绝未声明字段 | `{"query":"键盘","unknownField":true}` | passed | 35 ms |

## 发现

`labels` 虽然出现在共享 Schema 中且通过校验，但 `set_order_list_query` 的实现只修改 `query`；传入支付状态不会更新 `filters.labels`。`labels` 实际由 `select_order_filter_options` 消费。本轮不修改实现，报告此契约与行为差异。

`fail:true` 返回 TEST_BUSINESS_ERROR，并用 query_orders 读取确认筛选状态不变；非法类型、非法枚举、重复项、超界和额外字段均验证是否在发送前拒绝。

最终筛选：`{"query":"键盘","labels":[]}`。

- 未等待 delay=90000 的上界：服务端默认截止时间为60000ms；本轮覆盖0、80、150及非法负数/小数/90001/字符串。
- 这是原生测试 fixture，不代表真实业务订单页面。

[逐次返回与调用标识](agent-query-parameter-results.json)
