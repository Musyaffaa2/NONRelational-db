const express = require('express');
const database = require('./config/database');
require('dotenv').config();

const app = express();
app.use(express.json());

// Initialize database connections
let bookingService;

async function initializeApp() {
  try {
    const db = await database.connectMongo();
    const redis = await database.connectRedis();
    
    const BookingService = require('./services/BookingService');
    bookingService = new BookingService(db, redis);
    
    console.log('✅ Application initialized');
  } catch (error) {
    console.error('❌ Failed to initialize:', error);
    process.exit(1);
  }
}

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Venue routes
app.post('/api/venues', async (req, res) => {
  try {
    const User = require('./models/User');
    const Venue = require('./models/Venue');
    const venueModel = new Venue(database.getDb());
    
    const venueId = await venueModel.create(req.body);
    res.status(201).json({ success: true, venueId });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/venues/:id', async (req, res) => {
  try {
    const Venue = require('./models/Venue');
    const venueModel = new Venue(database.getDb());
    
    const venue = await venueModel.findById(req.params.id);
    if (!venue) {
      return res.status(404).json({ success: false, error: 'Venue not found' });
    }
    res.json({ success: true, data: venue });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Booking routes
app.get('/api/venues/:venueId/availability/:date', async (req, res) => {
  try {
    const slots = await bookingService.getAvailability(
      req.params.venueId,
      req.params.date
    );
    res.json({ success: true, data: slots });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const result = await bookingService.createBooking(req.body);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.delete('/api/bookings/:id', async (req, res) => {
  try {
    await bookingService.cancelBooking(req.params.id);
    res.json({ success: true, message: 'Booking cancelled' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/users/:userId/bookings', async (req, res) => {
  try {
    const bookings = await bookingService.getUserBookings(req.params.userId);
    res.json({ success: true, data: bookings });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/api/venues/popular', async (req, res) => {
  try {
    const venues = await bookingService.getPopularVenues();
    res.json({ success: true, data: venues });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await database.close();
  process.exit(0);
});

// Start server
const PORT = process.env.PORT || 3000;

initializeApp().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
});