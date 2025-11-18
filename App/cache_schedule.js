// cache_schedule.js
// Usage:
//   node cache_schedule.js get <YYYY-MM-DD>          # MISS -> seed -> HIT
//   node cache_schedule.js invalidate <YYYY-MM-DD>    # delete cached schedule

import { createClient } from "redis";

const REDIS_URL = "redis://:doom2019@localhost:6379";
const kSched = (d) => `sched:${d}`;

function client() {
  return createClient({ url: REDIS_URL });
}

// Example: generate schedule data for a date
function generateSchedule(date) {
  // Your real app would fetch from DB; here we mock a few slots
  return {
    date,
    slots: {
      "09:00": "free",
      "09:30": "free",
      "10:00": "free"
    }
  };
}

async function getSchedule(date) {
  const r = client(); await r.connect();
  try {
    const key = kSched(date);
    const cached = await r.get(key);
    if (cached) {
      console.log(`[HIT] ${key}`);
      console.log(JSON.stringify(JSON.parse(cached), null, 2));
      return;
    }
    console.log(`[MISS] ${key} → generating…`);
    const data = generateSchedule(date);
    // cache with TTL (e.g., 60s)
    await r.setEx(key, 60, JSON.stringify(data));
    console.log(JSON.stringify(data, null, 2));
  } finally { await r.quit(); }
}

async function invalidate(date) {
  const r = client(); await r.connect();
  try {
    const key = kSched(date);
    await r.del(key);
    console.log(`Invalidated: ${key}`);
  } finally { await r.quit(); }
}

// CLI
const [,, cmd, a] = process.argv;
if (cmd === "get") {
  if (!a) { console.log(`Usage:\n  node cache_schedule.js get <YYYY-MM-DD>`); process.exit(1); }
  await getSchedule(a);
} else if (cmd === "invalidate") {
  if (!a) { console.log(`Usage:\n  node cache_schedule.js invalidate <YYYY-MM-DD>`); process.exit(1); }
  await invalidate(a);
} else {
  console.log(`Usage:
  node cache_schedule.js get <YYYY-MM-DD>
  node cache_schedule.js invalidate <YYYY-MM-DD>`);
}
