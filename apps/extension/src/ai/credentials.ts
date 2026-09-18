import type { ModelProfile } from '../../../../packages/protocol/chat';
export function endpoint(base: string) {
  const u = new URL(base.trim());
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !(
      u.protocol === 'https:' ||
      (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))
    )
  )
    throw Error('API 地址须为 HTTPS 或本机 HTTP，不能包含认证、查询或片段');
  u.pathname = u.pathname.replace(/\/+$/, '');
  if (/\/chat\/completions(?:\/|$)/.test(u.pathname))
    throw Error('请填写 Base URL，不要包含 /chat/completions');
  return u.href.replace(/\/$/, '') + '/chat/completions';
}
export async function profiles(): Promise<ModelProfile[]> {
  return ((await chrome.storage.local.get('modelProfiles')).modelProfiles ?? []) as ModelProfile[];
}
export async function getKey(p: ModelProfile): Promise<string> {
  return ((await chrome.storage[p.keyStorage].get('credential:' + p.credentialId))[
    'credential:' + p.credentialId
  ] ?? '') as string;
}
export async function saveProfile(p: ModelProfile, key: string) {
  endpoint(p.baseUrl);
  const all = await profiles(),
    old = all.find((x) => x.id === p.id);
  if (old && old.baseUrl !== p.baseUrl && !key) throw Error('更换 API 地址后请重新输入凭证');
  const value = key || (old ? await getKey(old) : '');
  if (!value) throw Error('请填写 API Key');
  const next = {
    ...(JSON.parse(JSON.stringify(p)) as ModelProfile),
    version: (old?.version ?? 0) + 1,
    credentialId: crypto.randomUUID(),
  };
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage[next.keyStorage].set({ ['credential:' + next.credentialId]: value });
  try {
    await chrome.storage.local.set({
      modelProfiles: [...all.filter((x) => x.id !== next.id), next],
    });
  } catch (e) {
    await chrome.storage[next.keyStorage].remove('credential:' + next.credentialId);
    throw e;
  }
  if (old && !all.some((x) => x.id !== old.id && x.credentialId === old.credentialId))
    await chrome.storage[old.keyStorage].remove('credential:' + old.credentialId);
  return next;
}
export async function deleteProfile(id: string) {
  const all = await profiles(),
    old = all.find((p) => p.id === id),
    next = all.filter((p) => p.id !== id);
  await chrome.storage.local.set({ modelProfiles: next });
  if (old && !next.some((p) => p.credentialId === old.credentialId))
    await chrome.storage[old.keyStorage].remove('credential:' + old.credentialId);
}
export async function clearKeys() {
  for (const area of ['session', 'local'] as const) {
    const all = await chrome.storage[area].get(null);
    await chrome.storage[area].remove(Object.keys(all).filter((k) => k.startsWith('credential:')));
  }
}
export async function authorizeEndpoint(base: string) {
  const origin = new URL(endpoint(base)).origin + '/*';
  if (!(await chrome.permissions.request({ origins: [origin] })))
    throw Error('未授予模型 API 站点权限');
}
