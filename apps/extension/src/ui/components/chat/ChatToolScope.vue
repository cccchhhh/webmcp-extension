<script setup lang="ts">
import { t, message } from '../../i18n';
import { computed, shallowRef } from 'vue';
import { compatibleTools } from '../../../ai/tool-catalog';
import type { Page } from '../../../../../../packages/protocol';
const props = defineProps<{
  page?: Page;
  names: string[];
  mode: 'confirm' | 'auto';
  disabled: boolean;
  granted: boolean;
  pending: boolean;
  editing: boolean;
  notice: string;
}>();
const availableTools = computed(() => compatibleTools(props.page?.tools ?? []));
const opened = shallowRef(false);
const emit = defineEmits<{
  names: [names: string[]];
  mode: [value: 'confirm' | 'auto'];
  grant: [];
  revoke: [];
  takeover: [];
  edit: [];
}>();
function toggle(name: string, on: boolean) {
  emit('names', on ? [...props.names, name] : props.names.filter((n) => n !== name));
}
</script>
<template>
  <details
    class="tool-scope"
    :open="opened"
    @toggle="opened = ($event.target as HTMLDetailsElement).open"
  >
    <summary>
      {{
        pending
          ? t('正在准备授权…')
          : granted
            ? t('已授权 {count} 个工具 · {mode}', {
                count: names.length,
                mode: mode === 'auto' ? t('自动执行') : t('逐次确认'),
              })
            : t('页面工具与数据授权 · 未启用')
      }}
    </summary>
    <p class="hint">
      {{
        t(
          '默认授权全部可用工具并自动执行。聊天、已选工具定义及结果会发送到所选模型；不读取整页内容。',
        )
      }}
    </p>
    <label v-for="{ tool, reason } in availableTools" :key="tool.name" class="check-row"
      ><input
        type="checkbox"
        :checked="names.includes(tool.name)"
        :disabled="disabled || granted || !!reason"
        @change="toggle(tool.name, ($event.target as HTMLInputElement).checked)"
      /><span
        ><code>{{ tool.name }}</code
        ><small>{{ reason ? message(reason) : tool.description }}</small></span
      ></label
    >
    <p v-if="!availableTools.length" class="hint">{{ t('此页面没有可用工具，将使用纯聊天。') }}</p>
    <label class="check-row"
      ><input
        type="checkbox"
        :checked="mode === 'auto'"
        :disabled="disabled || granted"
        @change="emit('mode', ($event.target as HTMLInputElement).checked ? 'auto' : 'confirm')"
      />{{ t('本次会话自动执行已选工具') }}</label
    >
    <div class="actions">
      <template v-if="granted"
        ><button class="btn" :disabled="pending" @click="emit('edit')">
          {{ t('调整范围与执行方式') }}</button
        ><button class="link" :disabled="pending" @click="emit('revoke')">
          {{ t('撤销授权') }}
        </button></template
      ><button v-else class="btn primary" :disabled="disabled" @click="emit('grant')">
        {{ t('应用并恢复授权') }}
      </button>
    </div>
    <button
      v-if="!granted && notice.includes('SESSION_READ_ONLY')"
      class="link"
      :disabled="disabled"
      @click="emit('takeover')"
    >
      {{ t('接管此会话（停止另一侧边栏的新操作）') }}
    </button>
    <p class="hint">
      {{ t('调整范围会停止后续步骤并撤销旧授权；已发送的页面操作可能仍会完成。') }}
    </p>
  </details>
  <p v-if="notice" class="notice" role="status">{{ message(notice) }}</p>
</template>
