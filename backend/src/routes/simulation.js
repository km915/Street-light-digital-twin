// src/routes/simulation.js
const express = require('express');
const router  = express.Router();
const { simState, applyTickInterval } = require('../twin/engine');

let currentDataSource = 'no_connection'           // data source var

const SPEED_PRESETS = {
  '0.5x': 10000,
  '1x':   5000,
  '2x':   2500,
  '5x':   1000,
  '10x':  500,
};

// GET /api/simulation/state
router.get('/state', (req, res) => {
  res.json({
    running: simState.running,
    tickMs:  simState.tickMs,
    hour:    simState.hour,
    speed:   Object.entries(SPEED_PRESETS).find(([, v]) => v === simState.tickMs)?.[0] || 'custom',
  });
});

// POST /api/simulation/control
// body: { action: 'pause'|'resume'|'setSpeed', speed: '1x'|'2x'|... }
router.post('/control', (req, res) => {
  const { action, speed } = req.body;

  if (action === 'pause') {
    simState.running = false;
    applyTickInterval();
    console.log('[Sim] Paused');
  } else if (action === 'resume') {
    simState.running = true;
    applyTickInterval();
    console.log('[Sim] Resumed');
  } else if (action === 'setSpeed') {
    const ms = SPEED_PRESETS[speed];
    if (!ms) return res.status(400).json({ error: `Unknown speed. Use: ${Object.keys(SPEED_PRESETS).join(', ')}` });
    simState.tickMs = ms;
    applyTickInterval();
    console.log(`[Sim] Speed set to ${speed} (${ms}ms/tick)`);
  } else {
    return res.status(400).json({ error: 'action must be pause | resume | setSpeed' });
  }

  res.json({
    running: simState.running,
    tickMs:  simState.tickMs,
    hour:    simState.hour,
  });
});

// add to src/routes/simulation.js
// GET /api/simulation/source
router.get('/source', (req, res) => {
  res.json({ source: currentDataSource })
})

// POST /api/simulation/source
router.post('/source', async (req, res) => {
  const { source } = req.body
  if (!['no_connection', 'simulated', 'live'].includes(source)) {
    return res.status(400).json({ error: 'source must be no_connection | simulated | live' })
  }

  const { start, stop } = require('../twin/engine')

  // always stop first regardless of what we're switching to
  stop()
  currentDataSource = source

  if (source === 'simulated') {
    // always call start() fresh — resets time, buffer, hour counter
    await start()
    console.log('[Sim] Source: simulated — engine restarted fresh')
  } else {
    console.log(`[Sim] Source: ${source} — engine stopped`)
  }

  res.json({ source: currentDataSource, running: source === 'simulated' })
})

// replace just the retrain endpoints at the bottom of simulation.js

const scheduler = require('../twin/retrainScheduler')

router.get('/retrain/status', async (req, res) => {
  try {
    res.json(await scheduler.getStatus())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/simulation/retrain/reset-status
// called by settings page on mount to clear stale messages
router.post('/retrain/reset-status', (req, res) => {
  scheduler.resetStatus()
  res.json({ success: true })
})

// POST /api/simulation/retrain/trigger — real data only
// returns synchronously with enough info for the frontend popup
router.post('/retrain/trigger', async (req, res) => {
  if (scheduler.getStatus().then) {
    // async — just check isRetraining from the module
  }

  const status = await scheduler.getStatus()
  if (status.isRetraining) {
    return res.json({ status: 'already_running' })
  }

  // start async, but first check row count so we can tell the user immediately
  const pool = require('../db/pool')
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS count FROM state_history WHERE is_simulated = false`
  )
  const realCount = parseInt(rows[0].count)

  if (realCount < 100) {
    return res.json({
      status:     'not_enough_data',
      real_rows:  realCount,
      rows_needed: 100,
    })
  }

  res.json({ status: 'started', real_rows: realCount, source: 'real data' })
  scheduler.runRetrain()   // fire and forget after responding
})

// POST /api/simulation/retrain/force
router.post('/retrain/force', async (req, res) => {
  const status = await scheduler.getStatus()
  if (status.isRetraining) {
    return res.json({ status: 'already_running' })
  }

  // check how many rows we'd get from buffer + twin_state
  const pool = require('../db/pool')
  const { rows } = await pool.query(`SELECT COUNT(*) AS count FROM twin_state`)
  const { getBuffer } = require('../twin/engine')
  const buffer = getBuffer()
  const bufferCount = Object.values(buffer).reduce((s, arr) => s + arr.length, 0)
  const totalRows = parseInt(rows[0].count) + bufferCount

  if (totalRows < 100) {
    return res.json({
      status:      'not_enough_data',
      real_rows:   totalRows,
      rows_needed: 100,
    })
  }

  res.json({ status: 'started', real_rows: totalRows, source: 'simulation data' })
  scheduler.runRetrainForce()   // fire and forget
})

router.post('/retrain/schedule', async (req, res) => {
  const { schedule } = req.body
  if (!scheduler.SCHEDULE_MS.hasOwnProperty(schedule)) {
    return res.status(400).json({
      error: `schedule must be one of: ${Object.keys(scheduler.SCHEDULE_MS).join(', ')}`
    })
  }
  await scheduler.setSchedule(schedule)
  res.json({ success: true, schedule })
})

// POST /api/simulation/live-reading
// Called by frontend when it receives a message from the live feed WebSocket
// Writes the reading to state_history with is_simulated=false for retraining
router.post('/live-reading', async (req, res) => {
  const { lights } = req.body
  if (!lights || !Array.isArray(lights)) {
    return res.status(400).json({ error: 'Expected { lights: [...] }' })
  }

  const pool = require('../db/pool')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const l of lights) {
      // update twin_state with live reading
      await client.query(`
        UPDATE twin_state SET
          brightness=$1, status=$2, energy_consumed=$3,
          health_score=$4, ambient_light=$5, weather=$6,
          fault_alert=$7, fault_probability=$8,
          simulated_hour=$9, last_updated=NOW()
        WHERE light_id=$10
      `, [
        l.brightness, l.status || (l.brightness > 0 ? 'ON' : 'OFF'),
        l.energy_consumed || 0, l.health_score, l.ambient_light || 0,
        l.weather || 'clear', l.fault_alert || false,
        l.fault_probability || 0, l.simulated_hour || 0, l.light_id,
      ])

      // write to history with is_simulated=false — this is real data
      await client.query(`
        INSERT INTO state_history
          (light_id, brightness, health_score, energy_consumed,
           fault_occurred, fault_probability, weather,
           simulated_hour, region_id, is_simulated)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)
      `, [
        l.light_id, l.brightness, l.health_score,
        l.energy_consumed || 0,
        l.fault_alert || false,
        l.fault_probability || 0,
        l.weather || 'clear',
        l.simulated_hour || 0,
        req.regionId,
      ])
    }
    await client.query('COMMIT')
    res.json({ success: true, rows_written: lights.length })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: err.message })
  } finally {
    client.release()
  }
})

module.exports = router;