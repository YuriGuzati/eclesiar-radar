import { describe, expect, it } from "vitest";
import { SCHEMA, schemaStatements } from "./schema";

describe("schemaStatements", () => {
  it("splits the schema into one statement per DDL command", () => {
    const stmts = schemaStatements();
    const ddl = SCHEMA.match(/^(create table|create index|alter table)/gim) ?? [];
    expect(stmts).toHaveLength(ddl.length);
    expect(stmts.every((s) => !s.endsWith(";"))).toBe(true);
  });

  it("keeps leading comments with their statement and drops comment-only chunks", () => {
    expect(schemaStatements("-- note\ncreate table a (x int);\n-- trailing comment\n")).toEqual(["-- note\ncreate table a (x int)"]);
  });
});
