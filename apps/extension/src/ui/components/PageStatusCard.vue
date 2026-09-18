<script setup lang="ts">
import { t, message } from '../i18n';
import { computed } from 'vue';
import type { Page } from '../../../../../packages/protocol';
const props = defineProps<{ page?: Page; pending: boolean }>();
defineEmits<{ discover: []; permission: [] }>();
const status = computed(
  () =>
    ({
      unsupported: '浏览器暂不支持 WebMCP',
      permission_required: '需要站点访问权限',
      restricted_page: '此页面不允许插件访问',
      ready_empty: '页面尚未注册工具',
      ready: 'WebMCP 已就绪',
      discovery_failed: '工具发现失败',
    })[props.page?.discovery || 'ready_empty'],
);
</script>
<template>
  <section class="page-card">
    <div class="eyebrow">{{ t('当前页面') }}</div>
    <h3>{{ page?.title || t('正在获取页面…') }}</h3>
    <p class="url">{{ page?.url || t('请切换到 HTTP / HTTPS 页面') }}</p>
    <div class="row">
      <span class="status" :class="{ green: page?.discovery === 'ready' }"
        ><i />{{ t(status) }}</span
      ><button class="link" :disabled="pending" @click="$emit('discover')">
        {{ t('重新发现') }}
      </button>
    </div>
    <p v-if="page?.error" class="error">{{ message(page.error) }}</p>
    <button
      v-if="page?.discovery === 'permission_required'"
      class="btn primary full"
      :disabled="pending"
      @click="$emit('permission')"
    >
      {{ t('允许访问当前站点') }}
    </button>
    <p v-if="page?.discovery === 'unsupported'" class="hint">
      {{ t('需要提供 document.modelContext 工具发现接口的 Chrome 环境。请参阅安装说明。') }}
    </p>
  </section>
</template>
