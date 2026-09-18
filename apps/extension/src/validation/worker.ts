import { checkSchema, validate } from '../../../../packages/schema-validation';
self.onmessage = ({ data }) => {
  try {
    self.postMessage(
      data.mode === 'schema' ? checkSchema(data.schema) : validate(data.schema, data.value),
    );
  } catch {
    self.postMessage({ ok: false, code: 'SCHEMA_UNSUPPORTED', errors: ['Schema 校验异常'] });
  }
};
