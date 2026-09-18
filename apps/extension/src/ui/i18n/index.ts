import { readonly, shallowRef } from 'vue';
import { en } from './en';
export type Locale = 'zh-CN' | 'en';
export const localeStorageKey = 'webmcp.uiLocale';
const current = shallowRef<Locale>('zh-CN');
export const locale = readonly(current);
export function isLocale(value: unknown): value is Locale {
  return value === 'zh-CN' || value === 'en';
}
function applyLocale(value: Locale) {
  current.value = value;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = value;
    document.title = value === 'en' ? 'WebMCP Tools' : 'WebMCP 工具';
  }
}
export async function setLocale(value: Locale) {
  if (!isLocale(value)) return;
  await chrome.storage.local.set({ [localeStorageKey]: value });
  applyLocale(value);
}
export async function initializeLocale() {
  // Listen first so another sidebar's update is not missed during the initial read.
  let changed = false;
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !changes[localeStorageKey]) return;
    changed = true;
    const value = changes[localeStorageKey].newValue;
    applyLocale(isLocale(value) ? value : 'zh-CN');
  };
  chrome.storage.onChanged.addListener(listener);
  try {
    const stored = await chrome.storage.local.get(localeStorageKey);
    if (!changed)
      applyLocale(isLocale(stored[localeStorageKey]) ? stored[localeStorageKey] : 'zh-CN');
  } catch {
    if (!changed) applyLocale('zh-CN');
  }
  return () => chrome.storage.onChanged.removeListener(listener);
}
export function t(source: string, params: Record<string, string | number> = {}): string {
  const text = current.value === 'en' ? (en[source] ?? source) : source;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}
// Only apply to extension-owned status/error messages, never to page or model output.
export function message(source: string | undefined): string {
  if (!source || current.value !== 'en') return source ?? '';
  if (Object.hasOwn(en, source)) return en[source];
  for (const [pattern, replacement] of messagePatterns) {
    if (pattern.test(source)) return source.replace(pattern, replacement);
  }
  const parts = source.split(/([\n；])/);
  return parts.length > 1
    ? parts.map((part) => (part === '；' ? '; ' : part === '\n' ? part : message(part))).join('')
    : source;
}
const messagePatterns: [RegExp, string][] = [
  [/^(.+)：当前模型接口需要对象 Schema$/, '$1: this model API requires an object schema'],
  [/^(.+)：不支持外部 Schema 引用$/, '$1: external schema references are not supported'],
  [/^(.+) 的值无法映射，请继续使用 JSON 编辑$/, '$1 cannot be mapped; continue in the JSON editor'],
  [
    /^(.+) 类型无法映射，请继续使用 JSON 编辑$/,
    '$1 has an incompatible type; continue in the JSON editor',
  ],
  [/^模型服务请求失败（HTTP (\d+)）$/, 'Model request failed (HTTP $1)'],
  [/^不支持的 Schema 关键词：(.+)$/, 'Unsupported schema keyword: $1'],
  [/^引用不存在：(.+)$/, 'Reference not found: $1'],
  [/^(.+) 必须为对象$/, '$1 must be an object'],
  [/^(.+) 必须为非空数组$/, '$1 must be a nonempty array'],
];
