const { ObjectId } = require('mongodb');

class Booking {
  constructor(db) {
    this.collection = db.collection('bookings');
  }

  async create(bookingData) {
    const booking = {
      ...bookingData,
      venue_id: new ObjectId(bookingData.venue_id),
      user_id: new ObjectId(bookingData.user_id),
      created_at: new Date(),
      updated_at: new Date()
    };
    const result = await this.collection.insertOne(booking);
    return result.insertedId;
  }

  async findById(bookingId) {
    return await this.collection.findOne({ _id: new ObjectId(bookingId) });
  }

  async findByUser(userId) {
    return await this.collection
      .find({ user_id: new ObjectId(userId) })
      .sort({ date: -1 })
      .toArray();
  }

  async findByVenue(venueId, date = null) {
    const query = { venue_id: new ObjectId(venueId) };
    if (date) {
      query.date = date;
    }
    return await this.collection.find(query).toArray();
  }

  async updateStatus(bookingId, status) {
    return await this.collection.updateOne(
      { _id: new ObjectId(bookingId) },
      { 
        $set: { 
          status, 
          updated_at: new Date() 
        } 
      }
    );
  }

  async delete(bookingId) {
    return await this.collection.deleteOne({ _id: new ObjectId(bookingId) });
  }

  async getBookingStats(venueId, startDate, endDate) {
    return await this.collection.aggregate([
      {
        $match: {
          venue_id: new ObjectId(venueId),
          date: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          total_revenue: { $sum: '$total_price' }
        }
      }
    ]).toArray();
  }
}

module.exports = Booking;