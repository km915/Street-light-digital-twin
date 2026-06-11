// src/pages/LightDetail.jsx
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import LocationPicker from '../components/map/LocationPicker'
import {
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer
} from 'recharts'
import client from '../api/client'
import HealthBar    from '../components/HealthBar'
import StatusBadge  from '../components/StatusBadge'
import WeatherBadge from '../components/WeatherBadge'

const WEATHERS = ['clear', 'cloudy', 'rainy', 'foggy', 'stormy']

function MaintainButton({ lightId }) {
  const [loading, setLoading] = useState(false)
  const [msg,     setMsg]     = useState(null)

  async function handle() {
    setLoading(true)
    setMsg(null)
    try {
      const res = await client.post(`/maintenance/light/${lightId}`)
      setMsg({ type: 'success',
        text: `✓ Health restored from ${res.data.health_before.toFixed(1)}% → ${res.data.health_after}%` })
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.error || err.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={handle}
        disabled={loading}
        className="px-5 py-2 bg-amber-500 text-white text-sm font-semibold rounded-lg
                   hover:bg-amber-600 disabled:opacity-50 transition-colors"
      >
        {loading ? 'Performing maintenance...' : 'Maintain this light'}
      </button>
      {msg && (
        <p className={`mt-2 text-sm ${msg.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
          {msg.text}
        </p>
      )}
    </div>
  )
}


export default function LightDetail() {
  const { id }     = useParams()
  const navigate   = useNavigate()
  const [data,     setData]     = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)

  // override panel state
  const [overrideBrightness, setOverrideBrightness] = useState('')
  const [overrideWeather,    setOverrideWeather]    = useState('')
  const [overrideMsg,        setOverrideMsg]        = useState(null)
  const [overrideLoading,    setOverrideLoading]    = useState(false)

  // what-if panel state
  const [wiBrightness, setWiBrightness] = useState(70)
  const [wiWeather,    setWiWeather]    = useState('')
  const [wiHour,       setWiHour]       = useState('')
  const [wiResult,     setWiResult]     = useState(null)
  const [wiLoading,    setWiLoading]    = useState(false)
  const [wiError,      setWiError]      = useState(null)

  // Edit location button
  const [showLocationPicker, setShowLocationPicker] = useState(false)
  const [locationMsg,        setLocationMsg]         = useState(null)

  function fetchData() {
    client.get(`/lights/${id}`)
      .then(res  => { setData(res.data); setLoading(false); setError(null) })
      .catch(err => { setError(err.response?.data?.error || err.message); setLoading(false) })
  }

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [id])

  //handler function for "Edit location" button:
  async function handleSaveLocation(coords) {
    try {
      await client.patch(`/lights/${id}/location`, {
        latitude:  coords.lat,
        longitude: coords.lng,
      })
      setLocationMsg('Location saved successfully.')
      setShowLocationPicker(false)
      fetchData()
    } catch (err) {
      setLocationMsg('Failed to save: ' + (err.response?.data?.error || err.message))
    }
  }

  async function handleOverride() {
    if (overrideBrightness === '' && overrideWeather === '') return
    setOverrideLoading(true)
    setOverrideMsg(null)
    try {
      const payload = {}
      if (overrideBrightness !== '') payload.brightness = parseFloat(overrideBrightness)
      if (overrideWeather    !== '') payload.weather    = overrideWeather
      await client.post(`/lights/${id}/override`, payload)
      setOverrideMsg({ type: 'success', text: 'Override applied — takes effect next tick' })
      setOverrideBrightness('')
      setOverrideWeather('')
    } catch (err) {
      setOverrideMsg({ type: 'error', text: err.response?.data?.error || err.message })
    } finally {
      setOverrideLoading(false)
    }
  }

  async function handleWhatIf() {
    setWiLoading(true)
    setWiError(null)
    setWiResult(null)
    try {
      const payload = {
        light_id:   id,
        brightness: parseFloat(wiBrightness),
      }
      if (wiWeather) payload.weather = wiWeather
      if (wiHour)    payload.hour    = parseInt(wiHour)
      const res = await client.post('/whatif', payload)
      setWiResult(res.data)
    } catch (err) {
      setWiError(err.response?.data?.error || err.message)
    } finally {
      setWiLoading(false)
    }
  }

  if (loading) return <div className="p-6 text-gray-400">Loading...</div>
  if (error)   return (
    <div className="p-6">
      <button onClick={() => navigate('/')} className="text-sm text-blue-600 hover:underline mb-4 block">
        ← Back to fleet
      </button>
      <div className="text-red-500 bg-red-50 rounded-xl p-4">{error}</div>
    </div>
  )
  if (!data) return null

  const { current: c, history } = data

  // build what-if comparison chart data
  const wiEnergyData = wiResult ? [
    { name: 'Baseline', value: wiResult.per_light[0].baseline_energy_kwh },
    { name: 'Proposed', value: wiResult.per_light[0].proposed_energy_kwh },
  ] : []

  const wiFaultData = wiResult ? [
    { name: 'Baseline', value: parseFloat((wiResult.per_light[0].baseline_fault_prob * 100).toFixed(2)) },
    { name: 'Proposed', value: parseFloat((wiResult.per_light[0].proposed_fault_prob * 100).toFixed(2)) },
  ] : []

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">

      <button
        onClick={() => navigate('/')}
        className="text-sm text-blue-600 hover:underline flex items-center gap-1"
      >
        ← Back to fleet
      </button>

      {/* ── current state ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">{c.light_id}</h1>
            <p className="text-gray-400 text-sm">
              {c.zone} · {c.lamp_type} · {c.rated_power}W · age {c.install_age_days}d
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <WeatherBadge weather={c.weather} />
            <StatusBadge  status={c.status} faultAlert={c.fault_alert} />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          {[
            { label: 'Brightness',    value: `${c.brightness}%`                                    },
            { label: 'Energy/hr',     value: `${Number(c.energy_consumed).toFixed(4)} kWh`          },
            { label: 'Fault risk',    value: `${(c.fault_probability * 100).toFixed(1)}%`           },
            { label: 'Simulated hr',  value: `${String(c.simulated_hour).padStart(2, '0')}:00`      },
          ].map(s => (
            <div key={s.label} className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400">{s.label}</p>
              <p className="text-lg font-semibold text-gray-700">{s.value}</p>
            </div>
          ))}
        </div>

        <HealthBar value={c.health_score} />

        {c.fault_alert && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">
            ⚠ Fault alert — probability {(c.fault_probability * 100).toFixed(1)}%
          </div>
        )}
      </div>

      {/* ── manual override ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">Manual Override</h2>
        <p className="text-xs text-gray-400 mb-4">
          Force this light to specific settings. Takes effect on the next twin engine tick (≤5s).
        </p>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Brightness (0–100)</label>
            <input
              type="number" min={0} max={100} placeholder="e.g. 60"
              value={overrideBrightness}
              onChange={e => setOverrideBrightness(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-32
                         focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Weather</label>
            <select
              value={overrideWeather}
              onChange={e => setOverrideWeather(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              <option value="">— keep current —</option>
              {WEATHERS.map(w => <option key={w}>{w}</option>)}
            </select>
          </div>
          <button
            onClick={handleOverride}
            disabled={overrideLoading || (overrideBrightness === '' && overrideWeather === '')}
            className="px-5 py-2 bg-gray-800 text-white text-sm font-medium rounded-lg
                       hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            {overrideLoading ? 'Applying...' : 'Apply override'}
          </button>
        </div>

        {/* newly added */}
        {/* ── maintenance event ── */}
        <div className="bg-white rounded-xl border border-amber-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-amber-800 mb-1">🔧 Perform Maintenance</h2>
          <p className="text-xs text-gray-400 mb-4">
            Resets this light's health to 95%. Logs the event with timestamp.
            Current health: <strong>{Number(c.health_score).toFixed(1)}%</strong>
          </p>
          <MaintainButton lightId={id} />
        </div>
        {/* /newly added */}

        {/* location assignment */}
        <div className="bg-white dark:bg-gray-800 rounded-xl
                        border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
            Map Location
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            {c.latitude && c.longitude
              ? `Current: ${Number(c.latitude).toFixed(5)}, ${Number(c.longitude).toFixed(5)}`
              : 'No location assigned yet.'
            }
          </p>
          <button
            onClick={() => setShowLocationPicker(true)}
            className="px-5 py-2 bg-blue-600 text-white text-sm font-medium
                      rounded-lg hover:bg-blue-700 transition-colors"
          >
            {c.latitude ? 'Edit location' : 'Assign location'}
          </button>
          {locationMsg && (
            <p className="mt-2 text-sm text-green-600">{locationMsg}</p>
          )}
        </div>

        {showLocationPicker && (
          <LocationPicker
            lightId={id}
            currentLat={c.latitude}
            currentLng={c.longitude}
            onSave={handleSaveLocation}
            onClose={() => setShowLocationPicker(false)}
          />
        )}


          
        {overrideMsg && (
          <p className={`mt-3 text-sm ${overrideMsg.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
            {overrideMsg.text}
          </p>
        )}
      </div>

      {/* ── what-if for this light ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 mb-1">What-If Scenario</h2>
        <p className="text-xs text-gray-400 mb-4">
          Predict how this specific light would behave under different settings — no real changes made.
        </p>
        <div className="flex flex-wrap gap-4 items-end mb-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Proposed brightness (%)</label>
            <input
              type="number" min={0} max={100}
              value={wiBrightness}
              onChange={e => setWiBrightness(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-32
                         focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Weather</label>
            <select
              value={wiWeather}
              onChange={e => setWiWeather(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              <option value="">current ({c.weather})</option>
              {WEATHERS.map(w => <option key={w}>{w}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Hour (0–23)</label>
            <input
              type="number" min={0} max={23} placeholder={`current (${c.simulated_hour})`}
              value={wiHour}
              onChange={e => setWiHour(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-36
                         focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <button
            onClick={handleWhatIf}
            disabled={wiLoading}
            className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg
                       hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {wiLoading ? 'Running...' : 'Run What-If'}
          </button>
        </div>

        {wiError && <p className="text-sm text-red-500 mb-3">{wiError}</p>}

        {wiResult && (() => {
          const p = wiResult.per_light[0]
          return (
            <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-400 mb-2 text-center">Energy consumption (kWh/hr)</p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={wiEnergyData} barCategoryGap="40%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={v => `${v.toFixed(6)} kWh`} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    <Cell fill="#94a3b8" />
                    <Cell fill="#3b82f6" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div>
              <p className="text-xs text-gray-400 mb-2 text-center">Fault risk (%)</p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={wiFaultData} barCategoryGap="40%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={v => `${v}%`} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    <Cell fill="#94a3b8" />
                    <Cell fill="#ef4444" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          )
        })()}
      </div>

      {/* ── history charts ── */}
      {history.length > 0 && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-600 mb-4">
              Health score — last {history.length} recorded hours
            </h2>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="simulated_hour" tickFormatter={h => `${h}:00`} tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip formatter={v => v.toFixed(2)} labelFormatter={h => `Hour ${h}:00`} />
                <Line type="monotone" dataKey="health_score" stroke="#3b82f6"
                      strokeWidth={2} dot={false} name="Health" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-600 mb-4">
              Energy + fault risk — last {history.length} recorded hours
            </h2>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="simulated_hour" tickFormatter={h => `${h}:00`} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="e" orientation="left"  tick={{ fontSize: 11 }} />
                <YAxis yAxisId="f" orientation="right" domain={[0, 1]} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={h => `Hour ${h}:00`} />
                <Legend />
                <Line yAxisId="e" type="monotone" dataKey="energy_consumed"
                      stroke="#10b981" strokeWidth={2} dot={false} name="Energy (kWh)" />
                <Line yAxisId="f" type="monotone" dataKey="fault_probability"
                      stroke="#ef4444" strokeWidth={2} dot={false} name="Fault risk" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {history.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400 shadow-sm">
          History will appear after a few simulation ticks.
        </div>
      )}
    </div>
  )
}