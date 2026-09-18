import type { ChatCallContext } from '../../../../packages/protocol/chat';
import {
  bytes,
  type Snapshot,
  type Page,
  type Command,
  type CallRecord,
} from '../../../../packages/protocol';
import type { AgentCall } from '../../../../packages/protocol/remote';
import type { Validation } from '../../../../packages/schema-validation';
export type CallContext =
  | { kind: 'manual' }
  | { kind: 'remoteAgent'; agent: AgentCall }
  | { kind: 'aiChat'; chat: ChatCallContext; callId: string; authorized: () => boolean };
export interface SchedulerHooks {
  state(): Snapshot;
  validation(job: object): Promise<Validation>;
  permitted(page: Page): Promise<boolean>;
  send(page: Page, payload: object): Promise<{ accepted?: boolean; errorCode?: string }>;
  persist(): Promise<unknown>;
  authorized(call: AgentCall): boolean;
}
export async function invoke(
  command: Extract<Command, { type: 'INVOKE' }>,
  context: CallContext | AgentCall | undefined,
  hooks: SchedulerHooks,
) {
  const ctx: CallContext =
    context && 'kind' in context
      ? context
      : context
        ? { kind: 'remoteAgent', agent: context }
        : { kind: 'manual' };
  const agent = ctx.kind === 'remoteAgent' ? ctx.agent : undefined;
  const allowed = () => ctx.kind !== 'aiChat' || ctx.authorized();
  if (!allowed()) throw Error('CHAT_GRANT_REVOKED');
  const state = hooks.state();
  const { validation, persist, send } = hooks;
  const remote = { authorized: hooks.authorized };
  if (!allowed() || (agent && !remote.authorized(agent))) throw Error('PAGE_UNAVAILABLE');
  if (agent && state.calls.some((c) => c.callId === agent.callId)) return;
  const page = Object.values(state.pages).find((p) => p.pageId === command.pageId);
  if (!page) throw Error('PAGE_UNAVAILABLE');
  if (state.locks[page.pageId]) throw Error('PAGE_BUSY');
  if (bytes(command.arguments) > 262144) throw Error('INVALID_ARGUMENTS：参数超过 256 KiB');
  const tool = page.tools.find((t) => t.name === command.toolName);
  if (!tool?.executable) throw Error('TOOL_UNAVAILABLE');
  if (page.catalogVersion !== command.catalogVersion) throw Error('CATALOG_STALE');
  const checked = await validation({ schema: tool.inputSchema, value: command.arguments });
  if (!checked.ok) throw Error(`${checked.code}：${checked.errors.join('；')}`);
  // Recheck after asynchronous validation; acquiring the lock below has no await.
  if (state.pages[page.tabId] !== page || page.catalogVersion !== command.catalogVersion)
    throw Error('CATALOG_STALE');
  if (!allowed() || (agent && !remote.authorized(agent))) throw Error('PAGE_UNAVAILABLE');
  if (state.locks[page.pageId]) throw Error('PAGE_BUSY');
  if (Object.keys(state.locks).length >= 100) throw Error('PAGE_BUSY：会话中的在途调用达到上限');
  const call: CallRecord = {
    callId: ctx.kind === 'aiChat' ? ctx.callId : agent?.callId || crypto.randomUUID(),
    ...(ctx.kind === 'aiChat' ? { chat: ctx.chat } : {}),
    pageId: page.pageId,
    catalogVersion: page.catalogVersion,
    toolName: tool.name,
    source: ctx.kind === 'aiChat' ? 'aiChat' : agent ? 'agent' : 'manual',
    ...(agent
      ? {
          agent: {
            epoch: agent.epoch,
            target: agent.target,
            callId: agent.callId,
            toolName: agent.toolName,
            deadlineAt: agent.deadlineAt,
            type: agent.type,
          },
        }
      : {}),
    delivery: 'not_sent',
    execution: 'running',
    business: 'unclassified',
    startedAt: new Date().toISOString(),
    deadline: agent?.deadlineAt || Date.now() + 60000,
    arguments: command.arguments,
  };
  state.locks[page.pageId] = call.callId;
  state.calls.unshift(call);
  let sent = false;
  try {
    await persist();
    const permitted = await hooks.permitted(page);
    if (
      !allowed() ||
      !permitted ||
      (agent && !remote.authorized(agent)) ||
      state.pages[page.tabId] !== page ||
      page.catalogVersion !== command.catalogVersion
    ) {
      call.execution = 'rejected';
      call.errorCode = !permitted
        ? 'SITE_PERMISSION_REQUIRED'
        : agent && !remote.authorized(agent)
          ? 'PAGE_UNAVAILABLE'
          : 'CATALOG_STALE';
      delete state.locks[page.pageId];
      await persist();
      return call.callId;
    }
    call.delivery = 'sent';
    await persist();
    const stillPermitted = await hooks.permitted(page);
    if (
      !allowed() ||
      !stillPermitted ||
      state.pages[page.tabId] !== page ||
      page.catalogVersion !== command.catalogVersion ||
      (agent && !remote.authorized(agent))
    ) {
      call.delivery = 'not_sent';
      call.execution = 'rejected';
      call.errorCode = 'PAGE_UNAVAILABLE';
      delete state.locks[page.pageId];
      await persist();
      return call.callId;
    }
    sent = true;
    const response = await send(page, {
      type: 'EXECUTE',
      callId: call.callId,
      toolName: tool.name,
      version: command.catalogVersion,
      arguments: command.arguments,
    });
    if (!response?.accepted && state.locks[page.pageId] === call.callId) {
      call.execution = 'rejected';
      call.delivery = 'not_sent';
      call.errorCode = response?.errorCode || 'TOOL_UNAVAILABLE';
      delete state.locks[page.pageId];
    } else if (response?.accepted) call.delivery = 'acknowledged';
  } catch {
    if (state.locks[page.pageId] === call.callId) {
      call.execution = sent ? 'unknown' : 'rejected';
      call.errorCode = sent ? 'EXECUTION_UNKNOWN' : 'STORAGE_OR_DELIVERY_FAILED';
      if (!sent) {
        call.delivery = 'not_sent';
        delete state.locks[page.pageId];
      }
    }
  }
  await persist();
  setTimeout(() => void persist().catch(() => {}), Math.max(0, call.deadline - Date.now()));
  return call.callId;
}
