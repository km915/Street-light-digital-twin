// src/pages/FleetView.jsx
import { useState } from 'react'
import { useTwin } from '../context/TwinContext'
import LightCard from '../components/LightCard'
import LocationPicker from '../components/map/LocationPicker'
import client from '../api/client'

const ZONES      = ['All', 'Zone-1', 'Zone-2', 'Zone-3', 'Zone-4', 'Zone-5']
const LAMP_TYPES = ['All', 'LED', 'HPS', 'MH']
const STATUSES   = ['All', 'ON', 'OFF', 'FAULT']
const LAMP_DEFAULTS = { LED: 70, HPS: 150, MH: 250 }

export default function FleetView() {
  const { lights, loading, customZones, addCustomZone, resetCustomZones } = useTwin()

  // filters
  const [zone,       setZone]       = useState('All')
  const [lampType,   setLampType]   = useState('All')
  const [status,     setStatus]     = useState('All')
  const [search,     setSearch]     = useState('')

  // maintenance
  const [maintZone,    setMaintZone]    = useState('Zone-1')
  const [maintMsg,     setMaintMsg]     = useState(null)
  const [maintLoading, setMaintLoading] = useState(false)

  // fleet management
  const [showFleetPanel, setShowFleetPanel] = useState(false)
  const [newZone,        setNewZone]        = useState('Zone-1')
  const [newLampType,    setNewLampType]     = useState('LED')
  const [newPower,       setNewPower]        = useState(70)
  const [addMsg,         setAddMsg]          = useState(null)
  const [addLoading,     setAddLoading]      = useState(false)
  const [resetLoading,   setResetLoading]    = useState(false)
  const [localLights,    setLocalLights]     = useState(null)
  const [newLat,         setNewLat]          = useState('')
  const [newLng,         setNewLng]          = useState('')
  const [showLocationForNew, setShowLocationForNew] = useState(false)

  // animations
  const [animatingIn,  setAnimatingIn]  = useState(new Set())
  const [animatingOut, setAnimatingOut] = useState(new Set())

  const displayLights = localLights || lights
  const allZones      = [...ZONES.filter(z => z !== 'All'), ...customZones]

  const filtered = displayLights.filter(l => {
    if (zone     !== 'All' && l.zone      !== zone)      return false
    if (lampType !== 'All' && l.lamp_type !== lampType)   return false
    if (status === 'FAULT' && !l.fault_alert)             return false
    if (status === 'ON'    && l.status !== 'ON')          return false
    if (status === 'OFF'   && l.status !== 'OFF')         return false
    if (search && !l.light_id?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const faultCount = displayLights.filter(l => l.fault_alert).length
  const onCount    = displayLights.filter(l => l.status === 'ON').length
  const avgHealth  = displayLights.length
    ? (displayLights.reduce((s, l) => s + Number(l.health_score), 0) / displayLights.length).toFixed(1)
    : 0

  async function handleZoneMaintenance() {
    setMaintLoading(true)
    setMaintMsg(null)
    try {
      const res = await client.post(`/maintenance/zone/${maintZone}`)
      setMaintMsg({
        type: 'success',
        text: `${res.data.lights_maintained} lights in ${maintZone} restored to ${res.data.health_after}% health`
      })
    } catch (err) {
      setMaintMsg({ type: 'error', text: err.response?.data?.error || err.message })
    } finally {
      setMaintLoading(false)
    }
  }

  async function handleAddLight() {
    setAddLoading(true)
    setAddMsg(null)
    try {
      const res = await client.post('/fleet/add', {
        zone: newZone, lamp_type: newLampType, rated_power: parseInt(newPower)
      })
      const newId    = res.data.light.id
      const newLight = {
        ...res.data.light,
        light_id: newId,
        health_score: 100, status: 'OFF',
        fault_alert: false, brightness: 0,
        weather: 'clear', fault_probability: 0,
        latitude: newLat || null, longitude: newLng || null,
      }

      if (newLat && newLng) {
        await client.patch(`/lights/${newId}/location`, {
          latitude: parseFloat(newLat), longitude: parseFloat(newLng),
        })
      }

      setAnimatingIn(prev => new Set([...prev, newId]))
      setLocalLights(prev => [...(prev || lights), newLight])
      setTimeout(() => {
        setAnimatingIn(prev => { const s = new Set(prev); s.delete(newId); return s })
      }, 600)

      setAddMsg({ type: 'success', text: `Added ${newId} to ${newZone}` })
      setNewLat('')
      setNewLng('')
    } catch (err) {
      setAddMsg({ type: 'error', text: err.response?.data?.error || err.message })
    } finally {
      setAddLoading(false)
    }
  }

  async function handleDecommission(lightId) {
    if (!window.confirm(`Decommission ${lightId}? This removes it from the network.`)) return
    setAnimatingOut(prev => new Set([...prev, lightId]))
    setTimeout(async () => {
      try {
        await client.delete(`/fleet/${lightId}`)
        setLocalLights(prev =>
          (prev || lights).filter(l => (l.light_id || l.id) !== lightId)
        )
      } catch (err) {
        setAddMsg({ type: 'error', text: err.response?.data?.error || err.message })
      }
      setAnimatingOut(prev => { const s = new Set(prev); s.delete(lightId); return s })
    }, 400)
  }

  async function handleReset() {
    if (!window.confirm('Reset fleet to original 50 lights? All virtual lights will be removed.')) return
    setResetLoading(true)
    try {
      await client.post('/fleet/reset')
      setLocalLights(null)
      resetCustomZones()
      setNewZone('Zone-1')
      setAddMsg({ type: 'success', text: 'Fleet reset to original 50 lights' })
    } catch (err) {
      setAddMsg({ type: 'error', text: err.response?.data?.error || err.message })
    } finally {
      setResetLoading(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      Loading fleet state...
    </div>
  )

  return (
    <div className="p-6 max-w-7xl mx-auto">

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Lights', value: displayLights.length, color: 'text-blue-500'  },
          { label: 'Currently ON', value: onCount,              color: 'text-green-500' },
          { label: 'Fault Alerts', value: faultCount,           color: 'text-red-500'   },
          { label: 'Avg Health',   value: `${avgHealth}%`,      color: 'text-amber-500' },
        ].map(k => (
          <div key={k.label}
            className="bg-white dark:bg-gray-800 rounded-xl
                       border border-gray-200 dark:border-gray-700
                       p-4 shadow-sm">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* filter bar */}
      <div className="bg-white dark:bg-gray-800 rounded-xl
                      border border-gray-200 dark:border-gray-700
                      p-4 mb-3 flex flex-wrap gap-4 items-center shadow-sm">
        <input
          type="text" placeholder="Search ID..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 dark:border-gray-600
                     dark:bg-gray-700 dark:text-gray-200
                     rounded-lg px-3 py-1.5 text-sm w-36
                     focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        {[
          { label: 'Zone',   options: ['All', ...allZones], value: zone,     set: setZone     },
          { label: 'Lamp',   options: LAMP_TYPES,           value: lampType, set: setLampType },
          { label: 'Status', options: STATUSES,             value: status,   set: setStatus   },
        ].map(f => (
          <div key={f.label} className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">{f.label}</span>
            <select value={f.value} onChange={e => f.set(e.target.value)}
              className="border border-gray-200 dark:border-gray-600
                         dark:bg-gray-700 dark:text-gray-200
                         rounded-lg px-2 py-1.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-400">
              {f.options.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
        ))}
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} lights shown</span>
      </div>

      {/* maintenance bar — fixed dark mode colors */}
      <div className="bg-blue-50/50 dark:bg-slate-800/40
                      border border-blue-100 dark:border-slate-700/80
                      rounded-xl p-4 mb-3 flex flex-wrap gap-4 items-center shadow-sm">
        <span className="text-sm font-semibold
                        text-blue-900 dark:text-blue-300">
          Maintenance
        </span>
        <select
          value={maintZone} onChange={e => setMaintZone(e.target.value)}
          className="border border-blue-200 dark:border-slate-600
                    dark:bg-slate-700 dark:text-slate-200
                    rounded-lg px-3 py-1.5 text-sm bg-white
                    focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {allZones.map(z => <option key={z}>{z}</option>)}
        </select>
        <button
          onClick={handleZoneMaintenance}
          disabled={maintLoading}
          className="px-4 py-1.5 bg-blue-600 dark:bg-blue-500
                    text-white text-sm font-semibold rounded-lg
                    hover:bg-blue-700 dark:hover:bg-blue-600
                    disabled:opacity-50 transition-colors"
        >
          {maintLoading ? 'Maintaining...' : 'Maintain Zone'}
        </button>
        {maintMsg && (
          <span className={`text-sm font-medium
            ${maintMsg.type === 'success'
              ? 'text-green-700 dark:text-green-400'
              : 'text-red-600 dark:text-red-400'}`}>
            {maintMsg.text}
          </span>
        )}
      </div>

      {/* fleet management — proper button */}
      <div className="mb-4">
        <button
          onClick={() => setShowFleetPanel(o => !o)}
          className="px-4 py-2 text-sm font-medium
                     bg-gray-100 dark:bg-gray-800
                     text-gray-700 dark:text-gray-300
                     border border-gray-200 dark:border-gray-700
                     rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700
                     transition-colors flex items-center gap-2"
        >
          <span>{showFleetPanel ? '▲' : '▼'}</span>
          Fleet Management
          <span className="text-xs text-gray-400 dark:text-gray-500 font-normal">
            add / decommission lights
          </span>
        </button>
      </div>

      {/* fleet management panel */}
      {showFleetPanel && (
        <div className="bg-gray-50 dark:bg-gray-900
                        border border-gray-200 dark:border-gray-700
                        rounded-xl p-5 mb-6 shadow-sm">
          <div className="flex flex-wrap gap-4 items-end mb-4">

            {/* zone */}
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Zone</label>
              <select
                value={newZone}
                onChange={e => {
                  if (e.target.value === '__new__') {
                    const name = window.prompt('Enter new zone name (e.g. Zone-6):')
                    if (name && name.trim()) {
                      addCustomZone(name)
                      setNewZone(name.trim())
                    }
                  } else {
                    setNewZone(e.target.value)
                  }
                }}
                className="border border-gray-200 dark:border-gray-600
                           dark:bg-gray-800 dark:text-gray-200
                           rounded-lg px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {allZones.map(z => <option key={z} value={z}>{z}</option>)}
                <option value="__new__">+ New zone...</option>
              </select>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Selected: <strong>{newZone}</strong>
              </p>
            </div>

            {/* lamp type */}
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Lamp type</label>
              <select
                value={newLampType}
                onChange={e => { setNewLampType(e.target.value); setNewPower(LAMP_DEFAULTS[e.target.value]) }}
                className="border border-gray-200 dark:border-gray-600
                           dark:bg-gray-800 dark:text-gray-200
                           rounded-lg px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {['LED', 'HPS', 'MH'].map(l => <option key={l}>{l}</option>)}
              </select>
            </div>

            {/* rated power */}
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Rated power (W)</label>
              <input
                type="number" value={newPower}
                onChange={e => setNewPower(e.target.value)}
                className="border border-gray-200 dark:border-gray-600
                           dark:bg-gray-800 dark:text-gray-200
                           rounded-lg px-3 py-2 text-sm w-24
                           focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {/* location picker */}
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
                Location (optional)
              </label>
              <button
                onClick={() => setShowLocationForNew(true)}
                className="border border-gray-200 dark:border-gray-600
                           dark:bg-gray-800 dark:text-gray-300
                           rounded-lg px-3 py-2 text-sm
                           hover:bg-gray-50 dark:hover:bg-gray-700
                           transition-colors"
              >
                {newLat && newLng
                  ? `${parseFloat(newLat).toFixed(4)}, ${parseFloat(newLng).toFixed(4)}`
                  : 'Pick on map'
                }
              </button>
            </div>

            <button
              onClick={handleAddLight}
              disabled={addLoading}
              className="px-5 py-2 bg-blue-600 text-white text-sm font-semibold
                         rounded-lg hover:bg-blue-700 disabled:opacity-50
                         transition-colors"
            >
              {addLoading ? 'Adding...' : '+ Add Light'}
            </button>

            <button
              onClick={handleReset}
              disabled={resetLoading}
              className="ml-auto px-4 py-2 text-xs
                         text-gray-500 dark:text-gray-400
                         border border-gray-200 dark:border-gray-600
                         rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700
                         disabled:opacity-50 transition-colors"
            >
              {resetLoading ? 'Resetting...' : 'Reset to original 50'}
            </button>
          </div>

          {addMsg && (
            <p className={`text-sm ${addMsg.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
              {addMsg.text}
            </p>
          )}
        </div>
      )}

      {/* light grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {filtered.map(light => {
          const id    = light.light_id || light.id
          const isIn  = animatingIn.has(id)
          const isOut = animatingOut.has(id)
          return (
            <div
              key={id}
              style={{
                transition: 'all 0.4s ease',
                opacity:   isOut ? 0    : isIn ? 0.3 : 1,
                transform: isOut ? 'scale(0.8)' : isIn ? 'scale(1.05)' : 'scale(1)',
              }}
            >
              <LightCard
                light={{ ...light, light_id: id }}
                onDecommission={showFleetPanel ? () => handleDecommission(id) : null}
              />
            </div>
          )
        })}
      </div>

      {showLocationForNew && (
        <LocationPicker
          lightId="new light"
          currentLat={newLat || null}
          currentLng={newLng || null}
          onSave={coords => {
            setNewLat(coords.lat)
            setNewLng(coords.lng)
            setShowLocationForNew(false)
          }}
          onClose={() => setShowLocationForNew(false)}
        />
      )}
    </div>
  )
}