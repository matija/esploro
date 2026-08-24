import { fuzzyScore } from "./fuzzy";

// fuzzyScore is a three-way ranking, not a boolean: 2 beats 1 beats 0, and
// callers sort on it. The tests pin each tier and the boundaries between them.
describe("fuzzyScore", () => {
  it("treats an empty query as a substring match so unfiltered lists rank flat", () => {
    expect(fuzzyScore("public.users", "")).toBe(2);
    expect(fuzzyScore("", "")).toBe(2);
  });

  it("scores substrings above scattered matches", () => {
    expect(fuzzyScore("public.users", "users")).toBe(2);
    expect(fuzzyScore("public.users", "pu")).toBe(2);
    expect(fuzzyScore("public.users", "c.u")).toBe(2);
  });

  it("scores a full string match as a substring match", () => {
    expect(fuzzyScore("users", "users")).toBe(2);
  });

  it("is case-insensitive in both directions", () => {
    expect(fuzzyScore("Public.Users", "users")).toBe(2);
    expect(fuzzyScore("public.users", "USERS")).toBe(2);
    expect(fuzzyScore("PUBLIC.USERS", "pbu")).toBe(1);
  });

  it("scores characters appearing in order but apart as a fuzzy match", () => {
    expect(fuzzyScore("public.users", "pus")).toBe(1);
    expect(fuzzyScore("order_items", "oi")).toBe(1);
  });

  it("rejects characters that appear only out of order", () => {
    expect(fuzzyScore("public.users", "sp")).toBe(0);
    expect(fuzzyScore("abc", "cba")).toBe(0);
  });

  it("rejects a query with a character the string lacks", () => {
    expect(fuzzyScore("public.users", "puz")).toBe(0);
    expect(fuzzyScore("", "a")).toBe(0);
  });

  it("requires each query character to consume a distinct position", () => {
    // "ab" has only one "a", so a second "a" has nothing left to match.
    expect(fuzzyScore("ab", "aa")).toBe(0);
    expect(fuzzyScore("aab", "aa")).toBe(2);
    expect(fuzzyScore("a_a_b", "aab")).toBe(1);
  });

  it("rejects a query longer than the string", () => {
    expect(fuzzyScore("ab", "abc")).toBe(0);
  });

  it("matches punctuation and whitespace literally", () => {
    expect(fuzzyScore("public.users", ".")).toBe(2);
    expect(fuzzyScore("my table", " ")).toBe(2);
    expect(fuzzyScore("mytable", " ")).toBe(0);
  });
});
