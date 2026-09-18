import { describe, it, expect, vi, afterEach } from 'vitest';
import { ChatAuthority } from '../apps/extension/src/background/chat';
import { invoke } from '../apps/extension/src/background/scheduler';
import { emptySnapshot, type Page, type CallRecord } from '../packages/protocol';
import type { ChatCommand, ChatCallContext } from '../packages/protocol/chat';
afterEach(() => vi.useRealTimers());
function setup() {
  vi.useFakeTimers();
  const state = emptySnapshot();
  const owner = {};
  const page: Page = {
    pageId: crypto.randomUUID(),
    documentId: 'doc',
    catalogVersion: crypto.randomUUID(),
    tabId: 1,
    title: 'page',
    url: 'https://example.com',
    discovery: 'ready',
    tools: [
      { name: 'tool', description: 'test', inputSchema: { type: 'object' }, executable: true },
    ],
  };
  state.pages[1] = page;
  const persist = vi.fn(async () => {}),
    send = vi.fn(async () => ({ accepted: true }));
  const validation = vi.fn(async () => ({ ok: true as const, errors: [] }));
  const authority = new ChatAuthority({
    state: () => state,
    persist,
    profileValid: async () => true,
    invoke: (c, ctx) =>
      invoke(c, ctx, {
        state: () => state,
        persist,
        send,
        validation,
        permitted: async () => true,
        authorized: () => true,
      }),
  });
  const target = {
    pageId: page.pageId,
    documentId: page.documentId,
    catalogVersion: page.catalogVersion,
  };
  const sessionId = crypto.randomUUID(),
    profileId = crypto.randomUUID();
  const grant = (mode: 'confirm' | 'auto' = 'auto', who = owner, takeover = false) =>
    authority.handle(
      {
        type: 'CREATE_CHAT_GRANT',
        sessionId,
        profileId,
        profileVersion: 1,
        target,
        toolNames: ['tool'],
        mode,
        takeover,
      },
      who,
    ) as Promise<{ grantId: string }>;
  const command = (grantId: string): Extract<ChatCommand, { type: 'CHAT_INVOKE' }> => ({
    type: 'CHAT_INVOKE',
    context: {
      sessionId,
      runId: crypto.randomUUID(),
      invocationId: crypto.randomUUID(),
      providerToolCallId: 'call',
      grantId,
    },
    target,
    toolName: 'tool',
    arguments: { x: 1 },
  });
  return {
    state,
    owner,
    page,
    persist,
    send,
    validation,
    authority,
    target,
    sessionId,
    grant,
    command,
  };
}
describe('聊天授权与调度', () => {
  it('并发重发只执行一次，同 ID 更换参数被拒绝', async () => {
    const h = setup(),
      g = await h.grant(),
      c = h.command(g.grantId);
    const results = await Promise.all([
      h.authority.handle(c, h.owner),
      h.authority.handle(c, h.owner),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.state.calls[0].source).toBe('aiChat');
    await expect(h.authority.handle({ ...c, arguments: { x: 2 } }, h.owner)).rejects.toThrow(
      'INVOCATION_CONFLICT',
    );
  });
  it('单次确认绑定实际参数，不能替换', async () => {
    const h = setup(),
      g = await h.grant('confirm'),
      c = h.command(g.grantId);
    const a = (await h.authority.handle(
      {
        type: 'APPROVE_CHAT_CALL',
        context: c.context,
        toolName: c.toolName,
        arguments: c.arguments,
      },
      h.owner,
    )) as { approvalToken: string };
    await expect(h.authority.handle({ ...c, ...a, arguments: { x: 2 } }, h.owner)).rejects.toThrow(
      'APPROVAL_REQUIRED',
    );
    expect(h.send).not.toHaveBeenCalled();
    await h.authority.handle({ ...c, ...a }, h.owner);
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('校验期间撤销授权阻止发送', async () => {
    const h = setup(),
      g = await h.grant(),
      c = h.command(g.grantId);
    h.validation.mockImplementation(async () => {
      await h.authority.handle({ type: 'REVOKE_CHAT_GRANT', grantId: g.grantId }, h.owner);
      return { ok: true, errors: [] };
    });
    await expect(h.authority.handle(c, h.owner)).rejects.toThrow();
    expect(h.send).not.toHaveBeenCalled();
  });
  it('停止、Port 断开、跨所有者使用均阻止调用', async () => {
    for (const mode of ['stop', 'disconnect', 'foreign']) {
      const h = setup(),
        g = await h.grant(),
        c = h.command(g.grantId);
      if (mode === 'stop')
        await h.authority.handle(
          { type: 'CANCEL_CHAT_RUN', sessionId: h.sessionId, runId: c.context.runId },
          h.owner,
        );
      if (mode === 'disconnect') h.authority.disconnect(h.owner);
      await expect(h.authority.handle(c, mode === 'foreign' ? {} : h.owner)).rejects.toThrow();
      expect(h.send).not.toHaveBeenCalled();
    }
  });
  it('另一个侧边栏只读，显式接管使原授权失效', async () => {
    const h = setup(),
      g = await h.grant(),
      second = {};
    await expect(h.grant('auto', second)).rejects.toThrow('SESSION_READ_ONLY');
    await h.grant('auto', second, true);
    await expect(h.authority.handle(h.command(g.grantId), h.owner)).rejects.toThrow();
  });
  it('持久化失败不发送副作用，保留拒绝记录', async () => {
    const h = setup(),
      g = await h.grant();
    h.persist.mockRejectedValue(Error('quota'));
    await expect(h.authority.handle(h.command(g.grantId), h.owner)).rejects.toThrow();
    expect(h.send).not.toHaveBeenCalled();
    expect(h.state.calls[0].delivery).toBe('not_sent');
    expect(Object.keys(h.state.locks)).toHaveLength(0);
  });
  it('共享文档锁阻止聊天覆盖手动操作', async () => {
    const h = setup(),
      g = await h.grant();
    h.state.locks[h.page.pageId] = 'manual';
    await expect(h.authority.handle(h.command(g.grantId), h.owner)).rejects.toThrow('PAGE_BUSY');
    expect(h.send).not.toHaveBeenCalled();
  });
  it('裁剪记录不丢去重墓碑，读取返回 RESULT_RELEASED', async () => {
    const h = setup(),
      g = await h.grant(),
      c = h.command(g.grantId);
    await h.authority.handle(c, h.owner);
    h.state.calls = [];
    await h.authority.handle(c, h.owner);
    expect(h.send).toHaveBeenCalledTimes(1);
    await expect(
      h.authority.handle(
        {
          type: 'READ_CHAT_RESULT',
          sessionId: h.sessionId,
          invocationId: c.context.invocationId,
          grantId: g.grantId,
        },
        h.owner,
      ),
    ).rejects.toThrow('RESULT_RELEASED');
  });
});
