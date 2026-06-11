// src/routes/fleet.js
const express = require('express')
const router  = express.Router()
const pool    = require('../db/pool')
const fs      = require('fs')
const path    = require('path')

const LAMP_DEFAULTS   = { LED: 70,   HPS: 150,  MH: 250  }
const LAMP_EFFICIENCY = { LED: 1.0,  HPS: 0.75, MH: 0.65 }
const MAINTENANCE_COST = { LED: 300, HPS: 500,  MH: 450  }

// GET /api/fleet
router.get('/', async (req, res) => {
  const rid = req.regionId
  try {
    const { rows } = await pool.query(`
      SELECT
        sl.id, sl.zone, sl.lamp_type, sl.rated_power, sl.efficiency,
        sl.install_age_days, sl.initial_health, sl.maintenance_cost,
        sl.latitude, sl.longitude, sl.region_id,
        sl.is_virtual,
        ts.health_score, ts.status, ts.brightness,
        ts.fault_alert, ts.energy_consumed, ts.weather,
        ts.fault_probability, ts.simulated_hour
      FROM street_lights sl
      JOIN twin_state ts ON sl.id = ts.light_id
      WHERE sl.region_id = $1
      ORDER BY sl.id
    `, [rid])
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/fleet/add
router.post('/add', async (req, res) => {
  const { zone, lamp_type, rated_power } = req.body
  const rid = req.regionId

  if (!zone || !lamp_type)
    return res.status(400).json({ error: 'zone and lamp_type are required' })

  if (!LAMP_DEFAULTS[lamp_type])
    return res.status(400).json({ error: 'lamp_type must be LED, HPS, or MH' })

  try {
    const { rows: existing } = await pool.query(
      `SELECT id FROM street_lights WHERE region_id = $1 ORDER BY id`, [rid]
    )
    const existingIds = new Set(existing.map(r => r.id))

    let newId = null
    for (let n = 51; n <= 999; n++) {
      const candidate = `SL-${String(n).padStart(3, '0')}`
      if (!existingIds.has(candidate)) { newId = candidate; break }
    }

    if (!newId)
      return res.status(400).json({ error: 'Limit exceeded for the network' })

    const power      = rated_power || LAMP_DEFAULTS[lamp_type]
    const efficiency = LAMP_EFFICIENCY[lamp_type]
    const mCost      = MAINTENANCE_COST[lamp_type]

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      await client.query(`
        INSERT INTO street_lights
          (id, zone, lamp_type, rated_power, efficiency,
           install_age_days, initial_health, maintenance_cost,
           region_id, is_virtual)
        VALUES ($1,$2,$3,$4,$5,0,100,$6,$7,true)
      `, [newId, zone, lamp_type, power, efficiency, mCost, rid])

      await client.query(`
        INSERT INTO twin_state
          (light_id, brightness, status, energy_consumed, health_score,
           ambient_light, weather, fault_alert, fault_probability,
           simulated_hour, region_id)
        VALUES ($1,0,'OFF',0,100,0,'clear',false,0,0,$2)
      `, [newId, rid])

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    res.json({
      success: true,
      light: {
        id: newId, zone, lamp_type,
        rated_power: power, efficiency,
        health_score: 100, status: 'OFF',
        is_virtual: true, region_id: rid,
      }
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/fleet/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params
  const rid    = req.regionId

  try {
    const check = await pool.query(
      `SELECT id FROM street_lights WHERE id = $1 AND region_id = $2`, [id, rid]
    )
    if (check.rows.length === 0)
      return res.status(404).json({ error: 'Light not found' })

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`DELETE FROM state_history   WHERE light_id = $1`, [id])
      await client.query(`DELETE FROM maintenance_log WHERE light_id = $1`, [id])
      await client.query(`DELETE FROM twin_state      WHERE light_id = $1`, [id])
      await client.query(`DELETE FROM street_lights   WHERE id = $1`,       [id])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    res.json({ success: true, removed: id })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/fleet/reset
router.post('/reset', async (req, res) => {
  const rid = req.regionId
  try {
    const jsonPath  = path.join(__dirname, '../../../ml/street_lights.json')
    const original  = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
    const originalIds = new Set(original.map(l => l.id))

    const { rows: current } = await pool.query(
      `SELECT id FROM street_lights WHERE region_id = $1`, [rid]
    )
    const toRemove = current.map(r => r.id).filter(id => !originalIds.has(id))

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      for (const id of toRemove) {
        await client.query(`DELETE FROM state_history   WHERE light_id = $1`, [id])
        await client.query(`DELETE FROM maintenance_log WHERE light_id = $1`, [id])
        await client.query(`DELETE FROM twin_state      WHERE light_id = $1`, [id])
        await client.query(`DELETE FROM street_lights   WHERE id = $1`,       [id])
      }

      for (const light of original) {
        const exists = await client.query(
          `SELECT id FROM street_lights WHERE id = $1 AND region_id = $2`,
          [light.id, rid]
        )
        if (exists.rows.length === 0) {
          await client.query(`
            INSERT INTO street_lights
              (id, zone, lamp_type, rated_power, efficiency,
               install_age_days, initial_health, maintenance_cost,
               latitude, longitude, region_id, is_virtual)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false)
          `, [
            light.id, light.zone, light.lamp_type, light.rated_power,
            light.efficiency, light.install_age_days, light.initial_health,
            light.maintenance_cost, light.latitude || null,
            light.longitude || null, rid,
          ])

          await client.query(`
            INSERT INTO twin_state
              (light_id, brightness, status, energy_consumed, health_score,
               ambient_light, weather, fault_alert, fault_probability,
               simulated_hour, region_id)
            VALUES ($1,0,'OFF',0,$2,0,'clear',false,0,0,$3)
          `, [light.id, light.initial_health, rid])
        }
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    res.json({
      success: true,
      message: 'Fleet reset to original 50 lights',
      removed: toRemove,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router