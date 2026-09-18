<script setup lang="ts">
import { t, message } from './i18n';
import LanguagePreference from './components/LanguagePreference.vue';
import { reactive, computed, shallowRef } from 'vue';
import { createDraft, type ArgumentDraft } from './composables/argument-form';
import { usePanel } from './composables/panel';
import PageStatusCard from './components/PageStatusCard.vue';
import ToolList from './components/ToolList.vue';
import ToolDetailView from './components/ToolDetailView.vue';
import HistoryView from './components/HistoryView.vue';
import CallResultPanel from './components/CallResultPanel.vue';
import SettingsView from './components/SettingsView.vue';
import SharingView from './components/SharingView.vue';
import HelpView from './components/HelpView.vue';
import ModelProfileForm from './components/chat/ModelProfileForm.vue';
import AiChatView from './components/chat/AiChatView.vue';
import { useChat } from './composables/chat';
const {
  bridge,
  view,
  selected,
  callId,
  page,
  tool,
  record,
  draftKey,
  activeCall,
  busy,
  pending,
  notice,
  go,
  run,
  update,
  permission,
} = usePanel();
const chat = useChat(bridge);
const settingsTab = shallowRef<'models' | 'bridge'>('models');
const mainTabs = [
  { id: 'home', label: 'Tools', symbol: '⌘' },
  { id: 'chat', label: 'AIChat', symbol: '◇' },
  { id: 'settings', label: 'Settings', symbol: '⚙' },
  { id: 'help', label: 'Help', symbol: '?' },
] as const;
const activeTab = computed(() =>
  ['chat', 'settings', 'help'].includes(view.value) ? view.value : 'home',
);
function tabKey(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const index = mainTabs.findIndex((t) => t.id === activeTab.value);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? 3
        : (index + (event.key === 'ArrowRight' ? 1 : 3)) % 4;
  go(mainTabs[next].id);
  document.getElementById('tab-' + mainTabs[next].id)?.focus();
}
function modelSettings() {
  settingsTab.value = 'models';
  go('settings');
}
const drafts = reactive<Record<string, ArgumentDraft>>({});
const currentDraft = computed(
  () => drafts[draftKey.value] ?? createDraft(tool.value?.inputSchema ?? {}),
);
function execute(args: Record<string, unknown>) {
  if (page.value && tool.value)
    void run(() =>
      bridge.command({
        type: 'INVOKE',
        pageId: page.value!.pageId,
        catalogVersion: page.value!.catalogVersion,
        toolName: tool.value!.name,
        arguments: args,
      }),
    );
}
</script>
<template>
  <div class="app">
    <header>
      <div class="brand">
        <span class="logo">⌘</span>WebMCP <span class="edition">{{ t('工具助手') }}</span>
      </div>
      <nav :aria-label="t('快捷操作')">
        <button
          class="icon-btn"
          :aria-label="t('会话记录')"
          :title="t('会话记录')"
          @click="go('history')"
        >
          ◷</button
        ><button
          class="icon-btn"
          :aria-label="t('连接设置')"
          :title="t('连接设置')"
          @click="
            settingsTab = 'bridge';
            go('settings');
          "
        >
          ⚙
        </button>
      </nav>
    </header>
    <nav class="primary-tabs" role="tablist" :aria-label="t('主导航')" @keydown="tabKey">
      <button
        v-for="tab in mainTabs"
        :id="'tab-' + tab.id"
        :key="tab.id"
        role="tab"
        aria-controls="panel-view"
        :aria-selected="activeTab === tab.id"
        :tabindex="activeTab === tab.id ? 0 : -1"
        @click="go(tab.id)"
      >
        <span>{{ tab.symbol }}</span
        >{{ t(tab.label) }}
      </button>
    </nav>
    <main
      id="panel-view"
      :class="{ 'chat-panel': view === 'chat' }"
      role="tabpanel"
      :aria-labelledby="'tab-' + activeTab"
    >
      <p v-if="!bridge.connected.value" class="notice" role="status">
        {{ t('后台连接中断，正在重新订阅。执行请求不会自动重发。') }}
      </p>
      <p v-if="notice" class="notice" role="alert">{{ message(notice) }}</p>
      <button
        v-if="['detail', 'history', 'record', 'sharing'].includes(view)"
        class="back"
        @click="go(view === 'record' ? 'history' : 'home')"
      >
        ← {{ view === 'record' ? t('返回记录') : t('返回工具') }}</button
      ><template v-if="view === 'home'"
        ><PageStatusCard
          :page="page"
          :pending="pending"
          @discover="update"
          @permission="permission"
        /><ToolList
          :tools="page?.tools || []"
          @select="
            selected = $event;
            go('detail');
          "
        /><button class="sharing-link" @click="go('sharing')">
          {{ t('页面共享')
          }}<span
            >{{
              page && bridge.snapshot.value.sharing[page.pageId]?.enabled
                ? t('已开启')
                : t('未共享')
            }}
            ›</span
          >
        </button></template
      ><ToolDetailView
        v-else-if="view === 'detail' && tool"
        :key="draftKey"
        :tool="tool"
        :draft="currentDraft"
        :busy="busy"
        :call="activeCall"
        @draft="drafts[draftKey] = $event"
        @execute="execute"
      />
      <div v-else-if="view === 'detail'" class="empty">
        <h2 tabindex="-1">{{ t('工具已失效') }}</h2>
        <p>{{ t('页面或工具目录发生变化，请返回工具列表。') }}</p>
      </div>
      <HistoryView
        v-else-if="view === 'history'"
        :calls="bridge.snapshot.value.calls"
        @select="
          callId = $event;
          go('record');
        "
      /><template v-else-if="view === 'record'"
        ><h2 tabindex="-1">{{ t('调用详情') }}</h2>
        <template v-if="record"
          ><p class="mono description">{{ record.toolName }}</p>
          <p class="hint mono">{{ t('页面实例') }}{{ record.pageId }}</p>
          <h3>{{ t('调用参数') }}</h3>
          <pre v-if="record.arguments">{{ JSON.stringify(record.arguments, null, 2) }}</pre>
          <CallResultPanel :call="record"
        /></template>
        <p v-else class="empty">{{ t('记录已释放') }}</p></template
      ><template v-else-if="view === 'settings'">
        <div class="workspace-heading">
          <div>
            <div class="eyebrow">PREFERENCES</div>
            <h2 tabindex="-1">{{ t('设置') }}</h2>
            <p>{{ t('连接你的模型与浏览器工具。') }}</p>
          </div>
          <span>⚙</span>
        </div>
        <LanguagePreference />
        <div class="settings-switcher">
          <button :aria-pressed="settingsTab === 'models'" @click="settingsTab = 'models'">
            {{ t('模型配置') }}</button
          ><button :aria-pressed="settingsTab === 'bridge'" @click="settingsTab = 'bridge'">
            {{ t('远程桥接') }}
          </button>
        </div>
        <ModelProfileForm
          v-if="settingsTab === 'models'"
          :profiles="chat.modelProfiles.value"
          @changed="chat.refreshProfiles" />
        <SettingsView
          v-else
          :name="bridge.snapshot.value.deviceName"
          :remote="bridge.snapshot.value.remote"
          :command="bridge.command"
          :pending="pending"
          @save="run(() => bridge.command({ type: 'SAVE_DEVICE', name: $event }))" /></template
      ><AiChatView
        v-else-if="view === 'chat' && chat.runtime.value"
        :runtime="chat.runtime.value"
        :revision="chat.revision.value"
        :profiles="chat.modelProfiles.value"
        :page="page"
        :snapshot="bridge.snapshot.value"
        @settings="modelSettings"
        @record="
          callId = $event;
          go('record');
        "
      />
      <HelpView
        v-else-if="view === 'help'"
        @tools="go('home')"
        @settings="modelSettings"
      /><SharingView
        v-else-if="view === 'sharing'"
        :page="page"
        :sharing="page ? bridge.snapshot.value.sharing[page.pageId] : undefined"
        :pending="pending"
        @change="
          (enabled, toolNames) =>
            page &&
            run(() =>
              bridge.command({
                type: 'SET_SHARING',
                pageId: page!.pageId,
                catalogVersion: page!.catalogVersion,
                enabled,
                toolNames,
              }),
            )
        "
      />
    </main>
    <footer class="status-strip">
      <span>◇ {{ bridge.connected.value ? t('浏览器会话已连接') : t('后台连接中断') }}</span
      ><button @click="go('help')">{{ t('使用帮助 ›') }}</button>
    </footer>
  </div>
</template>
