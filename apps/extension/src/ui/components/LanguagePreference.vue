<script setup lang="ts">
import { shallowRef } from 'vue';
import { locale, t, setLocale, isLocale } from '../i18n';
const busy = shallowRef(false),
  failed = shallowRef(false);
async function change(event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (!isLocale(value)) return;
  busy.value = true;
  failed.value = false;
  try {
    await setLocale(value);
  } catch {
    failed.value = true;
  } finally {
    (event.target as HTMLSelectElement).value = locale.value;
    busy.value = false;
  }
}
</script>
<template>
  <div class="language-preference">
    <label for="ui-language">{{ t('界面语言') }}</label>
    <select id="ui-language" class="input" :value="locale" :disabled="busy" @change="change">
      <option value="zh-CN">简体中文</option>
      <option value="en">English</option>
    </select>
    <p v-if="failed" class="error" role="alert">{{ t('语言设置未能保存，请重试。') }}</p>
  </div>
</template>
<style scoped>
.language-preference {
  margin-bottom: 20px;
}
</style>
