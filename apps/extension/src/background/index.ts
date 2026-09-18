import { withSessionBudget } from '../ai/session-budget';
import { ChatAuthority } from './chat';
import { ChatCommandSchema } from '../../../../packages/protocol/chat';
import { defaultSharing } from './sharing';
import { invoke as schedule, type CallContext } from './scheduler';
import { RemoteBridge } from './remote';
import { type AgentCall } from '../../../../packages/protocol/remote';
import {
  CatalogSchema,
  SettledSchema,
  RequestSchema,
  emptySnapshot,
  bytes,
  type Snapshot,
  type Page,
  type CallRecord,
  type Command,
} from '../../../../packages/protocol';
import type { Validation } from '../../../../packages/schema-validation';
import { expire, settle, trim } from './state';
let state: Snapshot = emptySnapshot();
const ports = new Set<chrome.runtime.Port>();
let offscreen: Promise<void> | undefined;
let save = Promise.resolve();
const remote: RemoteBridge = new RemoteBridge({
  state: () => state,
  changed: () => {
    void persist();
  },
  invoke: (agent) =>
    invoke(
      {
        type: 'INVOKE',
        pageId: agent.target.localPageId,
        catalogVersion:
          state.pages[
            Object.keys(state.pages).find(
              (k) => state.pages[k].pageId === agent.target.localPageId,
            ) || ''
          ]?.catalogVersion || '',
        toolName: agent.toolName,
        arguments: agent.arguments,
      },
      agent,
    ),
  disconnected: (epoch) => {
    for (const call of state.calls)
      if (call.agent?.epoch === epoch && call.execution === 'running') {
        call.execution = 'unknown';
        call.errorCode = 'EXECUTION_UNKNOWN';
      }
    void persist();
  },
});
function revokeCallResults(pageId: string, remainingTools: string[] = []) {
  for (const call of state.calls) {
    if (call.pageId === pageId && call.agent && !remainingTools.includes(call.toolName))
      call.remoteResultRevoked = true;
  }
}
function resetSharing(page: Page, disable = false) {
  revokeCallResults(page.pageId);
  const share = state.sharing[page.pageId];
  if (share)
    state.sharing[page.pageId] = {
      ...share,
      enabled: disable ? false : share.enabled,
      authorizedToolNames: [],
      catalogVersion: crypto.randomUUID(),
      nativeVersion: page.catalogVersion,
    };
}
function setSharing(c: Extract<Command, { type: 'SET_SHARING' }>) {
  const page = Object.values(state.pages).find((p) => p.pageId === c.pageId);
  if (
    !page ||
    page.catalogVersion !== c.catalogVersion ||
    !['ready', 'ready_empty'].includes(page.discovery)
  )
    throw Error('CATALOG_STALE');
  const names = [...new Set(c.toolNames)];
  if (names.some((n) => !page.tools.some((t) => t.name === n && t.executable)))
    throw Error('TOOL_UNAVAILABLE');
  revokeCallResults(page.pageId, c.enabled ? names : []);
  state.sharing[page.pageId] = {
    autoAll: c.enabled && names.length === page.tools.filter((t) => t.executable).length,
    enabled: c.enabled,
    authorizedToolNames: c.enabled ? names : [],
    catalogVersion: crypto.randomUUID(),
    nativeVersion: page.catalogVersion,
  };
}
const ready = (async () => {
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const stored = await chrome.storage.session.get('snapshot');
  if (stored.snapshot) state = { ...emptySnapshot(), ...stored.snapshot };
  state.sharing ||= {};
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const settings = await chrome.storage.local.get('deviceName');
  state.deviceName = typeof settings.deviceName === 'string' ? settings.deviceName : '我的浏览器';
  for (const page of Object.values(state.pages)) {
    try {
      const frame = await chrome.webNavigation.getFrame({ tabId: page.tabId, frameId: 0 });
      if (frame?.documentId !== page.documentId) invalidate(page.tabId);
    } catch {
      invalidate(page.tabId);
    }
  }
  for (const call of state.calls.filter((c) => state.locks[c.pageId] === c.callId)) {
    const page = Object.values(state.pages).find((p) => p.pageId === call.pageId);
    if (!page) continue;
    if (call.agent && call.execution === 'running') {
      call.execution = 'unknown';
      call.errorCode = 'EXECUTION_UNKNOWN';
    }
    try {
      const status = await send(page, { type: 'STATUS', callId: call.callId });
      if (status?.call?.status === 'settled') settle(state, call, status.call);
      else if (status?.call?.status !== 'running') {
        call.execution = 'unknown';
        call.errorCode = 'EXECUTION_UNKNOWN';
      }
    } catch {
      call.execution = 'unknown';
      call.errorCode = 'EXECUTION_UNKNOWN';
    }
  }
  for (const page of Object.values(state.pages))
    if (page.documentId) await discover(page.tabId).catch(() => {});
  await remote.init();
  expire(state);
  await chrome.alarms.create('deadlines', { periodInMinutes: 0.5 });
})();
function send(page: Page, payload: object) {
  return chrome.tabs.sendMessage(
    page.tabId,
    { target: 'adapter', ...payload },
    { documentId: page.documentId, frameId: 0 },
  );
}
function persist() {
  for (const page of Object.values(state.pages)) {
    if (!state.sharing[page.pageId]) {
      const share = defaultSharing(page);
      if (share) state.sharing[page.pageId] = share;
    }
  }
  expire(state);
  for (const call of state.calls) remote.report(call);
  remote.reconcile();
  trim(state);
  const copy = structuredClone(state);
  const stored = structuredClone(copy);
  for (const page of Object.values(stored.pages)) page.tools = [];
  save = save
    .catch(() => {})
    .then(() =>
      withSessionBudget(async () => {
        const current = await chrome.storage.session.getBytesInUse('snapshot');
        const total = await chrome.storage.session.getBytesInUse(null);
        if (total - current + bytes(stored) > 8 * 1024 * 1024) throw Error('SESSION_STORAGE_FULL');
        await chrome.storage.session.set({ snapshot: stored });
      }),
    );
  for (const port of ports) {
    try {
      port.postMessage({ type: 'SNAPSHOT', snapshot: copy });
    } catch {
      ports.delete(port);
    }
  }
  return save;
}
function invalidate(tabId: number) {
  const page = state.pages[tabId];
  if (!page) return;
  for (const c of state.calls)
    if (c.pageId === page.pageId && c.execution === 'running') {
      c.execution = 'unknown';
      c.errorCode = 'EXECUTION_UNKNOWN';
    }
  delete state.locks[page.pageId];
  delete state.pages[tabId];
  delete state.sharing[page.pageId];
}
async function validation(job: object): Promise<Validation> {
  if (!offscreen)
    offscreen = (async () => {
      if (!(await chrome.offscreen.hasDocument()))
        await chrome.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: [chrome.offscreen.Reason.WORKERS],
          justification: '在可终止的 Worker 中校验不可信 Schema，限制执行时间。',
        });
    })().catch((e) => {
      offscreen = undefined;
      throw e;
    });
  await offscreen;
  return chrome.runtime.sendMessage({ target: 'validator', job });
}
const discoveryJobs = new Map<number, Promise<void>>();
async function discover(tabId: number, invalidateCatalog = false) {
  if (discoveryJobs.has(tabId)) {
    await discoveryJobs.get(tabId);
    if (!invalidateCatalog) return;
  }
  const job = discoverActual(tabId, invalidateCatalog);
  discoveryJobs.set(tabId, job);
  try {
    await job;
  } finally {
    if (discoveryJobs.get(tabId) === job) discoveryJobs.delete(tabId);
  }
}
async function discoverActual(tabId: number, invalidateCatalog: boolean) {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url || '';
  const old = state.pages[tabId];
  const previousVersion = old?.catalogVersion;
  const page: Page = old || {
    pageId: crypto.randomUUID(),
    tabId,
    documentId: '',
    title: tab.title || '当前页面',
    url,
    catalogVersion: crypto.randomUUID(),
    tools: [],
    discovery: 'permission_required',
  };
  page.title = tab.title || '当前页面';
  page.url = url;
  if (
    !/^https?:/.test(url) ||
    /^https:\/\/(chromewebstore.google.com|chrome.google.com\/webstore)/.test(url)
  ) {
    page.discovery = 'restricted_page';
    page.tools = [];
    resetSharing(page, true);
    state.pages[tabId] = page;
    await persist();
    return;
  }
  if (!(await chrome.permissions.contains({ origins: [new URL(url).origin + '/*'] }))) {
    page.discovery = 'permission_required';
    page.tools = [];
    resetSharing(page, true);
    state.pages[tabId] = page;
    await persist();
    return;
  }
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ['content.js'],
      world: 'ISOLATED',
    });
    const documentId = injected[0]?.documentId;
    if (!documentId) throw Error('没有文档标识');
    if (page.documentId && page.documentId !== documentId) {
      invalidate(tabId);
      page.pageId = crypto.randomUUID();
    }
    page.documentId = documentId;
    const found = CatalogSchema.parse(
      await send(page, { type: 'DISCOVER', invalidate: invalidateCatalog }),
    );
    page.discovery = found.discovery;
    page.catalogVersion = found.version;
    page.tools = found.tools;
    page.error = found.error;
    for (const tool of page.tools)
      if (tool.executable) {
        const checked = await validation({ mode: 'schema', schema: tool.inputSchema });
        tool.executable = checked.ok;
        tool.unavailableReason = checked.ok ? undefined : checked.errors.join('；');
      }
    const current = await chrome.webNavigation.getFrame({ tabId, frameId: 0 });
    if (current?.documentId !== documentId) return;
  } catch {
    page.discovery = 'discovery_failed';
    page.tools = [];
    page.error = '无法发现工具，请检查权限或刷新页面后重试';
  }
  if (previousVersion && previousVersion !== page.catalogVersion) resetSharing(page);
  if (!['ready', 'ready_empty'].includes(page.discovery)) resetSharing(page, true);
  const share = defaultSharing(page, state.sharing[page.pageId]);
  if (share) state.sharing[page.pageId] = share;
  state.pages[tabId] = page;
  await persist();
}
async function invoke(
  command: Extract<Command, { type: 'INVOKE' }>,
  agent?: AgentCall,
): Promise<void> {
  await schedule(command, agent ? { kind: 'remoteAgent', agent } : { kind: 'manual' }, {
    state: () => state,
    validation,
    send,
    persist,
    authorized: (call) => remote.authorized(call),
    permitted: (page) =>
      chrome.permissions.contains({ origins: [new URL(page.url).origin + '/*'] }),
  });
}
const chat = new ChatAuthority({
  state: () => state,
  persist,
  profileValid: async (id, version) => {
    const { modelProfiles = [] } = await chrome.storage.local.get('modelProfiles');
    return (modelProfiles as { id: string; version: number }[]).some(
      (p: { id: string; version: number }) => p.id === id && p.version === version,
    );
  },
  invoke: (command, context: CallContext) =>
    schedule(command, context, {
      state: () => state,
      validation,
      send,
      persist,
      authorized: (call) => remote.authorized(call),
      permitted: (page) =>
        chrome.permissions.contains({ origins: [new URL(page.url).origin + '/*'] }),
    }),
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (
    (area === 'local' && changes.modelProfiles) ||
    Object.keys(changes).some((k) => k.startsWith('credential:'))
  )
    chat.invalidateProfiles();
});
chrome.runtime.onConnect.addListener((port) => {
  if (
    port.name !== 'sidepanel' ||
    port.sender?.id !== chrome.runtime.id ||
    port.sender?.url !== chrome.runtime.getURL('sidepanel.html')
  ) {
    port.disconnect();
    return;
  }
  ports.add(port);
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    chat.disconnect(port);
  });
  port.onMessage.addListener(async (raw) => {
    await ready;
    let requestId = raw?.requestId;
    try {
      if (bytes(raw) > 300000) throw Error('请求过大');
      const parsed = RequestSchema.parse(raw);
      requestId = parsed.requestId;
      const c = parsed.command;
      let data: unknown;
      const chatCommand = ChatCommandSchema.safeParse(c);
      if (chatCommand.success) data = await chat.handle(chatCommand.data, port);
      if (c.type === 'SAVE_REMOTE') await remote.configure(c.settings);
      if (c.type === 'CONNECT_REMOTE') await remote.enable();
      if (c.type === 'DISCONNECT_REMOTE') await remote.disable();
      if (c.type === 'CLEAR_REMOTE') await remote.disable(true);
      if (c.type === 'SET_SHARING') setSharing(c);
      if (c.type === 'DISCOVER') await discover(c.tabId);
      if (c.type === 'INVOKE') await invoke(c);
      if (c.type === 'SAVE_DEVICE') {
        state.deviceName = c.name;
        await chrome.storage.local.set({ deviceName: c.name });
      }
      await persist();
      port.postMessage({ type: 'ACK', requestId, data });
    } catch (e) {
      try {
        port.postMessage({
          type: 'COMMAND_ERROR',
          requestId,
          error: e instanceof Error && e.name !== 'ZodError' ? e.message : '配置或命令格式无效',
        });
      } catch {}
    }
  });
  void ready.then(() => persist());
});
chrome.runtime.onMessage.addListener((m, sender) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.frameId !== 0 ||
    sender.tab?.id === undefined ||
    !sender.documentId
  )
    return;
  void ready.then(async () => {
    const page = state.pages[sender.tab!.id!];
    if (!page || page.documentId !== sender.documentId) return;
    if (m?.type === 'TOOLS_CHANGED') {
      page.catalogVersion = crypto.randomUUID();
      resetSharing(page);
      page.tools = [];
      await persist();
      await discover(page.tabId, true);
    }
    if (m?.type === 'CALL_SETTLED' && typeof m.callId === 'string') {
      const call = state.calls.find((c) => c.callId === m.callId && c.pageId === page.pageId);
      if (!call || state.locks[page.pageId] !== call.callId) return;
      if (bytes(m) > 1100000) return;
      const parsed = SettledSchema.safeParse(m);
      if (!parsed.success) return;
      settle(state, call, parsed.data);
      await persist();
    }
  });
});
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId === 0)
    void ready.then(async () => {
      invalidate(d.tabId);
      await persist();
      if (ports.size) await discover(d.tabId).catch(() => {});
    });
});
chrome.webNavigation.onHistoryStateUpdated.addListener((d) => {
  if (d.frameId === 0)
    void ready.then(async () => {
      const page = state.pages[d.tabId];
      if (page) {
        page.catalogVersion = crypto.randomUUID();
        resetSharing(page);
        page.tools = [];
        await persist();
      }
      await discover(d.tabId, true).catch(() => {});
    });
});
chrome.tabs.onRemoved.addListener(
  (id) =>
    void ready.then(() => {
      invalidate(id);
      return persist();
    }),
);
chrome.permissions.onRemoved.addListener(
  () =>
    void ready.then(async () => {
      for (const p of Object.values(state.pages)) {
        if (
          !/^https?:/.test(p.url) ||
          !(await chrome.permissions.contains({ origins: [new URL(p.url).origin + '/*'] }))
        ) {
          p.tools = [];
          p.discovery = 'permission_required';
          p.catalogVersion = crypto.randomUUID();
          resetSharing(p, true);
        }
      }
      await remote.checkPermission();
      await persist();
    }),
);
chrome.alarms.onAlarm.addListener(
  () =>
    void ready.then(async () => {
      await persist();
      await remote.wake();
    }),
);
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
