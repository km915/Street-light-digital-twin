// src/twin/engine.js
const pool  = require('../db/pool')
const axios = require('axios')
const { broadcast } = require('../websocket/broadcast')
require('dotenv').config()

const FLASK_URL = process.env.FLASK_API_URL || 'http://localhost:5001'

const WEATHER_OPTIONS = [
  'clear','clear','clear','clear','clear',
  'cloudy','cloudy','rainy','rainy','foggy','stormy'
]

const ZONE_BRIGHTNESS = {
  'Zone-1': 90, 'Zone-2': 85, 'Zone-3': 80,
  'Zone-4': 95, 'Zone-5': 75
}

// ── simulation state ──────────────────────────────────────────────────────────
const simState = {
  running:          false,
  tickMs:           5000,
  hour:             0,
  dayTick:          0,
  startRealTime:    null,   // Date — set fresh on every start()
  currentRealTime:  null,   // Date — advances 1 hour per tick
}

// ── in-memory 24h history buffer ──────────────────────────────────────────────
// Structure: { 'SL-001': [ ...up to 24 snapshots... ], ... }
// Used by analytics page instead of state_history
const historyBuffer = {}

function pushToBuffer(lightId, snapshot) {
  if (!historyBuffer[lightId]) historyBuffer[lightId] = []
  historyBuffer[lightId].push(snapshot)
  if (historyBuffer[lightId].length > 24) {
    historyBuffer[lightId].shift()   // keep only last 24
  }
}

function getBuffer() {
  return historyBuffer
}

function clearBuffer() {
  Object.keys(historyBuffer).forEach(k => delete historyBuffer[k])
}

let tickInterval = null
let lightWeather = {}

function pickWeather() {
  return WEATHER_OPTIONS[Math.floor(Math.random() * WEATHER_OPTIONS.length)]
}

function calcBrightness(hour, zone, weather) {
  if (hour >= 7 && hour < 18) return 0
  const base = ZONE_BRIGHTNESS[zone] || 85
  let b
  if ((hour >= 18 && hour < 22) || (hour >= 5 && hour < 7)) {
    b = base + (Math.random() * 6 - 3)
  } else {
    b = base * 0.65 + (Math.random() * 4 - 2)
  }
  if (weather === 'foggy' || weather === 'stormy') b = Math.min(100, b + 10)
  return Math.max(0, Math.min(100, parseFloat(b.toFixed(2))))
}

function calcAmbientLight(hour, weather) {
  if (hour >= 7 && hour < 18) {
    const base = Math.random() * 600 + 300
    const att  = { clear:1.0, cloudy:0.6, rainy:0.4, foggy:0.3, stormy:0.15 }
    return parseFloat((base * (att[weather] || 1.0)).toFixed(1))
  }
  return parseFloat((Math.random() * 15).toFixed(1))
}

function calcHealthDrain(weather, brightness, lampType, faultOccurred) {
  let drain = brightness === 0
    ? Math.random() * 0.003
    : 0.005 + Math.random() * 0.01 + (brightness / 100) * 0.005
  const wm = { clear:1.0, cloudy:1.05, rainy:1.3, foggy:1.15, stormy:2.0 }
  drain *= (wm[weather] || 1.0)
  if (faultOccurred) drain += 0.5 + Math.random() * 1.5
  const ld = { LED:0.6, HPS:1.0, MH:1.3 }
  drain *= (ld[lampType] || 1.0)
  return drain
}

async function tick() {
  if (!simState.running) return

  try {
    const { rows: lights } = await pool.query(`
      SELECT
        ts.light_id, ts.brightness, ts.health_score, ts.weather,
        ts.energy_consumed, ts.fault_alert, ts.simulated_hour,
        sl.zone, sl.lamp_type, sl.rated_power, sl.efficiency,
        sl.region_id
      FROM twin_state ts
      JOIN street_lights sl ON ts.light_id = sl.id
      ORDER BY ts.light_id
    `)

    if (lights.length === 0) {
      console.log('[Tick] No lights in database, skipping')
      return
    }

    if (simState.dayTick === 0) {
      lights.forEach(l => { lightWeather[l.light_id] = pickWeather() })
    }

    // advance simulated real-world time by 1 hour
    simState.currentRealTime = new Date(
      simState.currentRealTime.getTime() + 60 * 60 * 1000
    )
    const realTimestamp = simState.currentRealTime

    const updatedLights = lights.map(light => {
      const weather    = lightWeather[light.light_id] || 'clear'
      const brightness = calcBrightness(simState.hour, light.zone, weather)
      const ambient    = calcAmbientLight(simState.hour, weather)
      return {
        light_id:     light.light_id,
        zone:         light.zone,
        lamp_type:    light.lamp_type,
        rated_power:  light.rated_power,
        efficiency:   light.efficiency,
        health_score: light.health_score,
        region_id:    light.region_id || 1,
        brightness,
        ambient_light: ambient,
        weather,
        status:   brightness > 0 ? 'ON' : 'OFF',
        hour:     simState.hour,
        is_night: brightness > 0 ? 1 : 0,
      }
    })

    const flaskPayload = updatedLights.map(l => ({
      lamp_type:     l.lamp_type,
      weather:       l.weather,
      rated_power:   l.rated_power,
      efficiency:    l.efficiency,
      hour:          l.hour,
      is_night:      l.is_night,
      brightness:    l.brightness,
      ambient_light: l.ambient_light,
      health_score:  l.health_score,
      region_id:     l.region_id,
    }))

    const { data: flaskResponse } = await axios.post(
      `${FLASK_URL}/predict/batch`,
      { lights: flaskPayload },
      { timeout: 8000 }
    )

    const predictions = flaskResponse.predictions
    const dbClient    = await pool.connect()

    try {
      await dbClient.query('BEGIN')
      const snapshots = []

      for (let i = 0; i < updatedLights.length; i++) {
        const ul   = updatedLights[i]
        const pred = predictions[i]

        const fault     = pred.fault_alert
        const drain     = calcHealthDrain(ul.weather, ul.brightness, ul.lamp_type, fault)
        const newHealth = Math.max(0, parseFloat((ul.health_score - drain).toFixed(4)))

        // only update twin_state — no state_history insert
        await dbClient.query(`
          UPDATE twin_state SET
            brightness=$1, status=$2, energy_consumed=$3, health_score=$4,
            ambient_light=$5, weather=$6, fault_alert=$7,
            fault_probability=$8, simulated_hour=$9, last_updated=NOW()
          WHERE light_id=$10
        `, [
          ul.brightness, ul.status, pred.predicted_energy_kwh,
          newHealth, ul.ambient_light, ul.weather,
          pred.fault_alert, pred.fault_probability,
          simState.hour, ul.light_id,
        ])

        const snapshot = {
          light_id:          ul.light_id,
          zone:              ul.zone,
          lamp_type:         ul.lamp_type,
          brightness:        ul.brightness,
          status:            ul.status,
          health_score:      newHealth,
          energy_consumed:   pred.predicted_energy_kwh,
          fault_alert:       pred.fault_alert,
          fault_probability: pred.fault_probability,
          weather:           ul.weather,
          simulated_hour:    simState.hour,
          region_id:         ul.region_id,
        }

        snapshots.push(snapshot)

        // push to in-memory 24h buffer for analytics
        pushToBuffer(ul.light_id, {
          simulated_hour:   simState.hour,
          real_timestamp:   realTimestamp.toISOString(),
          brightness:       ul.brightness,
          health_score:     newHealth,
          energy_consumed:  pred.predicted_energy_kwh,
          fault_occurred:   fault,
          fault_probability: pred.fault_probability,
          weather:          ul.weather,
          zone:             ul.zone,
        })
      }

      await dbClient.query('COMMIT')

      simState.dayTick = (simState.dayTick + 1) % 24
      simState.hour    = (simState.hour + 1) % 24

      broadcast({
        type:          'TICK',
        lights:        snapshots,
        simulatedHour: simState.hour,
        realTimestamp: realTimestamp.toISOString(),
        history:       historyBuffer,   // send full buffer every tick
      })

      const faultCount = snapshots.filter(s => s.fault_alert).length
      console.log(
        `[Tick] ${realTimestamp.toLocaleString()} | ` +
        `SimHour=${simState.hour} | Faults=${faultCount}/${snapshots.length}`
      )

    } catch (err) {
      await dbClient.query('ROLLBACK')
      throw err
    } finally {
      dbClient.release()
    }

  } catch (err) {
    console.error('[Tick error]', err.message)
  }
}

function applyTickInterval() {
  if (tickInterval) clearInterval(tickInterval)
  if (simState.running) {
    tickInterval = setInterval(tick, simState.tickMs)
  }
}

async function start() {
  if (tickInterval) return

  try {
    await axios.get(`${FLASK_URL}/health`, { timeout: 3000 })
    console.log('[Engine] Flask model server reachable')
  } catch {
    console.warn('[Engine] Flask not reachable — engine will start anyway')
  }

  // always reset time to now — never read from DB
  simState.startRealTime   = new Date()
  simState.currentRealTime = new Date()
  simState.hour    = 0
  simState.dayTick = 0
  clearBuffer()

  simState.running = true
  console.log(`[Engine] Started. Real time base: ${simState.startRealTime.toISOString()}`)
  tick()
  applyTickInterval()
}

function stop() {
  simState.running = false
  if (tickInterval) clearInterval(tickInterval)
  tickInterval = null
  clearBuffer()
  console.log('[Engine] Stopped. History buffer cleared.')
}

module.exports = { start, stop, simState, applyTickInterval, getBuffer }