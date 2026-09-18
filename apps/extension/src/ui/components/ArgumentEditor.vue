<script setup lang="ts">
import { t, message } from '../i18n';
import { computed, shallowRef, onUnmounted, watch } from 'vue';
import type { Schema } from '../../../../../packages/protocol';
import { example, type Validation } from '../../../../../packages/schema-validation';
import {
  fieldsFor,
  readForm,
  parseArguments,
  mapToForm,
  type ArgumentDraft,
  type FieldDraft,
} from '../composables/argument-form';
import JsonArgumentEditor from './JsonArgumentEditor.vue';
import SchemaArgumentForm from './SchemaArgumentForm.vue';
const props = defineProps<{
  draft: ArgumentDraft;
  schema: Schema;
  busy: boolean;
  executable: boolean;
}>();
const emit = defineEmits<{
  draft: [value: ArgumentDraft];
  execute: [value: Record<string, unknown>];
}>();
const fields = computed(() => fieldsFor(props.schema));
const feedback = shallowRef(''),
  valid = shallowRef(false),
  checking = shallowRef(false);
const errors = shallowRef<Record<string, string>>(Object.create(null));
let worker: Worker | undefined;
let timer: ReturnType<typeof setTimeout>;
let disposed = false;
watch(
  () => props.draft,
  () => {
    feedback.value = '';
    valid.value = false;
    errors.value = Object.create(null);
  },
);
function updateField(name: string, patch: Partial<FieldDraft>) {
  emit('draft', {
    ...props.draft,
    fields: { ...props.draft.fields, [name]: { ...props.draft.fields[name], ...patch } },
  });
}
function valueOfDraft() {
  if (props.draft.mode === 'json') return parseArguments(props.draft.json);
  const result = readForm(fields.value || [], props.draft.fields);
  errors.value = result.errors;
  if (Object.keys(result.errors).length) throw Error('请检查标记的参数');
  return parseArguments(JSON.stringify(result.value));
}
function switchMode(mode: 'form' | 'json') {
  if (mode === props.draft.mode || checking.value) return;
  try {
    const value = valueOfDraft();
    if (mode === 'form') {
      if (!fields.value) return;
      emit('draft', { ...props.draft, mode, fields: mapToForm(fields.value, value) });
    } else emit('draft', { ...props.draft, mode, json: JSON.stringify(value, null, 2) });
  } catch (e) {
    valid.value = false;
    feedback.value = (e as Error).message;
  }
}
function fill() {
  const value = example(props.schema) as Record<string, unknown>;
  const json = JSON.stringify(value, null, 2);
  if (props.draft.mode === 'form' && fields.value) {
    try {
      emit('draft', { ...props.draft, json, fields: mapToForm(fields.value, value) });
    } catch {
      emit('draft', { ...props.draft, mode: 'json', json });
    }
  } else emit('draft', { ...props.draft, json });
}
async function check(execute = false) {
  if (checking.value || (execute && (props.busy || !props.executable))) return;
  checking.value = true;
  feedback.value = '';
  valid.value = false;
  try {
    const draft = props.draft;
    const value = valueOfDraft();
    const result = await new Promise<Validation>((resolve) => {
      worker = new Worker(chrome.runtime.getURL('validator.js'));
      const finish = (r: Validation) => {
        clearTimeout(timer);
        worker?.terminate();
        worker = undefined;
        resolve(r);
      };
      timer = setTimeout(() => finish({ ok: false, errors: ['校验超时，已停止'] }), 500);
      worker.onmessage = (e) => finish(e.data);
      worker.onerror = () => finish({ ok: false, errors: ['校验器异常'] });
      worker.postMessage({ schema: props.schema, value });
    });
    if (disposed) return;
    if (draft !== props.draft) throw Error('参数已变化，请重新校验');
    valid.value = result.ok;
    feedback.value = result.ok ? '校验通过' : result.errors.join('\n');
    if (result.ok && execute) emit('execute', value);
  } catch (e) {
    feedback.value = (e as Error).message;
  } finally {
    checking.value = false;
  }
}
onUnmounted(() => {
  disposed = true;
  clearTimeout(timer);
  worker?.terminate();
});
</script>
<template>
  <div class="section-head">
    <span>{{ t('调用参数') }}</span
    ><button class="link" :disabled="checking" @click="fill">{{ t('填入默认示例') }}</button>
  </div>
  <div class="argument-modes" role="group" :aria-label="t('参数输入方式')">
    <button
      :aria-pressed="draft.mode === 'form'"
      :disabled="checking || !fields"
      @click="switchMode('form')"
    >
      {{ t('表单') }}
    </button>
    <button :aria-pressed="draft.mode === 'json'" :disabled="checking" @click="switchMode('json')">
      JSON
    </button>
  </div>
  <p v-if="!fields" class="hint">{{ t('此 Schema 无法自动生成字段表单，请使用 JSON 编辑。') }}</p>
  <SchemaArgumentForm
    v-if="draft.mode === 'form' && fields"
    :fields="fields"
    :drafts="draft.fields"
    :errors="errors"
    :disabled="checking"
    @update="updateField"
  />
  <JsonArgumentEditor
    v-else
    :model-value="draft.json"
    :disabled="checking"
    @update:model-value="emit('draft', { ...draft, json: $event })"
  />
  <p class="hint">
    {{
      t('仅提交勾选的参数 · 不自动填入默认值；需要额外属性时使用 JSON。示例值请按实际情况修改。')
    }}
  </p>
  <p v-if="feedback" role="status" class="validation" :class="valid ? 'success' : 'error'">
    {{ message(feedback) }}
  </p>
  <div class="actions">
    <button class="btn" :disabled="checking" @click="check()">{{ t('校验参数') }}</button
    ><button class="btn primary" :disabled="busy || checking || !executable" @click="check(true)">
      {{ busy ? t('页面忙碌 / 等待确认') : t('执行工具') }}
    </button>
  </div>
</template>
