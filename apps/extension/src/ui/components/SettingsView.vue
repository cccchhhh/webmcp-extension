<script setup lang="ts">
import { t, message } from '../i18n';
import { shallowRef, watch } from 'vue';
import { emptyRemote, type RemoteState } from '../../../../../packages/protocol/remote';
import type { Command } from '../../../../../packages/protocol';
import { useRemoteActions } from '../composables/remote';
import RemoteConnectionForm from './RemoteConnectionForm.vue';
const props = withDefaults(
  defineProps<{
    name: string;
    pending: boolean;
    remote?: RemoteState;
    command?: (c: Command) => Promise<void>;
  }>(),
  { remote: emptyRemote },
);
defineEmits<{ save: [name: string] }>();
const draft = shallowRef(props.name);
watch(
  () => props.name,
  (n) => (draft.value = n),
);
const actions = useRemoteActions((c) =>
  props.command ? props.command(c) : Promise.reject(Error('后台未连接')),
);
</script>
<template>
  <h2 tabindex="-1">{{ t('连接设置') }}</h2>
  <label for="device">{{ t('设备名称') }}</label
  ><input id="device" v-model="draft" maxlength="60" autocomplete="off" />
  <button class="btn" :disabled="pending || !draft.trim()" @click="$emit('save', draft)">
    {{ t('保存名称') }}
  </button>
  <p class="hint">{{ t('名称用于本地显示，并在下次连接时同步到桥接。') }}</p>
  <p v-if="actions.notice.value" class="notice" role="status">
    {{ message(actions.notice.value) }}
  </p>
  <RemoteConnectionForm
    :remote="remote"
    :pending="pending || actions.pending.value"
    @save="actions.save"
    @connect="actions.action({ type: 'CONNECT_REMOTE' })"
    @disconnect="actions.action({ type: 'DISCONNECT_REMOTE' })"
    @clear="actions.action({ type: 'CLEAR_REMOTE' })"
    @copy="actions.copy"
  />
  <p class="hint">{{ t('远程调用的参数与结果会经过服务端。') }}</p>
</template>
