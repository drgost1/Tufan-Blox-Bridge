// Runtime, plugin-toggleable settings (the widget's git switches write here).

export const runtimeConfig = {
  autoCommit: process.env.TUFAN_AUTOCOMMIT === "1",
  autoPush: process.env.TUFAN_AUTOPUSH === "1",
};

export function setConfig(patch: Partial<typeof runtimeConfig>) {
  if (typeof patch.autoCommit === "boolean") runtimeConfig.autoCommit = patch.autoCommit;
  if (typeof patch.autoPush === "boolean") runtimeConfig.autoPush = patch.autoPush;
}
