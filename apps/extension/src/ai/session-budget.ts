// Web Locks serialize quota checks across side panels and the service worker.
// Unit-test/non-browser hosts use the caller's existing promise queue.
export async function withSessionBudget<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks)
    return await navigator.locks.request('webmcp-session-storage', work);
  return work();
}
