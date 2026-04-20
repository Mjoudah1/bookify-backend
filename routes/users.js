// backend/routes/users.js
const express = require('express');
const User = require('../models/User');
const Book = require('../models/Book'); // 👈 مهم
const auth = require('../middleware/authMiddleware');

const router = express.Router();

/* =========================================================
 🧼 Helper: sanitize user before sending to client
   - يحذف الباسورد + جواب الأمان المشفّر
   - يبقي subscription + isSubscribed (virtual)
========================================================= */
const sanitizeUser = (user) => {
  const obj = user.toObject({ virtuals: true });
  delete obj.password;
  delete obj.securityAnswer;
  return obj;
};

/* =========================================================
 📚 Helper: format book with URLs (للـ My Books)
========================================================= */
const mapBookWithUrls = (req, bookDoc) => {
  if (!bookDoc) return null;

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const b = bookDoc.toObject ? bookDoc.toObject() : bookDoc;

  if (b._id && (b.coverImageData || b.coverImage)) {
    b.coverImageUrl = `${baseUrl}/api/books/${b._id}/cover`;
  } else {
    b.coverImageUrl = null;
  }

  if (b.ebookFile) {
    b.ebookUrl = `${baseUrl}/uploads/ebooks/${b.ebookFile}`;
  } else {
    b.ebookUrl = null;
  }

  return b;
};

/* =========================================================
 👥 GET ALL USERS (Admin only)
  GET /api/users
========================================================= */
router.get('/', auth(['admin']), async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users.map(sanitizeUser));
  } catch (error) {
    console.error('❌ Error fetching users:', error);
    res.status(500).json({
      message: 'Error fetching users.',
      error: error.message,
    });
  }
});

/* =========================================================
 📚 GET MY BOOKS (User & Admin)
  GET /api/users/my-books

  - لو user عادي → يرجّع الكتب اللي في:
      user.purchasedBooks + user.ownedBooks
  - لو admin → يرجّع كل الكتب الموجودة في النظام
========================================================= */
router.get('/my-books', auth(['user', 'admin']), async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    // نجيب اليوزر بس عشان نعرف إذا هو admin أو لا
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // 👇 لو أدمن → رجّع كل الكتب
    if (String(user.role).toLowerCase() === 'admin') {
      const allBooks = await Book.find().sort({ createdAt: -1 });
      const formattedAll = allBooks.map((b) => mapBookWithUrls(req, b));
      return res.json(formattedAll);
    }

    // 👇 يوزر عادي → نرجّع الكتب اللي يملكها فقط
    const populatedUser = await User.findById(userId)
      .populate('purchasedBooks')
      .populate('ownedBooks');

    const rawBooks = [
      ...(populatedUser.purchasedBooks || []),
      ...(populatedUser.ownedBooks || []),
    ];

    const seen = new Set();
    const uniqueBooks = rawBooks.filter((b) => {
      const id = b._id.toString();
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const formatted = uniqueBooks.map((b) => mapBookWithUrls(req, b));
    return res.json(formatted);
  } catch (error) {
    console.error('❌ Error fetching my books:', error);
    res.status(500).json({
      message: 'Server error while loading user books.',
      error: error.message,
    });
  }
});

/* =========================================================
 ➕ CREATE USER (Admin only)
  POST /api/users
========================================================= */
router.post('/', auth(['admin']), async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      role,
      securityQuestion,
      securityAnswer,
    } = req.body;

    if (!username || !email || !password || !securityQuestion || !securityAnswer) {
      return res.status(400).json({
        message:
          'Username, email, password, security question and security answer are required.',
      });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res
        .status(400)
        .json({ message: 'User with this email already exists.' });
    }

    // ✅ only allow admin / user
    const allowedRoles = ['admin', 'user'];
    const finalRole = allowedRoles.includes(role) ? role : 'user';

    const user = new User({
      username,
      email,
      password, // will be hashed by pre-save hook
      role: finalRole,
      securityQuestion,
      securityAnswer,
      mustChangePassword: true,
      temporaryPasswordIssuedAt: new Date(),
      // اشتراك افتراضي
      subscription: {
        isActive: false,
        plan: 'none',
        expiresAt: null,
      },
      ownedBooks: [],
    });

    await user.save();

    res.status(201).json({
      message: '✅ User created successfully. The password is temporary until the user changes it.',
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('❌ Error creating user:', error);
    res.status(500).json({
      message: 'Error creating user.',
      error: error.message,
    });
  }
});

/* =========================================================
 ✏️ UPDATE USER (Admin only)
  PATCH /api/users/:id
========================================================= */
router.patch('/:id', auth(['admin']), async (req, res) => {
  try {
    const { role, isActive, username, subscription } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    // ✅ Update role
    if (role) {
      const allowedRoles = ['admin', 'user'];
      if (!allowedRoles.includes(role)) {
        return res
          .status(400)
          .json({ message: 'Invalid role. Allowed roles are admin or user.' });
      }
      user.role = role;
    }

    // ✅ Update isActive
    if (typeof isActive === 'boolean') {
      user.isActive = isActive;
    }

    // ✅ Update username
    if (username) {
      user.username = username;
    }

    // ✅ Initialize subscription object if missing
    if (!user.subscription) {
      user.subscription = {
        isActive: false,
        plan: 'none',
        expiresAt: null,
        expiryNotifiedAt: null,
      };
    }

    // ✅ Update subscription fields
    if (subscription && typeof subscription === 'object') {
      if (typeof subscription.isActive === 'boolean') {
        user.subscription.isActive = subscription.isActive;
      }

      if (subscription.plan) {
        const allowedPlans = [
          'none',
          'monthly',
          'quarterly',
          'semiannual',
          'yearly',
        ];
        if (!allowedPlans.includes(subscription.plan)) {
          return res.status(400).json({
            message:
              'Invalid subscription plan. Allowed: none, monthly, quarterly, semiannual, yearly.',
          });
        }
        user.subscription.plan = subscription.plan;
      }

      if (subscription.expiresAt !== undefined) {
        if (subscription.expiresAt === null || subscription.expiresAt === '') {
          user.subscription.expiresAt = null;
        } else {
          const expDate = new Date(subscription.expiresAt);
          if (isNaN(expDate.getTime())) {
            return res.status(400).json({
              message: 'Invalid subscription expiresAt date.',
            });
          }
          user.subscription.expiresAt = expDate;
        }
      }
    }

    await user.save();

    res.json({
      message: '✅ User updated successfully.',
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('❌ Error updating user:', error);
    res.status(500).json({
      message: 'Error updating user.',
      error: error.message,
    });
  }
});

router.post('/:id/cancel-subscription', auth(['admin']), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (String(user.role).toLowerCase() !== 'user') {
      return res.status(400).json({
        message: 'Subscription cancellation is available for normal users only.',
      });
    }

    user.subscription = {
      isActive: false,
      plan: 'none',
      expiresAt: null,
      expiryNotifiedAt: null,
    };

    await user.save();

    res.json({
      message: 'Subscription cancelled successfully.',
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    res.status(500).json({
      message: 'Error cancelling subscription.',
      error: error.message,
    });
  }
});

/* =========================================================
 🗑️ DELETE USER (Admin only)
  DELETE /api/users/:id
========================================================= */
router.delete('/:id', auth(['admin']), async (req, res) => {
  try {
    // prevent deleting yourself
    if (req.user.id === req.params.id) {
      return res
        .status(400)
        .json({ message: 'You cannot delete your own admin account.' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found.' });

    await user.deleteOne();

    res.json({ message: '✅ User deleted successfully.' });
  } catch (error) {
    console.error('❌ Error deleting user:', error);
    res.status(500).json({
      message: 'Error deleting user.',
      error: error.message,
    });
  }
});

module.exports = router;
