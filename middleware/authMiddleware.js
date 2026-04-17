const jwt = require('jsonwebtoken');
const User = require('../models/User');
const {
  notifyAdminsAboutExpiringSubscription,
  notifyUserAboutExpiringSubscription,
  notifyAdminsAboutExpiredSubscription,
} = require('../utils/subscriptionNotifier');

const JWT_SECRET = process.env.JWT_SECRET || 'secretkey';

const auth = (allowedRoles = []) => {
  return async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'No token provided' });
      }

      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      const userId = decoded.id || decoded._id;

      const user = await User.findById(userId);

      if (!user) {
        return res.status(401).json({ message: 'User not found' });
      }

      await notifyAdminsAboutExpiredSubscription(user);
      await notifyAdminsAboutExpiringSubscription(user);
      await notifyUserAboutExpiringSubscription(user);

      if (user.isActive === false) {
        return res.status(403).json({
          message: 'This account has been deactivated.',
        });
      }

      const currentPath = req.originalUrl || req.path || '';
      const isPasswordChangeFlow =
        currentPath.startsWith('/api/auth/change-password') ||
        currentPath.startsWith('/api/auth/me');

      if (user.mustChangePassword && !isPasswordChangeFlow) {
        return res.status(403).json({
          message:
            'You must change the temporary password assigned by the admin before continuing.',
          mustChangePassword: true,
        });
      }

      let isSubscribed = false;

      if (typeof user.isSubscribed === 'boolean') {
        isSubscribed = user.isSubscribed;
      }

      if (user.subscription) {
        const { isActive, expiresAt } = user.subscription;

        if (
          isActive === true &&
          (!expiresAt || new Date(expiresAt) > new Date())
        ) {
          isSubscribed = true;
        }
      }

      const plainUser = user.toObject ? user.toObject() : user;

      req.user = {
        ...plainUser,
        id: plainUser._id ? plainUser._id.toString() : userId,
        isSubscribed,
      };

      if (Array.isArray(allowedRoles) && allowedRoles.length > 0) {
        if (!allowedRoles.includes(user.role)) {
          return res
            .status(403)
            .json({ message: 'Access denied: insufficient role' });
        }
      }

      next();
    } catch (error) {
      console.error('Invalid token or auth middleware error:', error);
      return res.status(401).json({
        message: 'Invalid or expired token',
        error: error.message,
      });
    }
  };
};

module.exports = auth;
