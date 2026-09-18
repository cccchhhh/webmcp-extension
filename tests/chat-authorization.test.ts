import { describe, it, expect, vi } from 'vitest';
import { ChatRuntime } from '../apps/extension/src/ai/chat-runtime';
import type { ModelProfile, ChatSession } from '../packages/protocol/chat';
import type { Page } from '../packages/protocol';
const model: ModelProfile = {
  id: crypto.randomUUID(),
  version: 1,
  name: 'model',
  protocol: 'openai-chat-completions',
  baseUrl: 'https://example.com/v1',
  model: 'test',
  credentialId: 'key',
  keyStorage: 'session',
  redactFields: [],
};
function page(): Page {
  return {
    pageId: crypto.randomUUID(),
    documentId: 'doc',
    catalogVersion: crypto.randomUUID(),
    tabId: 1,
    url: 'https://example.com',
    title: 'page',
    discovery: 'ready',
    tools: [
      { name: 'a', description: 'a', inputSchema: { type: 'object' }, executable: true },
      { name: 'b', description: 'b', inputSchema: { type: 'object' }, executable: true },
      { name: 'bad', description: 'bad', inputSchema: true, executable: true },
    ],
  };
}
function setup(session?: ChatSession) {
  const request = vi.fn(async (c: any): Promise<any> =>
    c.type === 'CREATE_CHAT_GRANT'
      ? { grantId: crypto.randomUUID() }
      : c.type === 'GET_CHAT_INVOCATION'
        ? { execution: 'returned' }
        : {},
  );
  const key = vi.fn(async () => 'secret'),
    save = vi.fn(async () => {});
  const runtime = new ChatRuntime({ request, save, key, changed: () => {} }, session);
  return { runtime, scope: runtime.authorization, request, key, save };
}
const creates = (h: ReturnType<typeof setup>) =>
  h.request.mock.calls.map(([c]) => c).filter((c) => c.type === 'CREATE_CHAT_GRANT');
describe('会话默认授权', () => {
  it('默认授权全部兼容工具并自动执行，重复状态更新只授权一次', async () => {
    const h = setup(),
      p = page();
    await Promise.all([h.scope.sync(model, p), h.scope.sync(model, p)]);
    await h.scope.sync(model, p);
    expect(creates(h)).toHaveLength(1);
    expect(creates(h)[0]).toMatchObject({ toolNames: ['a', 'b'], mode: 'auto', takeover: false });
    expect(h.scope.names).toEqual(['a', 'b']);
  });
  it('空目录启用纯聊天，不申请站点权限', async () => {
    const h = setup(),
      p = { ...page(), tools: [], discovery: 'unsupported' as const };
    await h.scope.sync(model, p);
    expect(creates(h)[0]).toMatchObject({ toolNames: [], mode: 'auto' });
    expect(creates(h)[0].target).toBeUndefined();
  });
  it('凭证缺失只检查一次，更新配置后可以自动重试', async () => {
    const h = setup(),
      p = page();
    h.key.mockResolvedValue('');
    await h.scope.sync(model, p);
    await h.scope.sync(model, p);
    expect(h.key).toHaveBeenCalledTimes(1);
    expect(creates(h)).toHaveLength(0);
    h.key.mockResolvedValue('secret');
    await h.scope.sync({ ...model, version: 2 }, p);
    expect(creates(h)).toHaveLength(1);
  });
  it('撤销跨视图和会话恢复保持，只有手动恢复才创建新授权', async () => {
    const h = setup(),
      p = page();
    await h.scope.sync(model, p);
    await h.scope.revoke();
    await h.scope.sync(model, p);
    expect(creates(h)).toHaveLength(1);
    expect(h.runtime.session.authorization?.revoked).toBe(true);
    const reopened = setup(JSON.parse(JSON.stringify(h.runtime.session)));
    await reopened.scope.sync(model, p);
    expect(creates(reopened)).toHaveLength(0);
    await reopened.scope.apply(model, p);
    expect(creates(reopened)).toHaveLength(1);
    expect(reopened.runtime.session.authorization?.revoked).toBe(false);
  });
  it('调整范围前撤销旧授权，按选择和确认模式重建', async () => {
    const h = setup(),
      p = page();
    await h.scope.sync(model, p);
    await h.scope.edit();
    h.scope.setNames(['b']);
    h.scope.setMode('confirm');
    await h.scope.sync(model, p);
    expect(h.runtime.grantId).toBe('');
    await h.scope.apply(model, p);
    expect(creates(h)[1]).toMatchObject({ toolNames: ['b'], mode: 'confirm' });
    expect(h.runtime.session.authorization?.customized).toBe(true);
  });
  it('目录变化暂停且不自动扩权，显式重新绑定才授权新目录', async () => {
    const h = setup(),
      p = page();
    await h.scope.sync(model, p);
    const changed = {
      ...p,
      catalogVersion: crypto.randomUUID(),
      tools: [
        ...p.tools,
        { name: 'c', description: 'c', inputSchema: { type: 'object' }, executable: true },
      ],
    };
    await h.scope.sync(model, changed);
    await h.scope.sync(model, changed);
    expect(creates(h)).toHaveLength(1);
    expect(h.runtime.grantId).toBe('');
    await h.scope.apply(model, changed);
    expect(creates(h)[1].toolNames).toEqual(['a', 'b', 'c']);
  });
  it('超出目录预算不静默截取，可手动缩小范围', async () => {
    const h = setup(),
      p = page();
    p.tools = Array.from({ length: 31 }, (_, i) => ({ ...p.tools[0], name: 't' + i }));
    await h.scope.sync(model, p);
    expect(h.scope.names).toHaveLength(31);
    expect(creates(h)).toHaveLength(0);
    expect(h.scope.notice).toContain('30');
    h.scope.setNames(['t0']);
    await h.scope.apply(model, p);
    expect(creates(h)[0].toolNames).toEqual(['t0']);
    const changed = { ...p, catalogVersion: crypto.randomUUID() };
    await h.scope.sync(model, changed);
    await h.scope.apply(model, changed);
    expect(h.scope.notice).toContain('30');
    h.scope.setNames(['t1']);
    await h.scope.apply(model, changed);
    expect(creates(h)[1].toolNames).toEqual(['t1']);
  });
  it('恢复会话核查记录，不触发模型或工具；第二侧栏不自动接管', async () => {
    const h = setup(),
      p = page();
    await h.scope.sync(model, p);
    h.runtime.session.traces = [
      { invocationId: crypto.randomUUID(), name: 'a', arguments: {}, status: '执行中' },
    ];
    const recovery = setup(JSON.parse(JSON.stringify(h.runtime.session)));
    await recovery.scope.sync(model, p);
    expect(recovery.request.mock.calls.some(([c]) => c.type === 'GET_CHAT_INVOCATION')).toBe(true);
    expect(recovery.request.mock.calls.some(([c]) => c.type === 'CHAT_INVOKE')).toBe(false);
    const other = setup(JSON.parse(JSON.stringify(h.runtime.session)));
    other.request.mockRejectedValue(Error('SESSION_READ_ONLY'));
    await other.scope.sync(model, p);
    await other.scope.sync(model, p);
    expect(creates(other)).toHaveLength(1);
    expect(creates(other)[0].takeover).toBe(false);
    expect(other.scope.notice).toContain('SESSION_READ_ONLY');
  });
});
