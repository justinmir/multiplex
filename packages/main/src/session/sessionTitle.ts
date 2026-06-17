import os from "node:os";
import path from "node:path";
import { runOpencodePrompt } from "../intelligence/opencodeOneShot.js";

const OPENCODE_BIN = process.env.OPENCODE_BIN ?? path.join(os.homedir(), ".opencode", "bin", "opencode");

const MAX_TITLE = 60;

const TITLE_SYSTEM =
  "You are a labeler. You do NOT perform tasks — you only write a short title that " +
  "describes what a task is about. Output only the title text.";

// Framed as summarizing quoted text (not an instruction to act on), so even
// weaker models label rather than try to do the task.
function buildPrompt(task: string): string {
  return [
    "Write a short title summarizing the coding task quoted below.",
    "Rules: 5-8 words, at most 60 characters, imperative mood, no quotes, no trailing",
    "punctuation, no explanation. Output ONLY the title.",
    "",
    "Example task: \"the login button is broken on mobile safari, please fix it\"",
    "Example title: Fix broken login button on mobile Safari",
    "",
    "Task:",
    '"""',
    task,
    '"""',
  ].join("\n");
}

/** Refusal / meta-commentary openers that mean the model labeled poorly. */
const NON_TITLE = /^(i |i'm|i am|i don'?t|i can'?t|i cannot|sorry|unfortunately|as an|here'?s|here is|sure|okay|the task|this task|title:)/i;

/**
 * Generate a concise session title from the original prompt using opencode's
 * default agent (tool-less, transient server). Best-effort: returns null on any
 * failure/timeout/garbage so callers keep their truncated-prompt fallback.
 */
export async function generateSessionTitle(prompt: string, model?: string): Promise<string | null> {
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  try {
    const raw = await runOpencodePrompt({
      binPath: OPENCODE_BIN,
      model,
      system: TITLE_SYSTEM,
      prompt: buildPrompt(trimmed.slice(0, 2000)),
      timeoutMs: 30_000,
    });
    return cleanTitle(raw);
  } catch {
    return null;
  }
}

/** First non-empty line, stripped of quotes/markdown/punctuation, capped — or
 *  null if the model refused / returned a sentence rather than a title.
 *  Exported for tests. */
export function cleanTitle(raw: string): string | null {
  let t = raw.split("\n").map((s) => s.trim()).find(Boolean) ?? "";
  t = t
    .replace(/^[#>\-*\s]+/, "")        // leading markdown bullets/quotes
    .replace(/^(title|label)\s*[:\-]\s*/i, "") // "Title: ..."
    .replace(/^["'`]+|["'`]+$/g, "")    // wrapping quotes/backticks
    .replace(/[.!,;:]+$/g, "")          // trailing punctuation
    .trim();
  if (!t) return null;
  // Reject refusals / full sentences — the caller falls back to truncation.
  if (NON_TITLE.test(t)) return null;
  if (t.split(/\s+/).length > 10) return null;
  if (t.length > MAX_TITLE) t = `${t.slice(0, MAX_TITLE - 1).trimEnd()}…`;
  return t;
}

const BRANCH_SYSTEM =
  "You are a labeler. You do NOT perform tasks — you only write a short git " +
  "branch name describing what a task is about. Output only the branch name.";

function buildBranchPrompt(task: string): string {
  return [
    "Create a short git branch name summarizing the coding task quoted below.",
    "Rules: 3-5 words, lowercase, words joined by single hyphens (kebab-case),",
    "letters/digits/hyphens only, no slashes, no explanation. Output ONLY the name.",
    "",
    "Example task: \"the login button is broken on mobile safari, please fix it\"",
    "Example name: fix-mobile-safari-login",
    "",
    "Task:",
    '"""',
    task,
    '"""',
  ].join("\n");
}

/**
 * Generate a short, human-readable git branch slug (kebab-case, 3-5 words) from
 * the prompt via opencode's default agent. Best-effort: returns null on any
 * failure/timeout/garbage so callers can fall back to a deterministic name.
 */
export async function generateBranchName(prompt: string, model?: string): Promise<string | null> {
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  try {
    const raw = await runOpencodePrompt({
      binPath: OPENCODE_BIN,
      model,
      system: BRANCH_SYSTEM,
      prompt: buildBranchPrompt(trimmed.slice(0, 2000)),
      timeoutMs: 30_000,
    });
    return cleanBranch(raw);
  } catch {
    return null;
  }
}

/** Sanitize a model response into a valid, short kebab-case git branch slug, or
 *  null if it's a refusal / not a usable name. Exported for tests. */
export function cleanBranch(raw: string): string | null {
  const firstLine = raw.split("\n").map((s) => s.trim()).find(Boolean) ?? "";
  if (NON_TITLE.test(firstLine)) return null; // model refused / wrote prose
  const slug = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")  // everything non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, "");      // trim leading/trailing hyphens
  if (!slug) return null;
  const words = slug.split("-").filter(Boolean);
  if (words.length > 8) return null; // a sentence, not a name
  let out = words.slice(0, 5).join("-");
  if (out.length > 48) out = out.slice(0, 48).replace(/-[^-]*$/, "") || out.slice(0, 48);
  return out || null;
}
