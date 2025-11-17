import { createClient } from "redis";
const r = createClient({ url: "redis://:doom2019@localhost:6379" });
const kLock = (d,t) => `lock:slot:${d}:${t}`;
const kSlot = (d,t) => `slot:${d}:${t}`;
const kSched = d => `sched:${d}`;
const connect = async () => { if (!r.isOpen) await r.connect(); };

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

async function lock(date,time,userId,ttlMs=30000){
  await connect();
  const ok = await r.set(kLock(date,time), userId, { NX:true, PX: ttlMs });
  if (!ok) throw new Error("Slot locked by someone else");
  console.log("LOCKED", kLock(date,time), "by", userId);
}
async function confirm(date,time,userId){
  await connect();
  await r.hSetNX(kSlot(date,time), "status", "free");
  const res = await r.eval(CONFIRM_LUA, { keys:[kLock(date,time),kSlot(date,time),kSched(date)], arguments:[userId, String(Date.now())] });
  if (res !== "OK") throw new Error(typeof res==="string" ? res : JSON.stringify(res));
  console.log("CONFIRMED → booked", kSlot(date,time));
}

const [,, cmd, d, t, u] = process.argv;
(async () => {
  try {
    if (cmd==="lock") {
      if(!d||!t||!u) throw new Error("Usage: lock <date> <time> <userId>");
      await lock(d,t,u);
    } else if (cmd==="confirm") {
      if(!d||!t||!u) throw new Error("Usage: confirm <date> <time> <userId>");
      await confirm(d,t,u);
    } else {
      console.log(`Usage:
  node lock_slot.js lock <YYYY-MM-DD> <HH:MM> <userId>
  node lock_slot.js confirm <YYYY-MM-DD> <HH:MM> <userId>`);
    }
  } finally { if (r.isOpen) await r.quit(); }
})();
