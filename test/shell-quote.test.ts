import { describe, expect, it } from "vitest";
import { quoteShell } from "../src/shell-quote.js";

const QUOTE_CASES = [
  { name: "wraps a plain string in single quotes", input: "plain", expected: "'plain'" },
  {
    name: "keeps a string without special characters intact inside quotes",
    input: "ses_abc-123_DEF.4",
    expected: "'ses_abc-123_DEF.4'",
  },
  { name: "escapes single quotes inside the value", input: "it's", expected: "'it'\\''s'" },
  { name: "quotes spaces safely", input: "two words", expected: "'two words'" },
  {
    name: "quotes semicolons so they cannot start a new command",
    input: "a; rm -rf /",
    expected: "'a; rm -rf /'",
  },
  {
    name: "quotes backticks so they cannot start command substitution",
    input: "a`id`b",
    expected: "'a`id`b'",
  },
  {
    name: "quotes dollar signs so they cannot start variable expansion",
    input: "$HOME",
    expected: "'$HOME'",
  },
  { name: "quotes double quotes safely", input: 'say "hi"', expected: "'say \"hi\"'" },
  { name: "quotes backslashes literally", input: "a\\b", expected: "'a\\b'" },
] as const;

describe("quoteShell", () => {
  it.each(QUOTE_CASES)("$name", ({ input, expected }) => {
    expect(quoteShell(input)).toBe(expected);
  });

  it("quotes a malicious session id without enabling injection", () => {
    const command = `opencode attach 'http://localhost' --session ${quoteShell(
      "x'; touch /tmp/pwned; echo '",
    )}`;
    expect(command).toBe(
      "opencode attach 'http://localhost' --session 'x'\\''; touch /tmp/pwned; echo '\\'''",
    );
  });
});
