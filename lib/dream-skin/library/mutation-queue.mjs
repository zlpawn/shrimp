/**
 * Process-local mutation queue for serializing theme filesystem operations.
 */

export function createMutationQueue() {
  let tail = Promise.resolve();

  function run(operation) {
    const result = tail.then(operation, operation);
    tail = result.catch(() => {});
    return result;
  }

  function idle() {
    return tail.then(() => {});
  }

  return { run, idle };
}