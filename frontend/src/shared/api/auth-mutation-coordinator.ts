let mutationTail: Promise<void> = Promise.resolve()

/**
 * Browser authentication Cookies are mutated by response arrival order. Keep
 * every Cookie-setting/clearing request on one invocation-ordered lane so a
 * stale response can never land after a newer login or logout.
 */
export function serializeAuthCookieMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(mutation, mutation)
  mutationTail = result.then(() => undefined, () => undefined)
  return result
}
