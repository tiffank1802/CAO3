/** Générateur d'identifiants stables côté client (jamais recyclés). */
let counter = 0;

export function newId(prefix: string): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${counter.toString(36)}${rand}`;
}

export function resetIdCounterForTests(value = 0): void {
  counter = value;
}
