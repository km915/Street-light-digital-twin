// src/twin/retrainScheduler.js
const pool  = require('../db/pool')
const axios = require('axios')
require('dotenv').config()

const FLASK_URL = process.env.FLASK_API_URL || 'http://localhost:5001'

const SCHEDULE_MS = {
  'hourly':  1  * 60 * 60 * 1000,
  'daily':   24 * 60 * 60 * 1000,
  'weekly':  7  * 24 * 60 * 60 * 1000,
  'monthly': 30 * 24 * 60 * 60 * 1000,
  'manual':  null,
}

let checkInterval = null
let isRetraining  = false

// starts as idle with no stale message — reset every server restart
let retrainProgress = {
  status:       'idle',
  progress:     0,
  message:      '',
  started_at:   null,
  finished_at:  null,
  last_metrics: null,
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function getSetting(key) {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM system_settings WHERE key = $1`, [key]
    )
    return rows[0]?.value || null
  } catch {
    return null
  }
}

async function setSetting(key, value) {
  try {
    await pool.query(
      `INSERT INTO system_settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2`,
      [key, String(value)]
    )
  } catch (err) {
    console.error('[Retrain] setSetting error:', err.message)
  }
}

// ── build training rows from in-memory buffer + twin_state ────────────────────
// This is used by force retrain (simulation data)
async function buildTrainingRowsFromBuffer() {
  const { getBuffer } = require('./engine')
  const buffer = getBuffer()

  const rows = []

  // first add current twin_state snapshot for all lights
  const { rows: currentState } = await pool.query(`
    SELECT
      ts.light_id, ts.brightness, ts.health_score, ts.energy_consumed,
      ts.fault_alert, ts.fault_probability, ts.weather, ts.simulated_hour,
      sl.lamp_type, sl.rated_power, sl.efficiency,
      COALESCE(sl.region_id, 1) AS region_id
    FROM twin_state ts
    JOIN street_lights sl ON ts.light_id = sl.id
  `)

  for (const row of currentState) {
    rows.push({
      light_id:         row.light_id,
      lamp_type:        row.lamp_type,
      weather:          row.weather,
      rated_power:      row.rated_power,
      efficiency:       row.efficiency,
      hour:             row.simulated_hour,
      is_night:         row.brightness > 0 ? 1 : 0,
      brightness:       row.brightness,
      ambient_light:    5,
      health_score:     row.health_score,
      region_id:        row.region_id,
      energy_consumed:  row.energy_consumed,
      fault_occurred:   row.fault_alert ? 1 : 0,
      fault_probability: row.fault_probability,
      day:              0,
    })
  }

  // then add everything from the in-memory history buffer
  for (const [lightId, snapshots] of Object.entries(buffer)) {
    // find this light's static info from currentState
    const lightInfo = currentState.find(r => r.light_id === lightId)
    if (!lightInfo) continue

    for (const snap of snapshots) {
      rows.push({
        light_id:         lightId,
        lamp_type:        lightInfo.lamp_type,
        weather:          snap.weather,
        rated_power:      lightInfo.rated_power,
        efficiency:       lightInfo.efficiency,
        hour:             snap.simulated_hour,
        is_night:         snap.brightness > 0 ? 1 : 0,
        brightness:       snap.brightness,
        ambient_light:    5,
        health_score:     snap.health_score,
        region_id:        lightInfo.region_id,
        energy_consumed:  snap.energy_consumed,
        fault_occurred:   snap.fault_occurred ? 1 : 0,
        fault_probability: snap.fault_probability,
        day:              0,
      })
    }
  }

  return rows
}

// ── real data retrain (state_history with is_simulated=false) ─────────────────
async function runRetrain() {
  if (isRetraining) return { alreadyRunning: true }

  isRetraining = true
  retrainProgress = {
    status: 'running', progress: 5,
    message: 'Fetching real data from database...',
    started_at: new Date().toISOString(),
    finished_at: null, last_metrics: null,
  }

  try {
    retrainProgress.progress = 10

    const { rows } = await pool.query(`
      SELECT
        sh.light_id, sh.brightness, sh.health_score,
        sh.energy_consumed, sh.fault_occurred,
        sh.fault_probability, sh.weather, sh.simulated_hour,
        sl.lamp_type, sl.rated_power, sl.efficiency,
        COALESCE(sl.region_id, 1) AS region_id
      FROM state_history sh
      JOIN street_lights sl ON sh.light_id = sl.id
      WHERE sh.is_simulated = false
      ORDER BY sh.recorded_at DESC
      LIMIT 500000
    `)

    const realCount = rows.length

    if (realCount < 100) {
      retrainProgress = {
        status: 'not_enough_data',
        progress: 0,
        message: `Not enough real data`,
        real_rows: realCount,
        rows_needed: 100,
        started_at: retrainProgress.started_at,
        finished_at: new Date().toISOString(),
        last_metrics: null,
      }
      isRetraining = false
      return { notEnoughData: true, realCount, needed: 100 }
    }

    return await _doRetrain(rows, 'real data')

  } catch (err) {
    retrainProgress = {
      status: 'failed', progress: 0,
      message: err.message,
      started_at: retrainProgress.started_at,
      finished_at: new Date().toISOString(),
      last_metrics: null,
    }
    isRetraining = false
    return { error: err.message }
  }
}

// ── force retrain (simulation buffer + twin_state) ────────────────────────────
async function runRetrainForce() {
  if (isRetraining) return { alreadyRunning: true }

  isRetraining = true
  retrainProgress = {
    status: 'running', progress: 5,
    message: 'Building training data from simulation buffer...',
    started_at: new Date().toISOString(),
    finished_at: null, last_metrics: null,
  }

  try {
    retrainProgress.progress = 10
    retrainProgress.message  = 'Reading simulation history buffer...'

    const rows = await buildTrainingRowsFromBuffer()

    if (rows.length < 100) {
      retrainProgress = {
        status: 'not_enough_data',
        progress: 0,
        message: `Not enough simulation data`,
        real_rows: rows.length,
        rows_needed: 100,
        started_at: retrainProgress.started_at,
        finished_at: new Date().toISOString(),
        last_metrics: null,
      }
      isRetraining = false
      return { notEnoughData: true, realCount: rows.length, needed: 100 }
    }

    return await _doRetrain(rows, 'simulation data')

  } catch (err) {
    retrainProgress = {
      status: 'failed', progress: 0,
      message: err.message,
      started_at: retrainProgress.started_at,
      finished_at: new Date().toISOString(),
      last_metrics: null,
    }
    isRetraining = false
    return { error: err.message }
  }
}

// ── shared training core ──────────────────────────────────────────────────────
async function _doRetrain(rows, sourceLabel) {
  console.log(`[Retrain] _doRetrain called with ${rows.length} rows from ${sourceLabel}`)
  try {
    retrainProgress.progress = 30
    retrainProgress.message  = `Sending ${rows.length.toLocaleString()} rows to model server...`
    console.log(`[Retrain] Sending to Flask at ${FLASK_URL}/retrain`)

    retrainProgress.progress = 40
    retrainProgress.message  = 'Training models (this may take 1-2 minutes)...'

    const { data } = await axios.post(
      `${FLASK_URL}/retrain`,
      { rows },
      { timeout: 360000 }
    )

    console.log(`[Retrain] Flask responded:`, JSON.stringify(data))

    retrainProgress.progress = 90
    retrainProgress.message  = 'Saving results...'

    const now = new Date().toISOString()
    await setSetting('last_retrain_at', now)
    await pool.query(`UPDATE regions SET model_status = 'ready'`)

    const metrics = {
      energy_r2:  data.energy_r2,
      roc_auc:    data.roc_auc,
      rows_used:  rows.length,
      source:     sourceLabel,
    }

    retrainProgress = {
      status:      'done',
      progress:    100,
      message:     `Retrain complete using ${sourceLabel}.`,
      started_at:  retrainProgress.started_at,
      finished_at: now,
      last_metrics: metrics,
    }

    console.log(`[Retrain] Done. R²=${data.energy_r2?.toFixed(4)} AUC=${data.roc_auc?.toFixed(4)}`)
    isRetraining = false
    return { success: true, metrics }

  } catch (err) {
    console.error(`[Retrain] _doRetrain FAILED:`, err.message)
    if (err.response) {
      console.error(`[Retrain] Flask response status:`, err.response.status)
      console.error(`[Retrain] Flask response data:`, JSON.stringify(err.response.data))
    }
    retrainProgress = {
      status:      'failed',
      progress:    0,
      message:     err.message,
      started_at:  retrainProgress.started_at,
      finished_at: new Date().toISOString(),
      last_metrics: null,
    }
    isRetraining = false
    return { error: err.message }
  }
}

// ── scheduler ─────────────────────────────────────────────────────────────────
async function schedulerTick() {
  try {
    const schedule = await getSetting('retrain_schedule') || 'weekly'
    const ms       = SCHEDULE_MS[schedule]
    if (!ms) return

    const lastRetrainStr = await getSetting('last_retrain_at')
    const lastRetrain    = lastRetrainStr ? new Date(lastRetrainStr) : new Date(0)
    const elapsed        = Date.now() - lastRetrain.getTime()

    if (elapsed >= ms) {
      console.log(`[Retrain] Scheduled trigger (${schedule})`)
      runRetrain()
    }
  } catch (err) {
    console.error('[Retrain scheduler]', err.message)
  }
}

async function setSchedule(schedule) {
  if (!SCHEDULE_MS.hasOwnProperty(schedule)) return
  await setSetting('retrain_schedule', schedule)
  console.log(`[Retrain] Schedule: ${schedule}`)
}

async function getStatus() {
  const lastRetrainAt = await getSetting('last_retrain_at')
  const schedule      = await getSetting('retrain_schedule') || 'weekly'
  const ms            = SCHEDULE_MS[schedule]

  let nextRetrainIn = 'manual only'
  if (ms && lastRetrainAt) {
    const nextMs   = Math.max(0, new Date(lastRetrainAt).getTime() + ms - Date.now())
    const nextMins = Math.round(nextMs / 60000)
    nextRetrainIn  = nextMins < 60
      ? `${nextMins} minutes`
      : nextMins < 1440
      ? `${Math.round(nextMins / 60)} hours`
      : `${Math.round(nextMins / 1440)} days`
  }

  return {
    ...retrainProgress,
    lastRetrain:   lastRetrainAt,
    schedule,
    nextRetrainIn,
    isRetraining,
  }
}

// reset stale status — called when settings page loads
function resetStatus() {
  if (!isRetraining) {
    retrainProgress = {
      status: 'idle', progress: 0, message: '',
      started_at: null, finished_at: null, last_metrics: null,
    }
  }
}

function start() {
  checkInterval = setInterval(schedulerTick, 30 * 60 * 1000)
  schedulerTick()
  console.log('[Retrain] Scheduler started')
}

module.exports = {
  start, runRetrain, runRetrainForce,
  setSchedule, getStatus, resetStatus, SCHEDULE_MS,
}