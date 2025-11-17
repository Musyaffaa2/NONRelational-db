// queue_booking.js
// Usage:
//   node queue_booking.js worker [consumerName]
//   node queue_booking.js produce <YYYY-MM-DD> <HH:MM> <userId>

import { createClient } from "redis";

const REDIS_URL = "redis://:doom2019@localhost:6379";
const STREAM = "stream:bookings";
const GROUP  = "bookers";

const kLock  = (d,t) => `lock:slot:${d}:${t}`;
const kSlot  = (d,t) => `slot:${d}:${t}`;
const kSched = (d)   => `sched:${d}`;

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

const client = () => createClient({ url: REDIS_URL });

/** Producer: enqueue a confirm job */
async function produce(date, time, userId) {
  const r = client(); await r.connect();
  try {
    const id = await r.xAdd(STREAM, "*", { event: "confirm", date, time, user_id: userId });
    console.log("ENQUEUED", id, { date, time, user_id: userId });
  } finally { await r.quit(); }
}

/** Worker: consumes jobs and confirms booking atomically */
async function worker(consumerName = "w1") {
  const r = client(); await r.connect();
  try { await r.xGroupCreate(STREAM, GROUP, "$", { MKSTREAM: true }); } catch {}
  console.log(`Worker started → stream=${STREAM} group=${GROUP} consumer=${consumerName}`);
  process.on("SIGINT", async () => { try { await r.quit(); } finally { process.exit(0); } });

  while (true) {
    const res = await r.xReadGroup(GROUP, consumerName, [{ key: STREAM, id: ">" }], { COUNT: 10, BLOCK: 5000 });
    if (!res) continue;

    for (const stream of res) for (const msg of stream.messages) {
      const id = msg.id;

      // SAFELY normalize fields across client versions
      const raw = msg.message;
      let f;
      if (Array.isArray(raw)) {            // array of [k,v] pairs -> turn into object
        f = Object.fromEntries(raw);
      } else if (raw && typeof raw === "object") {
        f = raw;                           // already an object (most @redis/client versions)
      } else {
        console.error("SKIP ", id, "unexpected message format:", raw);
        // don't ack so it can be inspected
        continue;
      }

      const user = f.user_id ?? f.userId;
      const date = f.date;
      const time = f.time;

      try {
        if (!date || !time || !user) {
          console.error("SKIP ", id, "missing fields:", f);
          continue; // leave unacked
        }

        // Ensure slot exists (idempotent)
        await r.hSetNX(kSlot(date, time), "status", "free");

        // Atomic confirm
        const ok = await r.eval(CONFIRM_LUA, {
          keys: [kLock(date, time), kSlot(date, time), kSched(date)],
          arguments: [user, String(Date.now())]
        });

        if (ok === "OK") {
          console.log("OK   ", id, `${date} ${time} by ${user}`);
          await r.xAck(STREAM, GROUP, id);
        } else {
          console.error("FAIL ", id, ok);
          // leave unacked for inspection
        }
      } catch (e) {
        console.error("ERR  ", id, e.message);
        // leave unacked for retry/inspection
      }
    }
  }
}

// CLI
const [,, cmd, a, b, c] = process.argv;
if (cmd === "produce") {
  if (!a || !b || !c) {
    console.log(`Usage:\n  node queue_booking.js produce <YYYY-MM-DD> <HH:MM> <userId>`);
    process.exit(1);
  }
  produce(a, b, c);
} else if (cmd === "worker") {
  worker(a || "w1");
} else {
  console.log(`Usage:
  node queue_booking.js worker [consumerName]
  node queue_booking.js produce <YYYY-MM-DD> <HH:MM> <userId>`);
}
