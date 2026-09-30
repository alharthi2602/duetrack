// Local persistence and cloud refreshes share a snapshot. Serialize operations so
// an older refresh cannot overwrite a save that finishes while it is in flight.
export function accountOperations() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  };
}
