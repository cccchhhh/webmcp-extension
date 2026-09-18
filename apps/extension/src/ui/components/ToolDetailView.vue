<script setup lang="ts">
import { t, message } from '../i18n';
import { shallowRef } from 'vue';
import type { PageTool, CallRecord } from '../../../../../packages/protocol';
import ArgumentEditor from './ArgumentEditor.vue';
import type { ArgumentDraft } from '../composables/argument-form';
import CallResultPanel from './CallResultPanel.vue';
defineProps<{ tool: PageTool; draft: ArgumentDraft; busy: boolean; call?: CallRecord }>();
defineEmits<{ draft: [value: ArgumentDraft]; execute: [value: Record<string, unknown>] }>();
const tab = shallowRef('params');
</script>
<template>
  <div class="eyebrow">{{ t('工具详情') }}</div>
  <h2 tabindex="-1" class="mono tool-title">{{ tool.name }}</h2>
  <p class="description">{{ tool.description || t('无描述') }}</p>
  <p v-if="!tool.executable" class="notice">{{ message(tool.unavailableReason) }}</p>
  <div class="tabs">
    <button :aria-pressed="tab === 'params'" @click="tab = 'params'">{{ t('参数与执行') }}</button
    ><button :aria-pressed="tab === 'schema'" @click="tab = 'schema'">Input Schema</button>
  </div>
  <ArgumentEditor
    v-if="tab === 'params'"
    :draft="draft"
    :schema="tool.inputSchema"
    :busy="busy"
    :executable="tool.executable"
    @draft="$emit('draft', $event)"
    @execute="$emit('execute', $event)"
  />
  <pre v-else>{{ JSON.stringify(tool.inputSchema, null, 2) }}</pre>
  <CallResultPanel :call="call" />
</template>
