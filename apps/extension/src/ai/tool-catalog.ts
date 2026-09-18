import { bytes, type PageTool } from '../../../../packages/protocol';
import type { ModelTool } from './providers/openai';
export function catalog(tools: PageTool[], names: string[], aliases?: [string, string][]) {
  const stableAliases = new Map(aliases);
  if (names.length > 30) throw Error('每会话最多选择 30 个工具');
  const mapping = new Map<string, PageTool>();
  const definitions: ModelTool[] = names.map((name) => {
    const t = tools.find((t) => t.name === name && t.executable);
    if (!t) throw Error('TOOL_UNAVAILABLE');
    if (typeof t.inputSchema !== 'object' || t.inputSchema.type !== 'object')
      throw Error(`${name}：当前模型接口需要对象 Schema`);
    const inspect = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      for (const [k, v] of Object.entries(value)) {
        if (k === '$ref' && (typeof v !== 'string' || !v.startsWith('#/')))
          throw Error(`${name}：不支持外部 Schema 引用`);
        inspect(v);
      }
    };
    inspect(t.inputSchema);
    let alias = stableAliases.get(name);
    if (!alias) {
      alias = 'webmcp_' + String(stableAliases.size + 1).padStart(4, '0');
      stableAliases.set(name, alias);
      aliases?.push([name, alias]);
    }
    mapping.set(alias, t);
    return {
      type: 'function',
      function: { name: alias, description: t.description, parameters: t.inputSchema },
    };
  });
  if (bytes(definitions) > 128 * 1024) throw Error('工具定义超过 128 KiB，请减少选择');
  return { mapping, definitions };
}
export function modelResult(value: unknown, fields: string[], limit = 64 * 1024): unknown {
  const redact = (v: unknown): unknown => {
    if (typeof v === 'string' && /^[\s]*[\[{]/.test(v)) {
      try {
        return JSON.stringify(redact(JSON.parse(v)));
      } catch {
        return v;
      }
    }
    return Array.isArray(v)
      ? v.map(redact)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v).map(([k, x]) => [
              k,
              fields.some((f) => f.toLowerCase() === k.toLowerCase()) ? '[REDACTED]' : redact(x),
            ]),
          )
        : v;
  };
  const result = redact(value ?? null),
    originalBytes = bytes(result);
  return originalBytes <= limit
    ? result
    : { truncated: true, originalBytes, summary: '结果超过外发预算，请在本地调用记录查看完整结果' };
}

export function compatibleTools(tools: PageTool[]) {
  return tools.map((tool) => {
    let reason = tool.unavailableReason ?? '';
    try {
      catalog([tool], [tool.name]);
    } catch (e) {
      reason = e instanceof Error ? e.message : '模型接口不兼容';
    }
    return { tool, reason };
  });
}
