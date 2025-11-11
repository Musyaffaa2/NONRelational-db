class RedisService {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  // Initialize available time slots for a venue
  async initializeSlots(venueId, date) {
    const key = `venue:${venueId}:slots:${date}`;
    const slots = [];
    
    for (let hour = 9; hour <= 20; hour++) {
      slots.push(`${hour.toString().padStart(2, '0')}:00`);
    }

    if (slots.length > 0) {
      await this.redis.sadd(key, ...slots);
      await this.redis.expire(key, 86400 * 30); // 30 days
    }
    
    return slots;
  }

  // Get available slots
  async getAvailableSlots(venueId, date) {
    const key = `venue:${venueId}:slots:${date}`;
    const exists = await this.redis.exists(key);
    
    if (!exists) {
      return await this.initializeSlots(venueId, date);
    }
    
    return await this.redis.smembers(key);
  }

  // Acquire booking lock
  async acquireLock(venueId, date, startTime, ttl = 300) {
    const lockKey = `lock:venue:${venueId}:${date}:${startTime}`;
    const result = await this.redis.set(lockKey, '1', 'EX', ttl, 'NX');
    return result === 'OK';
  }

  // Release booking lock
  async releaseLock(venueId, date, startTime) {
    const lockKey = `lock:venue:${venueId}:${date}:${startTime}`;
    await this.redis.del(lockKey);
  }

  // Remove slot (mark as booked)
  async removeSlot(venueId, date, startTime) {
    const key = `venue:${venueId}:slots:${date}`;
    await this.redis.srem(key, startTime);
  }

  // Add slot back (for cancellations)
  async addSlot(venueId, date, startTime) {
    const key = `venue:${venueId}:slots:${date}`;
    await this.redis.sadd(key, startTime);
  }

  // Cache venue data
  async cacheVenue(venueId, venueData, ttl = 3600) {
    const key = `cache:venue:${venueId}`;
    await this.redis.setex(key, ttl, JSON.stringify(venueData));
  }

  // Get cached venue
  async getCachedVenue(venueId) {
    const key = `cache:venue:${venueId}`;
    const cached = await this.redis.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  // Track popular venues
  async incrementVenuePopularity(venueId) {
    await this.redis.zincrby('cache:popular:venues', 1, venueId);
  }

  // Get popular venues
  async getPopularVenues(limit = 5) {
    return await this.redis.zrevrange('cache:popular:venues', 0, limit - 1, 'WITHSCORES');
  }
}

module.exports = RedisService;
