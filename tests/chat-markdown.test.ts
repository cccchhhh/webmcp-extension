// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import AssistantMarkdown from '../apps/extension/src/ui/components/chat/AssistantMarkdown.vue';
import ChatMessageList from '../apps/extension/src/ui/components/chat/ChatMessageList.vue';
import { renderAssistantMarkdown } from '../apps/extension/src/ui/formatting/markdown';
it('渲染常用 Markdown，用户正文保持纯文本且没有身份标签', () => {
  const text =
    '# 标题\n\n**粗体** *斜体* ~~删除~~ `code`\n\n- 第一项\n- 第二项\n\n1. 步骤\n\n> 引用\n\n```js\nconst x = 1;\n```\n\n| 列一 | 列二 |\n| --- | --- |\n| a | b |\n\n[链接](https://example.com)';
  const w = mount(ChatMessageList, {
    props: {
      messages: [
        { id: 'u', role: 'user', text: '**用户**' },
        { id: 'a', role: 'assistant', text },
      ],
      traces: [],
      revision: 0,
      status: 'completed',
    },
  });
  expect(w.get('.message.user').text()).toBe('**用户**');
  expect(w.find('.message.user .message-label').exists()).toBe(false);
  for (const selector of ['h1', 'strong', 'em', 's', 'ul', 'ol', 'blockquote', 'pre code', 'table'])
    expect(w.find('.assistant-markdown ' + selector).exists()).toBe(true);
  expect(w.get('a').attributes()).toMatchObject({
    href: 'https://example.com',
    target: '_blank',
    rel: 'noopener noreferrer',
  });
});
it('HTML、事件属性和危险链接不可执行，图片不创建网络资源', () => {
  const w = mount(AssistantMarkdown, {
    props: {
      text: '<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n\n[坏](javascript:alert%281%29) [数据](data:text/html,evil) [邮件](mailto:a@b.com) [相对](/path)\n\n![替代文字](https://remote.example/image.png)\n\n[正常](http://example.com)',
    },
  });
  expect(w.find('script,img,iframe,svg').exists()).toBe(false);
  expect(w.findAll('a')).toHaveLength(1);
  expect(w.text()).toContain('替代文字');
  expect(w.html()).not.toContain('src="https://remote.example');
});
it('流式未闭合代码围栏和表格可渐进渲染，旧消息只按 text 变化解析', async () => {
  const w = mount(AssistantMarkdown, { props: { text: '```ts\nconst a =' } });
  expect(w.get('pre code').text()).toContain('const a =');
  await w.setProps({ text: '```ts\nconst a = 1;\n```\n\n| a |\n| - |\n| 1 |' });
  expect(w.get('table').text()).toContain('1');
  expect(w.get('pre code').text()).toContain('const a = 1;');
  expect(renderAssistantMarkdown('[不完整](https://')).not.toContain('<script');
});
it('用户向上滚动后，流式更新不会强制拉回底部', async () => {
  const host = document.createElement('main');
  host.className = 'chat-scroll';
  document.body.append(host);
  let top = 900;
  Object.defineProperties(host, {
    scrollHeight: { get: () => 1500 },
    clientHeight: { get: () => 600 },
    scrollTop: {
      get: () => top,
      set: (v) => {
        top = v;
      },
      configurable: true,
    },
  });
  const w = mount(ChatMessageList, {
    attachTo: host,
    props: {
      messages: [{ id: 'a', role: 'assistant', text: 'a' }],
      traces: [],
      revision: 0,
      status: 'requesting_model',
    },
  });
  top = 100;
  host.dispatchEvent(new Event('scroll'));
  await w.setProps({ revision: 1, messages: [{ id: 'a', role: 'assistant', text: 'new text' }] });
  expect(top).toBe(100);
  top = 900;
  host.dispatchEvent(new Event('scroll'));
  await w.setProps({ revision: 2 });
  await flushPromises();
  expect(top).toBe(1500);
  w.unmount();
  host.remove();
});
