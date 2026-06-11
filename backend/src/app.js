// src/app.js
const express          = require('express')
const cors             = require('cors')
const authRouter       = require('./routes/auth')
const lightsRouter     = require('./routes/lights')
const whatifRouter     = require('./routes/whatif')
const simulationRouter = require('./routes/simulation')
const maintenanceRouter = require('./routes/maintenance')
const fleetRouter      = require('./routes/fleet')
const regionsRouter    = require('./routes/regions')
const { requireAuth, attachRegion } = require('./middleware/auth')

const app = express()

app.use(cors({ origin: 'http://localhost:5173' }))
app.use(express.json())

// public routes — no auth needed
app.use('/api/auth', authRouter)

// protected routes — require valid JWT
app.use('/api/lights',      requireAuth, attachRegion, lightsRouter)
app.use('/api/whatif',      requireAuth, attachRegion, whatifRouter)
app.use('/api/simulation',  requireAuth, simulationRouter)
app.use('/api/maintenance', requireAuth, attachRegion, maintenanceRouter)
app.use('/api/fleet',       requireAuth, attachRegion, fleetRouter)
app.use('/api/regions',     requireAuth, regionsRouter)

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

module.exports = app