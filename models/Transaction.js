// backend/models/Transaction.js
const mongoose = require('mongoose');

/*
  🔥 Electronic Library Transactions Model
  - يسجل: شراء كتاب – استخدام الاشتراك – تجديد الاشتراك – قراءة كتاب
  - لا يوجد حالات إرجاع / استعارة
  - قابل للتوسع لأي بوابة دفع مستقبلاً
*/

const transactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    bookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Book',
      default: null, // في حالة subscription-only transaction
    },

    // نوع العملية
    type: {
      type: String,
      enum: [
        'buy',             // شراء كتاب دائم
        'read',            // قراءة كتاب عبر اشتراك
        'subscription',    // اشتراك جديد
        'subscription_renew' // تجديد اشتراك
      ],
      required: true,
    },

    // القيمة المالية المدفوعة (شراء – اشتراك – تجديد)
    amountPaid: {
      type: Number,
      default: 0,
    },

    // هل كانت القراءة عبر اشتراك؟
    viaSubscription: {
      type: Boolean,
      default: false,
    },

    // تسجيل تاريخ العملية بدقة
    accessedAt: {
      type: Date,
      default: Date.now,
    },

    // بيانات إضافية (مثلاً: الخطة، مدة الاشتراك)
    meta: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Transaction', transactionSchema);
