// src/routes/maintenance.js
const express = require('express')
const router  = express.Router()
const pool    = require('../db/pool')

const HEALTH_AFTER = 95

router.post('/light/:id', async (req, res) => {
  const { id }    = req.params
  const { notes } = req.body || {}
  const rid       = req.regionId
  try {
    const check = await pool.query(
      `SELECT ts.health_score FROM twin_state ts
       JOIN street_lights sl ON ts.light_id=sl.id
       WHERE ts.light_id=$1 AND sl.region_id=$2`,
      [id, rid]
    )
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Light not found' })
    }
    const healthBefore = parseFloat(check.rows[0].health_score)
    await pool.query(
      `UPDATE twin_state SET health_score=$1, last_updated=NOW() WHERE light_id=$2`,
      [HEALTH_AFTER, id]
    )
    await pool.query(
      `INSERT INTO maintenance_log
         (light_id, health_before, health_after, scope, notes, region_id)
       VALUES ($1,$2,$3,'single',$4,$5)`,
      [id, healthBefore, HEALTH_AFTER, notes || null, rid]
    )
    res.json({ success: true, light_id: id,
               health_before: healthBefore, health_after: HEALTH_AFTER })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/zone/:zone', async (req, res) => {
  const { zone }  = req.params
  const { notes } = req.body || {}
  const rid       = req.regionId
  try {
    const { rows: lights } = await pool.query(`
      SELECT ts.light_id, ts.health_score FROM twin_state ts
      JOIN street_lights sl ON ts.light_id=sl.id
      WHERE sl.zone=$1 AND sl.region_id=$2
    `, [zone, rid])
    if (lights.length === 0) {
      return res.status(404).json({ error: 'Zone not found or empty' })
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const light of lights) {
        await client.query(
          `UPDATE twin_state SET health_score=$1, last_updated=NOW() WHERE light_id=$2`,
          [HEALTH_AFTER, light.light_id]
        )
        await client.query(
          `INSERT INTO maintenance_log
             (light_id, health_before, health_after, scope, notes, region_id)
           VALUES ($1,$2,$3,'zone',$4,$5)`,
          [light.light_id, parseFloat(light.health_score),
           HEALTH_AFTER, notes || null, rid]
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    res.json({ success: true, zone,
               lights_maintained: lights.length, health_after: HEALTH_AFTER })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.get('/log', async (req, res) => {
  const rid = req.regionId
  const { light_id, zone } = req.query
  const conditions = [`ml.region_id=$1`]
  const params     = [rid]
  if (light_id) { params.push(light_id); conditions.push(`ml.light_id=$${params.length}`) }
  if (zone)     { params.push(zone);     conditions.push(`sl.zone=$${params.length}`)     }
  try {
    const { rows } = await pool.query(`
      SELECT ml.id, ml.light_id, ml.performed_at, ml.health_before,
             ml.health_after, ml.scope, ml.notes, sl.zone, sl.lamp_type
      FROM maintenance_log ml
      JOIN street_lights sl ON ml.light_id=sl.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ml.performed_at DESC LIMIT 200
    `, params)
    res.json(rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router