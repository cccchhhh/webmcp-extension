// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ToolList from '../apps/extension/src/ui/components/ToolList.vue';
import CallResultPanel from '../apps/extension/src/ui/components/CallResultPanel.vue';
import SharingView from '../apps/extension/src/ui/components/SharingView.vue';
import SettingsView from '../apps/extension/src/ui/components/SettingsView.vue';
describe('Vue 界面', () => {
  it('工具选择保持完整名称，描述转义', async () => {
    const name = 'long_tool_'.repeat(30);
    const wrapper = mount(ToolList, {
      props: {
        tools: [
          { name, description: '<img src=x onerror=alert(1)>', inputSchema: {}, executable: true },
        ],
      },
    });
    expect(wrapper.find('img').exists()).toBe(false);
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('select')?.[0]).toEqual([name]);
  });
  it('结果只渲染文本', () => {
    const wrapper = mount(CallResultPanel, {
      props: {
        call: {
          callId: 'a',
          pageId: 'p',
          catalogVersion: 'v',
          toolName: 't',
          source: 'manual',
          delivery: 'acknowledged',
          execution: 'returned',
          business: 'unclassified',
          startedAt: '',
          deadline: 0,
          rawResult: '<script>alert(1)</script>',
        },
      },
    });
    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.text()).toContain('<script>alert(1)</script>');
  });
  it('共享默认禁用且未授权', () => {
    const wrapper = mount(SharingView);
    expect((wrapper.find('input').element as HTMLInputElement).disabled).toBe(true);
    expect((wrapper.find('input').element as HTMLInputElement).checked).toBe(false);
  });
  it('保存设备名称而非模拟登录', async () => {
    const wrapper = mount(SettingsView, { props: { name: '设备', pending: false } });
    await wrapper.find('input').setValue('工作浏览器');
    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('save')?.[0]).toEqual(['工作浏览器']);
    expect((wrapper.find('input[type="password"]').element as HTMLInputElement).value).toBe('');
    expect(wrapper.text()).toContain('轻量桥接');
    expect(wrapper.text()).not.toContain('Agent 设备授权');
  });
});

import PageStatusCard from '../apps/extension/src/ui/components/PageStatusCard.vue';
describe('能力状态', () => {
  for (const [discovery, text] of [
    ['unsupported', '浏览器暂不支持'],
    ['permission_required', '需要站点访问权限'],
    ['restricted_page', '此页面不允许'],
    ['ready_empty', '页面尚未注册'],
    ['discovery_failed', '工具发现失败'],
  ] as const) {
    it(discovery, () => {
      const wrapper = mount(PageStatusCard, {
        props: {
          pending: false,
          page: {
            pageId: 'p',
            tabId: 1,
            documentId: 'd',
            title: '页面',
            url: 'https://example.com/',
            catalogVersion: 'v',
            tools: [],
            discovery,
          },
        },
      });
      expect(wrapper.text()).toContain(text);
      expect(wrapper.findAll('button').some((b) => b.text() === '允许访问当前站点')).toBe(
        discovery === 'permission_required',
      );
    });
  }
});

import { vi } from 'vitest';
import { emptyRemote } from '../packages/protocol/remote';
import RemoteConnectionForm from '../apps/extension/src/ui/components/RemoteConnectionForm.vue';
describe('远程界面', () => {
  it('连接设置仅保留轻量桥接，保存时固定使用桥接配置', async () => {
    const wrapper = mount(RemoteConnectionForm, {
      props: { remote: emptyRemote(), pending: false },
    });
    expect(wrapper.find('#connection-type').exists()).toBe(false);
    expect(wrapper.find('#device-id').exists()).toBe(false);
    expect(wrapper.find('#auth-mode').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('原有服务');
    await wrapper.find('#service-url').setValue('https://bridge.test');
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '保存连接配置')!
      .trigger('click');
    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      connectionType: 'bridge',
      baseUrl: 'https://bridge.test',
      mode: 'remote',
      deviceId: '',
    });
  });
  it('已保存令牌不回显，编辑令牌只通过保存事件提交并清空', async () => {
    const wrapper = mount(RemoteConnectionForm, {
      props: { remote: { ...emptyRemote(), hasToken: true }, pending: false },
    });
    expect((wrapper.find('#access-token').element as HTMLInputElement).type).toBe('password');
    expect((wrapper.find('#access-token').element as HTMLInputElement).value).toBe('');
    await wrapper.find('#access-token').setValue('private-test-token');
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '保存连接配置')!
      .trigger('click');
    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({ token: 'private-test-token' });
    expect((wrapper.find('#access-token').element as HTMLInputElement).value).toBe('');
    expect(wrapper.text()).not.toContain('private-test-token');
  });
  it('后台状态快照更新不会清空正在编辑的连接草稿', async () => {
    const remote = emptyRemote();
    const wrapper = mount(RemoteConnectionForm, { props: { remote, pending: false } });
    await wrapper.find('#service-url').setValue('https://draft.test');
    await wrapper.find('#access-token').setValue('unsaved-token');
    await wrapper.setProps({ remote: { ...remote, status: 'connecting' } });
    expect((wrapper.find('#service-url').element as HTMLInputElement).value).toBe(
      'https://draft.test',
    );
    expect((wrapper.find('#access-token').element as HTMLInputElement).value).toBe('unsaved-token');
  });
  it('展示连接错误与重连状态，启用状态阻止重复连接', () => {
    const wrapper = mount(RemoteConnectionForm, {
      props: {
        remote: {
          ...emptyRemote(),
          status: 'reconnecting',
          enabled: true,
          hasToken: true,
          deviceId: crypto.randomUUID(),
          error: 'CONNECTION_LOST',
        },
        pending: false,
      },
    });
    expect(wrapper.text()).toContain('重连中');
    expect(wrapper.text()).toContain('CONNECTION_LOST');
    expect(
      wrapper
        .findAll('button')
        .find((b) => b.text() === '开启连接')!
        .attributes('disabled'),
    ).toBeDefined();
  });
  it('页面共享和逐工具授权发出明确的权限变更', async () => {
    const page = {
      pageId: 'page',
      documentId: 'doc',
      catalogVersion: 'version',
      tabId: 1,
      title: 'p',
      url: 'https://site.test',
      discovery: 'ready' as const,
      tools: [{ name: 'echo', description: '', inputSchema: {}, executable: true }],
    };
    const wrapper = mount(SharingView, { props: { page } });
    await wrapper.find('input').setValue(true);
    expect(wrapper.emitted('change')?.[0]).toEqual([true, ['echo']]);
    await wrapper.setProps({
      sharing: {
        enabled: true,
        authorizedToolNames: [],
        catalogVersion: 'remote',
        nativeVersion: 'version',
      },
    });
    await wrapper.findAll('input')[1].setValue(true);
    expect(wrapper.emitted('change')?.[1]).toEqual([true, ['echo']]);
  });
});
