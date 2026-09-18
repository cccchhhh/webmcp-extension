<script setup lang="ts">
import { t } from '../i18n';
import { shallowRef, computed } from 'vue';
import { label, type CallRecord } from '../../../../../packages/protocol';
const props = defineProps<{ calls: CallRecord[] }>();
defineEmits<{ select: [id: string] }>();
const filter = shallowRef('all');
const records = computed(() =>
  props.calls.filter((c) => filter.value === 'all' || c.source === filter.value),
);
</script>
<template>
  <h2 tabindex="-1">
    {{ t('会话记录') }}<span class="count">{{ calls.length }}</span>
  </h2>
  <p class="description">{{ t('当前浏览器会话中的工具调用。') }}</p>
  <div class="tabs">
    <button
      v-for="item in [
        { id: 'all', name: '全部' },
        { id: 'manual', name: '手动' },
        { id: 'aiChat', name: 'AIChat' },
        { id: 'agent', name: 'Agent' },
      ]"
      :key="item.id"
      :aria-pressed="filter === item.id"
      @click="filter = item.id"
    >
      {{ t(item.name) }}
    </button>
  </div>
  <div v-if="!records.length" class="empty">{{ t('暂无调用记录') }}</div>
  <button
    v-for="call in records"
    :key="call.callId"
    class="history-row"
    @click="$emit('select', call.callId)"
  >
    <code>{{ call.toolName }}</code
    ><span class="history-meta"
      ><span>{{ new Date(call.startedAt).toLocaleTimeString() }}</span
      ><span>{{
        call.source === 'manual' ? t('手动') : call.source === 'aiChat' ? 'AIChat' : 'Agent'
      }}</span
      ><span>{{ call.durationMs === undefined ? '—' : `${call.durationMs} ms` }}</span
      ><span>{{ t(label(call)) }}</span></span
    >
  </button>
  <p class="hint">{{ t('最多保留 100 条、6 MiB。浏览器重启或扩展重载后清空。') }}</p>
</template>
