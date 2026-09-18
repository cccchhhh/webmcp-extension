import { z } from 'zod';
import { bytes, type Snapshot, type CallRecord } from '../../../../packages/protocol';
import {
  ClientEnvelope,
  ServerEnvelope,
  RemoteSettingsSchema,
  serviceOrigin,
  sameTarget,
  type RemoteConfig,
  type RemoteSettings,
  type Target,
  type Message,
  type ServerMessage,
  type AgentCall,
} from '../../../../packages/protocol/remote';

type Payload = Message['payload'];
type Reply = ServerMessage['payload'];
const ticketSchema = z
  .object({
    ticket: z.string().min(1).max(256),
    expiresAt: z.number().finite(),
    wsUrl: z.string().url(),
  })
  .strict();
const timeout = 10000;
class RemoteError extends Error {
  constructor(
    readonly code: string,
    readonly permanent = false,
  ) {
    super(code);
  }
}
interface Hooks {
  state(): Snapshot;
  changed(): void;
  invoke(call: AgentCall): Promise<void>;
  disconnected(epoch: string): void;
}
interface Registered {
  target: Target;
  blocked: boolean;
}
export class RemoteBridge {
  private config: RemoteConfig = {
    connectionType: 'bridge',
    baseUrl: 'http://127.0.0.1:38472',
    mode: 'local',
    deviceId: '',
    token: '',
    enabled: false,
  };
  private socket?: WebSocket;
  private epoch?: string;
  private authMessageId?: string;
  private generation = 0;
  private attempting = false;
  private attempts = 0;
  private heartbeat?: ReturnType<typeof setInterval>;
  private reconnect?: ReturnType<typeof setTimeout>;
  private handshake?: ReturnType<typeof setTimeout>;
  private lastPong = 0;
  private pending = new Map<
    string,
    {
      resolve: (r: Reply) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      expected: string;
    }
  >();
  private registered = new Map<string, Registered>();
  private syncing = false;
  private dirty = false;
  private seen = new Map<string, Target>();
  private cancelled = new Set<string>();
  private reported = new Map<string, string>();
  constructor(private hooks: Hooks) {}
  private publish(status = this.hooks.state().remote.status, error?: string) {
    const { token, ...config } = this.config;
    this.hooks.state().remote = {
      ...config,
      hasToken: !!token,
      status,
      ...(error ? { error } : {}),
    };
    this.hooks.changed();
  }
  async init() {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    const stored = await chrome.storage.local.get('remoteConfig');
    const remoteConfig = stored.remoteConfig as Record<string, unknown> | undefined;
    if (remoteConfig?.connectionType === 'bridge') {
      const parsed = RemoteSettingsSchema.safeParse({
        connectionType: remoteConfig.connectionType,
        baseUrl: remoteConfig.baseUrl,
        mode: remoteConfig.mode,
        deviceId: remoteConfig.deviceId,
        token: remoteConfig.token,
      });
      if (parsed.success)
        this.config = {
          ...parsed.data,
          token: parsed.data.token || '',
          enabled: remoteConfig.enabled === true,
        };
    }
    // Legacy credentials cannot authenticate the lightweight bridge. Do not auto-connect
    // the removed mode or silently send its token to the new endpoint.
    if (remoteConfig && remoteConfig.connectionType !== 'bridge') {
      this.config = {
        connectionType: 'bridge',
        baseUrl: 'http://127.0.0.1:38472',
        mode: 'local',
        deviceId: '',
        token: '',
        enabled: false,
      };
      this.hooks.state().sharing = {};
    }
    if (remoteConfig) await this.save();
    this.publish('disconnected');
    if (this.config.enabled) void this.connect();
  }
  private save() {
    return chrome.storage.local.set({ remoteConfig: this.config });
  }
  async configure(input: RemoteSettings) {
    const value = RemoteSettingsSchema.parse(input);
    const stored = await chrome.storage.local.get('bridgeDeviceId');
    const existing = z.string().uuid().safeParse(stored.bridgeDeviceId);
    const changedCredential =
      !!this.config.token && value.token !== undefined && value.token !== this.config.token;
    value.deviceId = existing.success && !changedCredential ? existing.data : crypto.randomUUID();
    value.mode = value.baseUrl.startsWith('https:') ? 'remote' : 'local';
    if (!existing.success || changedCredential)
      await chrome.storage.local.set({ bridgeDeviceId: value.deviceId });
    const changedIdentity =
      value.connectionType !== this.config.connectionType ||
      value.baseUrl !== this.config.baseUrl ||
      value.mode !== this.config.mode ||
      value.deviceId !== this.config.deviceId ||
      (value.token !== undefined && value.token !== this.config.token);
    const token =
      value.token ??
      (value.connectionType === this.config.connectionType &&
      value.baseUrl === this.config.baseUrl &&
      value.mode === this.config.mode
        ? this.config.token
        : '');
    this.stop();
    if (changedIdentity) this.hooks.state().sharing = {};
    this.config = { ...value, token, enabled: false };
    await this.save();
    this.publish('disconnected');
  }
  async enable() {
    if (!this.config.token || !this.config.deviceId) throw Error('请填写插件令牌并保存连接配置');
    this.config.enabled = true;
    await this.save();
    this.stop();
    this.attempts = 0;
    void this.connect();
  }
  async disable(clear = false) {
    this.config.enabled = false;
    this.stop();
    if (clear) {
      await chrome.storage.local.set({ bridgeDeviceId: crypto.randomUUID() });
      this.config.token = '';
      this.config.deviceId = '';
      this.hooks.state().sharing = {};
    }
    await this.save();
    this.publish('disconnected');
  }
  private stop() {
    this.generation++;
    this.attempting = false;
    clearTimeout(this.reconnect);
    clearTimeout(this.handshake);
    clearInterval(this.heartbeat);
    const socket = this.socket,
      epoch = this.epoch;
    this.socket = undefined;
    this.epoch = undefined;
    this.authMessageId = undefined;
    socket?.close();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new RemoteError('CONNECTION_LOST'));
    }
    this.pending.clear();
    this.registered.clear();
    this.reported.clear();
    this.seen.clear();
    this.cancelled.clear();
    if (epoch) this.hooks.disconnected(epoch);
  }
  private fail(code: string, permanent = false) {
    this.stop();
    if (!this.config.enabled) return;
    if (permanent) {
      this.config.enabled = false;
      void this.save();
      this.publish('attention', code);
      return;
    }
    this.publish('reconnecting', code);
    const delay =
      Math.min(30000, 1000 * 2 ** Math.min(this.attempts++, 5)) * (0.8 + Math.random() * 0.2);
    this.reconnect = setTimeout(() => void this.connect(), delay);
  }
  async checkPermission() {
    if (
      this.config.enabled &&
      !(await chrome.permissions.contains({ origins: [this.config.baseUrl + '/*'] }))
    )
      this.fail('SERVICE_PERMISSION_REQUIRED', true);
  }
  async wake() {
    if (this.config.enabled && !this.socket && !this.attempting) {
      clearTimeout(this.reconnect);
      await this.connect();
    }
  }
  private async api(path: string, method: string, body?: unknown) {
    const { token, baseUrl } = this.config;
    const generation = this.generation;
    if (!token) throw new RemoteError('TOKEN_REQUIRED', true);
    const origin = serviceOrigin(baseUrl);
    if (!(await chrome.permissions.contains({ origins: [origin + '/*'] })))
      throw new RemoteError('SERVICE_PERMISSION_REQUIRED', true);
    if (generation !== this.generation) throw new RemoteError('CONFIG_CHANGED', true);
    const response = await fetch(origin + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok)
      throw new RemoteError(
        `HTTP_${response.status}`,
        [400, 401, 403, 404].includes(response.status),
      );
    // Management responses are bounded and never surfaced verbatim in errors/logs.
    const reader = response.body?.getReader();
    let text = '',
      size = 0;
    if (reader) {
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          throw new RemoteError('INVALID_RESPONSE', true);
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new RemoteError('INVALID_RESPONSE', true);
    }
  }
  private async connect() {
    if (!this.config.enabled || this.socket || this.attempting) return;
    this.attempting = true;
    const generation = this.generation;
    this.publish(this.attempts ? 'reconnecting' : 'connecting');
    try {
      const ticket = ticketSchema.parse(
        await this.api('/bridge/ticket', 'POST', {
          deviceId: this.config.deviceId,
          deviceName: this.hooks.state().deviceName,
        }),
      );
      if (generation !== this.generation) return;
      const expected = this.config.baseUrl.replace(/^http/, 'ws') + '/bridge/ws';
      if (ticket.wsUrl !== expected || ticket.expiresAt <= Date.now())
        throw new RemoteError('INVALID_TICKET', true);
      const socket = (this.socket = new WebSocket(ticket.wsUrl));
      this.handshake = setTimeout(() => {
        if (this.socket === socket) this.fail('AUTH_TIMEOUT');
      }, 5000);
      socket.onopen = () => {
        if (this.socket === socket) {
          try {
            this.authMessageId = this.send({ type: 'AUTH', ticket: ticket.ticket });
          } catch {
            this.fail('CONNECTION_LOST');
          }
        }
      };
      socket.onmessage = (event) => {
        if (this.socket !== socket) return;
        try {
          this.receive(event.data);
        } catch {
          this.fail('INVALID_SERVER_MESSAGE', true);
        }
      };
      socket.onerror = () => {
        /* close carries recovery semantics */
      };
      socket.onclose = (event) => {
        if (this.socket === socket)
          this.fail(
            event.code === 1008
              ? 'AUTH_REQUIRED'
              : event.code === 1000
                ? 'CONNECTION_REPLACED'
                : 'CONNECTION_LOST',
            event.code === 1008 || event.code === 1000,
          );
      };
    } catch (e) {
      if (generation === this.generation)
        this.fail(
          e instanceof RemoteError ? e.code : 'CONNECTION_FAILED',
          (e instanceof RemoteError && e.permanent) || e instanceof z.ZodError,
        );
    } finally {
      if (generation === this.generation) this.attempting = false;
    }
  }
  private send(payload: Payload, messageId = crypto.randomUUID()) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
      throw new RemoteError('CONNECTION_LOST');
    const message = ClientEnvelope.parse({
      protocolVersion: 1,
      messageId,
      ...(this.epoch ? { connectionEpoch: this.epoch } : {}),
      payload,
    });
    const raw = JSON.stringify(message);
    if (bytes(message) > 2097152 || this.socket.bufferedAmount > 2097152)
      throw new RemoteError('MESSAGE_TOO_LARGE');
    this.socket.send(raw);
    return messageId;
  }
  private request(payload: Payload, expected: string): Promise<Reply> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RemoteError('SYNC_TIMEOUT'));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer, expected });
      try {
        this.send(payload, id);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  private receive(raw: unknown) {
    if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 2097152)
      throw Error('MESSAGE_TOO_LARGE');
    const m = ServerEnvelope.parse(JSON.parse(raw)),
      p = m.payload;
    if (!this.epoch) {
      if (
        p.type !== 'AUTH_OK' ||
        m.messageId !== this.authMessageId ||
        p.deviceId !== this.config.deviceId ||
        p.connectionEpoch !== m.connectionEpoch
      )
        throw Error('INVALID_AUTH');
      clearTimeout(this.handshake);
      this.epoch = m.connectionEpoch;
      this.attempts = 0;
      this.lastPong = Date.now();
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastPong >= 60000) return this.fail('HEARTBEAT_TIMEOUT');
        try {
          this.send({ type: 'PING', timestamp: Date.now() });
        } catch {
          this.fail('CONNECTION_LOST');
        }
      }, 20000);
      this.publish('connected');
      this.reconcile();
      return;
    }
    if (m.connectionEpoch !== this.epoch) throw Error('STALE_CONNECTION');
    if (p.type === 'PONG') {
      this.lastPong = Date.now();
      return;
    }
    if (p.type === 'AUTH_OK') throw Error('DUPLICATE_AUTH');
    const replyTo = 'replyTo' in p ? p.replyTo : m.messageId;
    const pending = this.pending.get(replyTo);
    if (pending) {
      this.pending.delete(replyTo);
      clearTimeout(pending.timer);
      if (p.type === 'ERROR') pending.reject(new RemoteError(p.code));
      else if (pending.expected !== p.type) pending.reject(new RemoteError('INVALID_REPLY'));
      else pending.resolve(p);
      return;
    }
    if (p.type === 'CALL') {
      if (this.seen.has(p.callId)) return;
      if (this.seen.size >= 10000) return this.fail('CALL_CAPACITY', true);
      this.seen.set(p.callId, p.target);
      const call: AgentCall = { ...p, epoch: this.epoch };
      void this.hooks.invoke(call).catch((e) => {
        if (call.epoch === this.epoch)
          this.safeSend({
            type: 'CALL_ACK',
            target: call.target,
            callId: call.callId,
            accepted: false,
            errorCode:
              e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : 'INVALID_ARGUMENTS',
          });
      });
    }
    if (p.type === 'CANCEL') {
      const call = this.hooks
        .state()
        .calls.find(
          (c) =>
            c.callId === p.callId &&
            c.agent?.epoch === this.epoch &&
            sameTarget(c.agent!.target, p.target),
        );
      // Only remember cancellation for a known request; never cancel a different target.
      const requested = this.seen.get(p.callId);
      if (!requested || !sameTarget(requested, p.target)) return;
      if (call && !sameTarget(call.agent!.target, p.target)) return;
      this.cancelled.add(p.callId);
      const outcome =
        !call || call.delivery === 'not_sent'
          ? 'not_started'
          : this.hooks.state().locks[call.pageId] === call.callId
            ? 'unsupported'
            : 'already_settled';
      this.safeSend({ type: 'CANCEL_ACK', target: p.target, callId: p.callId, outcome });
    }
  }
  private safeSend(payload: Payload) {
    try {
      this.send(payload);
    } catch {
      this.fail('CONNECTION_LOST');
    }
  }
  authorized(call: AgentCall) {
    const state = this.hooks.state();
    const page = Object.values(state.pages).find((p) => p.pageId === call.target.localPageId);
    const share = state.sharing[call.target.localPageId];
    const registered = this.registered.get(call.target.localPageId);
    return !!(
      this.epoch === call.epoch &&
      this.config.enabled &&
      !this.cancelled.has(call.callId) &&
      call.deadlineAt > Date.now() &&
      page &&
      page.documentId === call.target.documentId &&
      share?.enabled &&
      share.nativeVersion === page.catalogVersion &&
      share.catalogVersion === call.target.catalogVersion &&
      share.authorizedToolNames.includes(call.toolName) &&
      registered &&
      sameTarget(registered.target, call.target)
    );
  }
  report(call: CallRecord) {
    const agent = call.agent;
    if (!agent || agent.epoch !== this.epoch) return;
    const signature =
      call.execution === 'running'
        ? `running/${call.delivery}`
        : `${call.execution}/${this.hooks.state().locks[call.pageId] === call.callId}/${call.late}/${call.errorCode}`;
    if (this.reported.get(call.callId) === signature) return;
    this.reported.set(call.callId, signature);
    if (call.execution === 'rejected') {
      this.safeSend({
        type: 'CALL_ACK',
        target: agent.target,
        callId: call.callId,
        accepted: false,
        errorCode: call.errorCode || 'TOOL_UNAVAILABLE',
      });
    } else if (call.execution === 'returned' || call.execution === 'unknown') {
      const share = this.hooks.state().sharing[call.pageId];
      const permitted =
        share?.enabled &&
        share.authorizedToolNames.includes(call.toolName) &&
        !call.remoteResultRevoked;
      const errorCode = !permitted ? 'RESULT_RELEASED' : call.errorCode;
      this.safeSend({
        type: 'CALL_RESULT',
        target: agent.target,
        callId: call.callId,
        business: call.business,
        ...(errorCode
          ? {
              errorCode: ['RESULT_TOO_LARGE', 'RESULT_UNSERIALIZABLE', 'RESULT_RELEASED'].includes(
                errorCode,
              )
                ? (errorCode as 'RESULT_TOO_LARGE' | 'RESULT_UNSERIALIZABLE' | 'RESULT_RELEASED')
                : 'EXECUTION_UNKNOWN',
            }
          : { rawResult: call.rawResult }),
        executionSettled: this.hooks.state().locks[call.pageId] !== call.callId,
      });
    } else if (call.delivery === 'acknowledged')
      this.safeSend({
        type: 'CALL_ACK',
        target: agent.target,
        callId: call.callId,
        accepted: true,
      });
  }
  reconcile() {
    this.dirty = true;
    if (this.syncing || !this.epoch) return;
    this.syncing = true;
    const generation = this.generation;
    void (async () => {
      while (this.dirty && this.epoch && generation === this.generation) {
        this.dirty = false;
        const state = this.hooks.state();
        const ids = new Set([...this.registered.keys(), ...Object.keys(state.sharing)]);
        for (const id of ids) {
          if (generation !== this.generation) return;
          const page = Object.values(state.pages).find((p) => p.pageId === id);
          const share = state.sharing[id];
          const active = !!(
            page &&
            share?.enabled &&
            share.nativeVersion === page.catalogVersion &&
            ['ready', 'ready_empty'].includes(page.discovery)
          );
          let reg = this.registered.get(id);
          if (!active) {
            if (reg) {
              await this.request(
                { type: 'REMOVE_PAGE', target: reg.target, reason: 'sharing_disabled' },
                'APPLIED',
              );
              if (generation !== this.generation) return;
              this.registered.delete(id);
            }
            continue;
          }
          const version = share.catalogVersion;
          const blocked = !!state.locks[id];
          // Only authorized tool metadata leaves the browser.
          const tools = page!.tools.filter((t) => share.authorizedToolNames.includes(t.name));
          const names = tools.map((t) => t.name);
          if (!reg) {
            const u = new URL(page!.url);
            const reply = await this.request(
              {
                type: 'REGISTER_PAGE',
                page: {
                  localPageId: id,
                  documentId: page!.documentId,
                  title: page!.title.slice(0, 1024),
                  url: u.origin + u.pathname,
                  catalogVersion: version,
                  tools,
                  authorizedToolNames: names,
                  executionBlocked: blocked,
                },
              },
              'PAGE_REGISTERED',
            );
            if (generation !== this.generation) return;
            if (
              reply.type !== 'PAGE_REGISTERED' ||
              reply.target.localPageId !== id ||
              reply.target.documentId !== page!.documentId ||
              reply.target.catalogVersion !== version
            )
              throw Error('INVALID_TARGET');
            reg = { target: reply.target, blocked };
            this.registered.set(id, reg);
            // Revisit because permission may have changed while registration was pending.
            this.dirty = true;
          } else if (reg.target.catalogVersion !== version) {
            await this.request(
              {
                type: 'SYNC_CATALOG',
                target: reg.target,
                nextCatalogVersion: version,
                tools,
                authorizedToolNames: names,
              },
              'APPLIED',
            );
            if (generation !== this.generation) return;
            reg.target = { ...reg.target, catalogVersion: version };
            this.dirty = true;
          }
          if (reg.blocked !== blocked) {
            await this.request(
              { type: 'PAGE_STATE', target: reg.target, executionBlocked: blocked },
              'APPLIED',
            );
            if (generation !== this.generation) return;
            reg.blocked = blocked;
            this.dirty = true;
          }
        }
      }
    })()
      .catch((e) => {
        if (generation === this.generation) {
          const permanent =
            e instanceof RemoteError && !['SYNC_TIMEOUT', 'CONNECTION_LOST'].includes(e.code);
          this.fail('CATALOG_SYNC_FAILED', permanent);
        }
      })
      .finally(() => {
        this.syncing = false;
        if (this.dirty && this.epoch) this.reconcile();
      });
  }
}
