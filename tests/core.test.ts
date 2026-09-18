import { describe, it, expect } from 'vitest';
import { checkSchema, validate, example } from '../packages/schema-validation';
import { emptySnapshot, RequestSchema, type CallRecord } from '../packages/protocol';
import { expire, settle, trim } from '../apps/extension/src/background/state';
const call = (): CallRecord => ({
  callId: 'a',
  pageId: 'p',
  catalogVersion: 'v',
  toolName: 'tool',
  source: 'manual',
  delivery: 'sent',
  execution: 'running',
  business: 'unclassified',
  startedAt: new Date(0).toISOString(),
  deadline: 60000,
});
describe('Schema', () => {
  it('检查类型、必填、额外属性且不更改输入', () => {
    const schema = {
      type: 'object',
      properties: { x: { type: 'integer', default: 3 } },
      required: ['x'],
      additionalProperties: false,
    };
    const v = { x: '3', y: 1 };
    expect(validate(schema, v).ok).toBe(false);
    expect(v).toEqual({ x: '3', y: 1 });
    expect(validate(schema, { x: 3 }).ok).toBe(true);
    expect(validate(schema, {}).ok).toBe(false);
  });
  it('拒绝未知关键词、方言及远程引用', () => {
    for (const s of [
      { unknown: true },
      { $schema: '2020-12' },
      { $ref: 'https://example.com/schema' },
      { $ref: '#/definitions/missing' },
    ])
      expect(checkSchema(s).ok).toBe(false);
  });
  it('组合、数组、本地引用', () => {
    const s = {
      definitions: { value: { type: 'integer', minimum: 2 } },
      type: 'array',
      items: { $ref: '#/definitions/value' },
      minItems: 1,
      uniqueItems: true,
    };
    expect(validate(s, [2, 3]).ok).toBe(true);
    expect(validate(s, [1]).ok).toBe(false);
    expect(validate(s, [2, 2]).ok).toBe(false);
    expect(validate({ oneOf: [{ type: 'string' }, { type: 'integer' }] }, 2).ok).toBe(true);
    expect(validate({ not: { type: 'string' } }, 'x').ok).toBe(false);
  });
  it('默认示例仅显式生成', () => {
    expect(
      example({
        type: 'object',
        properties: { x: { default: 3 }, s: { type: 'string' } },
        required: ['s'],
      }),
    ).toEqual({ x: 3, s: '请填写' });
    expect(example({ oneOf: [{ type: 'string' }, { type: 'number' }] })).toEqual({});
  });
  it('format 为注解', () =>
    expect(validate({ type: 'string', format: 'email' }, 'not an email').ok).toBe(true));
  it('拒绝超过深度限制', () => {
    let s: any = { type: 'string' };
    for (let i = 0; i < 34; i++) s = { type: 'object', properties: { x: s } };
    expect(checkSchema(s).ok).toBe(false);
  });
});
describe('调用与历史', () => {
  it('超时保留锁，晚到结果归属原调用并解锁', () => {
    const s = emptySnapshot();
    s.calls = [call()];
    s.locks.p = 'a';
    expire(s, 60001);
    expect(s.calls[0].execution).toBe('unknown');
    expect(s.locks.p).toBe('a');
    settle(s, s.calls[0], { result: { ok: true } }, 70000);
    expect(s.calls[0].late).toBe(true);
    expect(s.calls[0].execution).toBe('returned');
    expect(s.locks.p).toBeUndefined();
  });
  it('业务错误不同于未知', () => {
    const s = emptySnapshot();
    const c = call();
    settle(s, c, { result: { isError: true }, business: 'error' });
    expect(c.execution).toBe('returned');
    expect(c.business).toBe('error');
  });
  it('释放历史完整载荷', () => {
    const s = emptySnapshot();
    s.calls = Array.from({ length: 10 }, (_, i) => ({
      ...call(),
      callId: String(i),
      execution: 'returned',
      rawResult: 'a'.repeat(1024 * 1024),
    }));
    trim(s);
    expect(s.calls.some((c) => c.released)).toBe(true);
    expect(s.calls.length).toBe(10);
  });
  it('限定命令及来源', () => {
    expect(
      RequestSchema.safeParse({
        requestId: crypto.randomUUID(),
        command: {
          type: 'INVOKE',
          pageId: crypto.randomUUID(),
          catalogVersion: crypto.randomUUID(),
          toolName: 'a',
          arguments: {},
          source: 'manual',
        },
      }).success,
    ).toBe(false);
  });
});
describe('Schema 边界', () => {
  it('元 Schema 拒绝非法契约', () => {
    expect(checkSchema({ type: 'banana' }).ok).toBe(false);
    expect(checkSchema({ required: 'x' }).ok).toBe(false);
    expect(checkSchema({ minimum: '1' }).ok).toBe(false);
  });
  it('布尔 Schema', () => {
    expect(validate(false, {}).ok).toBe(false);
    expect(validate(true, {}).ok).toBe(true);
  });
  it('条件、依赖、属性名与元组数组', () => {
    expect(
      validate(
        {
          if: { properties: { kind: { const: 'a' } } },
          then: { required: ['x'] },
          else: { required: ['y'] },
        },
        { kind: 'a' },
      ).ok,
    ).toBe(false);
    expect(validate({ dependencies: { x: ['y'] } }, { x: 1 }).ok).toBe(false);
    expect(validate({ propertyNames: { pattern: '^[a-z]+$' } }, { ABC: 1 }).ok).toBe(false);
    expect(
      validate({ items: [{ type: 'string' }, { type: 'integer' }], additionalItems: false }, [
        'a',
        1,
        2,
      ]).ok,
    ).toBe(false);
  });
  it('数值与字符串约束', () => {
    expect(validate({ type: 'number', multipleOf: 2, exclusiveMinimum: 2, maximum: 8 }, 4).ok).toBe(
      true,
    );
    expect(validate({ type: 'number', multipleOf: 2 }, 3).ok).toBe(false);
    expect(validate({ type: 'string', maxLength: 2 }, 'abc').ok).toBe(false);
  });
  it('超过 100 条时保留在途记录，总数不超限', () => {
    const s = emptySnapshot();
    s.calls = Array.from({ length: 120 }, (_, i) => ({
      ...call(),
      callId: String(i),
      pageId: String(i),
      execution: 'returned',
    }));
    s.calls[119].execution = 'running';
    s.locks['119'] = '119';
    trim(s);
    expect(s.calls).toHaveLength(100);
    expect(s.calls.some((c) => c.callId === '119')).toBe(true);
  });
  it('其他文档锁不会被晚到结果释放', () => {
    const s = emptySnapshot();
    s.locks.p = 'new';
    settle(s, call(), { result: 'old' });
    expect(s.locks.p).toBe('new');
  });
});
