/** Remove only redundant citation suffixes, never infer support from prose. */
export function citationProseNormalizer(context: unknown, literal = new Set<string>()) {
  const inspect = (value: unknown): void => {
    if (typeof value === "string") {
      for (const token of value.matchAll(/\[s[1-9]\d*(?:,\s*s[1-9]\d*)*\]|【s[1-9]\d*(?:,\s*s[1-9]\d*)*】|\(s[1-9]\d*(?:,\s*s[1-9]\d*)*\)/g)) literal.add(token[0]);
    } else if (Array.isArray(value)) value.forEach(inspect);
    else if (value && typeof value === "object") Object.values(value).forEach(inspect);
  };
  inspect(context);
  return (text: string, sourceIds: readonly string[]): string => {
    // Formatting in code, links or Markdown/HTML blocks is deliberately untouched.
    if (/[`\\~<>\t]|\]\(|\]\[|^ {4}/m.test(text)) return text;
    const attached = new Set(sourceIds);
    let offset = 0;
    return text.split("\n").map(line => {
      const start = offset;
      offset += line.length + 1;
      const suffix = /(?<=[.!?…)])[ \t]*((?:(?:\[s[1-9]\d*(?:,\s*s[1-9]\d*)*\]|【s[1-9]\d*(?:,\s*s[1-9]\d*)*】|\(s[1-9]\d*(?:,\s*s[1-9]\d*)*\))[ \t]*)+)$/.exec(line);
      if (!suffix) return line;
      // Only a suffix outside balanced quotation spans is an annotation.
      const closing: string[] = [];
      const pairs: Record<string, string> = { '"': '"', "'": "'", "“": "”", "‘": "’", "«": "»" };
      const prefix = [...text.slice(0, start + suffix.index)];
      for (const [index, character] of prefix.entries()) {
        // Apostrophes within words (including Uzbek Latin letters) are not
        // quotation boundaries. Actual quoted/code/source literals stay intact.
        if (["'", "‘", "’"].includes(character) && /[\p{L}\p{N}]/u.test(prefix[index - 1] ?? "")
          && /[\p{L}\p{N}]/u.test(prefix[index + 1] ?? "")) continue;
        if (character === closing.at(-1)) closing.pop();
        else if (pairs[character]) closing.push(pairs[character]);
        else if (["”", "’", "»"].includes(character)) return line;
      }
      if (closing.length) return line;
      const tokens = [...suffix[1].matchAll(/\[[^\]]+\]|【[^】]+】|\([^)]+\)/g)];
      if (tokens.some(token => literal.has(token[0])
        || [...token[0].matchAll(/s[1-9]\d*/g)].some(source => !attached.has(source[0])))) return line;
      return line.slice(0, suffix.index);
    }).join("\n");
  };
}
