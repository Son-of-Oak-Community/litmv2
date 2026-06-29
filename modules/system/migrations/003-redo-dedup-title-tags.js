// Re-run the 002 dedup. The cross-client race in the createActor/createItem
// hooks (a player creating a hero and the GM both running ensureTitleTag) could
// reintroduce a duplicate title tag *after* migration 002 had already run.
// Worlds already past v2 won't re-run 002, so this version re-applies the same
// idempotent cleanup. The hook guard prevents new duplicates; this clears the
// ones already created (which have no UI affordance to remove).
export { migrate } from "./002-dedup-title-tags.js";
