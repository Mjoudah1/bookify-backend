const express = require('express');

const auth = require('../middleware/authMiddleware');
const Notification = require('../models/Notification');
const SupportConversation = require('../models/SupportConversation');
const User = require('../models/User');

const router = express.Router();

const buildThreadTargetPath = (threadId) =>
  `/admin-messages?thread=${threadId}`;

const formatThread = (thread) => {
  if (!thread) return null;

  const lastMessage =
    Array.isArray(thread.messages) && thread.messages.length > 0
      ? thread.messages[thread.messages.length - 1]
      : null;

  return {
    _id: thread._id,
    userId: thread.userId,
    status: thread.status,
    lastSenderRole: thread.lastSenderRole,
    lastMessageAt: thread.lastMessageAt,
    unreadForAdmin: thread.unreadForAdmin || 0,
    unreadForUser: thread.unreadForUser || 0,
    messagesCount: Array.isArray(thread.messages)
      ? thread.messages.length
      : 0,
    lastMessage: lastMessage
      ? {
          _id: lastMessage._id,
          senderRole: lastMessage.senderRole,
          senderName: lastMessage.senderName,
          senderEmail: lastMessage.senderEmail,
          body: lastMessage.body,
          createdAt: lastMessage.createdAt,
        }
      : null,
    messages: Array.isArray(thread.messages)
      ? thread.messages.map((message) => ({
          _id: message._id,
          senderId: message.senderId,
          senderRole: message.senderRole,
          senderName: message.senderName,
          senderEmail: message.senderEmail,
          body: message.body,
          readByAdminAt: message.readByAdminAt || null,
          readByAdminName: message.readByAdminName || '',
          readByUserAt: message.readByUserAt || null,
          readByUserName: message.readByUserName || '',
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
        }))
      : [],
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
};

const markThreadMessagesAsRead = (thread, readerRole, readerName) => {
  if (!Array.isArray(thread.messages) || thread.messages.length === 0) {
    return false;
  }

  const now = new Date();
  let changed = false;

  for (const message of thread.messages) {
    if (readerRole === 'user' && message.senderRole === 'admin' && !message.readByUserAt) {
      message.readByUserAt = now;
      message.readByUserName = readerName || 'User';
      changed = true;
    }

    if (readerRole === 'admin' && message.senderRole === 'user' && !message.readByAdminAt) {
      message.readByAdminAt = now;
      message.readByAdminName = readerName || 'Admin';
      changed = true;
    }
  }

  return changed;
};

const syncThreadAfterMessageChange = (thread) => {
  const lastMessage =
    Array.isArray(thread.messages) && thread.messages.length > 0
      ? thread.messages[thread.messages.length - 1]
      : null;

  if (!lastMessage) {
    thread.lastMessageAt = null;
    thread.lastSenderRole = null;
    thread.status = 'open';
    thread.unreadForAdmin = 0;
    thread.unreadForUser = 0;
    return;
  }

  thread.lastMessageAt = lastMessage.createdAt || new Date();
  thread.lastSenderRole = lastMessage.senderRole;
  thread.status =
    lastMessage.senderRole === 'user'
      ? 'waiting_for_admin'
      : 'waiting_for_user';
};

router.get('/thread', auth(['user']), async (req, res) => {
  try {
    const thread = await SupportConversation.findOne({
      userId: req.user.id,
    }).populate('userId', 'username email role isActive');

    if (!thread) {
      return res.json({ thread: null });
    }

    const changedReadState = markThreadMessagesAsRead(
      thread,
      'user',
      req.user.username || req.user.email || 'User'
    );
    const hadUnreadForUser = thread.unreadForUser > 0;

    if (hadUnreadForUser) {
      thread.unreadForUser = 0;
    }

    if (hadUnreadForUser || changedReadState) {
      await thread.save();
    }

    return res.json({ thread: formatThread(thread) });
  } catch (error) {
    console.error('Fetch user thread error:', error);
    return res.status(500).json({
      message: 'Server error while loading messages.',
    });
  }
});

router.post('/thread', auth(['user']), async (req, res) => {
  try {
    const messageBody = String(req.body?.message || '').trim();

    if (!messageBody) {
      return res.status(400).json({
        message: 'Message content is required.',
      });
    }

    const user = await User.findById(req.user.id).select(
      'username email role isActive'
    );

    if (!user) {
      return res.status(404).json({
        message: 'User not found.',
      });
    }

    let thread = await SupportConversation.findOne({
      userId: req.user.id,
    });

    if (!thread) {
      thread = new SupportConversation({
        userId: req.user.id,
        messages: [],
      });
    }

    thread.messages.push({
      senderId: user._id,
      senderRole: 'user',
      senderName: user.username || user.email || 'User',
      senderEmail: user.email || '',
      body: messageBody,
      readByUserAt: new Date(),
      readByUserName: user.username || user.email || 'User',
    });
    thread.adminHidden = false;
    thread.lastMessageAt = new Date();
    thread.lastSenderRole = 'user';
    thread.status = 'waiting_for_admin';
    thread.unreadForAdmin = (thread.unreadForAdmin || 0) + 1;
    thread.unreadForUser = 0;

    await thread.save();
    await thread.populate('userId', 'username email role isActive');

    const admins = await User.find({
      role: 'admin',
      isActive: true,
    }).select('_id');

    if (admins.length > 0) {
      await Notification.insertMany(
        admins.map((admin) => ({
          userId: admin._id,
          title: 'New User Message',
          message: `The user ${user.email} sent a new message.`,
          sentBy: user._id,
          targetPath: buildThreadTargetPath(thread._id),
        }))
      );
    }

    return res.status(201).json({
      message: 'Message sent successfully.',
      thread: formatThread(thread),
    });
  } catch (error) {
    console.error('Send user message error:', error);
    return res.status(500).json({
      message: 'Server error while sending your message.',
    });
  }
});

router.delete(
  '/thread/messages/:messageId',
  auth(['user']),
  async (req, res) => {
    try {
      const thread = await SupportConversation.findOne({
        userId: req.user.id,
      }).populate('userId', 'username email role isActive');

      if (!thread) {
        return res.status(404).json({
          message: 'Conversation not found.',
        });
      }

      const message = thread.messages.id(req.params.messageId);
      if (!message) {
        return res.status(404).json({
          message: 'Message not found.',
        });
      }

      const senderId = message.senderId?.toString?.() || '';
      if (message.senderRole !== 'user' || senderId !== String(req.user.id)) {
        return res.status(403).json({
          message: 'You can only delete your own messages.',
        });
      }

      message.deleteOne();

      syncThreadAfterMessageChange(thread);
      await thread.save();

      return res.json({
        message: 'Message deleted successfully.',
        thread: formatThread(thread),
      });
    } catch (error) {
      console.error('Delete user message error:', error);
      return res.status(500).json({
        message: 'Server error while deleting your message.',
      });
    }
  }
);

router.get('/admin/threads', auth(['admin']), async (req, res) => {
  try {
    const threads = await SupportConversation.find({
      adminHidden: { $ne: true },
    })
      .populate('userId', 'username email role isActive createdAt')
      .sort({ lastMessageAt: -1, updatedAt: -1 });

    return res.json(threads.map((thread) => formatThread(thread)));
  } catch (error) {
    console.error('Fetch admin threads error:', error);
    return res.status(500).json({
      message: 'Server error while loading inbox.',
    });
  }
});

router.get('/admin/threads/:id', auth(['admin']), async (req, res) => {
  try {
    const thread = await SupportConversation.findOne({
      _id: req.params.id,
      adminHidden: { $ne: true },
    }).populate('userId', 'username email role isActive createdAt');

    if (!thread) {
      return res.status(404).json({
        message: 'Conversation not found.',
      });
    }

    const changedReadState = markThreadMessagesAsRead(
      thread,
      'admin',
      req.user.username || req.user.email || 'Admin'
    );
    const hadUnreadForAdmin = thread.unreadForAdmin > 0;

    if (hadUnreadForAdmin) {
      thread.unreadForAdmin = 0;
    }

    if (hadUnreadForAdmin || changedReadState) {
      await thread.save();
    }

    return res.json({ thread: formatThread(thread) });
  } catch (error) {
    console.error('Fetch admin thread details error:', error);
    return res.status(500).json({
      message: 'Server error while loading the conversation.',
    });
  }
});

router.post('/admin/threads/:id/reply', auth(['admin']), async (req, res) => {
  try {
    const messageBody = String(req.body?.message || '').trim();

    if (!messageBody) {
      return res.status(400).json({
        message: 'Reply content is required.',
      });
    }

    const admin = await User.findById(req.user.id).select(
      'username email role isActive'
    );

    if (!admin) {
      return res.status(404).json({
        message: 'Admin not found.',
      });
    }

    const thread = await SupportConversation.findById(req.params.id).populate(
      'userId',
      'username email role isActive'
    );

    if (!thread) {
      return res.status(404).json({
        message: 'Conversation not found.',
      });
    }

    thread.messages.push({
      senderId: admin._id,
      senderRole: 'admin',
      senderName: admin.username || admin.email || 'Admin',
      senderEmail: admin.email || '',
      body: messageBody,
      readByAdminAt: new Date(),
      readByAdminName: admin.username || admin.email || 'Admin',
    });
    thread.adminHidden = false;
    thread.lastMessageAt = new Date();
    thread.lastSenderRole = 'admin';
    thread.status = 'waiting_for_user';
    thread.unreadForUser = (thread.unreadForUser || 0) + 1;
    thread.unreadForAdmin = 0;

    await thread.save();

    await Notification.create({
      userId: thread.userId._id,
      title: 'Admin Reply',
      message: `The admin replied to your message.`,
      sentBy: admin._id,
      targetPath: '/messages',
    });

    return res.json({
      message: 'Reply sent successfully.',
      thread: formatThread(thread),
    });
  } catch (error) {
    console.error('Reply to user message error:', error);
    return res.status(500).json({
      message: 'Server error while sending the reply.',
    });
  }
});

router.delete('/admin/threads/:id', auth(['admin']), async (req, res) => {
  try {
    const thread = await SupportConversation.findById(req.params.id);

    if (!thread) {
      return res.status(404).json({
        message: 'Conversation not found.',
      });
    }

    thread.adminHidden = true;
    await thread.save();

    return res.json({
      message: 'Conversation removed from admin inbox.',
    });
  } catch (error) {
    console.error('Delete conversation error:', error);
    return res.status(500).json({
      message: 'Server error while deleting the conversation.',
    });
  }
});

router.delete(
  '/admin/threads/:id/messages/:messageId',
  auth(['admin']),
  async (req, res) => {
    try {
      const thread = await SupportConversation.findById(req.params.id).populate(
        'userId',
        'username email role isActive createdAt'
      );

      if (!thread) {
        return res.status(404).json({
          message: 'Conversation not found.',
        });
      }

      const message = thread.messages.id(req.params.messageId);
      if (!message) {
        return res.status(404).json({
          message: 'Message not found.',
        });
      }

      const senderId = message.senderId?.toString?.() || '';
      if (message.senderRole !== 'admin' || senderId !== String(req.user.id)) {
        return res.status(403).json({
          message: 'You can only delete your own replies.',
        });
      }

      message.deleteOne();

      syncThreadAfterMessageChange(thread);
      await thread.save();

      return res.json({
        message: 'Reply deleted successfully.',
        thread: formatThread(thread),
      });
    } catch (error) {
      console.error('Delete admin reply error:', error);
      return res.status(500).json({
        message: 'Server error while deleting the reply.',
      });
    }
  }
);

module.exports = router;
