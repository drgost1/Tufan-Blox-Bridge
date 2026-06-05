// Meshy AI REST client (https://docs.meshy.ai). Stateless by design: every task
// is re-queryable by id from Meshy's side, so a server restart mid-generation
// loses nothing — the taskId is the resume token (same contract as Open Cloud's
// operationId in openCloud.ts).
//
// CRITICAL download rule: model_urls/texture_urls are SIGNED, EXPIRING links.
// Never hand a URL across tool calls — always re-GET the task for fresh URLs
// immediately before downloading (downloadTask does exactly that).
//
// Endpoint versions differ per API (hard-coded per call):
//   text-to-3d  POST/GET /openapi/v2/text-to-3d[/:id]   (two-step: preview → refine)
//   image-to-3d POST/GET /openapi/v1/image-to-3d[/:id]
//   remesh      POST/GET /openapi/v1/remesh[/:id]

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scrub } from "../openCloud.js";
import { workDir } from "../assetWork.js";

const MESHY_BASE = "https://api.meshy.ai/openapi";

export const MESHY_KEY_HELP =
  "Meshy tools need a Meshy AI API key (requires a paid plan — Pro is $20/mo for 1,000 credits):\n" +
  "  1. https://www.meshy.ai/settings/api → create an API key\n" +
  "  2. Set TUFAN_MESHY_KEY=<key> in the tufan MCP server env, restart the AI client\n" +
  "Costs per task (approx): text-to-3D ~30 credits (~$0.60: preview 20 + texture refine 10), " +
  "image-to-3D ~30, remesh 5. Set TUFAN_MESHY_AUTOCONFIRM=1 to skip per-call spend confirmations.";

// Task endpoints a bare taskId could belong to, in likeliest-first order — lets
// resume work from just the id, no server-side state.
const TASK_ENDPOINTS = ["v2/text-to-3d", "v1/image-to-3d", "v1/remesh"] as const;

export type MeshyTask = {
  id: string;
  mode?: "preview" | "refine";
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED" | string;
  progress?: number;
  model_urls?: Record<string, string | undefined>;
  texture_urls?: Array<Record<string, string | undefined>>;
  task_error?: { message?: string } | null;
  /** Which endpoint the task was found under (set by us, not Meshy). */
  endpoint?: string;
  [k: string]: unknown;
};

function headers(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function meshyFetch(key: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${MESHY_BASE}/${path}`, {
    ...init,
    headers: { ...headers(key), ...(init?.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(30_000),
  });
}

async function startTask(key: string, path: string, body: Record<string, unknown>): Promise<string> {
  const res = await meshyFetch(key, path, { method: "POST", body: JSON.stringify(body) });
  const textBody = await res.text();
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403
        ? `\nKey problem — check:\n${MESHY_KEY_HELP}`
        : res.status === 402
          ? "\nOut of Meshy credits — top up or upgrade the plan at meshy.ai."
          : "";
    throw new Error(`Meshy ${path} HTTP ${res.status}: ${scrub(textBody.slice(0, 300), key)}${hint}`);
  }
  const j: any = JSON.parse(textBody);
  const id = j?.result ?? j?.id;
  if (!id || typeof id !== "string") {
    throw new Error(`Meshy ${path} returned no task id: ${scrub(textBody.slice(0, 200), key)}`);
  }
  return id;
}

export function startTextPreview(
  key: string,
  prompt: string,
  opts?: { targetPolycount?: number; topology?: "quad" | "triangle" },
): Promise<string> {
  const body: Record<string, unknown> = { mode: "preview", prompt };
  // target_polycount on text-to-3d is supported per docs; the verified fallback
  // for polycount control is the dedicated remesh endpoint (startRemesh).
  if (opts?.targetPolycount) body.target_polycount = Math.round(opts.targetPolycount);
  if (opts?.topology) body.topology = opts.topology;
  return startTask(key, "v2/text-to-3d", body);
}

export function startTextRefine(key: string, previewTaskId: string, opts?: { enablePbr?: boolean }): Promise<string> {
  return startTask(key, "v2/text-to-3d", {
    mode: "refine",
    preview_task_id: previewTaskId,
    enable_pbr: opts?.enablePbr !== false,
  });
}

export function startImageTo3D(
  key: string,
  imageUrl: string,
  opts?: { enablePbr?: boolean; targetPolycount?: number; topology?: "quad" | "triangle" },
): Promise<string> {
  const body: Record<string, unknown> = { image_url: imageUrl, enable_pbr: opts?.enablePbr !== false };
  if (opts?.targetPolycount) body.target_polycount = Math.round(opts.targetPolycount);
  if (opts?.topology) body.topology = opts.topology;
  return startTask(key, "v1/image-to-3d", body);
}

export function startRemesh(
  key: string,
  inputTaskId: string,
  targetPolycount: number,
  opts?: { topology?: "quad" | "triangle"; formats?: string[] },
): Promise<string> {
  return startTask(key, "v1/remesh", {
    input_task_id: inputTaskId,
    target_polycount: Math.round(targetPolycount),
    topology: opts?.topology ?? "triangle",
    target_formats: opts?.formats ?? ["glb"],
  });
}

/** Locate a task by bare id across the known endpoints (resume path). */
export async function findTask(key: string, taskId: string): Promise<MeshyTask> {
  let last = "";
  for (const ep of TASK_ENDPOINTS) {
    const res = await meshyFetch(key, `${ep}/${taskId}`);
    if (res.ok) {
      const t = (await res.json()) as MeshyTask;
      t.endpoint = ep;
      return t;
    }
    last = `${ep} → HTTP ${res.status}`;
  }
  throw new Error(`Meshy task ${taskId} not found under any endpoint (${last})`);
}

/**
 * Poll a task until it settles or the budget runs out. Returns {done:false}
 * with the latest snapshot when the budget elapses — NEVER blocks past waitMs.
 */
export async function pollTask(key: string, taskId: string, waitMs: number): Promise<{ done: boolean; task: MeshyTask }> {
  const deadline = Date.now() + waitMs;
  let delay = 3_000;
  let task = await findTask(key, taskId);
  for (;;) {
    if (task.status === "SUCCEEDED" || task.status === "FAILED" || task.status === "CANCELED") {
      return { done: true, task };
    }
    if (Date.now() + delay > deadline) return { done: false, task };
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(Math.round(delay * 1.4), 8_000);
    task = await findTask(key, taskId);
  }
}

export type DownloadedAsset = {
  task: MeshyTask;
  glbPath?: string;
  textures: Record<string, string>;
  dir: string;
};

async function fetchToFile(url: string, dest: string): Promise<boolean> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) return false;
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return true;
}

/**
 * Re-GET the task (fresh signed URLs) and download the GLB + any PBR maps into
 * the per-task work dir. Throws unless the task has SUCCEEDED.
 */
export async function downloadTask(key: string, taskId: string): Promise<DownloadedAsset> {
  let task = await findTask(key, taskId);
  if (task.status !== "SUCCEEDED") {
    throw new Error(`Meshy task ${taskId} is ${task.status}${task.task_error?.message ? ` — ${task.task_error.message}` : ""} (only SUCCEEDED tasks can be downloaded)`);
  }
  const dir = await workDir(taskId);
  const out: DownloadedAsset = { task, textures: {}, dir };

  const tryDownload = async (): Promise<boolean> => {
    const glbUrl = task.model_urls?.glb;
    if (!glbUrl) return false;
    const dest = join(dir, `${taskId}.glb`);
    if (!(await fetchToFile(glbUrl, dest))) return false;
    out.glbPath = dest;
    return true;
  };

  // Signed URLs can expire between the GET and the download under pathological
  // timing — one fresh re-GET retry covers it.
  if (!(await tryDownload())) {
    task = await findTask(key, taskId);
    out.task = task;
    if (!(await tryDownload())) {
      throw new Error(`Meshy task ${taskId} SUCCEEDED but the GLB download failed (no/expired model_urls.glb)`);
    }
  }

  for (const [name, url] of Object.entries(task.texture_urls?.[0] ?? {})) {
    if (!url) continue;
    const dest = join(dir, `${taskId}_${name}.png`);
    if (await fetchToFile(url, dest)) out.textures[name] = dest;
  }
  return out;
}

export type GenOutcome =
  | { kind: "downloaded"; asset: DownloadedAsset }
  | { kind: "pending"; task: MeshyTask; stage: string }
  | { kind: "failed"; task: MeshyTask };

function stageOf(task: MeshyTask): string {
  return task.endpoint === "v2/text-to-3d" && task.mode === "preview" ? "geometry preview" : "processing";
}

/**
 * Drive a generation task to its final downloaded files within the budget,
 * auto-chaining the text-to-3d refine (texturing) stage after a successful
 * preview. Resumable: pass any stage's taskId and it picks up from there.
 */
export async function driveGeneration(
  key: string,
  taskId: string,
  deadline: number,
  enablePbr: boolean,
): Promise<GenOutcome> {
  for (;;) {
    const budget = deadline - Date.now();
    if (budget <= 0) {
      const t = await findTask(key, taskId);
      return { kind: "pending", task: t, stage: stageOf(t) };
    }
    const { done, task } = await pollTask(key, taskId, budget);
    if (!done) return { kind: "pending", task, stage: stageOf(task) };
    if (task.status !== "SUCCEEDED") return { kind: "failed", task };
    if (task.endpoint === "v2/text-to-3d" && task.mode === "preview") {
      taskId = await startTextRefine(key, task.id, { enablePbr });
      continue;
    }
    return { kind: "downloaded", asset: await downloadTask(key, task.id) };
  }
}

/** One-line human summary of a task's state for tool output. */
export function describeTask(task: MeshyTask): string {
  const bits = [`task ${task.id}`, task.mode ? `mode=${task.mode}` : "", `status=${task.status}`];
  if (typeof task.progress === "number" && task.status !== "SUCCEEDED") bits.push(`progress=${task.progress}%`);
  if (task.task_error?.message) bits.push(`error="${task.task_error.message}"`);
  return bits.filter(Boolean).join(" ");
}

export function meshyKey(): string | undefined {
  return process.env.TUFAN_MESHY_KEY?.trim() || undefined;
}

export function autoConfirm(): boolean {
  return process.env.TUFAN_MESHY_AUTOCONFIRM === "1";
}
