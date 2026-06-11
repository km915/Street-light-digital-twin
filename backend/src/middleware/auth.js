// src/middleware/auth.js
const jwt = require('jsonwebtoken')

function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' })
  }

  const token = header.split(' ')[1]
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = decoded   // { userId, username }
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// adds req.regionId to every authenticated request
function attachRegion(req, res, next) {
  const regionId = req.headers['x-region-id']
  req.regionId = regionId ? parseInt(regionId) : 1
  next()
}

module.exports = { requireAuth, attachRegion }