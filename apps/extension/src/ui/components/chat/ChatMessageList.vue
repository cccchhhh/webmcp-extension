<script setup lang="ts">
import { t } from '../../i18n';
import { computed, watch, nextTick, useTemplateRef, onMounted, onUnmounted } from 'vue';
import type { ChatMessage, ChatTrace } from '../../../../../../packages/protocol/chat';
import ChatToolCallCard from './ChatToolCallCard.vue';
import AssistantMarkdown from './AssistantMarkdown.vue';
const props = defineProps<{
  messages: ChatMessage[];
  revision: number;
  traces: ChatTrace[];
  status: string;
}>();
defineEmits<{ approve: [value: boolean]; open: [id: string] }>();
const end = useTemplateRef('end');
const rows = computed(() => {
  void props.revision;
  return props.messages.map((message) => ({
    message,
    traces: props.traces.filter((t) => t.afterMessageId === message.id),
  }));
});
let scroller: HTMLElement | null = null;
let follow = true,
  lastTop = 0;
function onScroll() {
  if (!scroller) return;
  const gap = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
  follow = gap <= 16 || (scroller.scrollTop >= lastTop && gap <= 96);
  lastTop = scroller.scrollTop;
}
onMounted(() => {
  scroller = end.value?.closest<HTMLElement>('.chat-scroll') ?? null;
  lastTop = scroller?.scrollTop ?? 0;
  scroller?.addEventListener('scroll', onScroll, { passive: true });
});
onUnmounted(() => scroller?.removeEventListener('scroll', onScroll));
watch(
  () => props.revision,
  async () => {
    const keepFollowing = follow;
    await nextTick();
    if (keepFollowing && follow && scroller && props.messages.length) {
      scroller.scrollTop = scroller.scrollHeight;
      lastTop = scroller.scrollTop;
    }
  },
);
</script>
<template>
  <div class="chat-thread">
    <template v-for="{ message: m, traces: messageTraces } in rows" :key="m.id"
      ><article :class="['message', m.role]">
        <div v-if="m.role === 'assistant'" class="message-label">WebMCP AI</div>
        <div v-if="m.role === 'user'" class="message-text">{{ m.text }}</div>
        <AssistantMarkdown v-else-if="m.text" :text="m.text" />
        <p v-else class="hint">
          {{ status === 'requesting_model' ? t('正在生成…') : t('工具请求') }}
        </p>
      </article>
      <ChatToolCallCard
        v-for="trace in messageTraces"
        :key="trace.invocationId"
        :trace="{ ...trace }"
        :awaiting="status === 'awaiting_approval' && trace.status === '等待确认'"
        @approve="$emit('approve', $event)"
        @open="$emit('open', $event)"
    /></template>
    <div ref="end"></div>
  </div>
</template>
