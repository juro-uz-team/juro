/** Normalize the application's parameterized SQL surface to PostgreSQL. Values remain bound. */
export function postgresSql(source: string): string {
  const literals: string[] = [];
  let sql = source.replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g, value => {
    literals.push(value); return `\u0001${literals.length - 1}\u0002`;
  });
  const ignoreConflict = /\bINSERT\s+OR\s+IGNORE\b/i.test(sql);
  sql = sql.replace(/\bINSERT\s+OR\s+IGNORE\b/gi, "INSERT");
  sql = sql.replace(/\bjson_object\s*\(/gi, "jsonb_build_object(");
  sql = sql.replace(/\b([A-Za-z_][\w.]*)\s+COLLATE\s+NOCASE\b/gi, "lower($1)");
  // SQLite folds ASCII only for LIKE; the C collation gives PostgreSQL the same boundary.
  sql = sql.replace(/\b(NOT\s+)?LIKE\b/gi, (_, not) => `COLLATE "C" ${not ?? ""}ILIKE`);
  sql = sql.replace(/\bifnull\s*\(/gi, "coalesce(");
  sql = sql.replace(/\bIS\s+(NOT\s+)?(?=(?:NEW|OLD)\.|`|"|\?)/gi,
    (_, not) => not ? "IS DISTINCT FROM " : "IS NOT DISTINCT FROM ");
  sql = sql.replace(/\?(?=\s+IS\s+(?:NOT\s+)?NULL\b)/gi, "?::text");
  sql = sql.replace(/\b(json_valid\([^()]*\))\s*(=|<>|!=)\s*([01])\b/gi,
    (_, expression, operator, value) => `${expression} ${operator} ${value === "1" ? "TRUE" : "FALSE"}`);
  if (ignoreConflict) {
    const returning = sql.search(/\bRETURNING\b/i);
    sql = returning < 0 ? sql.trim().replace(/;$/, "") + " ON CONFLICT DO NOTHING"
      : sql.slice(0, returning) + " ON CONFLICT DO NOTHING " + sql.slice(returning);
  }
  sql = sql.replace(/\u0001(\d+)\u0002/g, (_, index) => literals[Number(index)]);
  return sql;
}
