<script setup lang="ts">
import { t } from '../i18n';
import type { Page } from '../../../../../packages/protocol';
import type { Sharing } from '../../../../../packages/protocol/remote';
const props = defineProps<{ page?: Page; sharing?: Sharing; pending?: boolean }>();
const emit = defineEmits<{ change: [enabled: boolean, toolNames: string[]] }>();
function toggle(name: string, enabled: boolean) {
  const names = new Set(props.sharing?.authorizedToolNames || []);
  if (enabled) names.add(name);
  else names.delete(name);
  emit('change', true, [...names]);
}
</script>
<template>
  <h2 tabindex="-1">{{ t('页面共享') }}</h2>
  <p class="description">
    {{
      t(
        '默认共享页面及全部可执行工具，可随时关闭或取消单项授权。远程调用的参数与结果会经过服务端。',
      )
    }}
  </p>
  <label class="grant"
    ><span>{{ t('共享当前页面') }}</span
    ><input
      type="checkbox"
      :aria-label="t('共享当前页面')"
      :checked="!!sharing?.enabled"
      :disabled="pending || !page || !['ready', 'ready_empty'].includes(page.discovery)"
      @change="
        $emit(
          'change',
          ($event.target as HTMLInputElement).checked,
          page?.tools.filter((t) => t.executable).map((t) => t.name) || [],
        )
      "
  /></label>
  <label v-for="tool in page?.tools || []" :key="tool.name" class="grant"
    ><code>{{ tool.name }}</code
    ><input
      type="checkbox"
      :aria-label="t('授权 ') + tool.name"
      :checked="sharing?.authorizedToolNames.includes(tool.name) || false"
      :disabled="pending || !sharing?.enabled || !tool.executable"
      @change="toggle(tool.name, ($event.target as HTMLInputElement).checked)"
  /></label>
  <p class="hint">
    {{ sharing?.enabled ? t('共享已开启；连接成功后同步已授权工具。') : t('当前页面未共享。')
    }}{{ t('新页面默认共享全部工具；全部授权时，新增工具会自动加入共享。') }}
  </p>
  <p class="hint">{{ t('本地手动调用无需连接服务，参数与结果不上传。') }}</p>
</template>
