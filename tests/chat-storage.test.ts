import { it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { saveProfile, profiles, getKey, deleteProfile } from '../apps/extension/src/ai/credentials';
import { saveSession, loadSession } from '../apps/extension/src/ai/chat-storage';
import type { ModelProfile, ChatSession } from '../packages/protocol/chat';
let local: Record<string, any>, session: Record<string, any>;
function area(data: Record<string, any>) {
  return {
    get: vi.fn(async (key: string | null) => (key ? { [key]: data[key] } : { ...data })),
    set: vi.fn(async (value: object) => Object.assign(data, JSON.parse(JSON.stringify(value)))),
    remove: vi.fn(async (key: string | string[]) => {
      for (const k of [key].flat()) delete data[k];
    }),
    setAccessLevel: vi.fn(async () => {}),
    getBytesInUse: vi.fn(async () => 0),
  };
}
beforeEach(() => {
  local = {};
  session = {};
  vi.stubGlobal('chrome', { storage: { local: area(local), session: area(session) } });
});
const profile = (): ModelProfile => ({
  id: crypto.randomUUID(),
  version: 0,
  name: 'test',
  protocol: 'openai-chat-completions',
  baseUrl: 'https://example.com/v1',
  model: 'test',
  credentialId: '',
  keyStorage: 'session',
  redactFields: ['token'],
});
it('响应式配置转为普通数组，默认凭证只在 session，删除后清理', async () => {
  const p = await saveProfile(reactive(profile()), 'secret');
  expect(Array.isArray((await profiles())[0].redactFields)).toBe(true);
  expect(await getKey(p)).toBe('secret');
  expect(JSON.stringify(local)).not.toContain('secret');
  await deleteProfile(p.id);
  expect(await getKey(p)).toBe('');
});
it('记住凭证与换域名重新输入', async () => {
  const p = await saveProfile({ ...profile(), keyStorage: 'local' }, 'secret');
  expect(session).toEqual({});
  await expect(saveProfile({ ...p, baseUrl: 'https://other.example' }, '')).rejects.toThrow(
    '重新输入',
  );
});
it('配置写入失败清理新凭证', async () => {
  vi.mocked(chrome.storage.local.set).mockRejectedValue(Error('quota'));
  await expect(saveProfile(profile(), 'secret')).rejects.toThrow('quota');
  expect(Object.keys(session)).toHaveLength(0);
});
it('会话 schema 迁移边界与配额拒绝', async () => {
  session.chatSession = { schemaVersion: 99 };
  expect(await loadSession()).toBeUndefined();
  const s: ChatSession = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    profileId: 'test',
    profileVersion: 1,
    messages: [],
    turns: [],
    traces: [],
    status: 'idle',
  };
  await saveSession(s);
  expect((await loadSession())?.id).toBe(s.id);
  vi.mocked(chrome.storage.session.getBytesInUse).mockImplementation(async (key) =>
    key === null ? 9 * 1024 * 1024 : 0,
  );
  await expect(saveSession(s)).rejects.toThrow('存储空间不足');
});
