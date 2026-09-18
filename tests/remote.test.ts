import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { RemoteBridge } from '../apps/extension/src/background/remote';
import { emptySnapshot, type Page, type CallRecord } from '../packages/protocol';
import {
  ClientEnvelope,
  ServerEnvelope,
  serviceOrigin,
  type AgentCall,
} from '../packages/protocol/remote';
import { invoke, type SchedulerHooks } from '../apps/extension/src/background/scheduler';
import { expire, settle } from '../apps/extension/src/background/state';

const id = () => crypto.randomUUID();
const tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
class Socket {
  static OPEN = 1;
  static all: Socket[] = [];
  readyState = 1;
  bufferedAmount = 0;
  sent: any[] = [];
  onopen?: () => void;
  onmessage?: (e: { data: string }) => void;
  onclose?: (e: { code: number }) => void;
  onerror?: () => void;
  constructor(readonly url: string) {
    Socket.all.push(this);
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw));
  }
  close() {
    this.readyState = 3;
  }
  emit(payload: unknown, epoch: string, messageId = id()) {
    this.onmessage?.({
      data: JSON.stringify({ protocolVersion: 1, messageId, connectionEpoch: epoch, payload }),
    });
  }
}
function makePage(): Page {
  return {
    pageId: id(),
    tabId: 1,
    documentId: id(),
    title: 'test',
    url: 'https://site.test/page?token=private#secret',
    catalogVersion: id(),
    tools: [{ name: 'echo', description: '', inputSchema: { type: 'object' }, executable: true }],
    discovery: 'ready',
  };
}
describe('remote connection', () => {
  let state = emptySnapshot(),
    bridge: RemoteBridge,
    storage: Record<string, unknown>,
    invokeHook: Mock<(call: AgentCall) => Promise<void>>,
    fetchMock: ReturnType<typeof vi.fn>;
  const device = id(),
    base = 'https://service.test';
  beforeEach(() => {
    vi.useFakeTimers();
    Socket.all = [];
    state = emptySnapshot();
    storage = { bridgeDeviceId: device };
    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => storage),
          set: vi.fn(async (v) => Object.assign(storage, v)),
          setAccessLevel: vi.fn(async () => {}),
        },
      },
      permissions: { contains: vi.fn(async () => true) },
    });
    fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ticket: 'ticket',
            expiresAt: Date.now() + 30000,
            wsUrl: 'wss://service.test/bridge/ws',
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    invokeHook = vi.fn(async () => {});
    bridge = new RemoteBridge({
      state: () => state,
      changed: () => {},
      invoke: (call) => invokeHook(call) as Promise<void>,
      disconnected: () => {},
    });
  });
  afterEach(async () => {
    await bridge.disable();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('new installs use bridge; legacy stored credentials are cleared without reconnecting', async () => {
    await bridge.init();
    expect(state.remote.connectionType).toBe('bridge');
    storage.remoteConfig = {
      baseUrl: base,
      mode: 'remote',
      deviceId: device,
      token: 'legacy-secret',
      enabled: true,
    };
    await bridge.init();
    expect(state.remote.connectionType).toBe('bridge');
    expect(storage.remoteConfig).toMatchObject({
      connectionType: 'bridge',
      baseUrl: 'http://127.0.0.1:38472',
      token: '',
      enabled: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('bridge generates a stable identity, sends name, and clears grants on changing provider', async () => {
    const settings = {
      connectionType: 'bridge' as const,
      baseUrl: base,
      mode: 'local' as const,
      deviceId: '',
      token: 'plugin-secret',
    };
    await bridge.configure(settings);
    const identity = state.remote.deviceId;
    expect(identity).toBeTruthy();
    expect(storage.bridgeDeviceId).toBe(identity);
    await bridge.enable();
    await tick();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      deviceId: identity,
      deviceName: state.deviceName,
    });
    await bridge.disable(true);
    await bridge.configure(settings);
    expect(state.remote.deviceId).not.toBe(identity);
    const resetIdentity = state.remote.deviceId;
    await bridge.configure(settings);
    expect(state.remote.deviceId).toBe(resetIdentity);
    state.sharing['old'] = {
      enabled: true,
      authorizedToolNames: [],
      catalogVersion: id(),
      nativeVersion: id(),
    };
    await bridge.configure({ ...settings, token: 'new-plugin-secret' });
    expect(state.remote.deviceId).not.toBe(resetIdentity);
    expect(storage.bridgeDeviceId).toBe(state.remote.deviceId);
    expect(state.sharing).toEqual({});
    state.sharing['test'] = {
      enabled: true,
      authorizedToolNames: [],
      catalogVersion: id(),
      nativeVersion: id(),
    };
    await bridge.configure({ baseUrl: 'https://other.test', mode: 'remote', deviceId: device });
    expect(state.sharing).toEqual({});
    expect(state.remote.hasToken).toBe(false);
    expect(state.remote.connectionType).toBe('bridge');
  });
  async function connect() {
    await bridge.configure({
      baseUrl: base,
      mode: 'remote',
      deviceId: device,
      token: 'private-access-token',
    });
    await bridge.enable();
    await tick();
    const socket = Socket.all.at(-1)!;
    expect(socket).toBeDefined();
    socket.onopen?.();
    const epoch = id();
    socket.emit(
      { type: 'AUTH_OK', deviceId: device, connectionEpoch: epoch },
      epoch,
      socket.sent[0].messageId,
    );
    await tick();
    return { socket, epoch };
  }
  async function registered() {
    const { socket, epoch } = await connect(),
      page = makePage();
    state.pages[1] = page;
    const version = id();
    state.sharing[page.pageId] = {
      enabled: true,
      authorizedToolNames: ['echo'],
      catalogVersion: version,
      nativeVersion: page.catalogVersion,
    };
    bridge.reconcile();
    await tick();
    const reg = socket.sent.find((m) => m.payload.type === 'REGISTER_PAGE');
    const target = {
      pageId: id(),
      localPageId: page.pageId,
      documentId: page.documentId,
      catalogVersion: version,
    };
    socket.emit({ type: 'PAGE_REGISTERED', target }, epoch, reg.messageId);
    await tick();
    const call: AgentCall = {
      type: 'CALL',
      target,
      callId: id(),
      toolName: 'echo',
      arguments: {},
      deadlineAt: Date.now() + 60000,
      epoch,
    };
    return { socket, epoch, page, target, call, reg };
  }
  it('auth uses headers and ticket message, persists token only in private local configuration', async () => {
    const { socket } = await connect();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer private-access-token');
    expect(socket.url).toBe('wss://service.test/bridge/ws');
    expect(socket.sent[0].payload).toEqual({ type: 'AUTH', ticket: 'ticket' });
    expect(JSON.stringify(state)).not.toContain('private-access-token');
    expect((storage.remoteConfig as any).token).toBe('private-access-token');
    expect(state.remote.status).toBe('connected');
  });
  it('changing services while permission is pending never sends the new credential to the old origin', async () => {
    let allow!: (v: boolean) => void;
    (chrome.permissions.contains as any).mockImplementationOnce(
      () => new Promise<boolean>((r) => (allow = r)),
    );
    await bridge.configure({
      baseUrl: base,
      mode: 'remote',
      deviceId: device,
      token: 'old-service-token',
    });
    await bridge.enable();
    await tick();
    await bridge.configure({
      baseUrl: 'https://another.test',
      mode: 'remote',
      deviceId: device,
      token: 'new-service-token',
    });
    allow(true);
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.remote.baseUrl).toBe('https://another.test');
  });
  it('invalid saved origin falls back safely without breaking background startup', async () => {
    storage.remoteConfig = {
      baseUrl: 'not-a-url',
      mode: 'remote',
      deviceId: device,
      token: 't',
      enabled: true,
    };
    await expect(bridge.init()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('401 disables retries; transient failures retry; explicit disconnect stops timers', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    await bridge.configure({ baseUrl: base, mode: 'remote', deviceId: device, token: 'bad' });
    await bridge.enable();
    await tick();
    expect(state.remote.status).toBe('attention');
    expect(state.remote.enabled).toBe(false);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRejectedValue(new TypeError('network'));
    await bridge.enable();
    await tick();
    expect(state.remote.status).toBe('reconnecting');
    await bridge.disable();
    const count = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(count);
  });
  it('rejects ticket endpoint substitution and stale epochs', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ticket: 't',
          expiresAt: Date.now() + 30000,
          wsUrl: 'wss://attacker.test/bridge/ws',
        }),
      ),
    );
    await bridge.configure({ baseUrl: base, mode: 'remote', deviceId: device, token: 't' });
    await bridge.enable();
    await tick();
    expect(Socket.all).toHaveLength(0);
    expect(state.remote.status).toBe('attention');
  });
  it('heartbeats use PONG liveness and auth expiry stops reconnect', async () => {
    const { socket, epoch } = await connect();
    await vi.advanceTimersByTimeAsync(20000);
    expect(socket.sent.at(-1).payload.type).toBe('PING');
    socket.emit({ type: 'PONG', timestamp: Date.now() }, epoch);
    await vi.advanceTimersByTimeAsync(40000);
    expect(state.remote.status).toBe('connected');
    await vi.advanceTimersByTimeAsync(20000);
    expect(state.remote.status).toBe('reconnecting');
    await bridge.disable();
    await connect();
    Socket.all.at(-1)!.onclose?.({ code: 1008 });
    expect(state.remote.status).toBe('attention');
  });
  it('registration strips URL secrets and only exports authorized tool metadata', async () => {
    const { reg, call, page } = await registered();
    expect(reg.payload.page.url).toBe('https://site.test/page');
    expect(bridge.authorized(call)).toBe(true);
    expect(page.catalogVersion).not.toBe(call.target.catalogVersion);
    state.sharing[page.pageId].authorizedToolNames = [];
    expect(bridge.authorized(call)).toBe(false);
  });
  it('revocation during registration removes the acknowledged target', async () => {
    const { socket, epoch } = await connect(),
      page = makePage();
    state.pages[1] = page;
    state.sharing[page.pageId] = {
      enabled: true,
      authorizedToolNames: ['echo'],
      catalogVersion: id(),
      nativeVersion: page.catalogVersion,
    };
    bridge.reconcile();
    await tick();
    const reg = socket.sent.find((m) => m.payload.type === 'REGISTER_PAGE');
    state.sharing[page.pageId].enabled = false;
    bridge.reconcile();
    socket.emit(
      {
        type: 'PAGE_REGISTERED',
        target: {
          pageId: id(),
          localPageId: page.pageId,
          documentId: page.documentId,
          catalogVersion: reg.payload.page.catalogVersion,
        },
      },
      epoch,
      reg.messageId,
    );
    await tick();
    const remove = socket.sent.find((m) => m.payload.type === 'REMOVE_PAGE');
    expect(remove).toBeDefined();
    socket.emit({ type: 'APPLIED', replyTo: remove.messageId }, epoch);
    await tick();
  });
  it('catalog rejection stops reconnect loops instead of repeatedly uploading invalid data', async () => {
    const { socket, epoch, page } = await registered();
    state.sharing[page.pageId].catalogVersion = id();
    bridge.reconcile();
    await tick();
    const sync = socket.sent.find((m) => m.payload.type === 'SYNC_CATALOG');
    expect(sync).toBeDefined();
    socket.emit(
      {
        type: 'ERROR',
        replyTo: sync.messageId,
        code: 'INVALID_CATALOG',
        message: 'Message rejected',
      },
      epoch,
    );
    await tick();
    expect(state.remote.status).toBe('attention');
    expect(state.remote.enabled).toBe(false);
  });
  it('duplicate CALL executes once, wrong-target cancellation and old epochs are rejected', async () => {
    const { socket, epoch, call } = await registered();
    const { epoch: _, ...payload } = call;
    socket.emit(payload, epoch);
    socket.emit(payload, epoch);
    await tick();
    expect(invokeHook).toHaveBeenCalledTimes(1);
    socket.emit(
      {
        type: 'CANCEL',
        target: { ...call.target, pageId: id() },
        callId: call.callId,
        reason: 'test',
      },
      epoch,
    );
    expect(bridge.authorized(call)).toBe(true);
    socket.emit(
      { type: 'CANCEL', target: call.target, callId: call.callId, reason: 'test' },
      epoch,
    );
    expect(bridge.authorized(call)).toBe(false);
    socket.emit(payload, id());
    expect(state.remote.status).toBe('attention');
  });
  it('results use original target, revocation suppresses raw data and new epochs drop old results', async () => {
    const { socket, epoch, page, call } = await registered();
    const record: CallRecord = {
      callId: call.callId,
      pageId: page.pageId,
      catalogVersion: page.catalogVersion,
      source: 'agent',
      agent: call,
      toolName: 'echo',
      delivery: 'acknowledged',
      execution: 'returned',
      business: 'unclassified',
      startedAt: new Date().toISOString(),
      deadline: call.deadlineAt,
      rawResult: { secret: 1 },
    };
    state.sharing[page.pageId].authorizedToolNames = [];
    bridge.report(record);
    const result = socket.sent.at(-1).payload;
    expect(result.target).toEqual(call.target);
    expect(result.rawResult).toBeUndefined();
    expect(result.errorCode).toBe('RESULT_RELEASED');
    record.agent = { ...call, epoch: id() };
    const count = socket.sent.length;
    bridge.report(record);
    expect(socket.sent).toHaveLength(count);
  });
  it('catalog changes preserve an authorized in-flight result; revocation cannot be undone by regrant', async () => {
    const { socket, page, call } = await registered();
    state.sharing[page.pageId].catalogVersion = id();
    const record: CallRecord = {
      callId: call.callId,
      pageId: page.pageId,
      catalogVersion: page.catalogVersion,
      source: 'agent',
      agent: call,
      toolName: 'echo',
      delivery: 'sent',
      execution: 'returned',
      business: 'unclassified',
      startedAt: new Date().toISOString(),
      deadline: call.deadlineAt,
      rawResult: 'original result',
    };
    bridge.report(record);
    expect(socket.sent.at(-1).payload.rawResult).toBe('original result');
    expect(socket.sent.at(-1).payload.target).toEqual(call.target);
    const count = socket.sent.length;
    record.delivery = 'acknowledged';
    bridge.report(record);
    expect(socket.sent).toHaveLength(count);
    record.callId = id();
    record.remoteResultRevoked = true;
    bridge.report(record);
    expect(socket.sent.at(-1).payload.rawResult).toBeUndefined();
  });
  it('restores saved enabled bridge connection and refuses service permission removal', async () => {
    const { socket } = await connect();
    await bridge.disable();
    (storage.remoteConfig as any).connectionType = 'bridge';
    (storage.remoteConfig as any).enabled = true;
    await bridge.init();
    await tick();
    expect(Socket.all).toHaveLength(2);
    (chrome.permissions.contains as any).mockResolvedValue(false);
    await bridge.checkPermission();
    expect(state.remote.status).toBe('attention');
  });
});

describe('shared scheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  function setup() {
    const state = emptySnapshot(),
      page = makePage();
    state.pages[1] = page;
    const command = {
      type: 'INVOKE' as const,
      pageId: page.pageId,
      catalogVersion: page.catalogVersion,
      toolName: 'echo',
      arguments: {},
    };
    const agent: AgentCall = {
      type: 'CALL',
      epoch: id(),
      callId: id(),
      target: {
        pageId: id(),
        localPageId: page.pageId,
        documentId: page.documentId,
        catalogVersion: id(),
      },
      toolName: 'echo',
      arguments: {},
      deadlineAt: Date.now() + 5000,
    };
    const hooks: SchedulerHooks = {
      state: () => state,
      validation: vi.fn(async () => ({ ok: true, errors: [] })),
      persist: vi.fn(async () => {}),
      permitted: vi.fn(async () => true),
      send: vi.fn(async () => ({ accepted: true })),
      authorized: vi.fn(() => true),
    };
    return { state, page, command, agent, hooks };
  }
  it('manual and agent calls share lock; duplicates never dispatch twice', async () => {
    const { state, command, agent, hooks } = setup();
    await invoke(command, agent, hooks);
    await expect(invoke(command, undefined, hooks)).rejects.toThrow('PAGE_BUSY');
    await invoke(command, agent, hooks);
    expect(hooks.send).toHaveBeenCalledTimes(1);
    expect(state.calls[0].source).toBe('agent');
    expect(state.calls[0].agent).not.toHaveProperty('arguments');
  });
  it('rechecks authorization and catalog after asynchronous schema validation', async () => {
    const { command, agent, hooks } = setup();
    (hooks.validation as any).mockImplementation(async () => {
      (hooks.authorized as any).mockReturnValue(false);
      return { ok: true, errors: [] };
    });
    await expect(invoke(command, agent, hooks)).rejects.toThrow('PAGE_UNAVAILABLE');
    expect(hooks.send).not.toHaveBeenCalled();
  });
  it('permission revoked during persistence cannot reach page execution', async () => {
    const { command, agent, hooks, state } = setup();
    (hooks.permitted as any).mockResolvedValueOnce(true).mockResolvedValue(false);
    await invoke(command, agent, hooks);
    expect(hooks.send).not.toHaveBeenCalled();
    expect(state.calls[0].execution).toBe('rejected');
    expect(state.locks).toEqual({});
  });
  it('result before ACK remains returned; timeout keeps lock until late completion', async () => {
    const { state, command, agent, hooks, page } = setup();
    (hooks.send as any).mockImplementation(async () => {
      settle(state, state.calls[0], { result: 'early' });
      return { accepted: true };
    });
    await invoke(command, agent, hooks);
    expect(state.calls[0].execution).toBe('returned');
    expect(state.calls[0].rawResult).toBe('early');
    (hooks.send as any).mockResolvedValue({ accepted: true });
    await invoke(command, undefined, hooks);
    const call = state.calls[0];
    expire(state, call.deadline + 1);
    expect(state.locks[page.pageId]).toBe(call.callId);
    settle(state, call, { result: 'late' });
    expect(call.late).toBe(true);
    expect(state.locks).toEqual({});
  });
  it('transport uncertainty keeps lock, explicit page rejection releases it', async () => {
    const { state, command, hooks, page } = setup();
    (hooks.send as any).mockRejectedValue(Error('gone'));
    await invoke(command, undefined, hooks);
    expect(state.calls[0].execution).toBe('unknown');
    expect(state.locks[page.pageId]).toBeTruthy();
    delete state.locks[page.pageId];
    (hooks.send as any).mockResolvedValue({ accepted: false, errorCode: 'CATALOG_STALE' });
    await invoke(command, undefined, hooks);
    expect(state.calls[0].execution).toBe('rejected');
    expect(state.locks).toEqual({});
  });
});

describe('protocol contract', () => {
  it('accepts only secure remote origins and local development loopback', () => {
    expect(serviceOrigin('https://example.com/')).toBe('https://example.com');
    expect(serviceOrigin('http://127.0.0.1:38471')).toBe('http://127.0.0.1:38471');
    for (const url of [
      'http://example.com',
      'http://[::1]:38471',
      'https://user:pass@example.com',
      'https://example.com/mcp',
      'https://example.com/?token=a',
      'https://example.com/#x',
    ])
      expect(() => serviceOrigin(url)).toThrow();
  });
  it('validates the versioned browser wire contract', async () => {
    const target = { pageId: id(), localPageId: id(), documentId: id(), catalogVersion: id() };
    const samples = [
      { type: 'AUTH', ticket: 't' },
      { type: 'PING', timestamp: 0 },
      {
        type: 'REGISTER_PAGE',
        page: {
          localPageId: target.localPageId,
          documentId: target.documentId,
          title: 'p',
          url: 'https://site.test',
          catalogVersion: target.catalogVersion,
          tools: [],
          authorizedToolNames: [],
          executionBlocked: false,
        },
      },
      {
        type: 'SYNC_CATALOG',
        target,
        nextCatalogVersion: id(),
        tools: [],
        authorizedToolNames: [],
      },
      { type: 'REMOVE_PAGE', target, reason: 'test' },
      { type: 'REVOKE', target, toolNames: ['echo'] },
      { type: 'PAGE_STATE', target, executionBlocked: true },
      { type: 'CALL_ACK', target, callId: id(), accepted: false, errorCode: 'PAGE_BUSY' },
      {
        type: 'CALL_RESULT',
        target,
        callId: id(),
        business: 'unclassified',
        rawResult: { ok: 1 },
        executionSettled: true,
      },
      { type: 'CANCEL_ACK', target, callId: id(), outcome: 'unsupported' },
    ];
    for (const payload of samples) {
      const m = { protocolVersion: 1, messageId: id(), payload };
      expect(ClientEnvelope.parse(m)).toEqual(m);
      expect(ClientEnvelope.safeParse({ ...m, extra: 1 }).success).toBe(false);
    }
    expect(
      ServerEnvelope.safeParse({
        protocolVersion: 2,
        messageId: id(),
        connectionEpoch: id(),
        payload: { type: 'PONG', timestamp: 0 },
      }).success,
    ).toBe(false);
  });
});
