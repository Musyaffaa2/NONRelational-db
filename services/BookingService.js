// BookingService.js
// Single-file version: embeds Redis logic + queue helpers, keeps BookingService philosophy intact.

const Venue = require('../models/Venue');
const Booking = require('../models/Booking');

/* ------------------------------ Embedded RedisService ------------------------------ */
/* Same API BookingService expects:
   - acquireLock(venue_id, date, start_time)
   - releaseLock(venue_id, date, start_time)
   - getAvailableSlots(venue_id, date) -> ["09:00",...]
   - removeSlot(venue_id, date, start_time)
   - addSlot(venue_id, date, start_time)c
   - getCachedVenue(venue_id)
   - cacheVenue(venue_id, venueObj)
   - incrementVenuePopularity(venue_id)
   - getPopularVenues(n) -> [member1, score1, ...]
*/
class RedisService {
  /**
   * @param {import('ioredis')} redis  (ioredis instance or compatible)
   * @param {Object} opts
   */
  constructor(redis, opts = {}) {
    if (!redis) throw new Error('Redis client required');
    this.r = redis;

    this.lockTtlMs = opts.lockTtlMs ?? 60_000;
    this.scheduleTtlSec = opts.scheduleTtlSec ?? 60;
    this.venueTtlSec = opts.venueTtlSec ?? 300;

    this.K = {
      lock:  (v,d,t) => `lock:slot:${v}:${d}:${t}`,
      slot:  (v,d,t) => `slot:${v}:${d}:${t}`,
      sched: (v,d)   => `sched:${v}:${d}`,
      venue: (v)     => `venue:${v}`,
      pop:            'venues:popularity',
    };

    // Lua used by queue + confirm path (aligned with your prior scripts)
    this.CONFIRM_LUA = `
      local owner = redis.call('GET', KEYS[1])
      if not owner or owner ~= ARGV[1] then return {err="LOCK_NOT_OWNER"} end
      local st = redis.call('HGET', KEYS[2], 'status')
      if st == 'booked' then return {err="ALREADY_BOOKED"} end
      redis.call('HSET', KEYS[2], 'status', 'booked', 'user_id', ARGV[1], 'updated_at', ARGV[2])
      redis.call('DEL', KEYS[1])
      redis.call('DEL', KEYS[3])
      return "OK"
    `;
  }

  /* --------------- Locks --------------- */
  async acquireLock(venueId, date, time, owner = 'booking') {
    // ioredis: SET key value NX PX ttl
    const ok = await this.r.set(this.K.lock(venueId, date, time), owner, 'NX', 'PX', this.lockTtlMs);
    return ok === 'OK';
  }

  async releaseLock(venueId, date, time) {
    // Unconditional release to match your current finally{} semantics
    await this.r.del(this.K.lock(venueId, date, time));
  }

  /* --------------- Schedule & Slots --------------- */
  async getAvailableSlots(venueId, date) {
    const key = this.K.sched(venueId, date);
    const cached = await this.r.get(key);
    let schedule;

    if (cached) {
      schedule = JSON.parse(cached);
    } else {
      // Baseline seed (same idea as your cache_schedule.js)
      schedule = { date, slots: { '09:00': 'free', '09:30': 'free', '10:00': 'free' } };
      await this.r.setex(key, this.scheduleTtlSec, JSON.stringify(schedule));
    }

    // Support both array and object shapes for slots
    let candidateTimes;
    if (Array.isArray(schedule.slots)) {
      candidateTimes = schedule.slots;
    } else if (schedule.slots && typeof schedule.slots === 'object') {
      candidateTimes = Object.keys(schedule.slots).filter(t => schedule.slots[t] === 'free');
    } else {
      candidateTimes = [];
    }

    const results = [];
    for (const t of candidateTimes) {
      const st = await this.r.hget(this.K.slot(venueId, date, t), 'status');
      if (!st || st === 'free') results.push(t);
    }
    return results;
  }

  async removeSlot(venueId, date, time) {
    await this.r.hset(
      this.K.slot(venueId, date, time),
      'status', 'booked',
      'updated_at', Date.now().toString()
    );
    await this.r.del(this.K.sched(venueId, date)); // invalidate schedule cache
  }

  async addSlot(venueId, date, time) {
    await this.r.hset(
      this.K.slot(venueId, date, time),
      'status', 'free',
      'updated_at', Date.now().toString()
    );
    await this.r.del(this.K.sched(venueId, date)); // invalidate schedule cache
  }

  /* --------------- Venue Cache --------------- */
  async getCachedVenue(venueId) {
    const s = await this.r.get(this.K.venue(venueId));
    return s ? JSON.parse(s) : null;
  }

  async cacheVenue(venueId, venueObj) {
    await this.r.setex(this.K.venue(venueId), this.venueTtlSec, JSON.stringify(venueObj));
  }

  /* --------------- Popularity --------------- */
  async incrementVenuePopularity(venueId, by = 1) {
    await this.r.zincrby(this.K.pop, by, String(venueId));
  }

  async getPopularVenues(limit = 5) {
    // returns [member1, score1, member2, score2, ...]
    return await this.r.zrevrange(this.K.pop, 0, limit - 1, 'WITHSCORES');
  }

  /* --------------- Optional atomic confirm (kept for queue use) --------------- */
  async confirmIfLocked(venueId, date, time, owner = 'booking') {
    // ioredis eval signature
    const res = await this.r.eval(
      this.CONFIRM_LUA,
      3,
      this.K.lock(venueId, date, time),
      this.K.slot(venueId, date, time),
      this.K.sched(venueId, date),
      owner,
      Date.now().toString()
    );
    return res === 'OK';
  }
}

/* ------------------------------ BookingService (unchanged behavior) ------------------------------ */

class BookingService {
  constructor(db, redis) {
    this.redisService = new RedisService(redis);  // same call-site behavior
    this.venueModel = new Venue(db);
    this.bookingModel = new Booking(db);
  }

  async createBooking(bookingData) {
    const { venue_id, date, start_time, duration = 1 } = bookingData;

    try {
      // 1. Acquire lock
      const locked = await this.redisService.acquireLock(venue_id, date, start_time);
      if (!locked) {
        throw new Error('Slot sedang diproses. Silakan coba lagi.');
      }

      // 2. Check availability
      const slots = await this.redisService.getAvailableSlots(venue_id, date);
      if (!slots.includes(start_time)) {
        throw new Error('Slot tidak tersedia');
      }

      // 3. Get venue data (with caching)
      let venue = await this.redisService.getCachedVenue(venue_id);
      if (!venue) {
        venue = await this.venueModel.findById(venue_id);
        if (!venue) {
          throw new Error('Venue tidak ditemukan');
        }
        await this.redisService.cacheVenue(venue_id, venue);
      }

      // 4. Calculate price
      const total_price = venue.price_per_hour * duration;

      // 5. Create booking in DB (your model decides which DB engine)
      const booking = {
        ...bookingData,
        venue_id,
        total_price,
        status: 'confirmed'
      };
      const bookingId = await this.bookingModel.create(booking);

      // 6. Update Redis
      await this.redisService.removeSlot(venue_id, date, start_time);
      await this.redisService.incrementVenuePopularity(venue_id);

      return { bookingId, total_price };

    } catch (error) {
      throw error;
    } finally {
      // Always release lock
      await this.redisService.releaseLock(venue_id, date, start_time);
    }
  }

  async cancelBooking(bookingId) {
    const booking = await this.bookingModel.findById(bookingId);
    if (!booking) {
      throw new Error('Booking tidak ditemukan');
    }

    if (booking.status === 'cancelled') {
      throw new Error('Booking sudah dibatalkan');
    }

    // Update status in DB
    await this.bookingModel.updateStatus(bookingId, 'cancelled');

    // Return slot to Redis
    await this.redisService.addSlot(
      booking.venue_id.toString(),
      booking.date,
      booking.start_time
    );

    return { success: true };
  }

  async getAvailability(venueId, date) {
    return await this.redisService.getAvailableSlots(venueId, date);
  }

  async getUserBookings(userId) {
    return await this.bookingModel.findByUser(userId);
  }

  async getPopularVenues() {
    const popularIds = await this.redisService.getPopularVenues(5);
    const venues = [];

    for (let i = 0; i < popularIds.length; i += 2) {
      const venueId = popularIds[i];
      const score = popularIds[i + 1];

      let venue = await this.redisService.getCachedVenue(venueId);
      if (!venue) {
        venue = await this.venueModel.findById(venueId);
      }

      if (venue) {
        venues.push({ ...venue, booking_count: parseInt(score, 10) });
      }
    }

    return venues;
  }

  /* ------------------------------ Queue helpers (optional) ------------------------------
     These integrate the queue_booking.js logic inside this file without altering the
     synchronous createBooking() flow. Use only if you want async processing.
  */

  /**
   * Enqueue a booking confirmation request (producer).
   * payload: { venue_id, date, time, user_id, duration? }
   */
  static async enqueueBooking(redisClient, payload) {
    const STREAM = 'stream:bookings';
    const fields = {
      event: 'confirm',
      venue_id: String(payload.venue_id),
      date: payload.date,
      time: payload.time || payload.start_time,
      user_id: String(payload.user_id),
      duration: String(payload.duration ?? 1)
    };
    // ioredis: XADD stream * key value ...
    const args = ['*', ...Object.entries(fields).flat()];
    const id = await redisClient.xadd(STREAM, ...args);
    return id;
  }

  /**
   * Start a worker that consumes the bookings stream and calls createBooking.
   * This keeps the same atomicity via the embedded RedisService logic.
   */
  static async startQueueWorker(redisClient, bookingService, consumerName = 'w1') {
    const STREAM = 'stream:bookings';
    const GROUP  = 'bookers';

    // Create group if not exists
    try { await redisClient.xgroup('CREATE', STREAM, GROUP, '$', 'MKSTREAM'); } catch {}

    // Simple loop
    /* eslint no-constant-condition: "off" */
    while (true) {
      const res = await redisClient.xreadgroup('GROUP', GROUP, consumerName, 'COUNT', 10, 'BLOCK', 5000, 'STREAMS', STREAM, '>');
      if (!res) continue;

      for (const [stream, messages] of res) {
        for (const [id, fields] of messages) {
          // ioredis returns fields as array [k1, v1, k2, v2, ...] or array of pairs depending on version
          let obj;
          if (Array.isArray(fields)) {
            if (Array.isArray(fields[0])) {
              obj = Object.fromEntries(fields);
            } else {
              // flat array
              obj = {};
              for (let i = 0; i < fields.length; i += 2) obj[fields[i]] = fields[i + 1];
            }
          }

          try {
            const bookingData = {
              venue_id: obj.venue_id,
              date: obj.date,
              start_time: obj.time,
              user_id: obj.user_id,
              duration: obj.duration ? Number(obj.duration) : 1
            };
            await bookingService.createBooking(bookingData);
            await redisClient.xack(STREAM, GROUP, id);
          } catch (e) {
            // Leave unacked for inspection
            // Consider dead-lettering in production
            // eslint-disable-next-line no-console
            console.error('Queue booking failed:', id, e.message);
          }
        }
      }
    }
  }
}

module.exports = BookingService;
