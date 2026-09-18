// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import {
  initializeLocale,
  locale,
  localeStorageKey,
  message,
  setLocale,
  t,
} from '../apps/extension/src/ui/i18n';
import LanguagePreference from '../apps/extension/src/ui/components/LanguagePreference.vue';
import ChatComposer from '../apps/extension/src/ui/components/chat/ChatComposer.vue';
import ChatMessageList from '../apps/extension/src/ui/components/chat/ChatMessageList.vue';
import ChatToolScope from '../apps/extension/src/ui/components/chat/ChatToolScope.vue';
import ToolList from '../apps/extension/src/ui/components/ToolList.vue';
import HelpView from '../apps/extension/src/ui/components/HelpView.vue';
import ModelProfileForm from '../apps/extension/src/ui/components/chat/ModelProfileForm.vue';
import RemoteConnectionForm from '../apps/extension/src/ui/components/RemoteConnectionForm.vue';
import { emptyRemote } from '../packages/protocol/remote';
let data: Record<string, unknown>;
let listeners: Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>;
beforeEach(async () => {
  data = {};
  listeners = new Set();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async () => data),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(data, values)),
      },
      onChanged: {
        addListener: (fn: typeof listeners extends Set<infer T> ? T : never) => listeners.add(fn),
        removeListener: (fn: typeof listeners extends Set<infer T> ? T : never) =>
          listeners.delete(fn),
      },
    },
  });
  await setLocale('zh-CN');
});
afterEach(() => vi.unstubAllGlobals());
it('language selector persists preference and updates mounted labels without clearing drafts', async () => {
  const selector = mount(LanguagePreference);
  const composer = mount(ChatComposer, { props: { busy: false, disabled: false, modelName: '' } });
  await composer.get('textarea').setValue('我的未发送消息');
  await selector.get('select').setValue('en');
  await flushPromises();
  expect(data[localeStorageKey]).toBe('en');
  expect(document.documentElement.lang).toBe('en');
  expect(document.title).toBe('WebMCP Tools');
  expect(selector.get('label').text()).toBe('Interface language');
  expect(composer.get('textarea').attributes('placeholder')).toBe(
    'What would you like to do on this page?',
  );
  expect((composer.get('textarea').element as HTMLTextAreaElement).value).toBe('我的未发送消息');
  expect(composer.get('.send').attributes('aria-label')).toBe('Send message');
  await selector.get('select').setValue('zh-CN');
  await flushPromises();
  expect(composer.get('.send').attributes('aria-label')).toBe('发送消息');
  selector.unmount();
  composer.unmount();
});
it('restores saved language, synchronizes sidebars and falls back for unsupported values', async () => {
  data[localeStorageKey] = 'en';
  const cleanup = await initializeLocale();
  expect(locale.value).toBe('en');
  for (const fn of listeners) fn({ [localeStorageKey]: { newValue: 'zh-CN' } }, 'local');
  expect(locale.value).toBe('zh-CN');
  for (const fn of listeners) fn({ [localeStorageKey]: { newValue: 'en' } }, 'session');
  expect(locale.value).toBe('zh-CN');
  for (const fn of listeners) fn({ [localeStorageKey]: { newValue: 'unsupported' } }, 'local');
  expect(locale.value).toBe('zh-CN');
  cleanup();
  expect(listeners.size).toBe(0);
});
it('failed persistence leaves the selected language unchanged and reports the error', async () => {
  const selector = mount(LanguagePreference);
  vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(Error('quota'));
  await selector.get('select').setValue('en');
  await flushPromises();
  expect(locale.value).toBe('zh-CN');
  expect(selector.get('[role="alert"]').text()).toContain('语言设置未能保存');
  expect((selector.get('select').element as HTMLSelectElement).value).toBe('zh-CN');
  selector.unmount();
});
it('switching does not translate user messages, model Markdown or tool descriptions', async () => {
  await setLocale('en');
  const thread = mount(ChatMessageList, {
    props: {
      messages: [
        { id: 'u', role: 'user', text: '执行工具' },
        { id: 'a', role: 'assistant', text: '**执行工具**' },
      ],
      traces: [],
      revision: 0,
      status: 'completed',
    },
  });
  const tools = mount(ToolList, {
    props: {
      tools: [{ name: '执行工具', description: '模型配置', inputSchema: {}, executable: true }],
    },
  });
  expect(thread.get('.message.user').text()).toBe('执行工具');
  expect(thread.get('.assistant-markdown strong').text()).toBe('执行工具');
  expect(tools.get('.tool-card').text()).toContain('模型配置');
  expect(tools.get('h2').text()).toContain('Page tools');
  thread.unmount();
  tools.unmount();
});
it('help, model settings and remote controls translate fully', async () => {
  await setLocale('en');
  const views = [
    mount(HelpView),
    mount(ModelProfileForm, { props: { profiles: [] } }),
    mount(RemoteConnectionForm, { props: { remote: emptyRemote(), pending: false } }),
  ];
  for (const view of views) {
    expect(view.text()).not.toMatch(/[\u3400-\u9fff]/);
    for (const input of view.findAll('[placeholder],[aria-label]')) {
      expect(JSON.stringify(input.attributes())).not.toMatch(/[\u3400-\u9fff]/);
    }
    view.unmount();
  }
});
it('authorization summary and stored runtime statuses translate reactively', async () => {
  const scope = mount(ChatToolScope, {
    props: {
      names: ['a', 'b'],
      mode: 'auto',
      disabled: false,
      granted: true,
      pending: false,
      editing: false,
      notice: '本会话授权已撤销，不会自动重新开启。',
    },
  });
  await setLocale('en');
  await nextTick();
  expect(scope.get('summary').text()).toBe('2 tools authorized · Automatic execution');
  expect(scope.text()).not.toMatch(/[\u3400-\u9fff]/);
  expect(message('执行中')).toBe('Running');
  expect(message('query：当前模型接口需要对象 Schema')).toContain('query: this model API');
  expect(message('模型服务请求失败（HTTP 429）')).toBe('Model request failed (HTTP 429)');
  expect(message('unknown external error')).toBe('unknown external error');
  expect(t('unknown translation')).toBe('unknown translation');
  scope.unmount();
});
it('storage read failures still initialize the default interface', async () => {
  await setLocale('en');
  vi.mocked(chrome.storage.local.get).mockRejectedValueOnce(Error('unavailable'));
  const cleanup = await initializeLocale();
  expect(locale.value).toBe('zh-CN');
  cleanup();
});
