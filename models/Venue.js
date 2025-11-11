const { ObjectId } = require('mongodb');

class Venue {
  constructor(db) {
    this.collection = db.collection('venues');
  }

  async create(venueData) {
    const venue = {
      ...venueData,
      created_at: new Date(),
      updated_at: new Date()
    };
    const result = await this.collection.insertOne(venue);
    return result.insertedId;
  }

  async findById(venueId) {
    return await this.collection.findOne({ _id: new ObjectId(venueId) });
  }

  async update(venueId, updateData) {
    return await this.collection.updateOne(
      { _id: new ObjectId(venueId) },
      { 
        $set: { 
          ...updateData, 
          updated_at: new Date() 
        } 
      }
    );
  }

  async delete(venueId) {
    return await this.collection.deleteOne({ _id: new ObjectId(venueId) });
  }

  async list(filter = {}, limit = 10, skip = 0) {
    return await this.collection
      .find(filter)
      .limit(limit)
      .skip(skip)
      .toArray();
  }

  async search(query) {
    return await this.collection
      .find({
        $or: [
          { name: { $regex: query, $options: 'i' } },
          { description: { $regex: query, $options: 'i' } }
        ]
      })
      .toArray();
  }
}

module.exports = Venue;