import { shallowRef, onUnmounted, watch } from 'vue';
import { label } from '../../../../../packages/protocol';
import { ChatRuntime } from '../../ai/chat-runtime';
import { getKey, profiles } from '../../ai/credentials';
import { loadSession, saveSession } from '../../ai/chat-storage';
import type { useBridge } from './bridge';
export function useChat(bridge: ReturnType<typeof useBridge>) {
  const revision = shallowRef(0),
    runtime = shallowRef<ChatRuntime>(),
    modelProfiles = shallowRef<Awaited<ReturnType<typeof profiles>>>([]);
  const refreshProfiles = async () => {
    modelProfiles.value = await profiles();
  };
  watch(bridge.snapshot, (snapshot) => {
    const r = runtime.value;
    if (!r) return;
    let changed = false;
    for (const trace of r.session.traces) {
      const call = snapshot.calls.find((c) => c.callId === trace.callId);
      if (call && call.execution !== 'running' && trace.status !== label(call)) {
        trace.status = label(call);
        changed = true;
      }
    }
    if (changed) {
      if (
        r.session.status === 'blocked_pending' &&
        !r.session.traces.some((t) => t.status === '执行中')
      )
        r.session.status = r.session.traces.some((t) => t.status === '结果未知')
          ? 'blocked_unknown'
          : 'idle';
      revision.value++;
    }
  });
  watch(bridge.connected, (connected) => {
    if (!connected) {
      void runtime.value?.stop();
      void runtime.value?.revoke();
    }
  });
  let disposed = false;
  void Promise.all([loadSession(), refreshProfiles()]).then(([session]) => {
    if (!disposed)
      runtime.value = new ChatRuntime(
        {
          request: bridge.request,
          save: saveSession,
          key: getKey,
          changed: () => revision.value++,
        },
        session,
      );
  });
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (
      (area === 'local' && changes.modelProfiles) ||
      Object.keys(changes).some((k) => k.startsWith('credential:'))
    ) {
      void (async () => {
        await runtime.value?.stop();
        await runtime.value?.revoke();
        await refreshProfiles();
        runtime.value?.authorization.configurationChanged();
      })().catch(() => {
        if (runtime.value) {
          runtime.value.error = '模型配置读取失败，请重新打开侧栏';
          revision.value++;
        }
      });
    }
  };
  chrome.storage.onChanged.addListener(changed);
  const unload = () => {
    void runtime.value?.stop();
    void runtime.value?.revoke();
  };
  window.addEventListener('pagehide', unload);
  onUnmounted(() => {
    disposed = true;
    unload();
    chrome.storage.onChanged.removeListener(changed);
    window.removeEventListener('pagehide', unload);
  });
  return { runtime, revision, modelProfiles, refreshProfiles };
}
