// backend/routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const auth = require('../middleware/authMiddleware');
const {
  notifyAdminsAboutExpiredSubscription,
} = require('../utils/subscriptionNotifier');

const router = express.Router();

// Helper: generate JWT
const JWT_SECRET = process.env.JWT_SECRET || 'secretkey'; // يُفضَّل وضعه في env فقط

const signUserToken = (user, isSubscribed) =>
  jwt.sign(
    {
      id: user._id,
      role: user.role,
      username: user.username,
      email: user.email,
      isSubscribed,
      mustChangePassword: Boolean(user.mustChangePassword),
      hasInterests:
        Array.isArray(user.interests) && user.interests.length > 0,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

/* =========================================================
 🧮 Helper: compute isSubscribed from subscription object
========================================================= */
const getSubscriptionStatus = (user) => {
  if (!user.subscription) return false;

  const { isActive, expiresAt } = user.subscription;

  if (!isActive) return false;
  if (!expiresAt) return false;

  const now = new Date();
  return new Date(expiresAt) > now;
};

const DEFAULT_FRONTEND_URL = 'https://bookify-frontend-877g.vercel.app';
const FRONTEND_URL = process.env.FRONTEND_URL || DEFAULT_FRONTEND_URL;
const BACKEND_URL = process.env.BACKEND_URL || '';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || '';

const createSocialState = (payload) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: '10m' });

const verifySocialState = (state) => jwt.verify(state, JWT_SECRET);

const extractOrigin = (value) => {
  if (!value) return '';

  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
};

const getFrontendOrigins = () =>
  [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    FRONTEND_URL,
    process.env.FRONTEND_URL,
  ]
    .filter(Boolean)
    .map((value) => extractOrigin(value))
    .filter(Boolean);

const isAllowedFrontendOrigin = (origin) => {
  if (!origin) return false;

  if (getFrontendOrigins().includes(origin)) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    return /\.vercel\.app$/i.test(parsed.hostname);
  } catch {
    return false;
  }
};

const resolveFrontendUrl = (candidateOrigin) =>
  isAllowedFrontendOrigin(candidateOrigin)
    ? candidateOrigin
    : extractOrigin(FRONTEND_URL) || DEFAULT_FRONTEND_URL;

const resolveBackendUrl = (req) =>
  BACKEND_URL || `${req.protocol}://${req.get('host')}`;

const resolveGoogleRedirectUri = (req) =>
  GOOGLE_REDIRECT_URI ||
  `${resolveBackendUrl(req)}/api/auth/social/google/callback`;

const buildFrontendSocialRedirect = (frontendUrl, params) => {
  const search = new URLSearchParams(params);
  return `${resolveFrontendUrl(frontendUrl)}/auth/social/callback?${search.toString()}`;
};

const redirectSocialError = (res, frontendUrl, message) =>
  res.redirect(
    buildFrontendSocialRedirect(frontendUrl, {
      error: message || 'Social login failed.',
    })
  );

const getGoogleAuthUrl = (state, redirectUri) => {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

const createSyntheticEmail = (provider, providerId) =>
  `${provider}_${providerId}@social.bookify.local`;

const normalizeUsername = (value, fallback) => {
  const cleaned = String(value || fallback || 'reader')
    .trim()
    .replace(/\s+/g, ' ');
  return cleaned || fallback || 'reader';
};

const buildLocalPlaceholder = (label) =>
  `${label}_${crypto.randomBytes(12).toString('hex')}`;

const findOrCreateSocialUser = async ({
  provider,
  providerId,
  email,
  username,
}) => {
  const providerField = 'googleId';
  const safeEmail = String(email || '').trim().toLowerCase();

  let user = await User.findOne({ [providerField]: providerId });
  if (!user && safeEmail) {
    user = await User.findOne({ email: safeEmail });
  }

  if (!user) {
    user = new User({
      username: normalizeUsername(username, `${provider} user`),
      email: safeEmail || createSyntheticEmail(provider, providerId),
      authProvider: provider,
      [providerField]: providerId,
      password: buildLocalPlaceholder('social'),
      securityQuestion: 'Social login account',
      securityAnswer: buildLocalPlaceholder('answer'),
      mustChangePassword: false,
      temporaryPasswordIssuedAt: null,
      subscription: {
        isActive: false,
        plan: 'none',
        expiresAt: null,
        expiryNotifiedAt: null,
      },
      ownedBooks: [],
      interests: [],
    });
  } else {
    user.authProvider = user.authProvider || provider;
    user[providerField] = providerId;
    if (!user.username) {
      user.username = normalizeUsername(username, `${provider} user`);
    }
    if (!user.email) {
      user.email = safeEmail || createSyntheticEmail(provider, providerId);
    }
  }

  await user.save();
  return user;
};

/* =========================================================
 🧩  REGISTER NEW USER  (Public)
========================================================= */
router.post('/signup', async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      securityQuestion,
      securityAnswer,
      interests,
    } = req.body;

    if (!username || !email || !password || !securityQuestion || !securityAnswer) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: 'Password must be at least 6 characters.' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: 'Email already registered.' });
    }

    const user = new User({
      username,
      email,
      authProvider: 'local',
      password,
      securityQuestion,
      securityAnswer,
      interests: Array.isArray(interests)
        ? interests
            .map((interest) => String(interest || '').trim())
            .filter(Boolean)
        : [],
      mustChangePassword: false,
      temporaryPasswordIssuedAt: null,
      // الاشتراك الافتراضي
      subscription: {
        isActive: false,
        plan: 'none',
        expiresAt: null,
        expiryNotifiedAt: null,
      },
      ownedBooks: [],
    });

    await user.save();

    res.status(201).json({
      message: 'User registered successfully.',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        interests: user.interests || [],
        hasInterests:
          Array.isArray(user.interests) && user.interests.length > 0,
        subscription: user.subscription,
        isSubscribed: false,
      },
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      message: 'Server error during signup.',
      error: error.message,
    });
  }
});

/* =========================================================
 🔐  LOGIN USER  (Public)
========================================================= */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email });
    if (!user)
      return res.status(400).json({ message: 'Invalid email or password.' });

    if (user.authProvider !== 'local' || !user.password) {
      return res.status(400).json({
        message: `This account uses ${user.authProvider || 'social'} sign-in. Please continue with that provider.`,
      });
    }

    await notifyAdminsAboutExpiredSubscription(user);

    if (user.isActive === false) {
      return res.status(403).json({
        message: 'This account has been deactivated. Please contact the admin.',
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: 'Invalid email or password.' });

    // ✅ حساب حالة الاشتراك (isSubscribed)
    const isSubscribed = getSubscriptionStatus(user);

    const token = signUserToken(user, isSubscribed);

    res.json({
      message: 'Login successful.',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        interests: user.interests || [],
        hasInterests:
          Array.isArray(user.interests) && user.interests.length > 0,
        subscription: user.subscription,
        isSubscribed,
        mustChangePassword: Boolean(user.mustChangePassword),
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      message: 'Server error during login.',
      error: error.message,
    });
  }
});

/* =========================================================
 👑  ADMIN CREATES USER WITH SPECIFIC ROLE  (Protected)
========================================================= */
router.post('/create-user', auth(['admin']), async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      role,
      securityQuestion,
      securityAnswer,
    } = req.body;

    if (
      !username ||
      !email ||
      !password ||
      !role ||
      !securityQuestion ||
      !securityAnswer
    ) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    const allowedRoles = ['admin', 'user'];
    if (!allowedRoles.includes(role)) {
      return res
        .status(400)
        .json({ message: 'Invalid role. Allowed roles are admin or user.' });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: 'Password must be at least 6 characters.' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: 'Email already registered.' });
    }

    const user = new User({
      username,
      email,
      authProvider: 'local',
      password,
      role,
      securityQuestion,
      securityAnswer,
      mustChangePassword: true,
      temporaryPasswordIssuedAt: new Date(),
      subscription: {
        isActive: false,
        plan: 'none',
        expiresAt: null,
        expiryNotifiedAt: null,
      },
      ownedBooks: [],
    });

    await user.save();

    res.status(201).json({
      message: `User created successfully as ${role}. The assigned password is temporary until the user changes it.`,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        interests: user.interests || [],
        hasInterests:
          Array.isArray(user.interests) && user.interests.length > 0,
        subscription: user.subscription,
        isSubscribed: false,
        mustChangePassword: true,
      },
    });
  } catch (error) {
    console.error('Admin create-user error:', error);
    res.status(500).json({
      message: 'Server error while creating user.',
      error: error.message,
    });
  }
});

/* =========================================================
 👤  GET CURRENT LOGGED-IN USER PROFILE  (Protected)
========================================================= */
router.get('/me', auth(['user', 'admin']), async (req, res) => {
  try {
    // في الميدل وير، req.user فيه id (وأحياناً أكثر)
    const user = await User.findById(req.user.id).select(
      '-password -securityAnswer'
    );
    if (!user) return res.status(404).json({ message: 'User not found.' });

    await notifyAdminsAboutExpiredSubscription(user);

    const isSubscribed = getSubscriptionStatus(user);

    res.json({
      ...user.toObject(),
      isSubscribed,
      hasInterests: Array.isArray(user.interests) && user.interests.length > 0,
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({
      message: 'Server error fetching user profile.',
      error: error.message,
    });
  }
});

/* =========================================================
 🔄  CHANGE PASSWORD  (Protected)
========================================================= */
router.put('/change-password', auth(['user', 'admin']), async (req, res) => {
  try {
    // نقبل oldPassword أو currentPassword من الفرونت
    const { oldPassword, currentPassword, newPassword } = req.body;
    const providedOldPassword = oldPassword || currentPassword;

    if (!providedOldPassword || !newPassword) {
      return res.status(400).json({
        message: 'Both old and new passwords are required.',
      });
    }

    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ message: 'New password must be at least 6 characters.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    // مقارنة الباسوورد القديم المرسل مع الهاش الموجود في قاعدة البيانات
    const isMatch = await bcrypt.compare(providedOldPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Incorrect old password.' });
    }

    // تعيين الباسوورد الجديد (الـ pre-save hook في User model سيقوم بعمل hash)
    user.password = newPassword;
    user.mustChangePassword = false;
    user.temporaryPasswordIssuedAt = null;
    await user.save();

    const isSubscribed = getSubscriptionStatus(user);
    const token = signUserToken(user, isSubscribed);

    res.json({
      message: 'Password updated successfully.',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        interests: user.interests || [],
        hasInterests:
          Array.isArray(user.interests) && user.interests.length > 0,
        subscription: user.subscription,
        isSubscribed,
        mustChangePassword: false,
      },
    });
  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({
      message: 'Server error while changing password.',
      error: error.message,
    });
  }
});

/* =========================================================
 🔑  FORGOT PASSWORD — STEP 1: GET SECURITY QUESTION (Public)
========================================================= */
router.post('/forgot-password/question', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }

    const user = await User.findOne({ email });
    if (!user)
      return res
        .status(404)
        .json({ message: 'No user found with this email.' });

    if (user.authProvider !== 'local') {
      return res.status(400).json({
        message: 'Password reset is available only for email/password accounts.',
      });
    }

    res.json({ question: user.securityQuestion });
  } catch (error) {
    console.error('Forgot password question error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

/* =========================================================
 🔑  FORGOT PASSWORD — STEP 2: VERIFY ANSWER + RESET (Public)
========================================================= */
router.post('/forgot-password/reset', async (req, res) => {
  try {
    const { email, answer, newPassword } = req.body;

    if (!email || !answer || !newPassword) {
      return res.status(400).json({
        message: 'Email, security answer and new password are required.',
      });
    }

    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ message: 'New password must be at least 6 characters.' });
    }

    const user = await User.findOne({ email });
    if (!user)
      return res.status(404).json({ message: 'User not found.' });

    if (user.authProvider !== 'local') {
      return res.status(400).json({
        message: 'Password reset is available only for email/password accounts.',
      });
    }

    const isAnswerMatch = await user.matchSecurityAnswer(answer);
    if (!isAnswerMatch) {
      return res
        .status(400)
        .json({ message: 'Security answer is incorrect.' });
    }

    user.password = newPassword;
    user.mustChangePassword = false;
    user.temporaryPasswordIssuedAt = null;
    await user.save();

    res.json({
      message:
        'Password has been reset successfully. You can now log in with your new password.',
    });
  } catch (error) {
    console.error('Forgot password reset error:', error);
    res.status(500).json({
      message: 'Server error while resetting password.',
      error: error.message,
    });
  }
});

router.get('/social/:provider/start', (req, res) => {
  try {
    const { provider } = req.params;
    const returnTo = resolveFrontendUrl(
      req.query.returnTo || req.get('origin') || extractOrigin(req.get('referer'))
    );

    if (provider === 'google') {
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        return redirectSocialError(
          res,
          returnTo,
          'Google login is not configured on the server.'
        );
      }

      const state = createSocialState({
        provider: 'google',
        returnTo,
      });

      return res.redirect(
        getGoogleAuthUrl(state, resolveGoogleRedirectUri(req))
      );
    }

    return redirectSocialError(res, returnTo, 'Unsupported social provider.');
  } catch (error) {
    console.error('Social auth start error:', error);
    return redirectSocialError(
      res,
      req.query.returnTo || req.get('origin'),
      'Unable to start social login.'
    );
  }
});

router.get('/social/google/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return redirectSocialError(res, null, 'Google login was cancelled.');
    }

    if (!code || !state) {
      return redirectSocialError(res, null, 'Missing Google authorization data.');
    }

    const decodedState = verifySocialState(state);
    if (decodedState.provider !== 'google') {
      return redirectSocialError(
        res,
        decodedState.returnTo,
        'Invalid Google login state.'
      );
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code: String(code),
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: resolveGoogleRedirectUri(req),
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData.access_token) {
      return redirectSocialError(
        res,
        decodedState.returnTo,
        tokenData.error_description || 'Google token exchange failed.'
      );
    }

    const profileRes = await fetch(
      'https://openidconnect.googleapis.com/v1/userinfo',
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      }
    );

    const profile = await profileRes.json().catch(() => ({}));
    if (!profileRes.ok || !profile.sub) {
      return redirectSocialError(
        res,
        decodedState.returnTo,
        'Failed to fetch Google profile.'
      );
    }

    const user = await findOrCreateSocialUser({
      provider: 'google',
      providerId: profile.sub,
      email: profile.email,
      username: profile.name || profile.given_name || profile.email,
    });

    const token = signUserToken(user, getSubscriptionStatus(user));
    return res.redirect(
      buildFrontendSocialRedirect(decodedState.returnTo, {
        token,
        hasInterests:
          Array.isArray(user.interests) && user.interests.length > 0
            ? 'true'
            : 'false',
      })
    );
  } catch (error) {
    console.error('Google social callback error:', error);
    return redirectSocialError(res, null, 'Google login failed.');
  }
});

module.exports = router;
