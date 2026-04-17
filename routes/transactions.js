const express = require('express');
const router = express.Router();

const Transaction = require('../models/Transaction');
const Book = require('../models/Book');
const User = require('../models/User');
const auth = require('../middleware/authMiddleware');
const {
  SUBSCRIPTION_PLANS,
  addMonths,
  getSubscriptionPlan,
  validateVirtualVisa,
} = require('../utils/virtualPayment');

router.get('/subscription-plans', auth(['user', 'admin']), async (req, res) => {
  res.json({
    plans: Object.values(SUBSCRIPTION_PLANS),
  });
});

router.post('/subscribe', auth(['user', 'admin']), async (req, res) => {
  try {
    const { plan, payment } = req.body;
    const selectedPlan = getSubscriptionPlan(plan);

    if (!selectedPlan) {
      return res.status(400).json({
        message: 'Invalid subscription plan selected.',
      });
    }

    const paymentCheck = validateVirtualVisa(payment);
    if (!paymentCheck.ok) {
      return res.status(400).json({
        message: paymentCheck.message,
      });
    }

    const user = await User.findById(req.user.id || req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const now = new Date();
    const currentExpiry = user.subscription?.expiresAt;
    const baseDate =
      currentExpiry && new Date(currentExpiry) > now
        ? new Date(currentExpiry)
        : now;

    const nextExpiry = addMonths(baseDate, selectedPlan.months);
    const isRenewal =
      !!user.subscription?.expiresAt &&
      new Date(user.subscription.expiresAt) > now;

    user.subscription = {
      isActive: true,
      plan: selectedPlan.key,
      expiresAt: nextExpiry,
      expiryNotifiedAt: null,
      expiryWarningNotifiedAt: null,
      expiryAdminWarningNotifiedAt: null,
    };

    await user.save();

    const transaction = await Transaction.create({
      userId: user._id,
      type: isRenewal ? 'subscription_renew' : 'subscription',
      amountPaid: selectedPlan.price,
      viaSubscription: false,
      accessedAt: new Date(),
      meta: {
        plan: selectedPlan.key,
        planLabel: selectedPlan.label,
        months: selectedPlan.months,
        paymentMethod: paymentCheck.payment.gateway,
        cardBrand: paymentCheck.payment.brand,
        cardLast4: paymentCheck.payment.last4,
      },
    });

    return res.json({
      message: isRenewal
        ? 'Subscription renewed successfully.'
        : 'Subscription activated successfully.',
      subscription: user.subscription,
      transaction,
    });
  } catch (error) {
    console.error('Subscription purchase error:', error);
    return res.status(500).json({
      message: 'Server error while activating subscription.',
      error: error.message,
    });
  }
});

router.post('/subscription', auth(['user', 'admin']), async (req, res) => {
  try {
    const { bookId } = req.body;

    if (!bookId) {
      return res.status(400).json({ message: 'Book ID is required.' });
    }

    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ message: 'Book not found.' });
    }

    if (!book.availableInSubscription) {
      return res.status(400).json({
        message: 'This e-book is not available in the subscription plan.',
      });
    }

    const user = req.user;
    const hasActiveSub =
      user.isSubscribed ??
      (user.subscription &&
        user.subscription.isActive &&
        user.subscription.expiresAt &&
        new Date(user.subscription.expiresAt) > new Date());

    if (!hasActiveSub) {
      return res.status(403).json({
        message: 'You need an active subscription to access this e-book.',
      });
    }

    if (!book.ebookFile) {
      return res.status(404).json({
        message: 'This e-book does not have a file attached.',
      });
    }

    const tx = await Transaction.create({
      userId: user._id,
      bookId: book._id,
      type: 'read',
      viaSubscription: true,
      amountPaid: 0,
      accessedAt: new Date(),
      meta: {
        from: 'subscription',
      },
    });

    res.json({
      message: 'Access via subscription recorded successfully.',
      transaction: tx,
    });
  } catch (error) {
    console.error('Subscription access transaction error:', error);
    res.status(500).json({
      message: 'Server error while creating subscription transaction.',
      error: error.message,
    });
  }
});

router.post('/buy', auth(['user', 'admin']), async (req, res) => {
  try {
    const { bookId, amountPaid } = req.body;

    if (!bookId) {
      return res.status(400).json({ message: 'Book ID is required.' });
    }

    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ message: 'Book not found.' });
    }

    const user = req.user;

    const alreadyOwned = (user.ownedBooks || []).some(
      (b) => b.toString() === book._id.toString()
    );
    if (alreadyOwned) {
      return res.status(400).json({
        message: 'You already own this e-book.',
      });
    }

    const paid =
      typeof amountPaid !== 'undefined' && amountPaid !== null
        ? Number(amountPaid)
        : Number(book.price) || 0;

    const tx = await Transaction.create({
      userId: user._id,
      bookId: book._id,
      type: 'buy',
      amountPaid: paid,
      viaSubscription: false,
      accessedAt: new Date(),
      meta: {
        source: 'direct_purchase',
      },
    });

    user.ownedBooks.push(book._id);
    await user.save();

    res.json({
      message: 'E-book purchase recorded successfully.',
      transaction: tx,
    });
  } catch (error) {
    console.error('Buy transaction error:', error);
    res.status(500).json({
      message: 'Server error while creating buy transaction.',
      error: error.message,
    });
  }
});

router.get('/my', auth(['user', 'admin']), async (req, res) => {
  try {
    const txs = await Transaction.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .populate('bookId', 'title author isbn price');

    res.json(txs);
  } catch (error) {
    console.error('My transactions error:', error);
    res.status(500).json({
      message: 'Server error while fetching your transactions.',
      error: error.message,
    });
  }
});

router.get('/', auth(['admin']), async (req, res) => {
  try {
    const txs = await Transaction.find()
      .sort({ createdAt: -1 })
      .populate('userId', 'username email role')
      .populate('bookId', 'title author isbn price');

    res.json(txs);
  } catch (error) {
    console.error('Get all transactions error:', error);
    res.status(500).json({
      message: 'Server error while fetching transactions.',
      error: error.message,
    });
  }
});

module.exports = router;
