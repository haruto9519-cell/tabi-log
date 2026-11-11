// Use the isolated Worker Preview for the feature branch Pages preview.
// Production pages continue to use the production Worker.
const isTabiLogPreview = location.hostname === "feat-d1-photo-sync.tabi-log.pages.dev";
window.TABI_LOG_API_BASE = isTabiLogPreview
  ? "https://feat-d1-photo-sync-tabi-log.haruto-9519.workers.dev"
  : "https://tabi-log.haruto-9519.workers.dev";

// Public Google OAuth web client ID (not a secret).
window.TABI_LOG_GOOGLE_CLIENT_ID = "88585688478-1i3t68qc8ek9ffo3f0u4qj4rfvsm1n5h.apps.googleusercontent.com";
