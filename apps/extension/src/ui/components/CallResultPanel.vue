<script setup lang="ts">
import { t } from '../i18n';
import { label, type CallRecord } from '../../../../../packages/protocol';
defineProps<{ call?: CallRecord }>();
</script>
<template>
  <section v-if="call" class="result">
    <div class="section-head">
      <h3>{{ t('执行结果') }}</h3>
      <span
        class="badge"
        :class="{ danger: call.execution === 'unknown' || call.business === 'error' }"
        >{{ t(label(call)) }}</span
      >
    </div>
    <p class="hint">
      {{ call.source === 'aiChat' ? 'AIChat' : call.source === 'agent' ? 'Agent' : t('手动')
      }}{{ t('调用') }}
    </p>
    <p class="hint mono">
      {{ call.callId }} ·
      {{ call.durationMs === undefined ? t('等待返回') : `${call.durationMs} ms` }}
    </p>
    <p v-if="call.errorCode" class="error">{{ call.errorCode }}</p>
    <p v-if="call.execution === 'unknown'" class="notice">
      {{ t('业务可能已经执行。请核实页面状态，不要盲目重复操作。') }}
    </p>
    <p v-if="call.released" class="hint">{{ t('完整载荷已释放，仅保留调用元数据。') }}</p>
    <pre v-if="call.rawResult !== undefined">{{
      typeof call.rawResult === 'string' ? call.rawResult : JSON.stringify(call.rawResult, null, 2)
    }}</pre>
    <p v-if="call.execution === 'returned'" class="hint">
      {{ t('页面已返回。业务是否完成请以原始结果及实际页面为准。') }}
    </p>
  </section>
</template>
