// 题目答案缓存：同一道题（尤其 OCS 超时后重试）直接秒回，不重复消耗 token。
// 只存内存，不做落盘：题目复用很少，没必要为它维护一份磁盘状态。
export function createAnswerCache({ ttlMs = 30 * 60 * 1000, maxEntries = 500, now = Date.now } = {}) {
  const store = new Map();

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (now() - entry.at > ttlMs) {
        store.delete(key);
        return null;
      }
      return entry.value;
    },
    set(key, value) {
      if (!store.has(key) && store.size >= maxEntries) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
      store.set(key, { value, at: now() });
    },
    get size() {
      return store.size;
    }
  };
}
