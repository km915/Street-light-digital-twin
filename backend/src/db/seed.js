// src/db/seed.js
const fs   = require('fs')
const path = require('path')
const pool = require('./pool')
require('dotenv').config()

const REGION_ID = 1   // IIT KGP is always region 1

async function seed() {
  const jsonPath = path.join(__dirname, '../../../ml/street_lights.json')
  const lights   = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))

  console.log(`Seeding ${lights.length} lights into region ${REGION_ID}...`)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // clear existing data for this region only
    await client.query(`
      DELETE FROM state_history
      WHERE light_id IN (
        SELECT id
        FROM street_lights
        WHERE region_id = $1
      )
`, [REGION_ID])
    await client.query(
      `DELETE FROM maintenance_log WHERE region_id = $1`, [REGION_ID])
    await client.query(
      `DELETE FROM twin_state
       WHERE light_id IN (
         SELECT id FROM street_lights WHERE region_id = $1
       )`, [REGION_ID])
    await client.query(
      `DELETE FROM street_lights WHERE region_id = $1`, [REGION_ID])

    for (const light of lights) {
      await client.query(
        `INSERT INTO street_lights
           (id, zone, lamp_type, rated_power, efficiency,
            install_age_days, initial_health, maintenance_cost,
            latitude, longitude, region_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          light.id, light.zone, light.lamp_type, light.rated_power,
          light.efficiency, light.install_age_days, light.initial_health,
          light.maintenance_cost,
          light.latitude  || null,
          light.longitude || null,
          REGION_ID,
        ]
      )

      await client.query(
        `INSERT INTO twin_state
           (light_id, brightness, status, energy_consumed, health_score,
            ambient_light, weather, fault_alert, fault_probability,
            simulated_hour, region_id)
         VALUES ($1,0,'OFF',0,$2,0,'clear',false,0,0,$3)`,
        [light.id, light.initial_health, REGION_ID]
      )
    }

    await client.query('COMMIT')
    console.log(`Seed complete. ${lights.filter(l => l.latitude).length} lights have coordinates.`)
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Seed failed:', err)
  } finally {
    client.release()
    await pool.end()
  }
}

seed()