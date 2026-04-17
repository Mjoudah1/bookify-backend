// backend/config/jwt.js
const JWT_SECRET = process.env.JWT_SECRET || 'secretkey';

module.exports = {
  JWT_SECRET,
};
