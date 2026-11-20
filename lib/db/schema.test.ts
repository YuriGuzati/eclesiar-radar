import { describe, expect, it } from "vitest";
import { SCHEMA, schemaStatements } from "./schema";

describe("schemaStatements", () => {
  it("splits the schema into one statement per table", () => {
    const stmts = schemaStatements();
    const tables = SCHEMA.match(/^create table/gim) ?? [];
    expect(stmts).toHaveLength(tables.length);
    expect(stmts.every((s) => !s.endsWith(";"))).toBe(true);
  });

  it("keeps leading comments with their statement and drops comment-only chunks", () => {
    expect(schemaStatements("-- note\ncreate table a (x int);\n-- trailing comment\n")).toEqual(["-- note\ncreate table a (x int)"]);
  });

  it("uses only SQLite syntax (no Postgres types or casts)", () => {
    expect(SCHEMA).not.toMatch(/timestamptz|jsonb|double precision|serial|::/i);
  });
});
