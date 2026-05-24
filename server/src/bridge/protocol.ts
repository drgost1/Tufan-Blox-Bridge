// Shared message shapes for the server <-> plugin HTTP bridge.

export interface Command {
  id: string;
  op: string;
  args: Record<string, unknown>;
}

export interface CommandResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface StudioChange {
  /** Studio-side full path, e.g. "ServerScriptService.MusicService" */
  studioPath: string;
  /** New Source contents of the script. */
  source: string;
}

export interface ReadyMessage {
  sessionId: string;
  placeName?: string;
  placeId?: number;
}

/** Default localhost port the plugin polls and the server's bridge listens on. */
export const BRIDGE_PORT = 58741;
