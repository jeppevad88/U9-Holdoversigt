// U9 Holdoversigt - fælles Supabase-database.
// Hjemmesiden kræver ikke login. Derfor bruges kun publishable/anon key.
window.SUPABASE_CONFIG = {
  url: "https://cnbhybdyftviykzsrkzl.supabase.co",
  anonKey: "sb_publishable_hbBIVt0bogajJ3R5B-iLCQ_GyGaQ1X8",
  icalFunctionUrl: "https://cnbhybdyftviykzsrkzl.supabase.co/functions/v1/u9-ical-sync"
};

window.APP_CONFIG = {
  maxPlayers: 7,
  stateTable: "u9_state",
  stateRowId: "main",
  scheduleCacheKey: "u9-schedule-cache-v3",
  scheduleRefreshMs: 10 * 60 * 1000,
  stateRefreshMs: 15 * 1000
};
