import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTitle, cleanBranch } from "./sessionTitle.js";

test("cleanTitle: keeps a clean title, stripping quotes/punctuation", () => {
  assert.equal(cleanTitle('"Add retry to webhook handler."'), "Add retry to webhook handler");
  assert.equal(cleanTitle("Fix mobile Safari login button"), "Fix mobile Safari login button");
  assert.equal(cleanTitle("Title: Refactor request handler"), "Refactor request handler");
  assert.equal(cleanTitle("- Add dark mode toggle"), "Add dark mode toggle");
});

test("cleanTitle: takes the first non-empty line", () => {
  assert.equal(cleanTitle("\n\nAdd caching layer\nsome explanation"), "Add caching layer");
});

test("cleanTitle: rejects refusals / meta commentary", () => {
  assert.equal(cleanTitle("I don't have access to the filesystem or code-reading tools"), null);
  assert.equal(cleanTitle("Sure, here is a title: Fix the bug"), null);
  assert.equal(cleanTitle("As an AI, I cannot do that"), null);
});

test("cleanTitle: rejects full sentences (too many words)", () => {
  assert.equal(cleanTitle("This change updates the parser and the lexer and also the tokenizer module"), null);
});

test("cleanTitle: caps overly long titles with an ellipsis", () => {
  // ≤10 words but >60 chars, so the length cap (not the sentence filter) applies.
  const long = "Refactor authentication middleware and session-management subsystem entirely";
  const out = cleanTitle(long)!;
  assert.ok(out.length <= 60, `capped to <= 60 chars (got ${out.length})`);
  assert.ok(out.endsWith("…"), "ends with ellipsis when truncated");
});

test("cleanTitle: empty/whitespace returns null", () => {
  assert.equal(cleanTitle("   \n  "), null);
});

test("cleanBranch: produces a kebab-case slug from a phrase", () => {
  assert.equal(cleanBranch("Fix mobile Safari login"), "fix-mobile-safari-login");
  assert.equal(cleanBranch("  Add retry to webhook handler  "), "add-retry-to-webhook-handler");
  assert.equal(cleanBranch("add_retry/webhook handler!"), "add-retry-webhook-handler");
});

test("cleanBranch: takes the first non-empty line and caps at 5 words", () => {
  assert.equal(cleanBranch("\n\none two three four five six\nextra"), "one-two-three-four-five");
});

test("cleanBranch: rejects refusals and full sentences", () => {
  assert.equal(cleanBranch("I don't have access to the repository"), null);
  assert.equal(cleanBranch("refactor the auth and authz and session and token and config modules"), null);
});

test("cleanBranch: empty / non-alphanumeric returns null", () => {
  assert.equal(cleanBranch("   "), null);
  assert.equal(cleanBranch("***"), null);
});
