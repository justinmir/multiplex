import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { LocalGitService } from "./LocalGitService.js";

const svc = new LocalGitService();
let repo: string;

function g(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

before(() => {
  repo = mkdtempSync(join(tmpdir(), "mx-git-"));
  g(repo, "init", "-b", "main");
  g(repo, "config", "user.email", "t@t.dev");
  g(repo, "config", "user.name", "Test");
  writeFileSync(join(repo, "README.md"), "hello\n");
  g(repo, "add", "-A");
  g(repo, "commit", "-m", "init");
});

after(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
});

test("defaultBranch resolves to main", async () => {
  assert.equal(await svc.defaultBranch(repo), "main");
});

test("createWorktree → edit → diff → hasChanges", async () => {
  const wt = join(repo, ".mx-worktrees", "wt1");
  mkdirSync(join(repo, ".mx-worktrees"), { recursive: true });
  const { worktreePath } = await svc.createWorktree(repo, wt, "multiplex/test-branch");
  assert.equal(worktreePath, wt);
  assert.equal(await svc.currentBranch(wt), "multiplex/test-branch");

  // No changes yet.
  assert.equal(await svc.hasChanges(wt), false);

  // Modify a tracked file + add an untracked one.
  writeFileSync(join(wt, "README.md"), "hello\nworld\n");
  writeFileSync(join(wt, "new.txt"), "brand new\n");

  assert.equal(await svc.hasChanges(wt), true);

  const changes = await svc.diff(wt);
  const byPath = Object.fromEntries(changes.map((c) => [c.path, c]));
  assert.ok(byPath["README.md"], "README.md should appear in diff");
  assert.equal(byPath["README.md"].kind, "modified");
  assert.ok(byPath["README.md"].additions >= 1);
  assert.ok(byPath["new.txt"], "new.txt should appear in diff");
  assert.equal(byPath["new.txt"].kind, "added");
  assert.ok(byPath["new.txt"].hunk.includes("brand new"));

  await svc.removeWorktree(wt);
});

test("listBranches includes the worktree branch after creation", async () => {
  const wt = join(repo, ".mx-worktrees", "wt2");
  await svc.createWorktree(repo, wt, "multiplex/branch-2");
  const branches = await svc.listBranches(repo);
  assert.ok(branches.includes("multiplex/branch-2"));
  await svc.removeWorktree(wt);
});
