import { execFile } from "node:child_process";

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Run a git command asynchronously in `cwd`. Never throws on a non-zero exit —
 * returns `{ ok: false, ... }` so callers can branch defensively (the repo may
 * have no commits, a detached HEAD, etc.).
 */
export function git(cwd: string, args: string[], timeoutMs = 15_000): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 1024 * 1024 * 16, encoding: "utf-8" },
      (err, stdout, stderr) => {
        const code = err && typeof (err as NodeJS.ErrnoException).code === "number"
          ? ((err as unknown as { code: number }).code)
          : err ? 1 : 0;
        resolve({
          ok: !err,
          stdout: stdout?.toString() ?? "",
          stderr: (stderr?.toString() ?? "").slice(0, 2000),
          code,
        });
      },
    );
  });
}

/** Run git and throw with stderr if it fails — for operations that must succeed. */
export async function gitOrThrow(cwd: string, args: string[], timeoutMs = 15_000): Promise<string> {
  const res = await git(cwd, args, timeoutMs);
  if (!res.ok) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr || `exit ${res.code}`}`);
  }
  return res.stdout;
}
