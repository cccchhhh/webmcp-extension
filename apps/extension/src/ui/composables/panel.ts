import { computed, shallowRef, onMounted, onUnmounted, nextTick } from 'vue';
import { provideBridge } from './bridge';
export type View =
  'home' | 'detail' | 'history' | 'record' | 'settings' | 'sharing' | 'chat' | 'help';
export function usePanel() {
  const bridge = provideBridge(),
    tabId = shallowRef<number>(),
    view = shallowRef<View>('home'),
    selected = shallowRef(''),
    callId = shallowRef(''),
    pending = shallowRef(false),
    notice = shallowRef('');
  const page = computed(() =>
    tabId.value === undefined ? undefined : bridge.snapshot.value.pages[tabId.value],
  );
  const tool = computed(() => page.value?.tools.find((t) => t.name === selected.value));
  const record = computed(() => bridge.snapshot.value.calls.find((c) => c.callId === callId.value));
  const draftKey = computed(() =>
    page.value && tool.value
      ? `${page.value.pageId}/${page.value.catalogVersion}/${tool.value.name}`
      : '',
  );
  const activeCall = computed(() =>
    bridge.snapshot.value.calls.find(
      (c) =>
        c.pageId === page.value?.pageId &&
        c.toolName === tool.value?.name &&
        c.catalogVersion === page.value?.catalogVersion,
    ),
  );
  const busy = computed(
    () =>
      pending.value ||
      !bridge.connected.value ||
      !!(page.value && bridge.snapshot.value.locks[page.value.pageId]),
  );
  async function run(action: () => Promise<unknown>) {
    pending.value = true;
    notice.value = '';
    try {
      await action();
    } catch (e) {
      notice.value = e instanceof Error ? e.message : '操作失败';
    } finally {
      pending.value = false;
    }
  }
  function go(next: View) {
    view.value = next;
    void nextTick(() => document.querySelector<HTMLElement>('h2')?.focus());
  }
  async function update() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId.value = tab?.id;
    if (tab?.id !== undefined)
      await run(() => bridge.command({ type: 'DISCOVER', tabId: tab.id! }));
  }
  async function permission() {
    if (!page.value) return;
    const origin = new URL(page.value.url).origin + '/*';
    try {
      if (await chrome.permissions.request({ origins: [origin] })) await update();
      else notice.value = '未授予站点访问权限';
    } catch (e) {
      notice.value = String(e);
    }
  }
  const onUpdated = (id: number, info: chrome.tabs.OnUpdatedInfo) => {
    if (id === tabId.value && info.status === 'complete') void update();
  };
  onMounted(() => {
    void update();
    chrome.tabs.onActivated.addListener(update);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
  onUnmounted(() => {
    chrome.tabs.onActivated.removeListener(update);
    chrome.tabs.onUpdated.removeListener(onUpdated);
  });
  return {
    bridge,
    tabId,
    view,
    selected,
    callId,
    page,
    tool,
    record,
    draftKey,
    activeCall,
    busy,
    pending,
    notice,
    go,
    run,
    update,
    permission,
  };
}
