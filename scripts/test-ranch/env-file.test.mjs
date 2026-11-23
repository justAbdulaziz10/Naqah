// Tests dotenv parsing used by the local proxy and tick commands.
import { describe, expect, it } from "vitest";
import { parseEnvFile } from "./env-file.mjs";

describe("operator env file parser", () => {
  it("reads exported and quoted values, strips comments, and never expands shell references", () => {
    expect(parseEnvFile(`\n# comment\nexport PREVIEW_ORIGIN='https://preview.example.test'\nCRON_SECRET="one\\ntwo" # local note\nDOLLAR=$HOME\n`)).toEqual({
      PREVIEW_ORIGIN: "https://preview.example.test", CRON_SECRET: "one\ntwo", DOLLAR: "$HOME",
    });
  });

  it("rejects malformed lines rather than silently changing an operator file", () => {
    expect(() => parseEnvFile("not a variable")).toThrow("Invalid env file");
    expect(() => parseEnvFile("KEY=\"unterminated")).toThrow("Invalid env file");
  });
});
