const TTL = 90 * 60 * 1000; // 90 minutes

const store = new Map();
const inflight = new Map();

export function cached(key, fetcher) {
  const hit = store.get(key);
  if (hit && Date.now() < hit.expiresAt) return Promise.resolve(hit.data);

  if (inflight.has(key)) return inflight.get(key);

  const promise = fetcher()
    .then((data) => {
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
