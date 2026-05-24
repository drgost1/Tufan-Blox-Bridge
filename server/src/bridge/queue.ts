// Command queue + pending-response registry.
//
// dispatch(op, args) -> Promise that resolves when the plugin POSTs a matching
// /response. Commands are handed to a waiting long-poll if one is parked,
// otherwise queued until the next poll arrives.

import { randomUUID } from "node:crypto";
import type { Command } from "./protocol.js";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

type Waiter = (cmd: Command | null) => void;

const pending = new Map<string, Pending>();
const queue: Command[] = [];
const waiters: Waiter[] = [];

let pluginConnected = false;

export function setPluginConnected(connected: boolean) {
  pluginConnected = connected;
}

export function isPluginConnected(): boolean {
  return pluginConnected;
}

/**
 * Send an op to the plugin and await its result.
 * Rejects if no response arrives within timeoutMs.
 */
export function dispatch(
  op: string,
  args: Record<string, unknown> = {},
  timeoutMs = 30_000,
): Promise<unknown> {
  const id = randomUUID();
  const cmd: Command = { id, op, args };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        new Error(
          `Plugin did not respond to "${op}" within ${timeoutMs}ms. Is Roblox Studio open with the Tufan-Blox-Bridge plugin loaded?`,
        ),
      );
    }, timeoutMs);

    pending.set(id, { resolve, reject, timer });

    const waiter = waiters.shift();
    if (waiter) {
      waiter(cmd);
    } else {
      queue.push(cmd);
    }
  });
}

/** Resolve/reject the dispatch promise that matches a /response message. */
export function resolveResponse(
  id: string,
  ok: boolean,
  result?: unknown,
  error?: string,
) {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
  if (ok) p.resolve(result);
  else p.reject(new Error(error ?? "Plugin reported an unknown error"));
}

/**
 * Long-poll: return the next queued command, or park for up to holdMs waiting
 * for one. Resolves null on timeout so the plugin re-polls.
 */
export function nextCommand(holdMs = 25_000): Promise<Command | null> {
  const queued = queue.shift();
  if (queued) return Promise.resolve(queued);

  return new Promise((resolve) => {
    const waiter: Waiter = (cmd) => {
      clearTimeout(timer);
      resolve(cmd);
    };
    const timer = setTimeout(() => {
      const i = waiters.indexOf(waiter);
      if (i >= 0) waiters.splice(i, 1);
      resolve(null);
    }, holdMs);
    waiters.push(waiter);
  });
}
