<script setup lang="ts">
import { t, message } from '../i18n';
import { useId } from 'vue';
import type { Field, FieldDraft } from '../composables/argument-form';
defineProps<{
  fields: Field[];
  drafts: Record<string, FieldDraft>;
  errors: Record<string, string>;
  disabled: boolean;
}>();
const emit = defineEmits<{ update: [name: string, patch: Partial<FieldDraft>] }>();
const id = useId();
function input(name: string, event: Event) {
  const el = event.target as HTMLInputElement;
  emit('update', name, { text: el.value, touched: true, badInput: el.validity?.badInput });
}
</script>
<template>
  <div class="argument-fields">
    <p v-if="!fields.length" class="hint">{{ t('此工具没有已声明的参数，可直接执行。') }}</p>
    <div v-for="(field, index) in fields" :key="field.name" class="argument-field">
      <div class="field-heading">
        <input
          type="checkbox"
          :aria-label="t('传入 {name}', { name: field.name })"
          :checked="field.required || drafts[field.name]?.enabled"
          :disabled="disabled || field.required"
          @change="
            emit('update', field.name, { enabled: ($event.target as HTMLInputElement).checked })
          "
        />
        <label :for="`${id}-${index}`"
          ><code>{{ field.name }}</code></label
        >
        <span class="field-type"
          >{{ field.kind === 'json' ? 'JSON' : field.kind }} ·
          {{ field.required ? t('必填') : t('可选') }}</span
        >
      </div>
      <p v-if="field.description" :id="`${id}-${index}-description`" class="field-description">
        {{ field.description }}
      </p>
      <select
        v-if="field.kind === 'boolean' || field.kind === 'enum'"
        :id="`${id}-${index}`"
        :value="drafts[field.name]?.text"
        :disabled="disabled || !drafts[field.name]?.enabled"
        :aria-describedby="`${id}-${index}-description ${id}-${index}-error`"
        :aria-invalid="!!errors[field.name]"
        @change="input(field.name, $event)"
      >
        <option value="">{{ t('请选择') }}</option>
        <template v-if="field.kind === 'boolean'"
          ><option value="true">true</option>
          <option value="false">false</option></template
        >
        <template v-else
          ><option v-for="(choice, n) in field.choices" :key="n" :value="String(n)">
            {{ JSON.stringify(choice) }}
          </option></template
        >
      </select>
      <textarea
        v-else-if="field.kind === 'json'"
        :id="`${id}-${index}`"
        class="field-json"
        spellcheck="false"
        :placeholder="t('输入 JSON，例如 [] 或 {}')"
        :value="drafts[field.name]?.text"
        :disabled="disabled || !drafts[field.name]?.enabled"
        :aria-describedby="`${id}-${index}-description ${id}-${index}-error`"
        :aria-invalid="!!errors[field.name]"
        @input="input(field.name, $event)"
      />
      <input
        v-else
        :id="`${id}-${index}`"
        :type="field.kind === 'string' ? 'text' : 'number'"
        :step="field.kind === 'integer' ? 1 : 'any'"
        :value="drafts[field.name]?.text"
        :placeholder="field.required ? t('待填写') : t('输入参数值')"
        :disabled="disabled || !drafts[field.name]?.enabled"
        :aria-describedby="`${id}-${index}-description ${id}-${index}-error`"
        :aria-invalid="!!errors[field.name]"
        @input="input(field.name, $event)"
      />
      <button
        v-if="field.kind === 'string' && drafts[field.name]?.enabled"
        class="link"
        :disabled="disabled"
        @click="emit('update', field.name, { text: '', touched: true })"
      >
        {{ t('设为空字符串') }}
      </button>
      <p
        v-if="errors[field.name]"
        :id="`${id}-${index}-error`"
        class="error field-error"
        role="alert"
      >
        {{ message(errors[field.name]) }}
      </p>
    </div>
  </div>
</template>
