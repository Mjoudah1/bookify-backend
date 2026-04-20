const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');

dotenv.config();

const app = express();
app.set('trust proxy', 1);

const DEFAULT_FRONTEND_URL = 'https://bookify-frontend-877g.vercel.app';

const allowedOrigins = [
  'http://localhost:3000',
  DEFAULT_FRONTEND_URL,
  process.env.FRONTEND_URL,
  ...(process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim())
    : []),
].filter(Boolean);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    return /\.vercel\.app$/i.test(parsed.hostname);
  } catch {
    return false;
  }
};

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

connectDB();

app.use(
  '/uploads/covers',
  express.static(path.join(__dirname, 'uploads', 'covers'))
);

app.use('/api/auth', require('./routes/auth'));
app.use('/api/books', require('./routes/books'));
app.use('/api/users', require('./routes/users'));
app.use('/api/admin/stats', require('./routes/adminStats'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/messages', require('./routes/messages'));

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

app.use((err, req, res, next) => {
  console.error('Server Error:', err.stack);
  res
    .status(500)
    .json({ message: 'Internal Server Error', error: err.message });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
