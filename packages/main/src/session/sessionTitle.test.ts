import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTitle } from "./sessionTitle.js";

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
