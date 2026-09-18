<script setup lang="ts">
import { t } from '../i18n';
defineProps<{ modelValue: string; disabled: boolean }>();
defineEmits<{ 'update:modelValue': [value: string] }>();
</script>
<template>
  <label for="arguments" class="hint">{{ t('JSON 对象') }}</label>
  <textarea
    id="arguments"
    class="json-editor"
    spellcheck="false"
    :value="modelValue"
    :disabled="disabled"
    @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>
