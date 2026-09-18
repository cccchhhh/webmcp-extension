<script setup lang="ts">
import { t } from '../i18n';
import { reactive, watch } from 'vue';
import RemoteConnectionStatus from './RemoteConnectionStatus.vue';
import type { RemoteState, RemoteSettings } from '../../../../../packages/protocol/remote';
const props = defineProps<{ remote: RemoteState; pending: boolean }>();
const emit = defineEmits<{
  save: [settings: RemoteSettings];
  connect: [];
  disconnect: [];
  clear: [];
  copy: [value: string];
}>();
const draft = reactive({ baseUrl: props.remote.baseUrl, token: '' });
watch(
  () => [props.remote.baseUrl, props.remote.deviceId] as const,
  ([baseUrl, deviceId], old) => {
    if (old && baseUrl === old[0] && deviceId === old[1]) return;
    Object.assign(draft, { baseUrl, token: '' });
  },
);
function save() {
  emit('save', {
    connectionType: 'bridge',
    baseUrl: draft.baseUrl,
    mode: draft.baseUrl.startsWith('https:') ? 'remote' : 'local',
    deviceId: '',
    token: draft.token || undefined,
  });
  draft.token = '';
}
</script>
<template>
  <section class="page-card remote">
    <h3>{{ t('页面工具连接') }}</h3>
    <RemoteConnectionStatus :remote="remote" />
    <p class="hint">{{ t('连接方式：轻量桥接') }}</p>
    <p class="hint">
      {{ t('运行独立桥接程序后填写地址和插件令牌；浏览器身份自动生成。页面工具仍需单独授权。') }}
    </p>
    <label for="service-url">{{ t('服务地址') }}</label
    ><input
      id="service-url"
      v-model="draft.baseUrl"
      placeholder="https://mcp.example.com"
      :disabled="pending"
    />
    <label for="access-token">{{ t('插件令牌') }}</label
    ><input
      id="access-token"
      v-model="draft.token"
      type="password"
      :disabled="pending"
      autocomplete="new-password"
      :placeholder="remote.hasToken ? t('已保存；留空保持现有令牌') : t('请输入令牌')"
    />
    <p class="hint">
      {{
        t(
          '令牌仅保存在本机扩展存储，不同步到云端。过期后需手动更新。修改配置后先保存，再开启连接。',
        )
      }}
    </p>
    <div class="actions">
      <button class="btn" :disabled="pending" @click="save">{{ t('保存连接配置') }}</button>
      <button
        class="btn primary"
        :disabled="pending || !remote.hasToken || !remote.deviceId || remote.enabled"
        @click="$emit('connect')"
      >
        {{ t('开启连接') }}
      </button>
      <button class="btn" :disabled="pending || !remote.enabled" @click="$emit('disconnect')">
        {{ t('断开连接') }}
      </button>
      <button class="btn" :disabled="pending || !remote.hasToken" @click="$emit('clear')">
        {{ t('清除凭证与共享') }}
      </button>
    </div>
    <p class="hint">{{ t('AI 客户端使用初始化命令提供的独立 Agent 令牌，不能使用插件令牌。') }}</p>
    <p class="hint mono">{{ t('已保存的 MCP 地址：') }}{{ remote.baseUrl }}/mcp</p>
    <button class="btn" @click="$emit('copy', remote.baseUrl + '/mcp')">
      {{ t('复制 MCP 地址') }}
    </button>
  </section>
</template>
<style scoped>
.remote input {
  width: 100%;
  min-width: 0;
  margin-bottom: 12px;
}
.remote label {
  display: block;
  margin-bottom: 6px;
}
.mono {
  overflow-wrap: anywhere;
}
.remote .actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.remote .actions .btn {
  min-height: 40px;
  white-space: normal;
}
</style>
