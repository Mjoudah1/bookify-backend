// backend/server.js
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');

dotenv.config();

const app = express();

// ✅ CORS FIX (Production + Local)
const allowedOrigins = [
  'http://localhost:3000',
  'https://bookify-frontend.vercel.app',
];

app.use(
  cors({
    origin: function (origin, callback) {
      // يسمح للطلبات بدون origin (مثل Postman)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Connect DB
connectDB();

// Static files
app.use(
  '/uploads/covers',
  express.static(path.join(__dirname, 'uploads', 'covers'))
);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/books', require('./routes/books'));
app.use('/api/users', require('./routes/users'));
app.use('/api/admin/stats', require('./routes/adminStats'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/messages', require('./routes/messages'));

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Bookify Electronic Library API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      books: '/api/books',
      users: '/api/users',
      adminStats: '/api/admin/stats',
      transactions: '/api/transactions',
      notifications: '/api/notifications',
      messages: '/api/messages',
    },
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server Error:', err.stack);
  res
    .status(500)
    .json({ message: 'Internal Server Error', error: err.message });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});