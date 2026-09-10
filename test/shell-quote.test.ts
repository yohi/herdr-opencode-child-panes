import { describe, expect, it } from "vitest";
import { quoteShell } from "../src/shell-quote.js";

describe("quoteShell", () => {
  it("wraps a plain string in single quotes", () => {
    expect(quoteShell("plain")).toBe("'plain'");
  });

  it("keeps a string without special characters intact inside quotes", () => {
    expect(quoteShell("ses_abc-123_DEF.4")).toBe("'ses_abc-123_DEF.4'");
  });

  it("escapes single quotes inside the value", () => {
    expect(quoteShell("it's")).toBe("'it'\\''s'");
  });

  it("quotes spaces safely", () => {
    expect(quoteShell("two words")).toBe("'two words'");
  });

  it("quotes semicolons so they cannot start a new command", () => {
    expect(quoteShell("a; rm -rf /")).toBe("'a; rm -rf /'");
  });

  it("quotes backticks so they cannot start command substitution", () => {
    expect(quoteShell("a`id`b")).toBe("'a`id`b'");
  });

  it("quotes dollar signs so they cannot start variable expansion", () => {
    expect(quoteShell("$HOME")).toBe("'$HOME'");
  });

  it("quotes double quotes safely", () => {
    expect(quoteShell('say "hi"')).toBe("'say \"hi\"'");
  });

  it("quotes a malicious session id without enabling injection", () => {
    const command = `opencode attach 'http://localhost' --session ${quoteShell(
      "x'; touch /tmp/pwned; echo '",
    )}`;
    expect(command).toBe(
      "opencode attach 'http://localhost' --session 'x'\\''; touch /tmp/pwned; echo '\\'''",
    );
  });

  it("quotes backslashes literally", () => {
    expect(quoteShell("a\\b")).toBe("'a\\b'");
  });
});
