// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import {
  createDraft,
  fieldsFor,
  readForm,
  mapToForm,
} from '../apps/extension/src/ui/composables/argument-form';
import ArgumentEditor from '../apps/extension/src/ui/components/ArgumentEditor.vue';
const schema = {
  type: 'object',
  properties: {
    q: { type: 'string' },
    n: { type: 'integer' },
    b: { type: 'boolean' },
    e: { enum: [0, false, '0', null] },
    a: { type: 'array' },
    o: { type: 'object' },
  },
  additionalProperties: false,
};
const fields = fieldsFor(schema)!;
afterEach(() => vi.unstubAllGlobals());
describe('参数表单类型与无损转换', () => {
  it('初始不传入可选字段、不填默认值', () => {
    const draft = createDraft(schema);
    expect(draft.json).toBe('{}');
    expect(readForm(fields, draft.fields).value).toEqual({});
  });
  it('保留空字符串、0、false、枚举类型、数组和对象', () => {
    const value = { q: '', n: 0, b: false, e: false, a: [1, 'x'], o: { x: true } };
    expect(readForm(fields, mapToForm(fields, value))).toEqual({ value, errors: {} });
    for (const e of [0, false, '0', null])
      expect(readForm(fields, mapToForm(fields, { e })).value.e).toBe(e);
  });
  it('必填未填写不隐式变成空字符串', () => {
    const s = { ...schema, required: ['q'] };
    expect(readForm(fieldsFor(s)!, createDraft(s).fields).errors.q).toBeTruthy();
  });
  it('非法数字、整数与 JSON 阻止提交，取消勾选忽略无效输入', () => {
    const d = createDraft(schema).fields;
    for (const text of ['', 'x', '1.2', 'Infinity']) {
      d.n = { enabled: true, touched: true, text };
      expect(readForm(fields, d).errors.n).toBeTruthy();
    }
    d.a = { enabled: true, touched: true, text: '[broken' };
    expect(readForm(fields, d).errors.a).toBeTruthy();
    d.n.enabled = false;
    d.a.enabled = false;
    expect(readForm(fields, d)).toEqual({ value: {}, errors: {} });
  });
  it('拒绝丢弃额外字段或转换错误类型', () => {
    expect(() => mapToForm(fields, { extra: 1 })).toThrow();
    expect(() => mapToForm(fields, { n: '1' })).toThrow();
    expect(() => mapToForm(fields, { e: 'missing' })).toThrow();
  });
  it('复杂顶层 Schema 回退，复杂字段使用 JSON', () => {
    for (const s of [true, {}, { ...schema, oneOf: [] }, { ...schema, $ref: '#/definitions/x' }])
      expect(fieldsFor(s)).toBeNull();
    expect(
      fieldsFor({ properties: { x: { anyOf: [{ type: 'string' }, { type: 'number' }] } } })![0]
        .kind,
    ).toBe('json');
  });
  it('特殊属性名不污染原型', () => {
    const s = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}');
    const f = fieldsFor(s)!;
    const value = JSON.parse('{"__proto__":"safe"}');
    expect(readForm(f, mapToForm(f, value)).value).toEqual(value);
    expect(Object.getPrototypeOf(readForm(f, mapToForm(f, value)).value)).toBe(Object.prototype);
  });
});
function editor(s = schema) {
  const wrapper = mount(ArgumentEditor, {
    props: {
      schema: s,
      draft: createDraft(s),
      busy: false,
      executable: true,
      onDraft: (value) => {
        void wrapper.setProps({ draft: value });
      },
    },
  });
  const click = async (label: string) => {
    await wrapper
      .findAll('button')
      .find((b) => b.text() === label)!
      .trigger('click');
    await flushPromises();
  };
  return { wrapper, click };
}
describe('参数编辑交互', () => {
  it('双模式同步、无效 JSON 与额外字段不被丢弃', async () => {
    const { wrapper, click } = editor();
    await wrapper.find('[aria-label="传入 q"]').setValue(true);
    await wrapper.find('input[type="text"]').setValue('关键词');
    await click('JSON');
    expect(JSON.parse((wrapper.find('textarea').element as HTMLTextAreaElement).value)).toEqual({
      q: '关键词',
    });
    for (const value of ['{bad', '{"extra":1}', '{"n":"wrong"}']) {
      await wrapper.find('textarea').setValue(value);
      await click('表单');
      expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe(value);
      expect(wrapper.find('[role="status"]').exists()).toBe(true);
    }
    await wrapper.find('textarea').setValue('{"q":""}');
    await click('表单');
    expect(wrapper.find('input[type="text"]').element).toHaveProperty('value', '');
    wrapper.unmount();
  });
  it('示例填充后可编辑，空字符串需要明确填写', async () => {
    const { wrapper, click } = editor({ ...schema, required: ['q'] } as typeof schema);
    await click('执行工具');
    expect(wrapper.text()).toContain('请填写此参数');
    await click('设为空字符串');
    await click('JSON');
    expect(JSON.parse((wrapper.find('textarea').element as HTMLTextAreaElement).value)).toEqual({
      q: '',
    });
    await click('填入默认示例');
    expect(wrapper.emitted('draft')!.length).toBeGreaterThan(1);
    wrapper.unmount();
  });
  it('校验期间禁用切换和重复执行，并提交正确类型', async () => {
    let instance: any;
    vi.stubGlobal('chrome', { runtime: { getURL: (s: string) => s } });
    vi.stubGlobal(
      'Worker',
      class {
        onmessage: any;
        onerror: any;
        terminate() {}
        postMessage() {
          instance = this;
        }
      },
    );
    const { wrapper, click } = editor();
    await wrapper.find('[aria-label="传入 b"]').setValue(true);
    await wrapper.findAll('select')[0].setValue('false');
    await click('执行工具');
    expect(
      wrapper
        .findAll('button')
        .find((b) => b.text() === 'JSON')!
        .attributes('disabled'),
    ).toBeDefined();
    instance.onmessage({ data: { ok: true, errors: [] } });
    await flushPromises();
    expect(wrapper.emitted('execute')).toEqual([[{ b: false }]]);
    wrapper.unmount();
  });
  it('不完整草稿可在重新挂载后恢复', async () => {
    const { wrapper } = editor();
    await wrapper.find('[aria-label="传入 a"]').setValue(true);
    await wrapper.find('textarea').setValue('[unfinished');
    const draft = wrapper.props('draft');
    wrapper.unmount();
    const reopened = mount(ArgumentEditor, {
      props: { schema, draft, busy: false, executable: true },
    });
    expect(reopened.find('textarea').element).toHaveProperty('value', '[unfinished');
    reopened.unmount();
  });
});
