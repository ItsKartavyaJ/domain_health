const TTL = 90 * 60 * 1000; // 90 minutes
const MAX_ENTRIES = 100;

const store = new Map();
const inflight = new Map();

function evictOldest() {
  const oldest = store.keys().next().value;
  if (oldest !== undefined) store.delete(oldest);
}

export function cached(key, fetcher) {
  const hit = store.get(key);
  if (hit && Date.now() < hit.expiresAt) return Promise.resolve(hit.data);

  if (inflight.has(key)) return inflight.get(key);

  const promise = fetcher()
    .then((data) => {
      if (store.size >= MAX_ENTRIES) evictOldest();
      store.set(key, { data, expiresAt: Date.now() + TTL });
      inflight.delete(key);
      return data;
    })
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return promise;
}

export function invalidate(prefix) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
