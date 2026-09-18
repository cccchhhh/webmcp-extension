<script setup lang="ts">
import { t, message } from '../../i18n';
import { shallowRef, computed, watch } from 'vue';
import type { Page, Snapshot } from '../../../../../../packages/protocol';
import type { ModelProfile } from '../../../../../../packages/protocol/chat';
import type { ChatRuntime } from '../../../ai/chat-runtime';
import ChatComposer from './ChatComposer.vue';
import ChatMessageList from './ChatMessageList.vue';
import ChatToolScope from './ChatToolScope.vue';
const props = defineProps<{
  runtime: ChatRuntime;
  revision: number;
  profiles: ModelProfile[];
  page?: Page;
  snapshot: Snapshot;
}>();
const emit = defineEmits<{ settings: []; record: [id: string] }>();
const selected = shallowRef(props.runtime.session.profileId || props.profiles[0]?.id || ''),
  notice = shallowRef('');
const profile = computed(() => props.profiles.find((p) => p.id === selected.value));
const target = computed(() => {
  void props.revision;
  const bound = props.runtime.session.target;
  return bound
    ? Object.values(props.snapshot.pages).find((p) => p.pageId === bound.pageId)
    : props.page;
});
const active = computed(() => {
  void props.revision;
  return props.runtime;
});
const statusText = computed(() => {
  void props.revision;
  const labels: Record<string, string> = {
    requesting_model: '正在生成回答',
    awaiting_approval: '等待你确认工具调用',
    executing_tool: '正在等待页面返回',
    interrupted: '会话记录已恢复，不会自动续跑。',
    blocked_unknown: '操作结果未知，请先核实页面状态',
    blocked_pending: '原操作仍在执行，请等待结果后继续',
    paused_target_changed: '页面或工具已变化，请重新授权',
  };
  return labels[props.runtime.session.status] ?? '';
});
async function run(action: () => Promise<unknown>) {
  notice.value = '';
  try {
    await action();
  } catch (e) {
    notice.value = e instanceof Error ? e.message : '操作失败';
  }
}
const resetting = shallowRef(false);
const authorization = computed(() => {
  void props.revision;
  return props.runtime.authorization;
});
watch(
  [() => props.revision, profile, target, resetting],
  () => {
    if (!resetting.value) void props.runtime.authorization.sync(profile.value, target.value);
  },
  { immediate: true, flush: 'post' },
);
function grant(takeover = false) {
  void run(() => authorization.value.apply(profile.value, target.value, takeover));
}
function send(text: string) {
  void run(() => {
    if (!profile.value) throw Error('请选择模型');
    return active.value.send(
      text,
      profile.value,
      target.value,
      authorization.value.names,
      authorization.value.mode,
    );
  });
}
async function newSession() {
  resetting.value = true;
  try {
    await run(() => active.value.reset());
  } finally {
    resetting.value = false;
  }
}
watch(selected, () => {
  void newSession();
});
watch(
  () => props.profiles,
  (profiles) => {
    if (!selected.value && profiles[0]) selected.value = profiles[0].id;
  },
);
</script>
<template>
  <div class="chat-layout">
    <div class="chat-scroll">
      <div class="workspace-heading">
        <div>
          <div class="eyebrow">PAGE ASSISTANT</div>
          <h2 tabindex="-1">{{ t('与页面对话') }}</h2>
        </div>
        <button
          class="icon-btn"
          :aria-label="t('新建对话')"
          :disabled="active.busy || authorization.pending || resetting"
          @click="newSession"
        >
          ＋
        </button>
      </div>
      <p
        v-if="active.session.target && page?.pageId !== active.session.target.pageId"
        class="notice"
      >
        {{ t('聊天仍绑定原页面。切换目标请新建对话。') }}
      </p>
      <select
        v-model="selected"
        class="input"
        :aria-label="t('聊天模型')"
        :disabled="active.busy || authorization.pending || resetting"
      >
        <option value="" disabled>{{ t('选择模型') }}</option>
        <option v-for="p in profiles" :key="p.id" :value="p.id">
          {{ p.name }} · {{ p.model }}
        </option></select
      ><button v-if="!profiles.length" class="btn full" @click="emit('settings')">
        {{ t('添加你的第一个模型') }}</button
      ><ChatToolScope
        :page="target"
        :names="authorization.names"
        :mode="authorization.mode"
        :disabled="active.busy || authorization.pending || resetting || !profile"
        :pending="authorization.pending"
        :editing="authorization.editing"
        :notice="authorization.notice"
        :granted="!!active.grantId"
        @names="authorization.setNames($event)"
        @mode="authorization.setMode($event)"
        @grant="grant()"
        @takeover="grant(true)"
        @edit="run(() => authorization.edit())"
        @revoke="run(() => authorization.revoke())"
      />
      <div v-if="!active.session.messages.length" class="chat-welcome">
        <div class="chat-emblem">✧</div>
        <h3>{{ t('说出目标，') }}<br />{{ t('让工具接着做。') }}</h3>
        <p>{{ t('查询页面数据、设置筛选条件，') }}<br />{{ t('执行过程始终可见。') }}</p>
        <button
          v-if="target?.tools.length"
          class="suggestion"
          :disabled="!active.grantId"
          @click="send(t('介绍本次授权的页面工具可以做什么'))"
        >
          {{ t('了解所选工具能做什么 →') }}
        </button>
      </div>
      <ChatMessageList
        :messages="active.session.messages"
        :revision="revision"
        :traces="active.session.traces"
        :status="active.session.status"
        @approve="active.approve($event)"
        @open="emit('record', $event)"
      />
      <p v-if="notice || active.error" class="notice" role="alert">
        {{ message(notice || active.error) }}
      </p>
      <p class="hint" role="status">
        {{ t(statusText) }}
      </p>
    </div>
    <div class="chat-dock">
      <ChatComposer
        :busy="active.busy"
        :disabled="!profile || !active.grantId || authorization.pending || resetting"
        :model-name="profile?.name ?? ''"
        @send="send"
        @stop="run(() => active.stop())"
        @settings="emit('settings')"
      />
      <p class="chat-notice">
        {{
          authorization.mode === 'confirm' ? t('工具执行前需要确认') : t('本次会话自动执行已选工具')
        }}
        ·
        {{ active.usage ? t('已收到供应商用量信息') : t('供应商未返回用量') }}
      </p>
    </div>
  </div>
</template>
