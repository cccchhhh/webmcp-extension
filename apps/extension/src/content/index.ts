import {
  AdapterCommandSchema,
  bytes,
  type PageTool,
  type Schema,
} from '../../../../packages/protocol';
interface NativeTool {
  name: string;
  description?: string;
  inputSchema: Schema | string;
  window?: Window;
}
interface Context {
  getTools(): Promise<NativeTool[]>;
  executeTool(tool: NativeTool, args: string): Promise<unknown>;
  ontoolchange: (() => void) | null;
}
const host = globalThis as typeof globalThis & { __webmcpInstalled?: boolean };
if (!host.__webmcpInstalled) {
  host.__webmcpInstalled = true;
  const context = (document as Document & { modelContext?: Context }).modelContext;
  let version = crypto.randomUUID();
  let tools: NativeTool[] = [];
  let busy: string | undefined;
  const calls = new Map<
    string,
    {
      status: 'running' | 'settled';
      result?: unknown;
      errorCode?: string;
      business?: 'error' | 'unclassified';
    }
  >();
  const notify = (m: unknown) => chrome.runtime.sendMessage(m).catch(() => {});
  const serializable = (value: unknown): unknown => {
    const seen = new Set<object>();
    const walk = (v: unknown, depth: number) => {
      if (depth > 64) throw Error('RESULT_UNSERIALIZABLE');
      if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
      if (typeof v === 'number' && Number.isFinite(v)) return;
      if (typeof v !== 'object' || !v) throw Error('RESULT_UNSERIALIZABLE');
      if (seen.has(v)) throw Error('RESULT_UNSERIALIZABLE');
      seen.add(v);
      if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype)
        throw Error('RESULT_UNSERIALIZABLE');
      Object.values(v).forEach((x) => walk(x, depth + 1));
      seen.delete(v);
    };
    walk(value, 0);
    const raw = JSON.stringify(value);
    if (new TextEncoder().encode(raw).length > 1048576) throw Error('RESULT_TOO_LARGE');
    return JSON.parse(raw);
  };
  async function discover() {
    if (
      !context ||
      typeof context.getTools !== 'function' ||
      typeof context.executeTool !== 'function'
    )
      return { discovery: 'unsupported', tools: [], version };
    try {
      const found = (await context.getTools()).filter((t) => t.window === window);
      if (found.length > 200) throw Error('工具数量超过 200');
      tools = found;
      const names = new Set<string>();
      const result: PageTool[] = tools.map((t) => {
        if (
          typeof t.name !== 'string' ||
          !t.name.length ||
          t.name.length > 1024 ||
          names.has(t.name)
        )
          throw Error('工具名称无效或重复');
        names.add(t.name);
        let schema: Schema;
        try {
          schema = typeof t.inputSchema === 'string' ? JSON.parse(t.inputSchema) : t.inputSchema;
          if (schema === undefined) throw Error();
        } catch {
          return {
            name: t.name,
            description: String(t.description || '').slice(0, 8192),
            inputSchema: false,
            executable: false,
            unavailableReason: 'SCHEMA_UNSUPPORTED',
          };
        }
        const targeted = Array.from(document.querySelectorAll('form[toolname]')).some(
          (f) => f.getAttribute('toolname') === t.name && !!f.getAttribute('target'),
        );
        const large = new TextEncoder().encode(JSON.stringify(schema)).length > 131072;
        return {
          name: t.name,
          description: String(t.description || '').slice(0, 8192),
          inputSchema: large ? false : schema,
          executable: !targeted && !large,
          unavailableReason: targeted
            ? '不支持跨文档表单工具'
            : large
              ? 'Schema 超过 128 KiB'
              : undefined,
        };
      });
      return { discovery: result.length ? 'ready' : 'ready_empty', tools: result, version };
    } catch {
      return {
        discovery: 'discovery_failed',
        tools: [],
        version,
        error: '发现失败，请检查页面的工具契约',
      };
    }
  }
  if (context)
    context.ontoolchange = () => {
      version = crypto.randomUUID();
      void notify({ type: 'TOOLS_CHANGED' });
    };
  chrome.runtime.onMessage.addListener((raw, sender, reply) => {
    if (sender.id !== chrome.runtime.id || raw?.target !== 'adapter' || bytes(raw) > 300000) return;
    const parsed = AdapterCommandSchema.safeParse(raw);
    if (!parsed.success) return;
    const m = parsed.data;
    if (m.type === 'DISCOVER') {
      if (m.invalidate) version = crypto.randomUUID();
      void discover().then(reply);
      return true;
    }
    if (m.type === 'STATUS') {
      reply({ call: calls.get(m.callId) || null, busy });
      return;
    }
    if (m.type === 'EXECUTE') {
      const existing = calls.get(m.callId);
      if (existing) {
        reply({ accepted: true, ...existing });
        return;
      }
      const tool = tools.find((t) => t.name === m.toolName);
      if (!context || !tool || m.version !== version || busy || calls.size >= 1000) {
        reply({
          accepted: false,
          errorCode: busy ? 'PAGE_BUSY' : calls.size >= 1000 ? 'TOOL_UNAVAILABLE' : 'CATALOG_STALE',
        });
        return;
      }
      busy = m.callId;
      calls.set(m.callId, { status: 'running' });
      reply({ accepted: true });
      void (async () => {
        let outcome: {
          status: 'settled';
          result?: unknown;
          errorCode?: string;
          business?: 'error' | 'unclassified';
        };
        try {
          const raw = await context.executeTool(tool, JSON.stringify(m.arguments));
          const result = serializable(raw);
          let structured = result;
          if (typeof result === 'string') {
            try {
              structured = JSON.parse(result);
            } catch {}
          }
          outcome = {
            status: 'settled',
            result,
            business:
              structured !== null &&
              typeof structured === 'object' &&
              (structured as { isError?: boolean }).isError === true
                ? 'error'
                : 'unclassified',
          };
        } catch (e) {
          const code =
            e instanceof Error && ['RESULT_TOO_LARGE', 'RESULT_UNSERIALIZABLE'].includes(e.message)
              ? e.message
              : 'EXECUTION_UNKNOWN';
          outcome = {
            status: 'settled',
            errorCode: code,
            result: { error: (e instanceof Error ? e.message : String(e)).slice(0, 8192) },
          };
        }
        calls.set(m.callId, outcome);
        busy = undefined;
        await notify({ type: 'CALL_SETTLED', callId: m.callId, ...outcome });
        // Keep only bounded recovery payloads; retain IDs to prevent replay.
        let budget = 0;
        for (const entry of [...calls.values()].reverse()) {
          if (entry.result !== undefined) {
            budget += new TextEncoder().encode(JSON.stringify(entry.result)).length;
            if (budget > 2 * 1024 * 1024) {
              delete entry.result;
              entry.errorCode = 'RESULT_RELEASED';
            }
          }
        }
      })();
    }
  });
}
