// Splits that are open on screen but still being created on the server. Loading or
// saving one waits for its creation first, so the app never has to.

const creating = new Map<string, Promise<unknown>>();

export function trackCreate(id: string, request: Promise<unknown>) {
  const done = request.finally(() => creating.delete(id));
  creating.set(id, done);
  return done;
}

/** Resolves once the split exists; rejects if creating it failed */
export const whenCreated = async (id: string) => {
  await creating.get(id);
};
