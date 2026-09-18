<script setup lang="ts">
import { t, message } from '../../i18n';
import type { ChatTrace } from '../../../../../../packages/protocol/chat';
defineProps<{ trace: ChatTrace; awaiting: boolean }>();
defineEmits<{ approve: [value: boolean]; open: [id: string] }>();
</script>
<template>
  <section class="call-trace">
    <div class="row">
      <code>{{ trace.name }}</code
      ><span class="badge">{{ message(trace.status) }}</span>
    </div>
    <details :open="awaiting">
      <summary>{{ t('实际参数') }}</summary>
      <pre>{{ JSON.stringify(trace.arguments, null, 2) }}</pre>
    </details>
    <details v-if="trace.result !== undefined">
      <summary>{{ t('发送给模型的结果') }}</summary>
      <pre>{{ JSON.stringify(trace.result, null, 2) }}</pre>
    </details>
    <div v-if="awaiting" class="actions">
      <button class="btn" @click="$emit('approve', false)">{{ t('拒绝') }}</button
      ><button class="btn primary" @click="$emit('approve', true)">{{ t('允许执行') }}</button>
    </div>
    <button v-if="trace.callId" class="link" @click="$emit('open', trace.callId)">
      {{ t('查看原始调用记录 →') }}
    </button>
  </section>
</template>
