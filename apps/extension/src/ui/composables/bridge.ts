import { shallowRef, onUnmounted, provide, inject, type InjectionKey } from 'vue';
import { emptySnapshot, type Command, type Snapshot } from '../../../../../packages/protocol';
function createBridge() {
  const snapshot = shallowRef<Snapshot>(emptySnapshot()),
    connected = shallowRef(false),
    error = shallowRef('');
  let port: chrome.runtime.Port;
  let timer: ReturnType<typeof setTimeout>;
  let disposed = false;
  const pending = new Map<
    string,
    {
      resolve: (data: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  function request<T = unknown>(c: Command): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!connected.value) {
        reject(Error('后台连接已断开'));
        return;
      }
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(Error('后台响应超时；不会重发操作，请查看记录'));
      }, 30000);
      pending.set(requestId, { resolve, reject, timer });
      port.postMessage({ requestId, command: c });
    });
  }
  async function command(c: Command): Promise<void> {
    await request(c);
  }
  function connect() {
    port = chrome.runtime.connect({ name: 'sidepanel' });
    connected.value = true;
    port.onMessage.addListener((m) => {
      if (m.type === 'SNAPSHOT') snapshot.value = m.snapshot;
      else {
        const p = pending.get(m.requestId);
        if (p) {
          clearTimeout(p.timer);
          pending.delete(m.requestId);
          m.type === 'ACK' ? p.resolve(m.data) : p.reject(Error(m.error));
        }
      }
    });
    port.onDisconnect.addListener(() => {
      connected.value = false;
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(Error('后台连接中断；请查看执行记录'));
      }
      pending.clear();
      if (!disposed) timer = setTimeout(connect, 1000);
    });
    void command({ type: 'GET_SNAPSHOT' }).catch((e) => (error.value = e.message));
  }
  connect();
  onUnmounted(() => {
    disposed = true;
    clearTimeout(timer);
    port.disconnect();
  });
  return { snapshot, connected, error, command, request };
}
const key: InjectionKey<ReturnType<typeof createBridge>> = Symbol('extensionBridge');
export function provideBridge() {
  const bridge = createBridge();
  provide(key, bridge);
  return bridge;
}
export function useBridge() {
  const bridge = inject(key);
  if (!bridge) throw Error('缺少后台上下文');
  return bridge;
}
