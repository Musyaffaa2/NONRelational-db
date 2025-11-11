const RedisService = require('./RedisService');
const Venue = require('../models/Venue');
const Booking = require('../models/Booking');

class BookingService {
  constructor(db, redis) {
    this.redisService = new RedisService(redis);
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

      // 5. Create booking in MongoDB
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

    // Update status in MongoDB
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
        venues.push({ ...venue, booking_count: parseInt(score) });
      }
    }

    return venues;
  }
}

module.exports = BookingService;