<script setup lang="ts">
import { t, message } from '../i18n';
import type { RemoteState } from '../../../../../packages/protocol/remote';
defineProps<{ remote: RemoteState }>();
const labels = {
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重连中',
  attention: '需要处理',
};
</script>
<template>
  <p role="status" data-testid="remote-status">{{ t(labels[remote.status]) }}</p>
  <p v-if="remote.error" class="notice" role="alert">
    {{ message(remote.error) }}{{ t('。请检查服务地址、插件令牌及服务运行状态。') }}
  </p>
</template>
