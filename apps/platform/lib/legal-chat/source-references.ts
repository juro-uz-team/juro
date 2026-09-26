/** Request-local transport names; canonical identities remain server-owned. */
export function compactSourceReferences(sourceIds: readonly string[]) {
  const occupied = new Set(sourceIds);
  const aliases = new Map<string, string>();
  let sequence = 0;
  for (const id of occupied) {
    if (id.length <= 32) continue;
    let alias: string;
    do { alias = `s${sequence++}`; } while (occupied.has(alias));
    aliases.set(id, alias);
  }
  const originals = new Map([...aliases].map(([id, alias]) => [alias, id]));
  return { aliases, originals,
    encode: (id: string) => aliases.get(id) ?? id,
    decode: (id: string) => originals.get(id) ?? id,
  };
}
