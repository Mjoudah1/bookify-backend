const User = require('../models/User');
const Notification = require('../models/Notification');
const EXPIRY_WARNING_WINDOW_DAYS = 3;

const notifyUserAboutExpiringSubscription = async (userLike) => {
  try {
    if (!userLike) return false;

    const userId = userLike._id || userLike.id;
    const role = String(userLike.role || '').toLowerCase();
    const subscription = userLike.subscription || {};
    const expiresAt = subscription.expiresAt
      ? new Date(subscription.expiresAt)
      : null;

    if (!userId || role !== 'user' || !subscription.isActive || !expiresAt) {
      return false;
    }

    const now = new Date();
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
      return false;
    }

    const warningWindowMs =
      EXPIRY_WARNING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const remainingMs = expiresAt.getTime() - now.getTime();

    if (remainingMs > warningWindowMs) {
      return false;
    }

    const updatedUser = await User.findOneAndUpdate(
      {
        _id: userId,
        role: 'user',
        'subscription.isActive': true,
        'subscription.expiresAt': { $gt: now, $lte: new Date(now.getTime() + warningWindowMs) },
        $or: [
          { 'subscription.expiryWarningNotifiedAt': { $exists: false } },
          { 'subscription.expiryWarningNotifiedAt': null },
          { 'subscription.expiryWarningNotifiedAt': { $lt: expiresAt } },
        ],
      },
      {
        $set: {
          'subscription.expiryWarningNotifiedAt': expiresAt,
        },
      },
      {
        new: true,
      }
    ).select('_id username email subscription');

    if (!updatedUser) {
      return false;
    }

    const expiryLabel = updatedUser.subscription?.expiresAt
      ? new Date(updatedUser.subscription.expiresAt).toLocaleDateString()
      : 'soon';

    await Notification.create({
      userId: updatedUser._id,
      title: 'Subscription Ending Soon',
      message: `Your subscription will expire on ${expiryLabel}. Renew soon to keep access to subscription books.`,
      sentBy: updatedUser._id,
      targetPath: '/user',
    });

    return true;
  } catch (error) {
    console.error('Expiring subscription user notification error:', error);
    return false;
  }
};

const notifyAdminsAboutExpiredSubscription = async (userLike) => {
  try {
    if (!userLike) return false;

    const userId = userLike._id || userLike.id;
    const role = String(userLike.role || '').toLowerCase();
    const subscription = userLike.subscription || {};
    const expiresAt = subscription.expiresAt ? new Date(subscription.expiresAt) : null;

    if (!userId || role !== 'user' || !subscription.isActive || !expiresAt) {
      return false;
    }

    if (Number.isNaN(expiresAt.getTime()) || expiresAt > new Date()) {
      return false;
    }

    const updatedUser = await User.findOneAndUpdate(
      {
        _id: userId,
        role: 'user',
        'subscription.isActive': true,
        'subscription.expiresAt': { $lte: new Date() },
        $or: [
          { 'subscription.expiryNotifiedAt': { $exists: false } },
          { 'subscription.expiryNotifiedAt': null },
          { 'subscription.expiryNotifiedAt': { $lt: expiresAt } },
        ],
      },
      {
        $set: {
          'subscription.isActive': false,
          'subscription.expiryNotifiedAt': new Date(),
        },
      },
      {
        new: true,
      }
    ).select('email username subscription');

    if (!updatedUser) {
      return false;
    }

    const admins = await User.find({
      role: 'admin',
      isActive: true,
    }).select('_id');

    if (!admins.length) {
      return false;
    }

    const title = 'Subscription Expired';
    const message = `The subscription for user ${updatedUser.email} has expired.`;

    await Notification.insertMany(
      admins.map((admin) => ({
        userId: admin._id,
        title,
        message,
        sentBy: updatedUser._id,
      }))
    );

    return true;
  } catch (error) {
    console.error('Expired subscription admin notification error:', error);
    return false;
  }
};

const notifyAdminsAboutExpiringSubscription = async (userLike) => {
  try {
    if (!userLike) return false;

    const userId = userLike._id || userLike.id;
    const role = String(userLike.role || '').toLowerCase();
    const subscription = userLike.subscription || {};
    const expiresAt = subscription.expiresAt
      ? new Date(subscription.expiresAt)
      : null;

    if (!userId || role !== 'user' || !subscription.isActive || !expiresAt) {
      return false;
    }

    const now = new Date();
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
      return false;
    }

    const warningWindowMs =
      EXPIRY_WARNING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const warningWindowEnd = new Date(now.getTime() + warningWindowMs);

    if (expiresAt > warningWindowEnd) {
      return false;
    }

    const updatedUser = await User.findOneAndUpdate(
      {
        _id: userId,
        role: 'user',
        'subscription.isActive': true,
        'subscription.expiresAt': { $gt: now, $lte: warningWindowEnd },
        $or: [
          { 'subscription.expiryAdminWarningNotifiedAt': { $exists: false } },
          { 'subscription.expiryAdminWarningNotifiedAt': null },
          { 'subscription.expiryAdminWarningNotifiedAt': { $lt: expiresAt } },
        ],
      },
      {
        $set: {
          'subscription.expiryAdminWarningNotifiedAt': expiresAt,
        },
      },
      {
        new: true,
      }
    ).select('_id username email subscription');

    if (!updatedUser) {
      return false;
    }

    const admins = await User.find({
      role: 'admin',
      isActive: true,
    }).select('_id');

    if (!admins.length) {
      return false;
    }

    const displayName = updatedUser.username || 'User';
    const expiryLabel = updatedUser.subscription?.expiresAt
      ? new Date(updatedUser.subscription.expiresAt).toLocaleDateString()
      : 'soon';

    await Notification.insertMany(
      admins.map((admin) => ({
        userId: admin._id,
        title: 'Subscription Ending Soon',
        message: `User ${displayName} (${updatedUser.email}) has a subscription ending on ${expiryLabel}.`,
        sentBy: updatedUser._id,
        targetPath: '/admin',
      }))
    );

    return true;
  } catch (error) {
    console.error('Expiring subscription admin notification error:', error);
    return false;
  }
};

module.exports = {
  notifyAdminsAboutExpiringSubscription,
  notifyUserAboutExpiringSubscription,
  notifyAdminsAboutExpiredSubscription,
};
