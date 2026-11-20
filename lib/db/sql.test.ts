import { describe, expect, it } from "vitest";
import { MAX_PARAMS, insertStatements, valuesList } from "./sql";

describe("insertStatements", () => {
  it("keeps every statement within D1's bound-parameter limit", () => {
    const rows = Array.from({ length: 37 }, (_, i) => [i, `n${i}`, i * 2, null, 1, 2, 3, "[]"]); // 8 columns
    const stmts = insertStatements("insert into t (a,b,c,d,e,f,g,h)", "on conflict do nothing", rows);
    expect(stmts.every((s) => (s.params?.length ?? 0) <= MAX_PARAMS)).toBe(true);
    expect(stmts.flatMap((s) => s.params)).toHaveLength(37 * 8);
    expect(stmts[0].sql).toMatch(/^insert into t \(a,b,c,d,e,f,g,h\) values \(\?,\?,\?,\?,\?,\?,\?,\?\),/);
    expect(stmts[0].sql.endsWith("on conflict do nothing")).toBe(true);
  });

  it("returns nothing for no rows", () => {
    expect(insertStatements("insert into t (a)", "", [])).toEqual([]);
  });
});

describe("valuesList", () => {
  it("builds row-value tuples", () => {
    expect(valuesList(2, 2)).toBe("(?,?),(?,?)");
  });
});
