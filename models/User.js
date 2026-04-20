// backend/models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    /* ============================
       👤 بيانات أساسية
    ============================ */
    username: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    authProvider: {
      type: String,
      enum: ['local', 'google'],
      default: 'local',
    },

    googleId: {
      type: String,
      default: null,
      sparse: true,
    },

    password: {
      type: String,
      required: function requiredPassword() {
        return this.authProvider === 'local';
      },
      minlength: 6,
    },

    role: {
      type: String,
      enum: ['admin', 'user'],
      default: 'user',
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    mustChangePassword: {
      type: Boolean,
      default: false,
    },

    temporaryPasswordIssuedAt: {
      type: Date,
      default: null,
    },

    /* ============================
       🔐 سؤال الأمان
    ============================ */
    securityQuestion: {
      type: String,
      required: function requiredSecurityQuestion() {
        return this.authProvider === 'local';
      },
      trim: true,
    },

    // يتم تخزينه مشفّر
    securityAnswer: {
      type: String,
      required: function requiredSecurityAnswer() {
        return this.authProvider === 'local';
      },
      trim: true,
    },

    interests: [
      {
        type: String,
        trim: true,
      },
    ],

    /* ============================
       💳 الاشتراك (للقراءة أونلاين)
    ============================ */
    subscription: {
      isActive: {
        type: Boolean,
        default: false,
      },
      plan: {
        type: String,
        enum: ['none', 'monthly', 'quarterly', 'semiannual', 'yearly'],
        default: 'none',
      },
      expiresAt: {
        type: Date,
        default: null,
      },
      expiryNotifiedAt: {
        type: Date,
        default: null,
      },
      expiryWarningNotifiedAt: {
        type: Date,
        default: null,
      },
      expiryAdminWarningNotifiedAt: {
        type: Date,
        default: null,
      },
    },

    /* ============================
       📚 الكتب المملوكة / المشتراة
    ============================ */
    // قديم (لو في كود يستخدمه لسه)
    ownedBooks: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Book',
      },
    ],

    // جديد: الكتب المدفوعة (شراء حقيقي)
    purchasedBooks: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Book',
      },
    ],

    // جديد: الكتب اللي أخذها المستخدم وهي FREE
    // هذي اللي نستخدمها مع شرط price === 0 في /api/books/my
    freeBooks: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Book',
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/* =======================================
   🔁 pre-save: تهشير الباسورد وجواب الأمان
======================================= */
UserSchema.pre('save', async function (next) {
  try {
    // Hash password if modified
    if (this.isModified('password') && this.password) {
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
    }

    // Hash security answer if modified
    if (this.isModified('securityAnswer') && this.securityAnswer) {
      const salt = await bcrypt.genSalt(10);
      this.securityAnswer = await bcrypt.hash(this.securityAnswer, salt);
    }

    next();
  } catch (err) {
    next(err);
  }
});

/* =======================================
   🗝️ دوال للمقارنة / التحقق
======================================= */

// Compare password for login
UserSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return bcrypt.compare(enteredPassword, this.password);
};

// Compare security answer when resetting password
UserSchema.methods.matchSecurityAnswer = async function (enteredAnswer) {
  if (!this.securityAnswer) return false;
  return bcrypt.compare(enteredAnswer, this.securityAnswer);
};

/* =======================================
   💳 فحص حالة الاشتراك
======================================= */

/**
 * ✅ هل الاشتراك فعّال الآن؟
 * - يفحص subscription.isActive
 * - لو فيه expiresAt → لازم يكون بعد التاريخ الحالي
 */
UserSchema.methods.isSubscriptionActive = function () {
  if (!this.subscription) return false;

  const { isActive, expiresAt } = this.subscription;

  if (!isActive) return false;

  // لو ما في تاريخ انتهاء → نعتبره مفتوح
  if (!expiresAt) return true;

  const now = new Date();
  return expiresAt > now;
};

/* =======================================
   🧩 virtual: isSubscribed (للاستخدام السريع)
======================================= */

UserSchema.virtual('isSubscribed').get(function () {
  return this.isSubscriptionActive();
});

module.exports = mongoose.model('User', UserSchema);
