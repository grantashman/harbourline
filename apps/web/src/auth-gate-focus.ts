export function getFocusWrapTarget<T>(
  focusable: readonly T[],
  active: T | null,
  shiftKey: boolean
): T | null {
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (first === undefined || last === undefined) return null;
  if (shiftKey && active === first) return last;
  if (!shiftKey && active === last) return first;
  return null;
}
