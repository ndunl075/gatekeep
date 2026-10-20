/** Counter backends must reject rather than hang: the engine turns a rejection into a degraded (no signal) check. */
export const COUNTER_TIMEOUT_MS = 800;

export function withTimeout<T>(p: PromiseLike<T>, ms = COUNTER_TIMEOUT_MS, what = "counter backend"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
