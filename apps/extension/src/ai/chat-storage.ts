import { withSessionBudget } from './session-budget';
import { bytes } from '../../../../packages/protocol';
import type { ChatSession } from '../../../../packages/protocol/chat';
let queue = Promise.resolve();
export async function loadSession(): Promise<ChatSession | undefined> {
  const chatSession = (await chrome.storage.session.get('chatSession')).chatSession as
    ChatSession | undefined;
  return chatSession?.schemaVersion === 1 ? chatSession : undefined;
}
export function saveSession(session: ChatSession) {
  const copy = JSON.parse(JSON.stringify(session)) as ChatSession;
  queue = queue
    .catch(() => {})
    .then(() =>
      withSessionBudget(async () => {
        while (bytes(copy) > 1024 * 1024 && copy.turns.length > 1) {
          copy.turns.shift();
          const next = copy.messages.findIndex((m, i) => i > 0 && m.role === 'user');
          if (next > 0) copy.messages.splice(0, next);
          const ids = new Set(copy.messages.map((m) => m.id));
          copy.traces = copy.traces.filter(
            (t) =>
              ids.has(t.afterMessageId ?? '') ||
              ['等待确认', '执行中', '结果未知'].includes(t.status),
          );
        }
        if (bytes(copy) > 1024 * 1024) throw Error('聊天记录已满，请新建会话');
        const total = await chrome.storage.session.getBytesInUse(null),
          old = await chrome.storage.session.getBytesInUse('chatSession');
        if (total - old + bytes(copy) > 8 * 1024 * 1024) throw Error('浏览器会话存储空间不足');
        await chrome.storage.session.set({ chatSession: copy });
      }),
    );
  return queue;
}
