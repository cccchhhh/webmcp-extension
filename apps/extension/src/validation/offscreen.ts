chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'validator') return;
  const worker = new Worker(chrome.runtime.getURL('validator.js'));
  let done = false;
  const finish = (result: unknown) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    worker.terminate();
    reply(result);
  };
  const timer = setTimeout(
    () => finish({ ok: false, code: 'SCHEMA_UNSUPPORTED', errors: ['校验超过 500ms，已终止'] }),
    500,
  );
  worker.onmessage = (e) => finish(e.data);
  worker.onerror = () =>
    finish({ ok: false, code: 'SCHEMA_UNSUPPORTED', errors: ['校验 Worker 异常'] });
  worker.postMessage(message.job);
  return true;
});
