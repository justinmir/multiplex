import os from "node:os";
import path from "node:path";
import type { IntelligenceProvider, ProjectSummaryInput, ProjectSummaryResult } from "@app/core";
import { runOpencodePrompt } from "./opencodeOneShot.js";
import { buildSummaryPrompt } from "./assembleContext.js";

const OPENCODE_PATH = process.env.OPENCODE_BIN ?? path.join(os.homedir(), ".opencode", "bin", "opencode");

const SUMMARY_SYSTEM =
  "You are a sharp engineering lead writing a project status update. " +
  "Respond with ONLY a single JSON object, no prose, no code fences, of the exact shape: " +
  '{"summary": string, "nextSteps": string[]}. ' +
  "summary is 1-3 sentences capturing the current state and the critical path. " +
  "nextSteps is an ordered list of 2-5 concrete, specific actions. Do not invent facts not in the context.";

const REFERENCE_SYSTEM =
  "Summarize the given reference in ONE concise sentence (no more than 20 words). " +
  "Respond with only that sentence — no quotes, no preamble.";

/** Extract the first balanced JSON object from a model response. */
function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/** Intelligence via opencode (same backend as the agent harness). */
export class OpencodeIntelligence implements IntelligenceProvider {
  constructor(
    private readonly getModel: () => string | undefined,
    private readonly binPath: string = OPENCODE_PATH,
  ) {}

  async summarizeProject(input: ProjectSummaryInput): Promise<ProjectSummaryResult> {
    const raw = await runOpencodePrompt({
      binPath: this.binPath,
      model: this.getModel(),
      system: SUMMARY_SYSTEM,
      prompt: buildSummaryPrompt(input),
    });

    const parsed = extractJson(raw) as { summary?: unknown; nextSteps?: unknown } | null;
    if (parsed && typeof parsed.summary === "string") {
      const nextSteps = Array.isArray(parsed.nextSteps)
        ? parsed.nextSteps.filter((s): s is string => typeof s === "string")
        : [];
      return { summary: parsed.summary.trim(), nextSteps, synthesizedAtMs: Date.now() };
    }

    // Fallback: keep the narrative, derive no steps rather than fail outright.
    const cleaned = raw.replace(/```[a-z]*|```/g, "").trim();
    if (!cleaned) throw new Error("Intelligence returned an empty response");
    return { summary: cleaned.slice(0, 600), nextSteps: [], synthesizedAtMs: Date.now() };
  }

  async summarizeReference(input: { title: string; url?: string; body?: string }): Promise<string> {
    const prompt = [
      `Title: ${input.title}`,
      input.url ? `URL: ${input.url}` : "",
      input.body ? `Content: ${input.body.slice(0, 2000)}` : "",
    ].filter(Boolean).join("\n");
    const raw = await runOpencodePrompt({
      binPath: this.binPath,
      model: this.getModel(),
      system: REFERENCE_SYSTEM,
      prompt,
      timeoutMs: 45_000,
    });
    return raw.replace(/^["'\s]+|["'\s]+$/g, "").split("\n")[0].slice(0, 200);
  }
}
