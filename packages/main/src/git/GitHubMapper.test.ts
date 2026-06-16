import { test } from "node:test";
import assert from "node:assert/strict";
import { mapFile, mapReview, mapInlineComment, mapIssueComment } from "./GitHubMapper.js";

test("mapFile maps status to kind and carries the patch", () => {
  const f = mapFile({ filename: "src/a.ts", additions: 3, deletions: 1, status: "modified", patch: "@@ -1 +1 @@\n-old\n+new" });
  assert.equal(f.path, "src/a.ts");
  assert.equal(f.kind, "modified");
  assert.equal(f.additions, 3);
  assert.equal(f.deletions, 1);
  assert.ok(f.hunk.includes("+new"));

  assert.equal(mapFile({ filename: "x", status: "added" }).kind, "added");
  assert.equal(mapFile({ filename: "x", status: "removed" }).kind, "deleted");
  assert.equal(mapFile({ filename: "x", status: "renamed" }).kind, "renamed");
});

test("mapReview maps verdicts", () => {
  assert.equal(mapReview({ id: 1, user: { login: "a" }, state: "APPROVED", body: "" }).verdict, "approved");
  assert.equal(mapReview({ id: 2, user: { login: "a" }, state: "CHANGES_REQUESTED", body: "fix" }).verdict, "changes_requested");
  assert.equal(mapReview({ id: 3, user: { login: "a" }, state: "COMMENTED", body: "hm" }).verdict, "commented");
  assert.equal(mapReview({ id: 4, user: null, state: "APPROVED", body: "" }).author, "unknown");
});

test("mapInlineComment carries path/line; mapIssueComment is general", () => {
  const inline = mapInlineComment({ id: 9, user: { login: "k" }, body: "nit", path: "f.ts", line: 12, created_at: "2026-01-01T00:00:00Z" });
  assert.equal(inline.kind, "inline");
  assert.equal(inline.path, "f.ts");
  assert.equal(inline.line, 12);

  const general = mapIssueComment({ id: 10, user: { login: "k" }, body: "lgtm", created_at: "2026-01-01T00:00:00Z" });
  assert.equal(general.kind, "general");
  assert.equal(general.body, "lgtm");
});
