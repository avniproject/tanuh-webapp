// At most `limit` tasks run at once, across every caller; the rest wait their turn, in order. The list's patient reads
// share one (tanuh-webapp#4 review): the pending tab used to read every pending patient at once, one burst of a
// request per patient.
export function createLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return <T>(task: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            active--;
            waiting.shift()?.();
          });
      };
      if (active < limit) run();
      else waiting.push(run);
    });
}
