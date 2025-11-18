// lock_slot.js
// Usage:
//   node lock_slot.js lock    <YYYY-MM-DD> <HH:MM> <userId> [ttlMs]
//   node lock_slot.js confirm <YYYY-MM-DD> <HH:MM> <userId>
//   node lock_slot.js unlock  <YYYY-MM-DD> <HH:MM> <userId>

import { createClient } from "redis";

const REDIS_URL = "redis://:doom2019@localhost:6379";
const kLock  = (d,t) => `lock:slot:${d}:${t}`;
const kSlot  = (d,t) => `slot:${d}:${t}`;
const kSched = (d)   => `sched:${d}`;

// Atomic confirm (same logic used by the queue worker)
const CONFIRM_LUA = `
local owner = redis.call('GET', KEYS[1])
if not owner or owner ~= ARGV[1] then return {err="LOCK_NOT_OWNER"} end
local st = redis.call('HGET', KEYS[2], 'status')
if st == 'booked' then return {err="ALREADY_BOOKED"} end
redis.call('HSET', KEYS[2], 'status', 'booked', 'user_id', ARGV[1], 'updated_at', ARGV[2])
redis.call('DEL', KEYS[1])
redis.call('DEL', KEYS[3])
return "OK"
`;

function client() {
  return createClient({ url: REDIS_URL });
}

async function doLock(date, time, userId, ttlMs = 60000) {
  const r = client(); await r.connect();
  try {
    // acquire lock with NX (only if not exists) + PX TTL
    const ok = await r.set(kLock(date, time), userId, { NX: true, PX: ttlMs });
    if (!ok) {
      const current = await r.get(kLock(date, time));
      console.error(`FAILED lock: ${kLock(date,time)} already held by ${current}`);
      process.exitCode = 1;
      return;
    }
    console.log(`LOCKED ${kLock(date,time)} by ${userId} (ttl=${ttlMs}ms)`);
  } finally { await r.quit(); }
}

async function doConfirm(date, time, userId) {
  const r = client(); await r.connect();
  try {
    // ensure slot hash exists (idempotent)
    await r.hSetNX(kSlot(date, time), "status", "free");

    const res = await r.eval(CONFIRM_LUA, {
      keys: [kLock(date, time), kSlot(date, time), kSched(date)],
      arguments: [userId, String(Date.now())]
    });

    if (res === "OK") {
      console.log(`CONFIRMED ${date} ${time} by ${userId}`);
    } else {
      console.error("CONFIRM FAILED:", res);
      process.exitCode = 1;
    }
  } finally { await r.quit(); }
}

async function doUnlock(date, time, userId) {
  const r = client(); await r.connect();
  try {
    const owner = await r.get(kLock(date, time));
    if (!owner) {
      console.log("No lock to release.");
      return;
    }
    if (owner !== userId) {
      console.error(`LOCK_NOT_OWNER: lock held by ${owner}`);
      process.exitCode = 1;
      return;
    }
    await r.del(kLock(date, time));
    console.log(`UNLOCKED ${kLock(date,time)} by ${userId}`);
  } finally { await r.quit(); }
}

// CLI
const [,, cmd, a, b, c, d] = process.argv;
if (cmd === "lock") {
  if (!a || !b || !c) {
    console.log(`Usage:\n  node lock_slot.js lock <YYYY-MM-DD> <HH:MM> <userId> [ttlMs]`);
    process.exit(1);
  }
  await doLock(a, b, c, d ? Number(d) : 60000);
} else if (cmd === "confirm") {
  if (!a || !b || !c) {
    console.log(`Usage:\n  node lock_slot.js confirm <YYYY-MM-DD> <HH:MM> <userId>`);
    process.exit(1);
  }
  await doConfirm(a, b, c);
} else if (cmd === "unlock") {
  if (!a || !b || !c) {
    console.log(`Usage:\n  node lock_slot.js unlock <YYYY-MM-DD> <HH:MM> <userId>`);
    process.exit(1);
  }
  await doUnlock(a, b, c);
} else {
  console.log(`Usage:
  node lock_slot.js lock    <YYYY-MM-DD> <HH:MM> <userId> [ttlMs]
  node lock_slot.js confirm <YYYY-MM-DD> <HH:MM> <userId>
  node lock_slot.js unlock  <YYYY-MM-DD> <HH:MM> <userId>`);
}
