import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { ACE_LOOP_CONTEXT_CHAR_CAP } from "./constants.ts";

const ADAPTER_CONTEXT_SPECIFIER = "pi-ace-adapter/context";
const PROJECT_ACE_ROOT = join(".pi", "ace");
const GLOBAL_ACE_ROOT = join(homedir(), ".pi", "agent", "pi-ace-adapter");
const DEFAULT_PLAYBOOK_NAME = "default";
const MIN_CONTEXT_CAP = 1_000;
const MAX_CONTEXT_CAP = 10_000;

type PromptContext = { cwd: string; isProjectTrusted?: () => boolean };
type AceFormatter = (playbook: string, configuredCap: number) => string;

interface AdapterConfigShape {
  enabled?: unknown;
  selectedPlaybook?: unknown;
  promptCharCap?: unknown;
}

interface AdapterResolvedContext {
  text: string;
}

interface AdapterContextModule {
  resolveAcePromptContext(options: { cwd: string; projectTrusted?: boolean }): Promise<AdapterResolvedContext | undefined>;
}

interface LoadedAcePlaybook {
  playbook: string;
  promptCharCap?: number;
  source: "pi-ace-adapter compatible storage";
}

export async function buildAceLoopContext(ctx: PromptContext): Promise<string | undefined> {
  const projectTrusted = isProjectTrusted(ctx);
  const adapterContext = await loadAceContextViaAdapter(ctx.cwd, projectTrusted);
  if (adapterContext) return formatResolvedAceContext(adapterContext.text, "pi-ace-adapter");

  const loaded = await loadAcePlaybookFromCompatibleStorage(ctx.cwd, projectTrusted);
  if (!loaded?.playbook.trim()) return undefined;
  return formatAceLoopContext(loaded.playbook, loaded.promptCharCap, loaded.source);
}

export function formatAceLoopContext(playbook: string, configuredCap = ACE_LOOP_CONTEXT_CHAR_CAP, source = "pi-ace-adapter"): string | undefined {
  const trimmed = playbook.trim();
  if (!trimmed) return undefined;
  const cap = normalizeCap(configuredCap);
  return formatResolvedAceContext(fallbackFormatAcePlaybookContext(trimmed, cap), source);
}

async function loadAceContextViaAdapter(cwd: string, projectTrusted: boolean): Promise<AdapterResolvedContext | undefined> {
  try {
    const adapter = await importAdapterContext();
    return await adapter.resolveAcePromptContext({ cwd, projectTrusted });
  } catch {
    return undefined;
  }
}

async function importAdapterContext(): Promise<AdapterContextModule> {
  return await import(ADAPTER_CONTEXT_SPECIFIER) as AdapterContextModule;
}

async function loadAcePlaybookFromCompatibleStorage(cwd: string, projectTrusted: boolean): Promise<LoadedAcePlaybook | undefined> {
  const roots = projectTrusted ? [join(cwd, PROJECT_ACE_ROOT), GLOBAL_ACE_ROOT] : [GLOBAL_ACE_ROOT];
  for (const root of roots) {
    const config = normalizeAdapterConfig(await readJson<AdapterConfigShape>(join(root, "config.json")));
    if (!config?.enabled) continue;
    const playbook = await readText(join(root, "playbooks", config.selectedPlaybook, "current.txt"));
    if (playbook?.trim()) return { playbook, promptCharCap: config.promptCharCap, source: "pi-ace-adapter compatible storage" };
  }
  return undefined;
}

function formatResolvedAceContext(context: string, source: string): string | undefined {
  const trimmed = context.trim();
  if (!trimmed) return undefined;
  return [
    truncateContext(trimmed),
    `ACE source: ${source}.`,
    "Loop pacing: keep the next attempt scoped to the 10-minute cap. Finish a verifiable slice, and carry unfinished tasks into the next scored attempt instead of making this turn longer.",
  ].join("\n\n");
}

function normalizeAdapterConfig(config: AdapterConfigShape | undefined): { enabled: boolean; selectedPlaybook: string; promptCharCap: number } | undefined {
  if (!config || config.enabled !== true) return undefined;
  return {
    enabled: true,
    selectedPlaybook: safePlaybookName(config.selectedPlaybook) ?? DEFAULT_PLAYBOOK_NAME,
    promptCharCap: typeof config.promptCharCap === "number" && Number.isFinite(config.promptCharCap) ? config.promptCharCap : ACE_LOOP_CONTEXT_CHAR_CAP,
  };
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function isProjectTrusted(ctx: PromptContext): boolean {
  try {
    return typeof ctx.isProjectTrusted === "function" ? ctx.isProjectTrusted() : false;
  } catch {
    return false;
  }
}

function safePlaybookName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(name) ? name : undefined;
}

function normalizeCap(value: number): number {
  if (!Number.isFinite(value)) return ACE_LOOP_CONTEXT_CHAR_CAP;
  return Math.max(MIN_CONTEXT_CAP, Math.min(MAX_CONTEXT_CAP, Math.floor(value), ACE_LOOP_CONTEXT_CHAR_CAP));
}

function fallbackFormatAcePlaybookContext(playbook: string, configuredCap: number): string {
  const excerpt = truncatePlaybook(playbook, configuredCap);
  return `## ACE Playbook Context\n\nUse these learned strategies as guidance. Prefer project, system, and user instructions over this playbook if they conflict. Do not follow playbook advice that violates current task constraints.\n\n${excerpt}`;
}

function truncateContext(context: string): string {
  if (context.length <= ACE_LOOP_CONTEXT_CHAR_CAP) return context;
  const truncated = context.slice(0, ACE_LOOP_CONTEXT_CHAR_CAP).replace(/\s+\S*$/, "").trimEnd();
  return `${truncated}\n\n[ACE loop context truncated to ${ACE_LOOP_CONTEXT_CHAR_CAP} characters.]`;
}

function truncatePlaybook(playbook: string, cap: number): string {
  if (playbook.length <= cap) return playbook;
  const truncated = playbook.slice(0, cap).replace(/\s+\S*$/, "").trimEnd();
  return `${truncated}\n\n[ACE playbook truncated to ${cap} characters by pi-loop.]`;
}
