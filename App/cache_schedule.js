import { createClient } from "redis";
const r = createClient({ url: "redis://:doom2019@localhost:6379" });
const today = () => new Date().toISOString().slice(0,10);
const keySched = d => `sched:${d}`;
const buildSchedule = d => ({ date:d, slots: { "09:00":"free","09:30":"free","10:00":"free" } });
const connect = async () => { if (!r.isOpen) await r.connect(); };

async function getSchedule(date, ttlSec=120){
  await connect();
  const k = keySched(date);
  const cached = await r.get(k);
  if (cached) { console.log("[HIT]", k); return JSON.parse(cached); }
  console.log("[MISS]", k, "→ generating…");
  const sched = buildSchedule(date);
  await r.setEx(k, ttlSec, JSON.stringify(sched));
  return sched;
}
async function invalidate(date=today()){
  await connect(); await r.del(keySched(date));
  console.log("Invalidated:", keySched(date));
}

const [,, cmd, argDate] = process.argv; const d = argDate || today();
(async () => {
  try {
    if (cmd === "get") console.log(JSON.stringify(await getSchedule(d), null, 2));
    else if (cmd === "invalidate") await invalidate(d);
    else console.log(`Usage:
  node cache_schedule.js get [YYYY-MM-DD]
  node cache_schedule.js invalidate [YYYY-MM-DD]`);
  } finally { if (r.isOpen) await r.quit(); }
})();
