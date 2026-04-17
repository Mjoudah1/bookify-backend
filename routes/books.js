// backend/routes/books.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const Book = require('../models/Book');
const auth = require('../middleware/authMiddleware');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const BookView = require('../models/BookView');
const Notification = require('../models/Notification');
const { validateVirtualVisa } = require('../utils/virtualPayment');

const router = express.Router();

/* ============================================
   📂 Upload Directories (covers + ebooks)
============================================ */

const uploadsRoot = path.join(__dirname, '../uploads');
const coversDir = path.join(uploadsRoot, 'covers');
const ebooksDir = path.join(uploadsRoot, 'ebooks');

// Ensure directories exist
[coversDir, ebooksDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

router.get('/categories/list', async (req, res) => {
  try {
    const categories = await Book.distinct('category', {
      category: { $exists: true, $ne: '' },
    });

    const normalized = categories
      .map((category) => String(category || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    return res.json(normalized);
  } catch (error) {
    console.error('Error fetching book categories:', error);
    return res.status(500).json({
      message: 'Server error while getting categories.',
      error: error.message,
    });
  }
});

router.get('/interests/mine', auth(['user', 'admin']), async (req, res) => {
  try {
    const user = await User.findById(req.user.id || req.user._id).select(
      'interests'
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const interests = Array.isArray(user.interests)
      ? user.interests
          .map((interest) => String(interest || '').trim())
          .filter(Boolean)
      : [];

    if (interests.length === 0) {
      return res.json({
        interests: [],
        books: [],
      });
    }

    const books = await Book.find({
      category: { $in: interests },
    }).sort({ createdAt: -1 });

    return res.json({
      interests,
      books: books.map((book) => mapBookWithUrls(req, book)),
    });
  } catch (error) {
    console.error('Error getting interest books:', error);
    return res.status(500).json({
      message: 'Server error while getting interest books.',
      error: error.message,
    });
  }
});

router.put('/interests/mine', auth(['user', 'admin']), async (req, res) => {
  try {
    const rawInterests = Array.isArray(req.body?.interests)
      ? req.body.interests
      : [];

    const normalizedInterests = [
      ...new Set(
        rawInterests
          .map((interest) => String(interest || '').trim())
          .filter(Boolean)
      ),
    ];

    const user = await User.findById(req.user.id || req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    user.interests = normalizedInterests;
    await user.save();

    const books =
      normalizedInterests.length > 0
        ? await Book.find({
            category: { $in: normalizedInterests },
          }).sort({ createdAt: -1 })
        : [];

    return res.json({
      message: 'Your interests were updated successfully.',
      interests: normalizedInterests,
      books: books.map((book) => mapBookWithUrls(req, book)),
      hasInterests: normalizedInterests.length > 0,
    });
  } catch (error) {
    console.error('Error updating interests:', error);
    return res.status(500).json({
      message: 'Server error while updating interests.',
      error: error.message,
    });
  }
});

/* ============================================
   🧰 Multer Storage
   - coverImage → /uploads/covers
   - ebookFile  → /uploads/ebooks
============================================ */

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'coverImage') {
      cb(null, coversDir);
    } else if (file.fieldname === 'ebookFile') {
      cb(null, ebooksDir);
    } else {
      cb(null, uploadsRoot);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix =
      Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

/* ============================================
   🔗 Helper: Add URLs (coverImageUrl + ebookUrl)
============================================ */

const mapBookWithUrls = (req, book) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const obj = book.toObject();

  if (obj.coverImage) {
    obj.coverImageUrl = `${baseUrl}/uploads/covers/${obj.coverImage}`;
  } else {
    obj.coverImageUrl = null;
  }

  obj.ebookUrl = null;

  return obj;
};

/* ============================================
   🧹 Helper: Safe delete file
============================================ */

const safeUnlink = (filePath) => {
  if (!filePath) return;
  fs.unlink(filePath, (err) => {
    if (err) {
      console.warn('Failed to delete file:', filePath, err.message);
    }
  });
};

/* ============================================
   🧠 Helper: هل الكتاب مجاني فعلاً للجميع؟
   - مجاني = price === 0 && NOT availableInSubscription
============================================ */

const isFreeForAll = (book) => {
  const price = Number(book.price) || 0;
  return price === 0 && !book.availableInSubscription;
};

const getPurchasePrice = (book) => {
  const purchasePrice = Number(book.purchasePrice);
  if (!Number.isNaN(purchasePrice) && purchasePrice > 0) {
    return purchasePrice;
  }

  const fallbackPrice = Number(book.price);
  if (!Number.isNaN(fallbackPrice) && fallbackPrice > 0) {
    return fallbackPrice;
  }

  return 0;
};

const getBookFilePath = (book) =>
  path.join(ebooksDir, book.ebookFile);

const buildReadFileUrl = (req, bookId) =>
  `${req.protocol}://${req.get('host')}/api/books/${bookId}/file/read`;

const isDigitsOnly = (value) => /^\d+$/.test(String(value).trim());

const hasPurchasedBook = (user, bookId) => {
  const purchased = Array.isArray(user.purchasedBooks)
    ? user.purchasedBooks
    : [];
  const owned = Array.isArray(user.ownedBooks)
    ? user.ownedBooks
    : [];

  return (
    purchased.some((b) => b.toString() === bookId.toString()) ||
    owned.some((b) => b.toString() === bookId.toString())
  );
};

const resolveBookAccess = (user, book) => {
  const role = String(user.role || '').toLowerCase();
  const freeForAll = isFreeForAll(book);
  const userHasPurchased = hasPurchasedBook(user, book._id);
  const userHasActiveSubscription =
    typeof user.isSubscriptionActive === 'function'
      ? user.isSubscriptionActive()
      : false;
  const includedInSubscription = !!book.availableInSubscription;

  const canReadOnline =
    role === 'admin' ||
    freeForAll ||
    userHasPurchased ||
    (userHasActiveSubscription && includedInSubscription);

  const canDownload = role === 'admin' || userHasPurchased;

  return {
    role,
    freeForAll,
    userHasPurchased,
    userHasActiveSubscription,
    includedInSubscription,
    canReadOnline,
    canDownload,
  };
};

const getViewerIdentity = (req) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : null;

  if (token) {
    try {
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || 'secretkey'
      );
      const userId = decoded.id || decoded._id || decoded.userId || decoded.sub;

      if (userId) {
        return {
          viewerType: 'user',
          viewerKey: `user:${userId}`,
        };
      }
    } catch {
      // Ignore invalid token and fall back to a guest fingerprint.
    }
  }

  const forwardedFor = req.headers['x-forwarded-for'];
  const ip = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : String(forwardedFor || req.ip || req.socket?.remoteAddress || 'unknown');
  const userAgent = req.get('user-agent') || 'unknown';
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${ip}|${userAgent}`)
    .digest('hex');

  return {
    viewerType: 'guest',
    viewerKey: `guest:${fingerprint}`,
  };
};

const trackUniqueBookView = async (req, bookId) => {
  const { viewerKey, viewerType } = getViewerIdentity(req);
  const now = new Date();
  const existing = await BookView.findOne({ bookId, viewerKey }).select('_id');

  if (existing) {
    await BookView.updateOne(
      { _id: existing._id },
      {
        $set: {
          lastViewedAt: now,
          viewerType,
        },
      }
    );
    return;
  }

  try {
    await BookView.create({
      bookId,
      viewerKey,
      viewerType,
      firstViewedAt: now,
      lastViewedAt: now,
    });

    await Book.updateOne({ _id: bookId }, { $inc: { views: 1 } });
  } catch (error) {
    if (error?.code === 11000) {
      await BookView.updateOne(
        { bookId, viewerKey },
        {
          $set: {
            lastViewedAt: now,
            viewerType,
          },
        }
      );
      return;
    }

    throw error;
  }
};

/* ============================================
   📚 POST /api/books
   ➕ Add new E-Book (Admin only)
============================================ */
/*
  Form-data:
    - title (required)
    - author (required)
    - isbn (required)
    - category, description, price, availableInSubscription
    - coverImage (file, optional)
    - ebookFile (file, required)
*/
router.post(
  '/',
  auth(['admin']),
  upload.fields([
    { name: 'coverImage', maxCount: 1 },
    { name: 'ebookFile', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        title,
        author,
        category,
        description,
        isbn,
        price,
        purchasePrice,
        availableInSubscription,
      } = req.body;

      if (!title || !author || !isbn) {
        return res.status(400).json({
          message: 'Title, Author and ISBN are required.',
        });
      }

      if (!isDigitsOnly(isbn)) {
        return res.status(400).json({
          message: 'ISBN must contain digits only.',
        });
      }

      const ebookFile = req.files?.ebookFile?.[0];
      if (!ebookFile) {
        return res.status(400).json({
          message: 'E-book file is required (PDF / EPUB).',
        });
      }

      const coverImage = req.files?.coverImage?.[0] || null;

      const numericPrice =
        typeof price !== 'undefined' && price !== ''
          ? Math.max(0, Number(price))
          : 0;
      const numericPurchasePrice =
        typeof purchasePrice !== 'undefined' && purchasePrice !== ''
          ? Math.max(0, Number(purchasePrice))
          : 0;

      const subscriptionFlag =
        typeof availableInSubscription === 'string'
          ? availableInSubscription !== 'false'
          : availableInSubscription === false
          ? false
          : true; // default true

      const newBook = new Book({
        title: title.trim(),
        author: author.trim(),
        category: category?.trim() || '',
        description: description?.trim() || '',
        isbn: isbn.trim(),
        coverImage: coverImage ? coverImage.filename : null,
        ebookFile: ebookFile.filename,
        price: numericPrice,
        purchasePrice: numericPurchasePrice,
        availableInSubscription: subscriptionFlag,
      });

      await newBook.save();
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      newBook.onlineFileUrl = `${baseUrl}/api/books/${newBook._id}/file/read`;
      await newBook.save();

      return res.status(201).json({
        message: '✅ Book added successfully.',
        book: mapBookWithUrls(req, newBook),
      });
    } catch (error) {
      console.error('❌ Error adding book:', error);

      if (
        error.code === 11000 &&
        (error.keyPattern?.isbn || error.keyValue?.isbn)
      ) {
        return res.status(400).json({
          message: 'Duplicate ISBN is NOT Allowed',
        });
      }

      if (error.name === 'ValidationError' && error.errors?.isbn) {
        return res.status(400).json({
          message: error.errors.isbn.message,
        });
      }

      return res.status(500).json({
        message: 'Server error while adding book.',
        error: error.message,
      });
    }
  }
);

/* ============================================
   📚 GET /api/books
   List books (Public)
============================================ */

router.get('/', async (req, res) => {
  try {
    const { sort, limit } = req.query;
    const lim = Number(limit) || 50;

    let sortOption = { createdAt: -1 }; // newest

    if (sort === 'top-rated') {
      sortOption = { averageRating: -1, ratingsCount: -1, views: -1 };
    } else if (sort === 'most-viewed') {
      sortOption = { views: -1, averageRating: -1 };
    }

    const books = await Book.find().sort(sortOption).limit(lim);

    const formatted = books.map((b) => mapBookWithUrls(req, b));
    return res.json(formatted);
  } catch (error) {
    console.error('❌ Error fetching books:', error);
    return res.status(500).json({
      message: 'Server error while getting books.',
      error: error.message,
    });
  }
});

/* ============================================
   📚 GET /api/books/my
   My Books (purchased + free-but-still-free)
   + تنظيف freeBooks من الكتب اللي بطلت Free
============================================ */

router.get('/my', auth(['user', 'admin']), async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const user = await User.findById(userId)
      .populate('purchasedBooks')
      .populate('freeBooks');

    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const purchased = Array.isArray(user.purchasedBooks)
      ? user.purchasedBooks
      : [];

    const free = Array.isArray(user.freeBooks)
      ? user.freeBooks
      : [];

    const booksMap = new Map();
    const stillFreeIds = [];

    const addBookToLibrary = (book, source) => {
      if (!book) return;

      const key = book._id.toString();
      const existing = booksMap.get(key);
      const nextBook = {
        ...mapBookWithUrls(req, book),
        librarySource: source,
      };

      if (!existing) {
        booksMap.set(key, nextBook);
        return;
      }

      const priority = {
        paid: 3,
        free: 2,
        subscription: 1,
      };

      if ((priority[source] || 0) > (priority[existing.librarySource] || 0)) {
        booksMap.set(key, nextBook);
      }
    };

    // 💰 الكتب المشتراة: تبقى دائماً في My Books
    purchased.forEach((book) => {
      addBookToLibrary(book, 'paid');
    });

    // 🆓 الكتب المجانية: تظهر فقط لو ما زالت مجانية للجميع
    free.forEach((book) => {
      if (!book) return;
      if (isFreeForAll(book)) {
        addBookToLibrary(book, 'free');
        stillFreeIds.push(book._id);
      }
    });

    const subscriptionReads = await Transaction.find({
      userId,
      type: 'read',
      viaSubscription: true,
      bookId: { $ne: null },
    })
      .sort({ accessedAt: -1, createdAt: -1 })
      .populate('bookId');

    subscriptionReads.forEach((tx) => {
      const book = tx.bookId;
      if (!book) return;
      if (!book.availableInSubscription || !book.ebookFile) return;

      addBookToLibrary(book, 'subscription');
    });

    // ✨ تنظيف freeBooks في الداتابيز لو في كتب بطلت Free
    if (user.freeBooks && stillFreeIds.length !== user.freeBooks.length) {
      user.freeBooks = stillFreeIds;
      await user.save();
    }

    const finalBooks = Array.from(booksMap.values());

    return res.json(finalBooks);
  } catch (error) {
    console.error('❌ Error getting my books:', error);
    return res.status(500).json({
      message: 'Server error while getting my books.',
      error: error.message,
    });
  }
});

/* ============================================
   🗑 DELETE /api/books/my/:bookId
   إزالة كتاب من مكتبة المستخدم (purchased + free)
============================================ */

router.delete('/my/:bookId', auth(['user', 'admin']), async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { bookId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    let changed = false;

    // نحذف من purchasedBooks
    if (Array.isArray(user.purchasedBooks)) {
      const before = user.purchasedBooks.length;
      user.purchasedBooks = user.purchasedBooks.filter(
        (id) => id.toString() !== bookId
      );
      if (user.purchasedBooks.length !== before) changed = true;
    }

    // ونحذف من freeBooks أيضاً لو موجود
    if (Array.isArray(user.freeBooks)) {
      const before = user.freeBooks.length;
      user.freeBooks = user.freeBooks.filter(
        (id) => id.toString() !== bookId
      );
      if (user.freeBooks.length !== before) changed = true;
    }

    const deletedSubscriptionReads = await Transaction.deleteMany({
      userId,
      bookId,
      type: 'read',
      viaSubscription: true,
    });

    if (deletedSubscriptionReads.deletedCount > 0) {
      changed = true;
    }

    if (!changed) {
      return res.status(404).json({
        message: 'Book not found in your library.',
      });
    }

    await user.save();

    return res.json({
      message: 'Book removed from your library.',
    });
  } catch (error) {
    console.error('❌ Remove my book error:', error);
    return res.status(500).json({
      message: 'Server error while removing book from your library.',
      error: error.message,
    });
  }
});

/* ============================================
   📚 GET /api/books/:id
   Single book details (Public) + increment views
============================================ */

router.get('/:id', async (req, res) => {
  try {
    const book = await Book.findById(req.params.id).populate(
      'ratings.user',
      'username email'
    );

    if (!book) {
      return res.status(404).json({ message: 'Book not found.' });
    }

    return res.json(mapBookWithUrls(req, book));
  } catch (error) {
    console.error('❌ Error fetching single book:', error);
    return res.status(500).json({
      message: 'Error fetching book.',
      error: error.message,
    });
  }
});

/* ============================================
   ✏️ PUT /api/books/:id
   Update book (Admin only)
============================================ */

router.put(
  '/:id',
  auth(['admin']),
  upload.fields([
    { name: 'coverImage', maxCount: 1 },
    { name: 'ebookFile', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const book = await Book.findById(req.params.id);
      if (!book) {
        return res.status(404).json({ message: 'Book not found.' });
      }

      const {
        title,
        author,
        category,
        description,
        isbn,
        price,
        purchasePrice,
        availableInSubscription,
      } = req.body;

      if (title !== undefined) book.title = title.trim();
      if (author !== undefined) book.author = author.trim();
      if (category !== undefined) book.category = category.trim();
      if (description !== undefined)
        book.description = description.trim();
      if (isbn !== undefined) {
        if (!isDigitsOnly(isbn)) {
          return res.status(400).json({
            message: 'ISBN must contain digits only.',
          });
        }
        book.isbn = isbn.trim();
      }
      if (price !== undefined) book.price = Math.max(0, Number(price));
      if (purchasePrice !== undefined) {
        book.purchasePrice = Math.max(0, Number(purchasePrice));
      }
      if (availableInSubscription !== undefined) {
        book.availableInSubscription =
          availableInSubscription === 'true' ||
          availableInSubscription === true;
      }

      const newCover = req.files?.coverImage?.[0];
      const newEbook = req.files?.ebookFile?.[0];

      if (newCover) {
        if (book.coverImage) {
          safeUnlink(path.join(coversDir, book.coverImage));
        }
        book.coverImage = newCover.filename;
      }

      if (newEbook) {
        if (book.ebookFile) {
          safeUnlink(path.join(ebooksDir, book.ebookFile));
        }

        book.ebookFile = newEbook.filename;

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        book.onlineFileUrl = `${baseUrl}/api/books/${book._id}/file/read`;
      }

      await book.save();

      return res.json({
        message: '✅ Book updated successfully.',
        book: mapBookWithUrls(req, book),
      });
    } catch (error) {
      console.error('❌ Error updating book:', error);

      if (
        error.code === 11000 &&
        (error.keyPattern?.isbn || error.keyValue?.isbn)
      ) {
        return res.status(400).json({
          message: 'Duplicate ISBN is NOT Allowed',
        });
      }

      if (error.name === 'ValidationError' && error.errors?.isbn) {
        return res.status(400).json({
          message: error.errors.isbn.message,
        });
      }

      return res.status(500).json({
        message: 'Server error while updating book.',
        error: error.message,
      });
    }
  }
);

/* ============================================
   🗑 DELETE /api/books/:id
   Delete book (Admin only)
============================================ */

router.delete('/:id', auth(['admin']), async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);

    if (!book) {
      return res.status(404).json({ message: 'Book not found.' });
    }

    if (book.coverImage) {
      safeUnlink(path.join(coversDir, book.coverImage));
    }

    if (book.ebookFile) {
      safeUnlink(path.join(ebooksDir, book.ebookFile));
    }

    await book.deleteOne();

    return res.json({ message: '✅ Book deleted successfully.' });
  } catch (error) {
    console.error('❌ Error deleting book:', error);
    return res.status(500).json({
      message: 'Server error while deleting book.',
      error: error.message,
    });
  }
});

/* ============================================
   ⭐ POST /api/books/:id/rate
   Add rating ONCE per user (no updates)
============================================ */

router.post('/:id/rate', auth(['user', 'admin']), async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const userId = req.user.id || req.user._id;

    const numericRating = Number(rating);

    if (!numericRating || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({
        message: 'Rating must be a number between 1 and 5.',
      });
    }

    const book = await Book.findById(req.params.id);

    if (!book) {
      return res.status(404).json({ message: 'Book not found.' });
    }

    if (!Array.isArray(book.ratings)) {
      book.ratings = [];
    }

    const existing = book.ratings.find(
      (r) => r.user.toString() === userId.toString()
    );

    if (existing) {
      return res.status(400).json({
        message: 'You have already rated this book.',
      });
    }

    const trimmedComment =
      typeof comment === 'string' ? comment.trim() : '';

    const now = new Date();

    book.ratings.push({
      user: userId,
      value: numericRating,
      comment: trimmedComment,
      createdAt: now,
      updatedAt: now,
    });

    const count = book.ratings.length;
    const sum = book.ratings.reduce((acc, r) => acc + r.value, 0);
    const avg = count === 0 ? 0 : sum / count;

    book.ratingsCount = count;
    book.averageRating = avg;

    await book.save();
    await book.populate('ratings.user', 'username email');

    const createdReview = book.ratings[book.ratings.length - 1] || null;

    if (trimmedComment && createdReview?._id) {
      const admins = await User.find({
        role: 'admin',
        isActive: true,
      }).select('_id');

      if (admins.length > 0) {
        const reviewerEmail =
          req.user.email ||
          createdReview.user?.email ||
          'unknown email';

        await Notification.insertMany(
          admins.map((admin) => ({
            userId: admin._id,
            title: 'New Book Comment',
            message: `The user ${reviewerEmail} added a comment on "${book.title}".`,
            sentBy: userId,
            targetPath: `/books/${book._id}?review=${createdReview._id}`,
          }))
        );
      }
    }

    return res.json({
      message: '✅ Rating submitted successfully.',
      averageRating: book.averageRating,
      ratingsCount: book.ratingsCount,
      ratings: book.ratings,
    });
  } catch (error) {
    console.error('❌ Error rating book:', error);
    return res.status(500).json({
      message: 'Server error while rating book.',
      error: error.message,
    });
  }
});

/* ============================================
   ❌ DELETE /api/books/:bookId/reviews/:reviewId
   Delete review (Admin only)
============================================ */

router.delete(
  '/:bookId/reviews/:reviewId',
  auth(['admin']),
  async (req, res) => {
    try {
      const { bookId, reviewId } = req.params;

      const book = await Book.findById(bookId);

      if (!book) {
        return res.status(404).json({ message: 'Book not found.' });
      }

      const ratingDoc = book.ratings.id(reviewId);
      if (!ratingDoc) {
        return res.status(404).json({ message: 'Review not found.' });
      }

      ratingDoc.deleteOne();

      const count = book.ratings.length;
      const sum = book.ratings.reduce((acc, r) => acc + r.value, 0);
      const avg = count === 0 ? 0 : sum / count;

      book.ratingsCount = count;
      book.averageRating = avg;

      await book.save();
      await book.populate('ratings.user', 'username email');

      return res.json({
        message: '✅ Review deleted successfully.',
        averageRating: book.averageRating,
        ratingsCount: book.ratingsCount,
        ratings: book.ratings,
      });
    } catch (error) {
      console.error('❌ Error deleting review:', error);
      return res.status(500).json({
        message: 'Server error while deleting review.',
        error: error.message,
      });
    }
  }
);

/* ============================================
   📖 GET /api/books/:id/read-access
   Online reading – subscription OR purchase OR free OR admin
============================================ */

router.get('/:id/read-access', auth(['user', 'admin']), async (req, res) => {
  try {
    const payloadUser = req.user;
    if (!payloadUser) {
      return res
        .status(401)
        .json({ message: 'Authentication required.' });
    }

    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ message: 'Book not found.' });
    }

    if (!book.ebookFile) {
      return res.status(404).json({
        message: 'This book does not have an online file.',
      });
    }

    const dbUser = await User.findById(
      payloadUser.id || payloadUser._id
    );

    if (!dbUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const freeBooks = Array.isArray(dbUser.freeBooks)
      ? dbUser.freeBooks
      : [];
    const userHasFree =
      freeBooks.some((b) => b.toString() === book._id.toString());
    const access = resolveBookAccess(dbUser, book);

    if (!access.canReadOnline) {
      return res.status(403).json({
        message:
          'You need an active subscription or ownership to read this book online.',
      });
    }

    if (access.freeForAll && !access.userHasPurchased && !userHasFree) {
      dbUser.freeBooks.push(book._id);
      await dbUser.save();
    }

    return res.json({
      readerUrl: buildReadFileUrl(req, book._id),
      canReadOnline: true,
      canDownload: access.canDownload,
    });
  } catch (error) {
    console.error('❌ Read-access error:', error);
    return res.status(500).json({
      message: 'Server error while checking read access.',
      error: error.message,
    });
  }
});

/* ============================================
   💳 POST /api/books/:id/buy
   شراء / إضافة كتاب للمكتبة (مجاني أو مدفوع)
============================================ */

router.post('/:id/buy', auth(['user', 'admin']), async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const bookId = req.params.id;
    const payment = req.body?.payment || null;

    const book = await Book.findById(bookId);
    if (!book) {
      return res.status(404).json({ message: 'Book not found.' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    if (!Array.isArray(user.purchasedBooks)) {
      user.purchasedBooks = [];
    }
    if (!Array.isArray(user.freeBooks)) {
      user.freeBooks = [];
    }

    const alreadyOwned = user.purchasedBooks.some(
      (b) => b.toString() === book._id.toString()
    );
    const alreadyFree = user.freeBooks.some(
      (b) => b.toString() === book._id.toString()
    );

    if (alreadyOwned || alreadyFree) {
      return res.status(400).json({
        message: 'You already own this book.',
      });
    }

    const freeForAll = isFreeForAll(book);
    const purchasePrice = getPurchasePrice(book);

    if (freeForAll && purchasePrice === 0 && !payment) {
      user.freeBooks.push(book._id);
      await user.save();

      return res.json({
        message: 'Book added to your library for free.',
        type: 'free',
        bookId: book._id,
      });
    }

    const paymentCheck = validateVirtualVisa(payment);
    if (!paymentCheck.ok) {
      return res.status(400).json({
        message: paymentCheck.message,
      });
    }

    user.purchasedBooks.push(book._id);
    await user.save();

    await Transaction.create({
      userId: user._id,
      bookId: book._id,
      type: 'buy',
      amountPaid: purchasePrice,
      viaSubscription: false,
      accessedAt: new Date(),
      meta: {
        source: 'virtual_book_checkout',
        paymentMethod: paymentCheck.payment.gateway,
        cardBrand: paymentCheck.payment.brand,
        cardLast4: paymentCheck.payment.last4,
      },
    });

    return res.json({
      message: 'Book purchased and added to your library.',
      type: 'paid',
      bookId: book._id,
    });
  } catch (error) {
    console.error('❌ Buy book error:', error);
    return res.status(500).json({
      message: 'Server error while creating buy transaction.',
      error: error.message,
    });
  }
});

router.get('/:id/file/read', auth(['user', 'admin']), async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ message: 'Book not found.' });
    }

    if (!book.ebookFile) {
      return res.status(404).json({
        message: 'This book does not have a readable file.',
      });
    }

    const user = await User.findById(req.user.id || req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const access = resolveBookAccess(user, book);
    if (!access.canReadOnline) {
      return res.status(403).json({
        message: 'You are not allowed to read this book online.',
      });
    }

    const filePath = getBookFilePath(book);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'E-book file not found.' });
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'inline');
    return res.sendFile(filePath);
  } catch (error) {
    console.error('Read file error:', error);
    return res.status(500).json({
      message: 'Server error while opening e-book.',
      error: error.message,
    });
  }
});

router.get('/:id/file/download', auth(['user', 'admin']), async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) {
      return res.status(404).json({ message: 'Book not found.' });
    }

    if (!book.ebookFile) {
      return res.status(404).json({
        message: 'This book does not have a downloadable file.',
      });
    }

    const user = await User.findById(req.user.id || req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const access = resolveBookAccess(user, book);
    if (!access.canDownload) {
      return res.status(403).json({
        message: 'Download is available only for purchased books.',
      });
    }

    const filePath = getBookFilePath(book);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'E-book file not found.' });
    }

    return res.download(filePath, book.ebookFile);
  } catch (error) {
    console.error('Download file error:', error);
    return res.status(500).json({
      message: 'Server error while downloading e-book.',
      error: error.message,
    });
  }
});

router.post('/:id/view', async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);

    if (!book) {
      return res.status(404).json({ message: 'Book not found.' });
    }

    await trackUniqueBookView(req, book._id);

    const refreshedBook = await Book.findById(req.params.id).select('views');

    return res.json({
      message: 'View tracked successfully.',
      views: refreshedBook?.views || 0,
    });
  } catch (error) {
    console.error('Error tracking book view:', error);
    return res.status(500).json({
      message: 'Error tracking book view.',
      error: error.message,
    });
  }
});

module.exports = router;
