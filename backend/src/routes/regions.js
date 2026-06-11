// src/routes/regions.js
const express  = require('express')
const router   = express.Router()
const pool     = require('../db/pool')
const multer   = require('multer')
const { parse } = require('csv-parse/sync')
const fs       = require('fs')
const path     = require('path')
const { requireAuth } = require('../middleware/auth')

const upload = multer({ dest: 'uploads/' })

// GET /api/regions — all regions this user has access to
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.id, r.name, r.description, r.campus_lat, r.campus_lng,
             r.campus_zoom, r.model_status, r.created_at,
             ur.role,
             COUNT(DISTINCT sl.id)          AS light_count,
             COUNT(DISTINCT ts.light_id)
               FILTER (WHERE ts.fault_alert = true) AS fault_count,
             ROUND(AVG(ts.health_score)::numeric, 1) AS avg_health
      FROM regions r
      JOIN user_regions ur ON ur.region_id = r.id
      LEFT JOIN street_lights sl ON sl.region_id = r.id
      LEFT JOIN twin_state ts ON ts.light_id = sl.id
      WHERE ur.user_id = $1
      GROUP BY r.id, ur.role
      ORDER BY r.created_at
    `, [req.user.userId])

    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})


// GET /api/regions/:id — single region details
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.* FROM regions r
      JOIN user_regions ur ON ur.region_id = r.id
      WHERE r.id = $1 AND ur.user_id = $2
    `, [req.params.id, req.user.userId])

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Region not found or no access' })
    }
    res.json(rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})


// POST /api/regions — create new region from CSV upload
router.post('/', requireAuth, upload.single('csv'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'CSV file is required' })
  }

  const { name, description, campus_lat, campus_lng } = req.body

  if (!name) {
    fs.unlinkSync(req.file.path)
    return res.status(400).json({ error: 'Region name is required' })
  }

  try {
    const csvContent = fs.readFileSync(req.file.path, 'utf-8')
    fs.unlinkSync(req.file.path)

    // parse CSV
    const records = parse(csvContent, {
      columns:          true,
      skip_empty_lines: true,
      trim:             true,
    })

    if (records.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty' })
    }

    // validate required columns
    const required = ['light_id', 'zone', 'lamp_type', 'rated_power']
    const cols     = Object.keys(records[0])
    const missing  = required.filter(c => !cols.includes(c))
    if (missing.length > 0) {
      return res.status(400).json({
        error: `CSV missing required columns: ${missing.join(', ')}`
      })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // create region
      const regionResult = await client.query(`
        INSERT INTO regions
          (name, description, campus_lat, campus_lng, model_status, created_by)
        VALUES ($1, $2, $3, $4, 'pending', $5)
        RETURNING id
      `, [
        name,
        description || null,
        parseFloat(campus_lat) || 22.3149,
        parseFloat(campus_lng) || 87.3105,
        req.user.userId,
      ])

      const regionId = regionResult.rows[0].id

      // grant access to creating user
      await client.query(
        `INSERT INTO user_regions (user_id, region_id, role) VALUES ($1, $2, 'owner')`,
        [req.user.userId, regionId]
      )

      // deduplicate: one row per light_id for identity data
      const lightMap = {}
      const historyRows = []

      for (const row of records) {
        const id = row.light_id
        if (!lightMap[id]) {
          lightMap[id] = {
            id,
            zone:             row.zone,
            lamp_type:        row.lamp_type,
            rated_power:      parseInt(row.rated_power)      || 100,
            efficiency:       parseFloat(row.efficiency)     || 1.0,
            install_age_days: parseInt(row.install_age_days) || 0,
            initial_health:   parseFloat(row.initial_health) || 100,
            maintenance_cost: parseInt(row.maintenance_cost) || 300,
            latitude:         parseFloat(row.latitude)       || null,
            longitude:        parseFloat(row.longitude)      || null,
          }
        }

        // if row has historical readings, collect them
        if (row.timestamp || row.brightness !== undefined) {
          historyRows.push({
            light_id:         id,
            brightness:       parseFloat(row.brightness)       || 0,
            health_score:     parseFloat(row.health_score)     || 100,
            energy_consumed:  parseFloat(row.energy_consumed)  || 0,
            fault_occurred:   row.fault_occurred === 'true' || row.fault_occurred === '1',
            fault_probability: parseFloat(row.fault_probability) || 0,
            weather:          row.weather          || 'clear',
            simulated_hour:   parseInt(row.hour)   || 0,
          })
        }
      }

      // insert lights
      for (const light of Object.values(lightMap)) {
        await client.query(`
          INSERT INTO street_lights
            (id, zone, lamp_type, rated_power, efficiency,
             install_age_days, initial_health, maintenance_cost,
             latitude, longitude, region_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          ON CONFLICT (id) DO NOTHING
        `, [
          `${regionId}-${light.id}`,   // prefix with region to avoid ID clash
          light.zone, light.lamp_type, light.rated_power, light.efficiency,
          light.install_age_days, light.initial_health, light.maintenance_cost,
          light.latitude, light.longitude, regionId,
        ])

        await client.query(`
          INSERT INTO twin_state
            (light_id, brightness, status, energy_consumed, health_score,
             ambient_light, weather, fault_alert, fault_probability,
             simulated_hour, region_id)
          VALUES ($1,0,'OFF',0,$2,0,'clear',false,0,0,$3)
        `, [`${regionId}-${light.id}`, light.initial_health, regionId])
      }

      // insert history rows
      for (const h of historyRows) {
        await client.query(`
          INSERT INTO state_history
            (light_id, brightness, health_score, energy_consumed,
             fault_occurred, fault_probability, weather, simulated_hour, region_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [
          `${regionId}-${h.light_id}`,
          h.brightness, h.health_score, h.energy_consumed,
          h.fault_occurred, h.fault_probability,
          h.weather, h.simulated_hour, regionId,
        ])
      }

      await client.query('COMMIT')

      res.json({
        success:       true,
        region_id:     regionId,
        name,
        lights_added:  Object.keys(lightMap).length,
        history_rows:  historyRows.length,
        model_status:  'pending',
        message:       historyRows.length > 0
          ? 'Region created. Model training will start shortly.'
          : 'Region created with no historical data. Simulation will generate training data.',
      })

    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

  } catch (err) {
    console.error('[region create error]', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router