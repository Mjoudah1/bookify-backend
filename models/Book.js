// backend/models/Book.js
const mongoose = require('mongoose');

/* ---------------------------------------------
   ⭐ Rating Subdocument (per-user rating + comment)
--------------------------------------------- */
const ratingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    value: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
      default: '',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

/* ---------------------------------------------
   📚 E-Book Schema (Electronic Library ONLY)
--------------------------------------------- */
const BookSchema = new mongoose.Schema(
  {
    // Basic info
    title: {
      type: String,
      required: true,
      trim: true,
    },

    author: {
      type: String,
      required: true,
      trim: true,
    },

    category: {
      type: String,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
    },

    // 📌 ISBN — Unique & Required
    isbn: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      validate: {
        validator: (value) => /^\d+$/.test(value),
        message: 'ISBN must contain digits only.',
      },
    },

    // 📘 Cover image
    coverImage: {
      type: String, // filename in /uploads/covers
      default: null,
    },

    coverImageData: {
      type: String,
      default: null,
    },

    coverImageContentType: {
      type: String,
      default: null,
    },

    // 📥 E-book file (PDF / EPUB)
    ebookFile: {
      type: String, // filename in /uploads/ebooks
      required: true,
    },

    // ⚡ رابط القراءة أونلاين (PDF)
    onlineFileUrl: {
      type: String,   // مثال: http://localhost:5000/uploads/ebooks/file.pdf
      default: null,
    },

    // 💰 Price for buy option
    price: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },

    purchasePrice: {
      type: Number,
      default: 0,
      min: 0,
    },

    // 📖 هل يشمله الاشتراك؟
    availableInSubscription: {
      type: Boolean,
      default: true,
    },

    /* ---------------------------------------------
       ⭐ Ratings System (per user)
    --------------------------------------------- */
    ratings: [ratingSchema],

    averageRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },

    ratingsCount: {
      type: Number,
      default: 0,
    },

    /* ---------------------------------------------
       👁️ Views Counter
    --------------------------------------------- */
    views: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

/* 🔒 Ensure Unique ISBN */
BookSchema.index({ isbn: 1 }, { unique: true });

/* 🧮 Instance method: recalculateRatings */
BookSchema.methods.recalculateRatings = function () {
  if (!this.ratings || this.ratings.length === 0) {
    this.averageRating = 0;
    this.ratingsCount = 0;
    return;
  }

  const sum = this.ratings.reduce(
    (acc, r) => acc + (r.value || 0),
    0
  );

  this.ratingsCount = this.ratings.length;
  this.averageRating = sum / this.ratingsCount;
};

module.exports = mongoose.model('Book', BookSchema);
