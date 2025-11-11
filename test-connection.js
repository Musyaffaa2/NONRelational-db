const { MongoClient } = require('mongodb');
const Redis = require('ioredis');

async function testConnections() {
  console.log('🔍 Testing database connections...\n');
  
  // Test MongoDB
  try {
    const mongoClient = await MongoClient.connect('mongodb://localhost:27017');
    console.log('✅ MongoDB connected successfully!');
    await mongoClient.close();
  } catch (error) {
    console.log('❌ MongoDB connection failed:', error.message);
  }
  
  // Test Redis
  try {
    const redis = new Redis('redis://localhost:6380');
    await redis.ping();
    console.log('✅ Redis connected successfully!');
    await redis.quit();
  } catch (error) {
    console.log('❌ Redis connection failed:', error.message);
  }
}

testConnections();