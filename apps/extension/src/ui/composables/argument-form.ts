import type { Schema } from '../../../../../packages/protocol';
export interface Field {
  name: string;
  required: boolean;
  description: string;
  kind: string;
  choices?: unknown[];
}
export interface FieldDraft {
  enabled: boolean;
  text: string;
  touched: boolean;
  badInput?: boolean;
}
export interface ArgumentDraft {
  mode: 'form' | 'json';
  json: string;
  fields: Record<string, FieldDraft>;
}
const complex = [
  '$ref',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'dependencies',
  'patternProperties',
];
export function fieldsFor(schema: Schema): Field[] | null {
  if (
    typeof schema !== 'object' ||
    complex.some((k) => k in schema) ||
    (schema.type !== undefined && schema.type !== 'object') ||
    !schema.properties ||
    typeof schema.properties !== 'object' ||
    Array.isArray(schema.properties)
  )
    return null;
  const properties = schema.properties as Record<string, Schema>;
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  if (required.some((name) => !Object.hasOwn(properties, name))) return null;
  return Object.entries(properties).map(([name, spec]) => {
    const s = typeof spec === 'object' ? spec : {};
    const simple = !complex.some((k) => k in s);
    const choices =
      simple &&
      Array.isArray(s.enum) &&
      s.enum.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
        ? s.enum
        : undefined;
    const kind = choices
      ? 'enum'
      : simple && ['string', 'number', 'integer', 'boolean'].includes(String(s.type))
        ? String(s.type)
        : 'json';
    return {
      name,
      required: required.includes(name),
      description: typeof s.description === 'string' ? s.description : '',
      kind,
      choices,
    };
  });
}
export function createDraft(schema: Schema): ArgumentDraft {
  const fields = fieldsFor(schema);
  return {
    mode: fields ? 'form' : 'json',
    json: '{}',
    fields: Object.fromEntries(
      (fields || []).map((f) => [f.name, { enabled: f.required, text: '', touched: false }]),
    ),
  };
}
export function readForm(fields: Field[], drafts: Record<string, FieldDraft>) {
  const entries: [string, unknown][] = [];
  const errors: Record<string, string> = Object.create(null);
  for (const field of fields) {
    const d = drafts[field.name];
    if (!d || (!field.required && !d.enabled)) continue;
    try {
      if (!d.touched) throw Error('请填写此参数');
      let value: unknown;
      if (field.kind === 'string') value = d.text;
      else if (field.kind === 'boolean') {
        if (!['true', 'false'].includes(d.text)) throw Error('请选择 true 或 false');
        value = d.text === 'true';
      } else if (field.kind === 'enum') {
        if (!/^\d+$/.test(d.text) || Number(d.text) >= field.choices!.length)
          throw Error('请选择一个值');
        value = field.choices![Number(d.text)];
      } else if (field.kind === 'number' || field.kind === 'integer') {
        if (
          d.badInput ||
          !d.text.trim() ||
          !/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(d.text) ||
          !Number.isFinite(Number(d.text))
        )
          throw Error('请输入有效数字');
        value = Number(d.text);
        if (field.kind === 'integer' && !Number.isInteger(value)) throw Error('请输入整数');
      } else {
        try {
          value = JSON.parse(d.text);
        } catch {
          throw Error('请输入有效 JSON');
        }
      }
      entries.push([field.name, value]);
    } catch (e) {
      errors[field.name] = (e as Error).message;
    }
  }
  return { value: Object.fromEntries(entries), errors };
}
export function parseArguments(json: string): Record<string, unknown> {
  if (new TextEncoder().encode(json).length > 262144) throw Error('参数超过 256 KiB');
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    throw Error('JSON 格式无效，请检查引号、逗号和括号');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('参数必须为 JSON 对象');
  return value;
}
export function mapToForm(
  fields: Field[],
  value: Record<string, unknown>,
): Record<string, FieldDraft> {
  if (Object.keys(value).some((name) => !fields.some((f) => f.name === name)))
    throw Error('包含表单未定义的字段，请继续使用 JSON 编辑');
  return Object.fromEntries(
    fields.map((f) => {
      if (!Object.hasOwn(value, f.name))
        return [f.name, { enabled: f.required, text: '', touched: false }];
      const v = value[f.name];
      let text: string;
      if (f.kind === 'json') text = JSON.stringify(v, null, 2);
      else if (f.kind === 'enum') {
        const index = f.choices!.findIndex((c) => Object.is(c, v));
        if (index < 0) throw Error(`${f.name} 的值无法映射，请继续使用 JSON 编辑`);
        text = String(index);
      } else {
        const expected = f.kind === 'integer' ? 'number' : f.kind;
        if (typeof v !== expected || (f.kind === 'integer' && !Number.isInteger(v)))
          throw Error(`${f.name} 类型无法映射，请继续使用 JSON 编辑`);
        text = String(v);
      }
      return [f.name, { enabled: true, text, touched: true }];
    }),
  );
}
