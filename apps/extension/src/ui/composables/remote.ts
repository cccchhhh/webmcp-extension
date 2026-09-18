import { shallowRef } from 'vue';
import type { Command } from '../../../../../packages/protocol';
import { serviceOrigin, type RemoteSettings } from '../../../../../packages/protocol/remote';
export function useRemoteActions(command: (c: Command) => Promise<void>) {
  const pending = shallowRef(false),
    notice = shallowRef('');
  async function run(action: () => Promise<void>, success = '') {
    pending.value = true;
    notice.value = '';
    try {
      await action();
      notice.value = success;
    } catch (e) {
      notice.value = e instanceof Error ? e.message : '操作失败';
    } finally {
      pending.value = false;
    }
  }
  // Called directly from a click: permissions.request must retain the user gesture.
  function save(settings: RemoteSettings) {
    let origin: string;
    try {
      origin = serviceOrigin(settings.baseUrl);
    } catch {
      notice.value = '请输入 HTTPS 服务地址，或本机 HTTP 地址；不要包含路径、查询参数或凭证';
      return;
    }
    const permission = chrome.permissions.request({ origins: [origin + '/*'] });
    return run(async () => {
      if (!(await permission)) throw Error('未授予服务地址访问权限');
      await command({
        type: 'SAVE_REMOTE',
        settings: {
          ...settings,
          connectionType: 'bridge',
          baseUrl: origin,
        },
      });
    }, '连接配置已保存');
  }
  function action(c: Command) {
    return run(() => command(c), '操作已完成');
  }
  async function copy(value: string) {
    await run(() => navigator.clipboard.writeText(value), '已复制');
  }
  return { pending, notice, save, action, copy };
}
