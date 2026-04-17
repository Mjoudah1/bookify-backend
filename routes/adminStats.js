// backend/routes/adminStats.js
const express = require('express');
const User = require('../models/User');
const Book = require('../models/Book');
const auth = require('../middleware/authMiddleware');

const router = express.Router();

/* =========================================================
 📊 ADMIN OVERVIEW STATS  (Admin only)
  GET /api/admin/stats/overview

  ✅ متوافق مع نظام المكتبة الإلكترونية فقط
========================================================= */
router.get('/overview', auth(['admin']), async (req, res) => {
  try {
    const now = new Date();

    const [
      // 👤 Users stats
      totalUsers,
      adminCount,
      userCount,
      activeUsersCount,
      subscribedUsersCount,
      expiredSubscriptionsCount,
      neverActivatedSubscriptionsCount,

      // 📚 Books stats
      totalBooks,
      subscriptionBooksCount,
      paidBooksCount,

      // ⭐ Top rated books
      topRatedBooks,

      // 👁️ Most viewed books
      mostViewedBooks,
    ] = await Promise.all([
      // Users
      User.countDocuments(),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ isActive: true }),

      // ✅ مستخدمين اشتراكهم فعّال حاليًا
      User.countDocuments({
        'subscription.isActive': true,
        'subscription.expiresAt': { $gt: now },
      }),

      // ✅ اشتراكات منتهية (isActive = true لكن التاريخ انتهى)
      User.countDocuments({
        'subscription.isActive': true,
        'subscription.expiresAt': { $lte: now },
      }),

      // ✅ لم يفعل الاشتراك أساسًا
      User.countDocuments({
        'subscription.isActive': false,
      }),

      // Books
      Book.countDocuments(),
      Book.countDocuments({ availableInSubscription: true }),
      Book.countDocuments({ price: { $gt: 0 } }),

      // Top rated
      Book.find({ ratingsCount: { $gt: 0 } })
        .sort({ averageRating: -1, ratingsCount: -1 })
        .limit(5),

      // Most viewed
      Book.find({ views: { $gt: 0 } })
        .sort({ views: -1 })
        .limit(5),
    ]);

    res.json({
      users: {
        total: totalUsers,
        admins: adminCount,
        regularUsers: userCount,
        active: activeUsersCount,
        // 🟦 إضافات خاصة بالاشتراك
        subscribed: subscribedUsersCount, // اشتراك فعّال الآن
        subscriptions: {
          active: subscribedUsersCount,
          expired: expiredSubscriptionsCount,
          inactive: neverActivatedSubscriptionsCount,
        },
      },
      books: {
        total: totalBooks,
        availableInSubscription: subscriptionBooksCount,
        paidBooks: paidBooksCount,
      },
      topRated: topRatedBooks.map((b) => ({
        id: b._id,
        title: b.title,
        author: b.author,
        averageRating: b.averageRating,
        ratingsCount: b.ratingsCount,
      })),
      mostViewed: mostViewedBooks.map((b) => ({
        id: b._id,
        title: b.title,
        author: b.author,
        views: b.views,
        averageRating: b.averageRating,
      })),
      generatedAt: new Date(),
    });
  } catch (error) {
    console.error('❌ Admin stats overview error:', error);
    res.status(500).json({
      message: 'Server error while fetching admin stats overview.',
      error: error.message,
    });
  }
});

module.exports = router;
