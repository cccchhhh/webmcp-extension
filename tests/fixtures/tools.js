// This page is a local test fixture, never included in the extension package.
window.fixtureCalls = [];
const status = document.getElementById('status');
const api = document.modelContext?.registerTool ? document.modelContext : navigator.modelContext;
const orders = [
  { orderNo: 'TEST-1001', product: '无线机械键盘', amount: 399, payment: '已支付' },
  { orderNo: 'TEST-1002', product: '便携显示器', amount: 899, payment: '待支付' },
  { orderNo: 'TEST-1003', product: '轻薄键盘', amount: 199, payment: '已支付' },
  { orderNo: 'TEST-1004', product: 'USB-C 扩展坞', amount: 259, payment: '待支付' },
];
const state = { query: '', labels: [] };
const registered = new Map();
const names = ['query_orders', 'set_order_list_query', 'select_order_filter_options'];
const descriptions = {
  query_orders: '查询当前筛选下的测试订单，返回订单数据与总数。',
  set_order_list_query: '更新订单关键词，并同步更新页面列表。',
  select_order_filter_options: '选择订单支付状态：已支付或待支付；空数组清除筛选。',
};
const schema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: '订单号或商品关键词' },
    labels: {
      type: 'array',
      items: { type: 'string', enum: ['已支付', '待支付'] },
      uniqueItems: true,
    },
    delay: {
      type: 'integer',
      minimum: 0,
      maximum: 90000,
      default: 0,
      description: '返回前等待毫秒数',
    },
    fail: { type: 'boolean', default: false, description: '返回测试业务错误，不修改页面状态' },
  },
  additionalProperties: false,
};
function filtered() {
  return orders.filter(
    (order) =>
      `${order.orderNo} ${order.product}`.toLowerCase().includes(state.query.toLowerCase()) &&
      (!state.labels.length || state.labels.includes(order.payment)),
  );
}
function renderOrders() {
  const rows = filtered();
  const body = document.getElementById('orders');
  body.replaceChildren();
  for (const order of rows) {
    const tr = document.createElement('tr');
    for (const value of [order.orderNo, order.product, `¥${order.amount}`, order.payment]) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.append(td);
    }
    body.append(tr);
  }
  document.getElementById('query').value = state.query;
  document.getElementById('payment').value = state.labels.length === 1 ? state.labels[0] : '';
  document.getElementById('summary').textContent =
    `共 ${rows.length} 条 · 关键词：${state.query || '不限'} · 状态：${state.labels.join('、') || '全部'}`;
}
function renderLogs() {
  document.getElementById('call-count').textContent = `${window.fixtureCalls.length} 次`;
  const list = document.getElementById('logs');
  list.replaceChildren();
  for (const call of window.fixtureCalls.slice(-20).reverse()) {
    const entry = document.createElement('div');
    entry.className = 'log';
    const row = document.createElement('div');
    row.className = 'row';
    const title = document.createElement('code');
    title.textContent = call.name;
    const tag = document.createElement('span');
    tag.className = 'badge';
    tag.textContent = call.status;
    row.append(title, tag);
    const time = document.createElement('p');
    time.className = 'note';
    time.textContent = `${new Date(call.startedAt).toLocaleTimeString()} · ${call.durationMs === undefined ? '等待返回' : `${call.durationMs} ms`}`;
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '查看参数与结果';
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify({ arguments: call.args, result: call.result }, null, 2);
    details.append(summary, pre);
    entry.append(row, time, details);
    list.append(entry);
  }
}
function validArguments(args) {
  return (
    args &&
    typeof args === 'object' &&
    !Array.isArray(args) &&
    Object.keys(args).every((key) => Object.hasOwn(schema.properties, key)) &&
    (args.query === undefined || typeof args.query === 'string') &&
    (args.fail === undefined || typeof args.fail === 'boolean') &&
    (args.delay === undefined ||
      (Number.isInteger(args.delay) && args.delay >= 0 && args.delay <= 90000)) &&
    (args.labels === undefined ||
      (Array.isArray(args.labels) &&
        args.labels.every((s) => ['已支付', '待支付'].includes(s)) &&
        new Set(args.labels).size === args.labels.length))
  );
}
async function execute(name, args) {
  const call = { name, args: structuredClone(args), startedAt: Date.now(), status: '执行中' };
  window.fixtureCalls.push(call);
  renderLogs();
  const valid = validArguments(args);
  if (valid) await new Promise((resolve) => setTimeout(resolve, args.delay || 0));
  const isError = !valid || args.fail === true;
  let payload;
  if (isError) {
    payload = {
      code: valid ? 'TEST_BUSINESS_ERROR' : 'INVALID_ARGUMENTS',
      message: valid
        ? '这是主动触发的测试业务错误，未修改筛选条件。'
        : '参数类型或取值不符合工具 Schema。',
    };
  } else {
    if (name === 'set_order_list_query') state.query = args.query ?? '';
    if (name === 'select_order_filter_options') state.labels = args.labels ?? [];
    const query = name === 'query_orders' && args.query !== undefined ? args.query : state.query;
    const rows = filtered().filter((order) =>
      `${order.orderNo} ${order.product}`.toLowerCase().includes(query.toLowerCase()),
    );
    payload = {
      name,
      arguments: args,
      filters: structuredClone(state),
      total: rows.length,
      records: rows,
    };
    renderOrders();
  }
  const result = { isError, content: [{ type: 'text', text: JSON.stringify(payload) }] };
  call.result = result;
  call.status = isError ? '业务错误' : '已返回';
  call.durationMs = Date.now() - call.startedAt;
  renderLogs();
  return result;
}
function updateRegistration() {
  const button = document.getElementById('registration');
  button.disabled = !api?.registerTool;
  button.textContent = registered.size ? '暂停工具注册' : '重新注册工具';
  status.dataset.tone = registered.size ? '' : 'off';
  status.textContent = registered.size
    ? `原生 WebMCP 已就绪 · 已注册 ${registered.size} 个工具`
    : '工具已暂停注册。插件应显示“页面尚未注册工具”。';
}
async function register() {
  document.getElementById('registration').disabled = true;
  try {
    for (const name of names)
      if (!registered.has(name)) {
        const controller = new AbortController();
        await api.registerTool(
          {
            name,
            description: descriptions[name],
            inputSchema: schema,
            execute: (args) => execute(name, args),
          },
          { signal: controller.signal },
        );
        registered.set(name, controller);
      }
    updateRegistration();
  } catch (error) {
    updateRegistration();
    status.dataset.tone = 'error';
    status.textContent = `工具注册失败（已注册 ${registered.size} 个）：${error.message}`;
  }
}
if (!api?.registerTool) {
  status.dataset.tone = 'error';
  status.textContent =
    '浏览器未提供原生 WebMCP 注册接口。请使用支持 WebMCP 的 Chrome 并开启测试功能。';
} else register();
document.getElementById('registration').addEventListener('click', async () => {
  if (!registered.size) return register();
  try {
    for (const [name, controller] of [...registered]) {
      if (typeof api.unregisterTool === 'function') await api.unregisterTool(name);
      else controller.abort();
      registered.delete(name);
    }
    updateRegistration();
  } catch (error) {
    updateRegistration();
    status.dataset.tone = 'error';
    status.textContent = `暂停注册失败：${error.message}`;
  }
});
document.getElementById('filters').addEventListener('submit', (event) => {
  event.preventDefault();
  state.query = document.getElementById('query').value;
  state.labels = document.getElementById('payment').value
    ? [document.getElementById('payment').value]
    : [];
  renderOrders();
});
for (const button of document.querySelectorAll('[data-copy]'))
  button.addEventListener('click', async () => {
    const feedback = document.getElementById('feedback');
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      feedback.textContent = `已复制：${button.dataset.copy}`;
    } catch {
      feedback.textContent = `请手动复制：${button.dataset.copy}`;
    }
  });
renderOrders();
