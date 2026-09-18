<script setup lang="ts">
import { t, message } from '../../i18n';
import { reactive, shallowRef } from 'vue';
import type { ModelProfile } from '../../../../../../packages/protocol/chat';
import {
  authorizeEndpoint,
  saveProfile,
  deleteProfile,
  getKey,
  clearKeys,
} from '../../../ai/credentials';
import { complete } from '../../../ai/providers/openai';
const props = defineProps<{ profiles: ModelProfile[] }>();
const emit = defineEmits<{ changed: [] }>();
const blank = (): ModelProfile => ({
  id: crypto.randomUUID(),
  version: 0,
  name: '',
  protocol: 'openai-chat-completions',
  baseUrl: '',
  model: '',
  credentialId: '',
  keyStorage: 'session',
  redactFields: ['password', 'token', 'apiKey', 'authorization', 'cookie'],
});
const form = reactive(blank()),
  key = shallowRef(''),
  show = shallowRef(false),
  busy = shallowRef(false),
  notice = shallowRef('');
function edit(p?: ModelProfile) {
  Object.assign(form, p ?? blank());
  key.value = '';
  notice.value = '';
}
async function action(kind: 'save' | 'test' | 'delete' | 'clear') {
  busy.value = true;
  notice.value = '';
  try {
    if (kind === 'clear') {
      await clearKeys();
      notice.value = '已清除全部模型密钥';
    } else if (kind === 'delete') {
      await deleteProfile(form.id);
      edit();
    } else {
      if (!form.name.trim() || !form.model.trim()) throw Error('请填写配置名称和模型 ID');
      // Request permission directly from the click gesture, before storage/network awaits.
      await authorizeEndpoint(form.baseUrl);
      if (kind === 'save') {
        const p = await saveProfile({ ...form }, key.value);
        edit(p);
        notice.value = '模型配置已保存';
      } else {
        const existing = props.profiles.find((p) => p.id === form.id && p.baseUrl === form.baseUrl);
        const secret = key.value || (existing ? await getKey(existing) : '');
        await complete(
          form,
          secret,
          [{ role: 'user', content: 'Reply OK.' }],
          [],
          new AbortController().signal,
          () => {},
        );
        notice.value = '文本流连接成功；工具能力需通过页面工具调用验证';
      }
    }
    emit('changed');
  } catch (e) {
    notice.value = e instanceof Error ? e.message : '操作失败';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="profile-list">
    <button
      v-for="p in profiles"
      :key="p.id"
      class="profile-chip"
      :aria-pressed="form.id === p.id"
      :disabled="busy"
      @click="edit(p)"
    >
      {{ p.name }}</button
    ><button class="profile-chip" :disabled="busy" @click="edit()">{{ t('＋ 新增模型') }}</button>
  </div>
  <form @submit.prevent="action('save')">
    <label for="profile-name">{{ t('配置名称') }}</label
    ><input
      id="profile-name"
      v-model="form.name"
      required
      :disabled="busy"
      :placeholder="t('我的模型服务')"
    />
    <label for="protocol">{{ t('接口协议') }}</label
    ><select id="protocol" class="input" disabled>
      <option>{{ t('OpenAI Chat Completions 兼容') }}</option>
    </select>
    <label for="base-url">{{ t('API 地址') }}</label
    ><input
      id="base-url"
      v-model="form.baseUrl"
      required
      :disabled="busy"
      placeholder="https://api.example.com/v1"
    />
    <label for="model-id">{{ t('模型 ID') }}</label
    ><input
      id="model-id"
      v-model="form.model"
      required
      :disabled="busy"
      :placeholder="t('服务商提供的模型 ID')"
    />
    <label for="api-key">API Key</label>
    <div class="key-input">
      <input
        id="api-key"
        v-model="key"
        :type="show ? 'text' : 'password'"
        :disabled="busy"
        autocomplete="off"
        :placeholder="form.version ? t('留空保留已保存凭证') : t('填写你的 API Key')"
      /><button type="button" class="link" @click="show = !show">
        {{ show ? t('隐藏') : t('显示') }}
      </button>
    </div>
    <label class="check-row"
      ><input
        type="checkbox"
        :checked="form.keyStorage === 'local'"
        :disabled="busy"
        @change="
          form.keyStorage = ($event.target as HTMLInputElement).checked ? 'local' : 'session'
        "
      />{{ t('记住 API Key（本机保存，非系统密钥保险箱）') }}</label
    >
    <label for="redact-fields">{{ t('工具结果脱敏字段（逗号分隔）') }}</label
    ><input
      id="redact-fields"
      :value="form.redactFields.join(', ')"
      :disabled="busy"
      @input="
        form.redactFields = ($event.target as HTMLInputElement).value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      "
    />
    <p class="hint">
      {{
        t(
          '测试会向所选服务发送最小文本请求，可能产生少量费用。聊天和授权工具数据将发送至该模型服务。',
        )
      }}
    </p>
    <div class="actions">
      <button type="button" class="btn" :disabled="busy" @click="action('test')">
        {{ t('测试连接') }}</button
      ><button class="btn primary" :disabled="busy">{{ t('保存配置') }}</button>
    </div>
    <div class="actions">
      <button
        v-if="form.version"
        type="button"
        class="link error"
        :disabled="busy"
        @click="action('delete')"
      >
        {{ t('删除配置') }}</button
      ><button type="button" class="link" :disabled="busy" @click="action('clear')">
        {{ t('清除全部模型密钥') }}
      </button>
    </div>
  </form>
  <p v-if="notice" class="notice" role="status">{{ message(notice) }}</p>
</template>
