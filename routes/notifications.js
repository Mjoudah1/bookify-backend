const express = require('express');
const router = express.Router();

const Notification = require('../models/Notification');
const User = require('../models/User');
const auth = require('../middleware/authMiddleware');

router.post('/send', auth(['admin']), async (req, res) => {
  try {
    const { target, title, message } = req.body;

    if (!target || !title || !message) {
      return res.status(400).json({
        message: 'Recipient, title and message are required.',
      });
    }

    if (target === 'broadcast') {
      const users = await User.find({
        role: 'user',
        isActive: true,
      }).select('_id');

      if (!users.length) {
        return res.status(404).json({
          message: 'No active users found for broadcast.',
        });
      }

      const notifications = await Notification.insertMany(
        users.map((user) => ({
          userId: user._id,
          title,
          message,
          sentBy: req.user.id,
        }))
      );

      return res.json({
        message: 'Broadcast sent successfully.',
        count: notifications.length,
      });
    }

    const user = await User.findById(target);
    if (!user || user.role !== 'user') {
      return res.status(404).json({
        message: 'Selected user not found.',
      });
    }

    const notification = await Notification.create({
      userId: user._id,
      title,
      message,
      sentBy: req.user.id,
    });

    return res.json({
      message: 'Notification sent successfully.',
      notification,
    });
  } catch (error) {
    console.error('Send notification error:', error);
    return res.status(500).json({
      message: 'Server error while sending notification.',
    });
  }
});

router.get('/my', auth(['user', 'admin']), async (req, res) => {
  try {
    const notifications = await Notification.find({
      userId: req.user.id,
    })
      .sort({ createdAt: -1 })
      .limit(50);

    res.json(notifications);
  } catch (error) {
    console.error('Fetch notifications error:', error);
    res.status(500).json({
      message: 'Server error while fetching notifications.',
    });
  }
});

router.get('/unread-count', auth(['user', 'admin']), async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      userId: req.user.id,
      isRead: false,
    });

    res.json({ unread: count });
  } catch (error) {
    console.error('Unread count error:', error);
    res.status(500).json({
      message: 'Server error.',
    });
  }
});

router.patch('/:id/read', auth(['user', 'admin']), async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!notification) {
      return res.status(404).json({
        message: 'Notification not found.',
      });
    }

    notification.isRead = true;
    notification.readAt = new Date();

    await notification.save();

    res.json({
      message: 'Notification marked as read.',
    });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({
      message: 'Server error.',
    });
  }
});

router.patch('/read-all', auth(['user', 'admin']), async (req, res) => {
  try {
    const result = await Notification.updateMany(
      {
        userId: req.user.id,
        isRead: false,
      },
      {
        $set: {
          isRead: true,
          readAt: new Date(),
        },
      }
    );

    res.json({
      message: 'All notifications marked as read.',
      updatedCount: result.modifiedCount || 0,
    });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({
      message: 'Server error while marking notifications as read.',
    });
  }
});

const clearAllNotificationsHandler = async (req, res) => {
  try {
    const result = await Notification.deleteMany({
      userId: req.user.id,
    });

    res.json({
      message: 'All notifications deleted successfully.',
      deletedCount: result.deletedCount || 0,
    });
  } catch (error) {
    console.error('Clear all notifications error:', error);
    res.status(500).json({
      message: 'Server error while deleting all notifications.',
    });
  }
};

router.delete('/all', auth(['user', 'admin']), clearAllNotificationsHandler);
router.delete('/clear-all', auth(['user', 'admin']), clearAllNotificationsHandler);

router.delete('/:id', auth(['user', 'admin']), async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!notification) {
      return res.status(404).json({
        message: 'Notification not found.',
      });
    }

    await notification.deleteOne();

    res.json({
      message: 'Notification deleted successfully.',
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      message: 'Server error while deleting notification.',
    });
  }
});

module.exports = router;
