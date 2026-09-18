import type { Snapshot, CallRecord } from '../../../../packages/protocol';
import { bytes } from '../../../../packages/protocol';
export function expire(state: Snapshot, now = Date.now()) {
  for (const call of state.calls)
    if (call.execution === 'running' && call.deadline <= now) {
      call.execution = 'unknown';
      call.errorCode = 'EXECUTION_UNKNOWN';
      call.durationMs = now - Date.parse(call.startedAt);
    }
}
export function settle(
  state: Snapshot,
  call: CallRecord,
  outcome: { result?: unknown; errorCode?: string; business?: 'error' | 'unclassified' },
  now = Date.now(),
) {
  const late = call.execution === 'unknown';
  call.execution = outcome.errorCode ? 'unknown' : 'returned';
  call.business = outcome.business || 'unclassified';
  call.rawResult = outcome.result;
  call.errorCode = outcome.errorCode;
  call.late = late;
  call.durationMs = now - Date.parse(call.startedAt);
  if (state.locks[call.pageId] === call.callId) delete state.locks[call.pageId];
}
export function trim(state: Snapshot) {
  if (state.calls.length > 100) {
    const keep = new Set(Object.values(state.locks));
    let remaining = 100 - keep.size;
    state.calls = state.calls.filter((c) => keep.has(c.callId) || remaining-- > 0);
  }
  for (const call of [...state.calls].reverse()) {
    if (bytes(state.calls) <= 6 * 1024 * 1024) break;
    if (call.execution !== 'running') {
      delete call.arguments;
      delete call.rawResult;
      call.released = true;
    }
  }
}
