<script setup lang="ts">
import { computed } from 'vue';
import { renderAssistantMarkdown } from '../../formatting/markdown';
const props = defineProps<{ text: string }>();
const html = computed(() => renderAssistantMarkdown(props.text));
</script>
<template><div class="assistant-markdown" v-html="html"></div></template>
<style scoped>
.assistant-markdown {
  min-width: 0;
  max-width: 100%;
  font-size: 13px;
  line-height: 1.85;
  overflow-wrap: anywhere;
  white-space: normal;
}
.assistant-markdown :deep(> :first-child) {
  margin-top: 0;
}
.assistant-markdown :deep(> :last-child) {
  margin-bottom: 0;
}
.assistant-markdown :deep(p) {
  margin: 0 0 12px;
}
.assistant-markdown :deep(h1),
.assistant-markdown :deep(h2),
.assistant-markdown :deep(h3),
.assistant-markdown :deep(h4),
.assistant-markdown :deep(h5),
.assistant-markdown :deep(h6) {
  font-weight: 650;
  line-height: 1.45;
  letter-spacing: 0;
  margin: 20px 0 10px;
}
.assistant-markdown :deep(h1) {
  font-size: 21px;
}
.assistant-markdown :deep(h2) {
  font-size: 18px;
}
.assistant-markdown :deep(h3) {
  font-size: 15px;
}
.assistant-markdown :deep(h4),
.assistant-markdown :deep(h5),
.assistant-markdown :deep(h6) {
  font-size: 13px;
}
.assistant-markdown :deep(ul),
.assistant-markdown :deep(ol) {
  margin: 10px 0 14px;
  padding-left: 22px;
}
.assistant-markdown :deep(li) {
  margin: 4px 0;
}
.assistant-markdown :deep(li > p) {
  margin: 4px 0;
}
.assistant-markdown :deep(blockquote) {
  margin: 12px 0;
  border-left: 3px solid #c7d4f6;
  padding: 2px 0 2px 12px;
  color: #61718a;
}
.assistant-markdown :deep(code) {
  font-size: 11px;
  padding: 2px 5px;
  background: #edf1f7;
  border-radius: 4px;
  overflow-wrap: anywhere;
}
.assistant-markdown :deep(pre) {
  max-width: 100%;
  max-height: 380px;
  overflow: auto;
  margin: 12px 0;
  padding: 12px;
  background: #f5f7fb;
  border: 1px solid var(--line);
  line-height: 1.7;
  white-space: pre;
}
.assistant-markdown :deep(pre code) {
  padding: 0;
  background: none;
  white-space: pre;
  overflow-wrap: normal;
}
.assistant-markdown :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 14px 0;
  font-size: 12px;
}
.assistant-markdown :deep(th),
.assistant-markdown :deep(td) {
  padding: 8px 10px;
  border: 1px solid var(--line);
  white-space: nowrap;
  text-align: left;
}
.assistant-markdown :deep(th) {
  background: #f5f7fb;
  font-weight: 600;
}
.assistant-markdown :deep(a) {
  color: var(--blue);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.assistant-markdown :deep(hr) {
  margin: 20px 0;
  border: 0;
  border-top: 1px solid var(--line);
}
</style>
