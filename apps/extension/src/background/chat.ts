import { bytes, type Snapshot, type Command } from '../../../../packages/protocol';
import type {
  ChatCommand,
  ChatCallContext,
  ChatInvocation,
} from '../../../../packages/protocol/chat';
import type { CallContext } from './scheduler';
type Grant = Extract<ChatCommand, { type: 'CREATE_CHAT_GRANT' }> & { id: string; owner: object };
export class ChatAuthority {
  private grants = new Map<string, Grant>();
  private owners = new Map<string, object>();
  private stopped = new Set<string>();
  private approvals = new Map<string, { owner: object; digest: string }>();
  private submitting = new Map<string, Promise<unknown>>();
  constructor(
    private hooks: {
      state: () => Snapshot;
      persist: () => Promise<unknown>;
      invoke: (c: Extract<Command, { type: 'INVOKE' }>, ctx: CallContext) => Promise<unknown>;
      profileValid: (id: string, version: number) => Promise<boolean>;
    },
  ) {}
  disconnect(owner: object) {
    for (const [id, g] of this.grants) if (g.owner === owner) this.grants.delete(id);
    for (const [id, o] of this.owners) if (o === owner) this.owners.delete(id);
    for (const [id, a] of this.approvals) if (a.owner === owner) this.approvals.delete(id);
  }
  invalidateProfiles() {
    this.grants.clear();
  }
  private grant(id: string, owner: object) {
    const g = this.grants.get(id);
    if (!g || g.owner !== owner || this.owners.get(g.sessionId) !== owner)
      throw Error('CHAT_GRANT_REVOKED');
    if (g.target) {
      const p = Object.values(this.hooks.state().pages).find((p) => p.pageId === g.target!.pageId);
      if (
        !p ||
        p.documentId !== g.target.documentId ||
        p.catalogVersion !== g.target.catalogVersion
      )
        throw Error('CATALOG_STALE');
    }
    return g;
  }
  private authorize(ctx: ChatCallContext, owner: object, name: string) {
    const g = this.grant(ctx.grantId, owner);
    if (
      g.sessionId !== ctx.sessionId ||
      !g.toolNames.includes(name) ||
      this.stopped.has(ctx.sessionId + '/' + ctx.runId)
    )
      throw Error('CHAT_GRANT_REVOKED');
    return g;
  }
  async handle(c: ChatCommand, owner: object): Promise<unknown> {
    const state = this.hooks.state();
    state.chatInvocations ||= {};
    if (c.type === 'CREATE_CHAT_GRANT') {
      if (!(await this.hooks.profileValid(c.profileId, c.profileVersion)))
        throw Error('PROFILE_CHANGED');
      const old = this.owners.get(c.sessionId);
      if (old && old !== owner && !c.takeover)
        throw Error('SESSION_READ_ONLY：会话由另一个侧边栏持有，可显式接管');
      if (c.toolNames.length && !c.target) throw Error('PAGE_UNAVAILABLE');
      if (c.target) {
        const p = Object.values(state.pages).find((p) => p.pageId === c.target!.pageId);
        if (
          !p ||
          p.documentId !== c.target.documentId ||
          p.catalogVersion !== c.target.catalogVersion
        )
          throw Error('CATALOG_STALE');
        if (c.toolNames.some((n) => !p.tools.some((t) => t.name === n && t.executable)))
          throw Error('TOOL_UNAVAILABLE');
      }
      for (const [id, g] of this.grants) if (g.sessionId === c.sessionId) this.grants.delete(id);
      this.owners.set(c.sessionId, owner);
      const id = crypto.randomUUID();
      this.grants.set(id, { ...c, id, owner });
      return { grantId: id };
    }
    if (c.type === 'CHECK_CHAT_GRANT') {
      const g = this.grant(c.grantId, owner);
      if (!(await this.hooks.profileValid(g.profileId, g.profileVersion)))
        throw Error('PROFILE_CHANGED');
      this.grant(c.grantId, owner);
      return {};
    }
    if (c.type === 'REVOKE_CHAT_GRANT') {
      this.grant(c.grantId, owner);
      this.grants.delete(c.grantId);
      return {};
    }
    const sid = 'context' in c ? c.context.sessionId : c.sessionId;
    if (this.owners.get(sid) !== owner) throw Error('SESSION_READ_ONLY');
    if (c.type === 'CANCEL_CHAT_RUN') {
      this.stopped.add(c.sessionId + '/' + c.runId);
      return {};
    }
    if (c.type === 'APPROVE_CHAT_CALL') {
      this.authorize(c.context, owner, c.toolName);
      const token = crypto.randomUUID();
      this.approvals.set(token, {
        owner,
        digest: await digest({ context: c.context, toolName: c.toolName, arguments: c.arguments }),
      });
      return { approvalToken: token };
    }
    if (c.type === 'GET_CHAT_INVOCATION' || c.type === 'READ_CHAT_RESULT') {
      const item = state.chatInvocations[c.sessionId + '/' + c.invocationId];
      if (!item) return { found: false };
      const call = state.calls.find((x) => x.callId === item.callId);
      if (c.type === 'GET_CHAT_INVOCATION')
        return { found: true, callId: item.callId, execution: call?.execution ?? 'released' };
      const g = this.grant(c.grantId, owner);
      if (
        g.sessionId !== c.sessionId ||
        !g.toolNames.includes(item.toolName) ||
        JSON.stringify(g.target) !== JSON.stringify(item.target)
      )
        throw Error('CHAT_GRANT_REVOKED');
      if (!call || call.released) throw Error('RESULT_RELEASED');
      if (this.stopped.has(item.context.sessionId + '/' + item.context.runId))
        throw Error('CHAT_RUN_STOPPED');
      item.consumed = true;
      await this.hooks.persist();
      return {
        callId: call.callId,
        execution: call.execution,
        business: call.business,
        errorCode: call.errorCode,
        result: call.rawResult,
      };
    }
    const key = c.context.sessionId + '/' + c.context.invocationId;
    // Serialize duplicate submissions, then check the persisted content digest again.
    const pending = this.submitting.get(key);
    if (pending) {
      await pending.catch(() => {});
      return this.handle(c, owner);
    }
    const work = this.submit(c, owner);
    this.submitting.set(key, work);
    try {
      return await work;
    } finally {
      this.submitting.delete(key);
    }
  }
  private async submit(c: Extract<ChatCommand, { type: 'CHAT_INVOKE' }>, owner: object) {
    const g = this.authorize(c.context, owner, c.toolName);
    if (!(await this.hooks.profileValid(g.profileId, g.profileVersion)))
      throw Error('PROFILE_CHANGED');
    if (JSON.stringify(c.target) !== JSON.stringify(g.target)) throw Error('CATALOG_STALE');
    if (bytes(c.arguments) > 262144) throw Error('INVALID_ARGUMENTS');
    const fingerprint = await digest({
      context: c.context,
      target: c.target,
      toolName: c.toolName,
      arguments: c.arguments,
    });
    const state = this.hooks.state(),
      key = c.context.sessionId + '/' + c.context.invocationId;
    const existing = state.chatInvocations![key];
    if (existing) {
      if (existing.digest !== fingerprint) throw Error('INVOCATION_CONFLICT');
      return { callId: existing.callId };
    }
    this.authorize(c.context, owner, c.toolName);
    if (g.mode === 'confirm') {
      const a = c.approvalToken && this.approvals.get(c.approvalToken);
      if (
        !a ||
        a.owner !== owner ||
        a.digest !==
          (await digest({ context: c.context, toolName: c.toolName, arguments: c.arguments }))
      )
        throw Error('APPROVAL_REQUIRED');
      this.approvals.delete(c.approvalToken!);
    }
    const item: ChatInvocation = {
      context: c.context,
      target: c.target,
      toolName: c.toolName,
      digest: fingerprint,
      callId: crypto.randomUUID(),
    };
    state.chatInvocations![key] = item;
    try {
      await this.hooks.invoke(
        {
          type: 'INVOKE',
          pageId: c.target.pageId,
          catalogVersion: c.target.catalogVersion,
          toolName: c.toolName,
          arguments: c.arguments,
        },
        {
          kind: 'aiChat',
          chat: c.context,
          callId: item.callId,
          authorized: () => {
            try {
              this.authorize(c.context, owner, c.toolName);
              return true;
            } catch {
              return false;
            }
          },
        },
      );
    } catch (e) {
      if (!state.calls.some((x) => x.callId === item.callId)) delete state.chatInvocations![key];
      throw e;
    }
    return { callId: item.callId };
  }
}
export async function digest(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))),
    ),
  )
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
