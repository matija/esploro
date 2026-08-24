import { cn, truncateSmart } from "./utils";

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("drops falsy values so conditional classes can be inlined", () => {
    expect(cn("px-2", false, null, undefined, "", "py-1")).toBe("px-2 py-1");
  });

  it("accepts arrays and conditional objects", () => {
    expect(cn(["px-2", "py-1"], { "bg-red": true, "bg-blue": false })).toBe(
      "px-2 py-1 bg-red",
    );
  });

  it("lets a later Tailwind class win over an earlier conflicting one", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm text-red-500", "text-lg")).toBe("text-red-500 text-lg");
  });

  it("keeps non-conflicting Tailwind classes side by side", () => {
    expect(cn("px-2", "py-4")).toBe("px-2 py-4");
  });

  it("returns an empty string when given nothing", () => {
    expect(cn()).toBe("");
    expect(cn(false, undefined)).toBe("");
  });
});

// truncateSmart shortens tab titles. For "schema.table" titles the table name
// is the important half, so the schema is sacrificed first.
describe("truncateSmart", () => {
  it("returns short titles untouched", () => {
    expect(truncateSmart("users", 10)).toBe("users");
  });

  it("returns a title of exactly maxLen untouched", () => {
    expect(truncateSmart("0123456789", 10)).toBe("0123456789");
  });

  it("ellipsizes a dotless title to maxLen characters", () => {
    const result = truncateSmart("averylongtablename", 10);
    expect(result).toBe("averylong…");
    expect(result).toHaveLength(10);
  });

  it("truncates the schema and keeps the table name whole", () => {
    const result = truncateSmart("very_long_schema.users", 12);
    expect(result).toBe("very_….users");
    expect(result.endsWith(".users")).toBe(true);
  });

  it("truncates the table name itself when it alone exceeds the budget", () => {
    const result = truncateSmart("public.a_very_long_table_name", 10);
    expect(result).toBe("a_very_lo…");
    expect(result).toHaveLength(10);
  });

  it("abbreviates the schema to a single character when the budget is tight", () => {
    // Table is 7 chars with maxLen 10, leaving a schema budget of 2.
    expect(truncateSmart("public.usertbl", 10)).toBe("p….usertbl");
  });

  it("drops the schema entirely when there is no room to abbreviate it", () => {
    // Table is 8 chars with maxLen 10: a schema budget of 1 leaves room for the
    // ellipsis alone, so the schema collapses to a bare marker.
    expect(truncateSmart("public.usertbls", 10)).toBe("….usertbls");
  });

  it("splits on the first dot so extra dots stay in the table part", () => {
    expect(truncateSmart("long_schema.some.table", 14)).toBe("lo….some.table");
  });

  it("handles a leading dot as an empty schema", () => {
    expect(truncateSmart(".averylongtable", 10)).toBe("averylong…");
  });
});
