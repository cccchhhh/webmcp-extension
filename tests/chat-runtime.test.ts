import { it, expect, vi, beforeEach } from 'vitest';
import { ChatRuntime } from '../apps/extension/src/ai/chat-runtime';
import { complete } from '../apps/extension/src/ai/providers/openai';
import type { ModelProfile } from '../packages/protocol/chat';
import type { Page } from '../packages/protocol';
vi.mock('../apps/extension/src/ai/providers/openai', () => ({ complete: vi.fn() }));
const profile: ModelProfile = {
  id: crypto.randomUUID(),
  version: 1,
  name: 'test',
  protocol: 'openai-chat-completions',
  baseUrl: 'https://example.com',
  model: 'test',
  credentialId: 'x',
  keyStorage: 'session',
  redactFields: ['token'],
};
const page: Page = {
  pageId: crypto.randomUUID(),
  tabId: 1,
  documentId: 'doc',
  catalogVersion: crypto.randomUUID(),
  url: 'https://example.com/?secret=1',
  title: 'test',
  discovery: 'ready',
  tools: [{ name: 'tool', description: '', inputSchema: { type: 'object' }, executable: true }],
};
const toolCall = (id: string) => ({
  id,
  type: 'function' as const,
  function: { name: 'webmcp_0001', arguments: '{}' },
});
beforeEach(() => vi.clearAllMocks());
function setup(execution = 'returned') {
  const events: string[] = [];
  const request = vi.fn(async (c: any) => {
    events.push(c.type);
    if (c.type === 'CREATE_CHAT_GRANT') return { grantId: crypto.randomUUID() };
    if (c.type === 'CHAT_INVOKE') return { callId: crypto.randomUUID() };
    if (c.type === 'GET_CHAT_INVOCATION') return { found: true, execution };
    if (c.type === 'READ_CHAT_RESULT')
      return { execution, business: 'unclassified', result: { token: 'secret', ok: true } };
    return {};
  });
  const save = vi.fn(async () => {});
  const runtime = new ChatRuntime({
    request: request as any,
    save,
    key: async () => 'key',
    changed: () => {},
  });
  return { runtime, request, events, save };
}
it('多工具串行且原生 tool_call_id 成对回传，结果脱敏', async () => {
  const h = setup();
  vi.mocked(complete)
    .mockResolvedValueOnce({
      message: { role: 'assistant', content: null, tool_calls: [toolCall('one'), toolCall('two')] },
      usage: undefined,
    })
    .mockResolvedValueOnce({ message: { role: 'assistant', content: 'done' }, usage: undefined });
  await h.runtime.grant(profile, page, ['tool'], 'auto');
  await h.runtime.send('go', profile, page, ['tool'], 'auto');
  expect(h.runtime.session.status).toBe('completed');
  expect(h.events.filter((e) => ['CHAT_INVOKE', 'READ_CHAT_RESULT'].includes(e))).toEqual([
    'CHAT_INVOKE',
    'READ_CHAT_RESULT',
    'CHAT_INVOKE',
    'READ_CHAT_RESULT',
  ]);
  const messages = vi.mocked(complete).mock.calls[1][2];
  expect(messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual([
    'one',
    'two',
  ]);
  expect(JSON.stringify(messages)).not.toContain('secret');
  expect(h.runtime.session.origin).toBe('https://example.com');
});
it('未知结果阻断模型循环且不重试工具', async () => {
  const h = setup('unknown');
  vi.mocked(complete).mockResolvedValueOnce({
    message: { role: 'assistant', content: null, tool_calls: [toolCall('one')] },
    usage: undefined,
  });
  await h.runtime.grant(profile, page, ['tool'], 'auto');
  await h.runtime.send('go', profile, page, ['tool'], 'auto');
  expect(h.runtime.session.status).toBe('blocked_unknown');
  expect(complete).toHaveBeenCalledTimes(1);
  expect(h.events.filter((e) => e === 'CHAT_INVOKE')).toHaveLength(1);
  expect(h.events).not.toContain('READ_CHAT_RESULT');
});
it('批准等待期间停止不提交页面操作', async () => {
  const h = setup();
  vi.mocked(complete).mockResolvedValueOnce({
    message: { role: 'assistant', content: null, tool_calls: [toolCall('one')] },
    usage: undefined,
  });
  await h.runtime.grant(profile, page, ['tool'], 'confirm');
  const running = h.runtime.send('go', profile, page, ['tool'], 'confirm');
  await vi.waitFor(() => expect(h.runtime.session.status).toBe('awaiting_approval'));
  await h.runtime.stop();
  await running;
  expect(h.events).not.toContain('CHAT_INVOKE');
  expect(h.runtime.session.status).toBe('stopped');
});
it('执行前持久化失败禁止调用工具', async () => {
  const h = setup();
  await h.runtime.grant(profile, page, ['tool'], 'auto');
  h.save.mockRejectedValue(Error('quota'));
  await h.runtime.send('go', profile, page, ['tool'], 'auto');
  expect(h.events).not.toContain('CHAT_INVOKE');
  expect(complete).not.toHaveBeenCalled();
});
it('完整会话恢复只恢复记录，不请求模型', () => {
  const h = setup();
  const recovered = new ChatRuntime(
    { request: h.request as any, save: h.save, key: async () => '', changed: () => {} },
    h.runtime.session,
  );
  expect(recovered.session.status).toBe('interrupted');
  expect(complete).not.toHaveBeenCalled();
});
it('恢复时按 invocation 查回尚未收到 ACK 的调用，不重新提交', async () => {
  const h = setup('unknown');
  h.runtime.session.traces = [
    { invocationId: crypto.randomUUID(), name: 'tool', arguments: {}, status: '执行中' },
  ];
  h.request.mockImplementation(async (c: any) =>
    c.type === 'CREATE_CHAT_GRANT'
      ? { grantId: crypto.randomUUID() }
      : c.type === 'GET_CHAT_INVOCATION'
        ? { found: true, callId: 'recovered-call', execution: 'unknown' }
        : ({} as any),
  );
  await h.runtime.grant(profile, page, ['tool'], 'auto');
  expect(h.runtime.session.traces[0].callId).toBe('recovered-call');
  expect(h.runtime.session.status).toBe('blocked_unknown');
  expect(h.request.mock.calls.some(([c]) => c.type === 'CHAT_INVOKE')).toBe(false);
});
