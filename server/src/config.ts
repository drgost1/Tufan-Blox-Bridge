// Runtime, plugin-toggleable settings (the widget's switches write here; the
// plugin also sends them on /ready so they're known at connect time).
//
// gitEnabled is the master switch: when false, the bridge does NO git at all —
// no .git in the mirror, no commits, no backups. Git/GitHub is strictly opt-in,
// so a user who doesn't want the repo headache just leaves it off. Defaults off;
// the plugin persists the user's choice and re-sends it each session.

export const runtimeConfig = {
  gitEnabled: process.env.TUFAN_GIT === "1",
  autoCommit: process.env.TUFAN_AUTOCOMMIT === "1",
  autoPush: process.env.TUFAN_AUTOPUSH === "1",
  // Inspection-only mode. Pure-write tools are hidden at registration (server.ts);
  // mixed read/write tools (script_source, tag) stay visible but guard their write
  // path via requireWritable() (helpers.ts), so reads still work in inspector mode.
  readOnly: process.env.TUFAN_READONLY === "1",
};

export function setConfig(patch: Partial<typeof runtimeConfig>) {
  if (typeof patch.gitEnabled === "boolean") runtimeConfig.gitEnabled = patch.gitEnabled;
  if (typeof patch.autoCommit === "boolean") runtimeConfig.autoCommit = patch.autoCommit;
  if (typeof patch.autoPush === "boolean") runtimeConfig.autoPush = patch.autoPush;
  if (typeof patch.readOnly === "boolean") runtimeConfig.readOnly = patch.readOnly;
}
