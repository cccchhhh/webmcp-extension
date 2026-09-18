import { describe, it, expect } from 'vitest';
import { complete } from '../apps/extension/src/ai/providers/openai';
import { endpoint } from '../apps/extension/src/ai/credentials';
import { catalog, modelResult } from '../apps/extension/src/ai/tool-catalog';
import type { ModelProfile } from '../packages/protocol/chat';
export const profile: ModelProfile = {
  id: crypto.randomUUID(),
  version: 1,
  name: 'test',
  protocol: 'openai-chat-completions',
  baseUrl: 'https://example.com/v1',
  model: 'test',
  credentialId: 'test',
  keyStorage: 'session',
  redactFields: ['token'],
};
const sse = (delta: object, finish_reason: string | null = null) =>
  'data: ' + JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] }) + '\r\n\r\n';
function fake(text: string, step = 1) {
  const data = new TextEncoder().encode(text);
  let i = 0;
  return (async () =>
    new Response(
      new ReadableStream({
        pull(c) {
          if (i >= data.length) c.close();
          else {
            c.enqueue(data.slice(i, i + step));
            i += step;
          }
        },
      }),
    )) as typeof fetch;
}
describe('聊天供应商协议', () => {
  it('跨字节中文、CRLF 和工具参数聚合，只接受完整终止', async () => {
    const data =
      sse({ content: '你好' }) +
      sse({
        tool_calls: [
          { index: 0, id: 'call_a', function: { name: 'webmcp_0001', arguments: '{"a":' } },
        ],
      }) +
      sse({ tool_calls: [{ index: 0, function: { arguments: '1}' } }] }, 'tool_calls') +
      'data: [DONE]\r\n\r\n';
    const out = await complete(
      profile,
      'secret',
      [],
      [],
      new AbortController().signal,
      () => {},
      fake(data),
    );
    expect(out.message.content).toBe('你好');
    expect(out.message.tool_calls?.[0].function.arguments).toBe('{"a":1}');
    expect(out.usage).toBeUndefined();
  });
  it('流中断、截断原因、重复工具 ID 均拒绝执行', async () => {
    for (const data of [
      sse({ content: 'partial' }),
      sse({}, 'length') + 'data: [DONE]\n\n',
      sse(
        {
          tool_calls: [
            { index: 0, id: 'x', function: { name: 'a', arguments: '{}' } },
            { index: 1, id: 'x', function: { name: 'b', arguments: '{}' } },
          ],
        },
        'tool_calls',
      ) + 'data: [DONE]\n\n',
    ])
      await expect(
        complete(profile, 'secret', [], [], new AbortController().signal, () => {}, fake(data)),
      ).rejects.toThrow();
  });
  it('认证错误不暴露服务端正文，重定向与 Cookie 被禁用', async () => {
    const fetcher = (async (_url, init) => {
      expect(init?.redirect).toBe('error');
      expect(init?.credentials).toBe('omit');
      return new Response('SECRET_BODY', { status: 401 });
    }) as typeof fetch;
    await expect(
      complete(profile, 'secret', [], [], new AbortController().signal, () => {}, fetcher),
    ).rejects.toThrow('模型凭证或权限不可用');
  });
  it('地址只追加协议路径，拒绝认证、query、非本地 HTTP', () => {
    expect(endpoint('https://example.com/custom/')).toBe(
      'https://example.com/custom/chat/completions',
    );
    expect(endpoint('http://localhost:456/v1')).toContain('/v1/chat/completions');
    for (const url of [
      'http://example.com',
      'https://user:pass@example.com',
      'https://example.com?q=1',
      'https://example.com/chat/completions',
    ])
      expect(() => endpoint(url)).toThrow();
  });
  it('工具别名与原名隔离，限制 Schema 与预算', () => {
    const out = catalog(
      [
        {
          name: '中文 工具',
          description: 'desc',
          inputSchema: { type: 'object' },
          executable: true,
        },
      ],
      ['中文 工具'],
    );
    expect(out.mapping.get('webmcp_0001')?.name).toBe('中文 工具');
    expect(() => catalog([], Array(31).fill('x'))).toThrow();
    expect(() =>
      catalog(
        [{ name: 'x', description: '', inputSchema: { $ref: 'http://evil' }, executable: true }],
        ['x'],
      ),
    ).toThrow();
  });
  it('结果递归脱敏并结构化裁剪', () => {
    expect(modelResult({ nested: { token: 'secret' } }, ['token'])).toEqual({
      nested: { token: '[REDACTED]' },
    });
    expect(
      modelResult({ content: [{ type: 'text', text: '{"token":"secret"}' }] }, ['token']),
    ).toEqual({ content: [{ type: 'text', text: '{"token":"[REDACTED]"}' }] });
    expect(modelResult('x'.repeat(1000), [], 100)).toMatchObject({ truncated: true });
  });
});
it('供应商回显凭证时不写入正文或工具参数', async () => {
  const out = await complete(
    profile,
    'secret',
    [],
    [],
    new AbortController().signal,
    () => {},
    fake(sse({ content: 'secret' }, 'stop') + 'data: [DONE]\n\n'),
  );
  expect(out.message.content).toBe('[REDACTED]');
  await expect(
    complete(
      profile,
      'secret',
      [],
      [],
      new AbortController().signal,
      () => {},
      fake(
        sse(
          {
            tool_calls: [
              { index: 0, id: 'x', function: { name: 'tool', arguments: '{"key":"secret"}' } },
            ],
          },
          'tool_calls',
        ) + 'data: [DONE]\n\n',
      ),
    ),
  ).rejects.toThrow('包含凭证');
});
it('调整授权范围后，历史工具别名不会指向另一工具', () => {
  const aliases: [string, string][] = [];
  const tools = ['a', 'b'].map((name) => ({
    name,
    description: '',
    inputSchema: { type: 'object' },
    executable: true,
  }));
  catalog(tools, ['a', 'b'], aliases);
  const subset = catalog(tools, ['b'], aliases);
  expect(subset.mapping.get('webmcp_0002')?.name).toBe('b');
  expect(subset.mapping.has('webmcp_0001')).toBe(false);
});
