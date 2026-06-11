// src/routes/lights.js
const express = require('express')
const router  = express.Router()
const pool    = require('../db/pool')

router.get('/analytics/fleet', async (req, res) => {
  const rid = req.regionId
  try {
    const kpis = await pool.query(`
      SELECT
        COUNT(*)                                                          AS total_lights,
        COUNT(*) FILTER (WHERE ts.status = 'ON')                         AS lights_on,
        COUNT(*) FILTER (WHERE ts.fault_alert = true)                    AS fault_alerts,
        ROUND(AVG(ts.health_score)::numeric, 2)                          AS avg_health,
        ROUND(SUM(ts.energy_consumed)::numeric, 6)                       AS total_energy_kwh,
        ROUND(AVG(ts.brightness) FILTER (WHERE ts.brightness > 0)::numeric, 1)
                                                                          AS avg_brightness
      FROM twin_state ts
      JOIN street_lights sl ON ts.light_id = sl.id
      WHERE sl.region_id = $1
    `, [rid])

    const byZone = await pool.query(`
      SELECT
        sl.zone,
        COUNT(*)                                               AS lights,
        COUNT(*) FILTER (WHERE ts.fault_alert = true)         AS faults,
        ROUND(AVG(ts.health_score)::numeric, 2)               AS avg_health,
        ROUND(SUM(ts.energy_consumed)::numeric, 6)            AS total_energy_kwh
      FROM twin_state ts
      JOIN street_lights sl ON ts.light_id = sl.id
      WHERE sl.region_id = $1
      GROUP BY sl.zone ORDER BY sl.zone
    `, [rid])

    const faultHistory = await pool.query(`
      SELECT
        sh.simulated_hour,
        COUNT(*) FILTER (WHERE sh.fault_occurred = true)      AS faults,
        ROUND(SUM(sh.energy_consumed)::numeric, 6)            AS total_energy,
        ROUND(AVG(sh.health_score)::numeric, 2)               AS avg_health
      FROM state_history sh
      JOIN street_lights sl ON sh.light_id = sl.id
      WHERE sl.region_id = $1
      GROUP BY sh.simulated_hour
      ORDER BY sh.simulated_hour
    `, [rid])

    res.json({
      fleet:          kpis.rows[0],
      by_zone:        byZone.rows,
      hourly_history: faultHistory.rows,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/analytics/zone-history', async (req, res) => {
  const rid = req.regionId
  try {
    const { getBuffer } = require('../twin/engine')
    const buffer = getBuffer()

    // buffer is { 'SL-001': [{simulated_hour, zone, brightness, ...}], ... }
    // we need to aggregate it into hourly zone stats

    const hourMap = {}

    for (const [lightId, snapshots] of Object.entries(buffer)) {
      for (const snap of snapshots) {
        const h = snap.simulated_hour
        if (!hourMap[h]) hourMap[h] = {}
        const z = snap.zone
        if (!hourMap[h][z]) {
          hourMap[h][z] = {
            total_energy:   0,
            health_sum:     0,
            health_count:   0,
            fault_count:    0,
            brightness_sum: 0,
            brightness_count: 0,
          }
        }
        const bucket = hourMap[h][z]
        bucket.total_energy   += snap.energy_consumed || 0
        bucket.health_sum     += snap.health_score    || 0
        bucket.health_count   += 1
        if (snap.fault_occurred) bucket.fault_count += 1
        if (snap.brightness > 0) {
          bucket.brightness_sum   += snap.brightness
          bucket.brightness_count += 1
        }
      }
    }

    // flatten to array keyed by hour with one key per zone
    const hourly = Object.entries(hourMap)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([hour, zones]) => {
        const entry = { simulated_hour: Number(hour) }
        for (const [zone, data] of Object.entries(zones)) {
          entry[`${zone}_energy`]     = parseFloat(data.total_energy.toFixed(6))
          entry[`${zone}_health`]     = data.health_count > 0
            ? parseFloat((data.health_sum / data.health_count).toFixed(2))
            : 0
          entry[`${zone}_faults`]     = data.fault_count
          entry[`${zone}_brightness`] = data.brightness_count > 0
            ? parseFloat((data.brightness_sum / data.brightness_count).toFixed(1))
            : 0
        }
        return entry
      })

    // also build by_zone for the zone detail table
    const byZoneMap = {}
    for (const hourEntry of Object.values(hourMap)) {
      for (const [zone, data] of Object.entries(hourEntry)) {
        if (!byZoneMap[zone]) byZoneMap[zone] = []
        // already accumulated above — skip
      }
    }

    res.json({ hourly, by_zone: {} })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/analytics/maintenance-summary', async (req, res) => {
  const rid = req.regionId
  try {
    const recent = await pool.query(`
      SELECT ml.light_id, ml.performed_at, ml.health_before,
             ml.health_after, ml.scope, ml.notes, sl.zone, sl.lamp_type
      FROM maintenance_log ml
      JOIN street_lights sl ON ml.light_id = sl.id
      WHERE sl.region_id = $1
      ORDER BY ml.performed_at DESC
      LIMIT 50
    `, [rid])

    const byZone = await pool.query(`
      SELECT sl.zone, COUNT(*) AS events,
             ROUND(AVG(ml.health_before)::numeric, 1) AS avg_health_before
      FROM maintenance_log ml
      JOIN street_lights sl ON ml.light_id = sl.id
      WHERE sl.region_id = $1
      GROUP BY sl.zone ORDER BY sl.zone
    `, [rid])

    res.json({
      recent_events: recent.rows,
      by_zone: byZone.rows.map(r => ({
        ...r,
        events:            Number(r.events),
        avg_health_before: Number(r.avg_health_before),
      })),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/zone/:zone', async (req, res) => {
  const rid = req.regionId
  try {
    const { rows } = await pool.query(`
      SELECT ts.*, sl.zone, sl.lamp_type, sl.rated_power, sl.efficiency
      FROM twin_state ts
      JOIN street_lights sl ON ts.light_id = sl.id
      WHERE sl.zone = $1 AND sl.region_id = $2
      ORDER BY ts.light_id
    `, [req.params.zone, rid])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/', async (req, res) => {
  const rid = req.regionId
  try {
    const { rows } = await pool.query(`
      SELECT
        ts.light_id, ts.brightness, ts.status, ts.energy_consumed,
        ts.health_score, ts.ambient_light, ts.weather,
        ts.fault_alert, ts.fault_probability, ts.simulated_hour,
        ts.last_updated,
        sl.zone, sl.lamp_type, sl.rated_power, sl.efficiency,
        sl.maintenance_cost, sl.latitude, sl.longitude
      FROM twin_state ts
      JOIN street_lights sl ON ts.light_id = sl.id
      WHERE sl.region_id = $1
      ORDER BY ts.light_id
    `, [rid])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/:id', async (req, res) => {
  const rid = req.regionId
  try {
    const stateResult = await pool.query(`
      SELECT ts.*, sl.zone, sl.lamp_type, sl.rated_power,
             sl.efficiency, sl.maintenance_cost, sl.install_age_days,
             sl.latitude, sl.longitude
      FROM twin_state ts
      JOIN street_lights sl ON ts.light_id = sl.id
      WHERE ts.light_id = $1 AND sl.region_id = $2
    `, [req.params.id, rid])

    if (stateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Light not found' })
    }

    const historyResult = await pool.query(`
      SELECT brightness, health_score, energy_consumed,
             fault_occurred, fault_probability, weather,
             simulated_hour, recorded_at
      FROM state_history
      WHERE light_id = $1
      ORDER BY recorded_at DESC
      LIMIT 48
    `, [req.params.id])

    res.json({
      current: stateResult.rows[0],
      history: historyResult.rows.reverse(),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.patch('/:id/location', async (req, res) => {
  const { id } = req.params
  const { latitude, longitude } = req.body
  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: 'latitude and longitude required' })
  }
  try {
    const result = await pool.query(
      `UPDATE street_lights SET latitude=$1, longitude=$2
       WHERE id=$3 AND region_id=$4
       RETURNING id, latitude, longitude`,
      [parseFloat(latitude), parseFloat(longitude), id, req.regionId]
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Light not found' })
    }
    res.json({ success: true, ...result.rows[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/:id/override', async (req, res) => {
  const { id } = req.params
  const { brightness, weather } = req.body || {}
  try {
    const check = await pool.query(
      `SELECT ts.light_id FROM twin_state ts
       JOIN street_lights sl ON ts.light_id = sl.id
       WHERE ts.light_id=$1 AND sl.region_id=$2`,
      [id, req.regionId]
    )
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Light not found' })
    }
    const updates = []
    const params  = []
    if (brightness !== undefined) {
      params.push(parseFloat(brightness))
      updates.push(`brightness=$${params.length}`)
      params.push(brightness > 0 ? 'ON' : 'OFF')
      updates.push(`status=$${params.length}`)
    }
    if (weather !== undefined) {
      params.push(weather)
      updates.push(`weather=$${params.length}`)
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: 'Provide brightness or weather' })
    }
    params.push(id)
    await pool.query(
      `UPDATE twin_state SET ${updates.join(', ')}, last_updated=NOW()
       WHERE light_id=$${params.length}`,
      params
    )
    const { rows } = await pool.query(`
      SELECT ts.*, sl.zone, sl.lamp_type, sl.rated_power,
             sl.efficiency, sl.maintenance_cost
      FROM twin_state ts
      JOIN street_lights sl ON ts.light_id=sl.id
      WHERE ts.light_id=$1
    `, [id])
    res.json({ success: true, light: rows[0] })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router