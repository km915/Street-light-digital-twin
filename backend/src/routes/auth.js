// src/routes/auth.js
const express  = require('express')
const router   = express.Router()
const bcrypt   = require('bcryptjs')
const jwt      = require('jsonwebtoken')
const pool     = require('../db/pool')
require('dotenv').config()

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' })
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE username = $1', [username]
    )

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const user  = rows[0]
    const valid = await bcrypt.compare(password, user.password_hash)

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    )

    res.json({ token, username: user.username, userId: user.id })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})


// GET /api/auth/me — verify token + return user info
router.get('/me', async (req, res) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token' })
  }

  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET)
    res.json({ userId: decoded.userId, username: decoded.username })
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
})

module.exports = router