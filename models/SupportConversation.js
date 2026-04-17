const mongoose = require('mongoose');

const supportMessageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    senderRole: {
      type: String,
      enum: ['admin', 'user'],
      required: true,
    },
    senderName: {
      type: String,
      trim: true,
      default: '',
    },
    senderEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    body: {
      type: String,
      required: true,
      trim: true,
    },
    readByAdminAt: {
      type: Date,
      default: null,
    },
    readByAdminName: {
      type: String,
      trim: true,
      default: '',
    },
    readByUserAt: {
      type: Date,
      default: null,
    },
    readByUserName: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

const supportConversationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['open', 'waiting_for_admin', 'waiting_for_user'],
      default: 'open',
    },
    lastSenderRole: {
      type: String,
      enum: ['admin', 'user', null],
      default: null,
    },
    lastMessageAt: {
      type: Date,
      default: null,
    },
    unreadForAdmin: {
      type: Number,
      default: 0,
      min: 0,
    },
    unreadForUser: {
      type: Number,
      default: 0,
      min: 0,
    },
    adminHidden: {
      type: Boolean,
      default: false,
    },
    messages: [supportMessageSchema],
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  'SupportConversation',
  supportConversationSchema
);
