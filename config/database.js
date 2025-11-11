const { MongoClient } = require('mongodb');
const Redis = require('ioredis');
require('dotenv').config();

class Database {
  constructor() {
    this.mongoClient = null;
    this.db = null;
    this.redis = null;
  }

  async connectMongo() {
    try {
      // HAPUS useNewUrlParser dan useUnifiedTopology
      this.mongoClient = await MongoClient.connect(process.env.MONGODB_URI);
      this.db = this.mongoClient.db();
      console.log('✅ MongoDB connected');
      await this.createIndexes();
      return this.db;
    } catch (error) {
      console.error('❌ MongoDB connection error:', error);
      throw error;
    }
  }

  async connectRedis() {
    try {
      this.redis = new Redis(process.env.REDIS_URI);
      this.redis.on('connect', () => {
        console.log('✅ Redis connected');
      });
      this.redis.on('error', (err) => {
        console.error('❌ Redis error:', err);
      });
      return this.redis;
    } catch (error) {
      console.error('❌ Redis connection error:', error);
      throw error;
    }
  }

  async createIndexes() {
    await this.db.collection('bookings').createIndex({ 
      venue_id: 1, 
      date: 1, 
      start_time: 1 
    });
    await this.db.collection('bookings').createIndex({ user_id: 1 });
    await this.db.collection('users').createIndex({ email: 1 }, { unique: true });
    await this.db.collection('venues').createIndex({ name: 1 });
  }

  getDb() {
    return this.db;
  }

  getRedis() {
    return this.redis;
  }

  async close() {
    if (this.mongoClient) await this.mongoClient.close();
    if (this.redis) await this.redis.quit();
    console.log('🔌 Database connections closed');
  }
}

module.exports = new Database();