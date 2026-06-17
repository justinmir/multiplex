import os from "node:os";
import path from "node:path";
import type { IntelligenceProvider, ProjectSummaryInput, ProjectSummaryResult, ReferenceIndexResult } from "@app/core";
import { runOpencodePrompt, INDEX_TOOLS } from "./opencodeOneShot.js";
import { buildSummaryPrompt } from "./assembleContext.js";

const OPENCODE_PATH = process.env.OPENCODE_BIN ?? path.join(os.homedir(), ".opencode", "bin", "opencode");

const SUMMARY_SYSTEM =
  "You are a sharp engineering lead writing a project status update. " +
  "Respond with ONLY a single JSON object, no prose, no code fences, of the exact shape: " +
  '{"summary": string, "nextSteps": string[], "nextStepPrompts": string[], "suggestedPrompts": string[]}. ' +
  "summary is 1-3 sentences capturing the current state and the critical path. " +
  "nextSteps is an ordered list of 2-5 concrete, specific actions. " +
  "nextStepPrompts has the SAME length as nextSteps: for each step, a ready-to-run prompt " +
  "(imperative, 1-2 sentences) a user could hand a coding agent to do exactly that step. " +
  "suggestedPrompts is EXACTLY 4 specific, actionable prompts (imperative, one sentence each) a " +
  "user could hand to a coding agent to push this project forward, grounded in the context. " +
  "Do not invent facts not in the context.";

const GLOBAL_PROMPTS_SYSTEM =
  "You suggest what a developer could work on next across all their projects. " +
  "Respond with ONLY a JSON object, no prose, no code fences, of the shape " +
  '{"prompts": string[]} where prompts is EXACTLY 4 short, specific, actionable session ' +
  "prompts (imperative, one sentence each) grounded in the overview. Do not invent facts.";

const REFERENCE_SYSTEM =
  "Summarize the given reference in ONE concise sentence (no more than 20 words). " +
  "Respond with only that sentence — no quotes, no preamble.";

const INDEX_SYSTEM =
  "You index a project reference for later reuse. Use your available tools — web " +
  "fetch/search and any configured MCP servers (wikis, docs, Google Docs, issue " +
  "trackers) — to RETRIEVE the actual content of the reference described below. " +
  "Respond with ONLY a single JSON object, no prose, no code fences. " +
  'On success: {"content": string, "summary": string} where content is the extracted ' +
  "substance (key facts, structure, decisions, important details — up to ~1500 words, " +
  "plain text) and summary is one sentence (<= 20 words). " +
  'If you CANNOT access the resource (authentication required, not found, no tool can ' +
  'reach it, or it has no fetchable content): {"error": string} with a clear, specific, ' +
  "user-facing reason. Never fabricate content you did not actually retrieve.";

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
      operation: "synthesis",
    });

    const parsed = extractJson(raw) as { summary?: unknown; nextSteps?: unknown; nextStepPrompts?: unknown; suggestedPrompts?: unknown } | null;
    if (parsed && typeof parsed.summary === "string") {
      const strs = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
      return {
        summary: parsed.summary.trim(),
        nextSteps: strs(parsed.nextSteps),
        nextStepPrompts: strs(parsed.nextStepPrompts),
        suggestedPrompts: strs(parsed.suggestedPrompts).slice(0, 4),
        synthesizedAtMs: Date.now(),
      };
    }

    // Fallback: keep the narrative, derive no steps rather than fail outright.
    const cleaned = raw.replace(/```[a-z]*|```/g, "").trim();
    if (!cleaned) throw new Error("Intelligence returned an empty response");
    return { summary: cleaned.slice(0, 600), nextSteps: [], nextStepPrompts: [], suggestedPrompts: [], synthesizedAtMs: Date.now() };
  }

  async suggestGlobalPrompts(overview: string): Promise<string[]> {
    const raw = await runOpencodePrompt({
      binPath: this.binPath,
      model: this.getModel(),
      system: GLOBAL_PROMPTS_SYSTEM,
      prompt: overview,
      timeoutMs: 45_000,
      operation: "suggestions",
    });
    const parsed = extractJson(raw) as { prompts?: unknown } | null;
    const prompts = Array.isArray(parsed?.prompts)
      ? parsed!.prompts.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : [];
    return prompts.map((p) => p.trim()).slice(0, 4);
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
      operation: "reference",
    });
    return raw.replace(/^["'\s]+|["'\s]+$/g, "").split("\n")[0].slice(0, 200);
  }

  async indexReference(input: { title: string; url?: string; kind?: string }): Promise<ReferenceIndexResult> {
    const prompt = [
      `Title: ${input.title}`,
      input.kind ? `Kind: ${input.kind}` : "",
      input.url ? `URL: ${input.url}` : "",
      input.url ? "Fetch this URL (and follow obvious links) to retrieve its content." : "There is no URL — index from the title alone only if you can find the resource via a tool; otherwise report an error.",
    ].filter(Boolean).join("\n");

    const raw = await runOpencodePrompt({
      binPath: this.binPath,
      model: this.getModel(),
      system: INDEX_SYSTEM,
      prompt,
      tools: INDEX_TOOLS,
      timeoutMs: 120_000,
      operation: "index",
    });

    const parsed = extractJson(raw) as { content?: unknown; summary?: unknown; error?: unknown } | null;
    if (parsed) {
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
      const error = str(parsed.error);
      if (error) return { error: error.slice(0, 400) };
      const content = str(parsed.content);
      const summary = str(parsed.summary);
      if (content || summary) {
        return { content: content?.slice(0, 8000), summary: summary?.slice(0, 200) };
      }
    }
    // No parseable result — surface a clear error rather than silently storing junk.
    return { error: "The harness returned no usable content for this reference." };
  }
}
