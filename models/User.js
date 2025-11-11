const { ObjectId } = require('mongodb');

class User {
  constructor(db) {
    this.collection = db.collection('users');
  }

  async create(userData) {
    const user = {
      ...userData,
      created_at: new Date(),
      updated_at: new Date()
    };
    const result = await this.collection.insertOne(user);
    return result.insertedId;
  }

  async findById(userId) {
    return await this.collection.findOne({ _id: new ObjectId(userId) });
  }

  async findByEmail(email) {
    return await this.collection.findOne({ email });
  }

  async update(userId, updateData) {
    return await this.collection.updateOne(
      { _id: new ObjectId(userId) },
      { 
        $set: { 
          ...updateData, 
          updated_at: new Date() 
        } 
      }
    );
  }

  async delete(userId) {
    return await this.collection.deleteOne({ _id: new ObjectId(userId) });
  }

  async list(filter = {}, limit = 10, skip = 0) {
    return await this.collection
      .find(filter)
      .limit(limit)
      .skip(skip)
      .toArray();
  }
}

module.exports = User;