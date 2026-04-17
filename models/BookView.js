const mongoose = require('mongoose');

const bookViewSchema = new mongoose.Schema(
  {
    bookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Book',
      required: true,
      index: true,
    },
    viewerKey: {
      type: String,
      required: true,
      trim: true,
    },
    viewerType: {
      type: String,
      enum: ['user', 'guest'],
      required: true,
    },
    firstViewedAt: {
      type: Date,
      default: Date.now,
    },
    lastViewedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

bookViewSchema.index({ bookId: 1, viewerKey: 1 }, { unique: true });

module.exports = mongoose.model('BookView', bookViewSchema);
