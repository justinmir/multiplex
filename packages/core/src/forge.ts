import type { PullRequest, FileChange, ReviewComment, CheckRun } from "./domain.js";

/** Input for opening a draft PR. `repo` is "owner/name". */
export interface OpenPRInput {
  repo: string;
  title: string;
  head: string;
  base?: string;
  body?: string;
  draft?: boolean;
}

/**
 * A code forge (GitHub first). All `repo` arguments are "owner/name". Keeps the
 * rest of the app off octokit so the forge is swappable.
 */
export interface ForgeService {
  openDraftPR(p: OpenPRInput): Promise<PullRequest>;
  getPR(repo: string, number: number): Promise<PullRequest | null>;
  listPRFiles(repo: string, number: number): Promise<FileChange[]>;
  listReviewComments(repo: string, number: number): Promise<ReviewComment[]>;
  listCheckRuns(repo: string, number: number): Promise<CheckRun[]>;
  replyToComment(repo: string, number: number, commentId: string, body: string): Promise<void>;
  rerunChecks(repo: string, number: number): Promise<void>;
  merge(repo: string, number: number): Promise<void>;
}
