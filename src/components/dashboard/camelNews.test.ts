import { describe, expect, it } from "vitest";
import { clauseAbout, namesCamel } from "./camelNews";

describe("camel news", () => {
  it("finds a name joined to «و» and keeps whole words", () => {
    expect(namesCamel("مزون تعبانة، ووضحة ما تاكل زين", "وضحة")).toBe(true);
    expect(namesCamel("جا كريم اليوم", "ريم")).toBe(false);
    expect(namesCamel("Haya walks stiffly", "Haya")).toBe(true);
  });

  it("returns only the part about the camel", () => {
    expect(clauseAbout("كلهم بخير، ووضحة رجعت تاكل شوي", "وضحة")).toBe("وضحة رجعت تاكل شوي");
    expect(clauseAbout("كلهم بخير بس الجازي ما شفتها العصر", "الجازي")).toBe("الجازي ما شفتها العصر");
    expect(clauseAbout("18 شفتهم، صيتة وطرفة ما شفتهم اليوم", "طرفة")).toBe("صيتة وطرفة ما شفتهم اليوم");
    expect(clauseAbout("كلهم بخير، وجرح مزون طاب", "مزون")).toBe("جرح مزون طاب");
    expect(clauseAbout("وضحة رجعت تاكل", "وضحة")).toBe("وضحة رجعت تاكل");
    expect(clauseAbout("كلهم بخير", "مزون")).toBeNull();
  });
});
