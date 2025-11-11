const database = require('../config/database');
const BookingService = require('../services/BookingService');
const User = require('../models/User');
const Venue = require('../models/Venue');

async function runTests() {
  try {
    console.log('🧪 Starting booking system tests...\n');
    
    // Connect databases
    const db = await database.connectMongo();
    const redis = await database.connectRedis();

    const userModel = new User(db);
    const venueModel = new Venue(db);
    const bookingService = new BookingService(db, redis);

    // Test 1: Create User
    console.log('📝 Test 1: Create User');
    const userId = await userModel.create({
      name: 'Test User',
      email: `test${Date.now()}@example.com`,
      phone: '081234567890'
    });
    console.log('✅ User created:', userId.toString());

    // Test 2: Create Venue
    console.log('\n📝 Test 2: Create Venue');
    const venueId = await venueModel.create({
      name: 'Meeting Room A',
      description: 'Modern meeting room with projector',
      capacity: 10,
      price_per_hour: 100000,
      amenities: ['Projector', 'Whiteboard', 'AC']
    });
    console.log('✅ Venue created:', venueId.toString());

    // Test 3: Check Availability
    console.log('\n📝 Test 3: Check Initial Availability');
    const date = '2025-11-15';
    const slots = await bookingService.getAvailability(venueId.toString(), date);
    console.log('✅ Available slots:', slots.length, 'slots');
    console.log('   Slots:', slots.slice(0, 5).join(', '), '...');

    // Test 4: Create Booking
    console.log('\n📝 Test 4: Create Booking');
    const booking = await bookingService.createBooking({
      user_id: userId.toString(),
      venue_id: venueId.toString(),
      date: date,
      start_time: '10:00',
      duration: 2
    });
    console.log('✅ Booking created:', booking.bookingId.toString());
    console.log('   Total price: Rp', booking.total_price.toLocaleString('id-ID'));

    // Test 5: Check Availability After Booking
    console.log('\n📝 Test 5: Check Availability After Booking');
    const slotsAfter = await bookingService.getAvailability(venueId.toString(), date);
    console.log('✅ Remaining slots:', slotsAfter.length, 'slots');
    console.log('   10:00 slot removed:', !slotsAfter.includes('10:00'));

    // Test 6: Get User Bookings
    console.log('\n📝 Test 6: Get User Bookings');
    const userBookings = await bookingService.getUserBookings(userId.toString());
    console.log('✅ User has', userBookings.length, 'booking(s)');

    // Test 7: Try Double Booking (Should Fail)
    console.log('\n📝 Test 7: Try Double Booking (Should Fail)');
    try {
      await bookingService.createBooking({
        user_id: userId.toString(),
        venue_id: venueId.toString(),
        date: date,
        start_time: '10:00',
        duration: 1
      });
      console.log('❌ Double booking should have failed!');
    } catch (error) {
      console.log('✅ Double booking prevented:', error.message);
    }

    // Test 8: Cancel Booking
    console.log('\n📝 Test 8: Cancel Booking');
    await bookingService.cancelBooking(booking.bookingId.toString());
    console.log('✅ Booking cancelled successfully');

    // Test 9: Check Availability After Cancel
    console.log('\n📝 Test 9: Check Availability After Cancel');
    const slotsRestored = await bookingService.getAvailability(venueId.toString(), date);
    console.log('✅ Slots restored:', slotsRestored.length, 'slots');
    console.log('   10:00 slot restored:', slotsRestored.includes('10:00'));

    // Test 10: Popular Venues
    console.log('\n📝 Test 10: Get Popular Venues');
    const popular = await bookingService.getPopularVenues();
    console.log('✅ Popular venues count:', popular.length);

    console.log('\n🎉 All tests passed successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    console.error('Stack:', error.stack);
  } finally {
    await database.close();
    process.exit(0);
  }
}

runTests();