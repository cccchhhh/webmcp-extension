<script setup lang="ts">
import { t, message } from '../i18n';
import type { PageTool } from '../../../../../packages/protocol';
defineProps<{ tools: PageTool[] }>();
defineEmits<{ select: [name: string] }>();
</script>
<template>
  <div class="section-head">
    <h2 tabindex="-1">
      {{ t('页面工具') }}<span class="count">{{ tools.length }}</span>
    </h2>
    <span class="muted">{{ t('手动调用') }}</span>
  </div>
  <div v-if="!tools.length" class="empty">
    <div class="empty-icon">◇</div>
    <h3>{{ t('暂无可用工具') }}</h3>
    <p>{{ t('授予当前站点权限后，发现页面注册的 WebMCP 工具。') }}</p>
  </div>
  <button
    v-for="tool in tools"
    :key="tool.name"
    class="tool-card"
    @click="$emit('select', tool.name)"
  >
    <span class="tool-icon">⌘</span
    ><span class="tool-copy"
      ><code>{{ tool.name }}</code
      ><span :title="tool.description || t('此工具未提供描述')">{{
        tool.description || t('此工具未提供描述')
      }}</span
      ><small v-if="!tool.executable" class="error"
        >{{ t('仅可查看 ·') }}{{ message(tool.unavailableReason) }}</small
      ></span
    ><span aria-hidden="true">›</span>
  </button>
</template>
