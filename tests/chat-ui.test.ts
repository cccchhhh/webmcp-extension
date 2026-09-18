// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ChatComposer from '../apps/extension/src/ui/components/chat/ChatComposer.vue';
import ChatToolCallCard from '../apps/extension/src/ui/components/chat/ChatToolCallCard.vue';
it('中文输入法不误发，Shift+Enter 换行，Enter 发送', async () => {
  const w = mount(ChatComposer, { props: { busy: false, disabled: false, modelName: 'test' } });
  await w.find('textarea').setValue('测试');
  await w.find('textarea').trigger('keydown', { key: 'Enter', isComposing: true });
  await w.find('textarea').trigger('keydown', { key: 'Enter', shiftKey: true });
  expect(w.emitted('send')).toBeUndefined();
  await w.find('textarea').trigger('keydown', { key: 'Enter' });
  expect(w.emitted('send')?.[0]).toEqual(['测试']);
});
it('运行期间按钮停止，卡片转义参数并发出确认事件', async () => {
  const composer = mount(ChatComposer, {
    props: { busy: true, disabled: false, modelName: 'test' },
  });
  await composer.get('button[aria-label="停止生成"]').trigger('click');
  expect(composer.emitted('stop')).toHaveLength(1);
  const w = mount(ChatToolCallCard, {
    props: {
      awaiting: true,
      trace: {
        invocationId: 'x',
        name: 'tool',
        arguments: { text: '<script>bad()</script>' },
        status: '等待确认',
      },
    },
  });
  expect(w.find('script').exists()).toBe(false);
  await w.get('.primary').trigger('click');
  expect(w.emitted('approve')?.[0]).toEqual([true]);
});
