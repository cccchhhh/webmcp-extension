import type {
  ModelProfile,
  ProviderMessage,
  ProviderToolCall,
} from '../../../../../packages/protocol/chat';
import { endpoint } from '../credentials';
export interface ModelTool {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}
export async function complete(
  profile: ModelProfile,
  key: string,
  messages: ProviderMessage[],
  tools: ModelTool[],
  signal: AbortSignal,
  onText: (text: string) => void,
  fetcher: typeof fetch = fetch,
) {
  if (!key) throw Error('缺少 API Key，请在模型设置中重新填写');
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  let idle: ReturnType<typeof setTimeout>;
  const reset = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(Error('模型首字节或流空闲超过 30 秒')), 30000);
  };
  const total = setTimeout(() => controller.abort(Error('模型请求超过 120 秒')), 120000);
  reset();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const res = await fetcher(endpoint(profile.baseUrl), {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: profile.model,
        messages,
        stream: true,
        ...(tools.length ? { tools, parallel_tool_calls: false } : {}),
      }),
    });
    if (!res.ok)
      throw Error(
        res.status === 401 || res.status === 403
          ? '模型凭证或权限不可用'
          : res.status === 429
            ? '模型限流或额度不足'
            : `模型服务请求失败（HTTP ${res.status}）`,
      );
    if (!res.body) throw Error('模型未返回响应流');
    reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '',
      text = '',
      done = false,
      finish: string | undefined,
      usage: unknown;
    const calls = new Map<number, ProviderToolCall>();
    let size = 0;
    const frame = (raw: string) => {
      const data = raw
        .split('\n')
        .filter((x) => x.startsWith('data:'))
        .map((x) => x.slice(5).trimStart())
        .join('\n');
      if (!data) return;
      if (data === '[DONE]') {
        done = true;
        return;
      }
      if (done) throw Error('模型终止后仍返回数据');
      const obj = JSON.parse(data);
      if (obj.error) throw Error('模型服务返回错误');
      if (obj.usage) usage = obj.usage;
      const choice = obj.choices?.find((x: any) => x.index === 0) ?? obj.choices?.[0];
      if (!choice) return;
      if (choice.finish_reason) finish = choice.finish_reason;
      const d = choice.delta ?? {};
      if (typeof d.content === 'string') {
        text += d.content;
        onText(text.replaceAll(key, '[REDACTED]'));
      }
      for (const t of d.tool_calls ?? []) {
        if (!Number.isInteger(t.index) || t.index < 0 || t.index > 29)
          throw Error('工具调用索引无效');
        const call = calls.get(t.index) ?? {
          id: '',
          type: 'function',
          function: { name: '', arguments: '' },
        };
        if (t.id) call.id += t.id;
        if (t.function?.name) call.function.name += t.function.name;
        if (t.function?.arguments) call.function.arguments += t.function.arguments;
        calls.set(t.index, call);
      }
    };
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      reset();
      size += chunk.value.byteLength;
      if (size > 2 * 1024 * 1024) throw Error('模型响应超过 2 MiB');
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let i: number;
      while ((i = buffer.indexOf('\n\n')) !== -1) {
        frame(buffer.slice(0, i));
        buffer = buffer.slice(i + 2);
      }
    }
    if (!done || !finish || !['stop', 'tool_calls'].includes(finish))
      throw Error('模型响应未完整结束，不执行工具');
    const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    if (
      toolCalls.length &&
      (finish !== 'tool_calls' ||
        toolCalls.some((t) => !t.id || !t.function.name) ||
        new Set(toolCalls.map((t) => t.id)).size !== toolCalls.length)
    )
      throw Error('工具请求不完整');
    if (!toolCalls.length && finish === 'tool_calls') throw Error('缺少工具请求');
    if (toolCalls.some((t) => t.function.arguments.includes(key)))
      throw Error('模型工具参数包含凭证，已阻止执行');
    return {
      message: {
        role: 'assistant',
        content: text.replaceAll(key, '[REDACTED]') || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      } as ProviderMessage,
      usage,
    };
  } catch (e) {
    if (controller.signal.aborted) throw controller.signal.reason ?? Error('已停止');
    // Never surface provider bodies or arbitrary network errors containing credentials.
    throw e instanceof Error
      ? new Error(e.message.replaceAll(key, '[REDACTED]'))
      : Error('模型请求失败');
  } finally {
    clearTimeout(idle!);
    clearTimeout(total);
    signal.removeEventListener('abort', abort);
    await reader?.cancel().catch(() => {});
  }
}
