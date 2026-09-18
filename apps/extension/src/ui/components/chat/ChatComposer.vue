<script setup lang="ts">
import { t } from '../../i18n';
import { shallowRef } from 'vue';
const props = defineProps<{ busy: boolean; disabled: boolean; modelName: string }>();
const emit = defineEmits<{ send: [text: string]; stop: []; settings: [] }>();
const draft = shallowRef(''),
  composing = shallowRef(false);
function send() {
  if (!draft.value.trim() || props.busy || props.disabled) return;
  emit('send', draft.value);
  draft.value = '';
}
function keydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !composing.value && e.keyCode !== 229) {
    e.preventDefault();
    send();
  }
}
</script>
<template>
  <div class="composer">
    <textarea
      v-model="draft"
      :aria-label="t('对话内容')"
      :placeholder="t('你想在这个页面上做什么？')"
      :disabled="disabled"
      @compositionstart="composing = true"
      @compositionend="composing = false"
      @keydown="keydown"
    ></textarea>
    <div class="composer-bottom">
      <button class="model-select" @click="emit('settings')">
        {{ modelName || t('配置模型') }} ↗</button
      ><button
        class="send"
        :disabled="!busy && (disabled || !draft.trim())"
        :aria-label="busy ? t('停止生成') : t('发送消息')"
        @click="busy ? emit('stop') : send()"
      >
        {{ busy ? '■' : '↑' }}
      </button>
    </div>
  </div>
</template>
