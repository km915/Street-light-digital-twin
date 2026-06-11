// src/pages/Settings.jsx
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useTwin } from '../context/TwinContext'
import client from '../api/client'

const SCHEDULE_OPTIONS = [
  { value: 'hourly',  label: 'Every hour (demo/testing)'  },
  { value: 'daily',   label: 'Every day'                  },
  { value: 'weekly',  label: 'Every week (recommended)'   },
  { value: 'monthly', label: 'Every month'                },
  { value: 'manual',  label: 'Manual only'                },
]

export default function Settings() {
  const { darkMode, toggleDarkMode } = useTwin()
  const { user, region, logout }     = useAuth()

  const [retrainStatus,     setRetrainStatus]     = useState(null)
  const [selectedSchedule,  setSelectedSchedule]  = useState('weekly')
  const [scheduleMsg,       setScheduleMsg]        = useState(null)
  const [triggerLoading,    setTriggerLoading]     = useState(false)
  const [forceLoading,      setForceLoading]       = useState(false)

  // track previous isRetraining to detect completion
  const prevRetraining = useRef(false)

  // on mount: reset stale status from previous server session
  useEffect(() => {
    client.post('/simulation/retrain/reset-status').catch(() => {})
  }, [])

  // poll status
  useEffect(() => {
    function load() {
      client.get('/simulation/retrain/status')
        .then(res => {
          const s = res.data

          if (prevRetraining.current && !s.isRetraining) {
            if (s.status === 'done' && s.last_metrics) {
              const m = s.last_metrics
              window.alert(
                `Model retraining complete!\n\n` +
                `Source:     ${m.source || 'unknown'}\n` +
                `Rows used:  ${m.rows_used?.toLocaleString() ?? '?'}\n` +
                `Energy R²:  ${m.energy_r2?.toFixed(4) ?? '?'}\n` +
                `Fault AUC:  ${m.roc_auc?.toFixed(4)   ?? '?'}`
              )
            } else if (s.status === 'failed') {
              window.alert(`Retraining failed:\n\n${s.message}`)
            }
          }

          prevRetraining.current = s.isRetraining
          setRetrainStatus(s)
          setSelectedSchedule(s.schedule || 'weekly')
        })
        .catch(() => {})
    }

    load()
    const interval = setInterval(load, 3000)   // always 3s — simple and reliable
    return () => clearInterval(interval)
  }, [])   // ← empty deps, runs once, polls forever while page is open

  async function handleSetSchedule(schedule) {
    setSelectedSchedule(schedule)
    setScheduleMsg(null)
    try {
      await client.post('/simulation/retrain/schedule', { schedule })
      setScheduleMsg({ type: 'success', text: `Schedule set to: ${schedule}` })
    } catch (err) {
      setScheduleMsg({ type: 'error', text: err.response?.data?.error || err.message })
    }
  }

  async function handleTriggerRetrain() {
    setTriggerLoading(true)
    try {
      const res = await client.post('/simulation/retrain/trigger')
      const d   = res.data

      if (d.status === 'already_running') {
        window.alert('Retraining is already in progress.')
      } else if (d.status === 'not_enough_data') {
        window.alert(
          `Cannot retrain — not enough real data.\n\n` +
          `Real data rows available: ${d.real_rows.toLocaleString()}\n` +
          `Rows needed to train:     ${d.rows_needed.toLocaleString()}\n\n` +
          `Connect a live feed to accumulate real data, or use\n` +
          `"Force retrain" to train on simulation data instead.`
        )
      } else if (d.status === 'started') {
        window.alert(
          `Retraining started!\n\n` +
          `Source: ${d.source}\n` +
          `Rows:   ${d.real_rows.toLocaleString()}\n\n` +
          `This may take 1-2 minutes. A popup will appear when complete.`
        )
      }
    } catch (err) {
      window.alert(`Error: ${err.response?.data?.error || err.message}`)
    } finally {
      setTriggerLoading(false)
    }
  }

  async function handleForceRetrain() {
    setForceLoading(true)
    try {
      const res = await client.post('/simulation/retrain/force')
      const d   = res.data

      if (d.status === 'already_running') {
        window.alert('Retraining is already in progress.')
      } else if (d.status === 'not_enough_data') {
        window.alert(
          `Cannot retrain — not enough simulation data.\n\n` +
          `Simulation rows available: ${d.real_rows.toLocaleString()}\n` +
          `Rows needed to train:      ${d.rows_needed.toLocaleString()}\n\n` +
          `Run the simulation for longer to accumulate more data.\n` +
          `The in-memory buffer holds up to 24 ticks × 50 lights = 1,200 rows.\n` +
          `Let the simulation run for at least a few minutes.`
        )
      } else if (d.status === 'started') {
        window.alert(
          `Force retraining started!\n\n` +
          `Source: ${d.source}\n` +
          `Rows:   ${d.real_rows.toLocaleString()}\n\n` +
          `This may take 1-2 minutes. A popup will appear when complete.`
        )
      }
    } catch (err) {
      window.alert(`Error: ${err.response?.data?.error || err.message}`)
    } finally {
      setForceLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-1">
        Settings
      </h1>
      <p className="text-sm text-gray-400 dark:text-gray-500 mb-8">
        Application preferences and model configuration.
      </p>

      {/* appearance */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border
                          border-gray-200 dark:border-gray-700 p-5 shadow-sm mb-6">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
          Appearance
        </h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Dark mode
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Persists across sessions
            </p>
          </div>
          <button
            onClick={toggleDarkMode}
            className={`relative inline-flex h-6 w-11 items-center rounded-full
                        transition-colors duration-200
                        ${darkMode ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full
                              bg-white shadow transition-transform duration-200
                              ${darkMode ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </section>

      {/* active region */}
      {region && (
        <section className="bg-white dark:bg-gray-800 rounded-xl border
                            border-gray-200 dark:border-gray-700 p-5 shadow-sm mb-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
            Active Region
          </h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {region.name}
              </p>
              {region.description && (
                <p className="text-xs text-gray-400 mt-0.5">{region.description}</p>
              )}
            </div>
            <button
              onClick={() => { window.location.href = '/regions' }}
              className="text-xs px-3 py-1.5 text-blue-600 dark:text-blue-400
                         border border-blue-200 dark:border-blue-700
                         rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20
                         transition-colors"
            >
              Switch region
            </button>
          </div>
        </section>
      )}

      {/* model retraining */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border
                          border-gray-200 dark:border-gray-700 p-5 shadow-sm mb-6">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
          Model Retraining
        </h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
          The global model retrains using accumulated data. Real feed data
          only by default. Use force retrain to train on simulation data.
        </p>

        {/* progress + status */}
        {retrainStatus && (
          <div className="mb-5 space-y-3">

            {/* progress bar — only while running */}
            {retrainStatus.isRetraining && (
              <div>
                <div className="flex justify-between text-xs
                                text-gray-500 dark:text-gray-400 mb-1">
                  <span className="truncate pr-2">{retrainStatus.message}</span>
                  <span className="shrink-0">{retrainStatus.progress ?? 0}%</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                  <div
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-700"
                    style={{ width: `${retrainStatus.progress ?? 0}%` }}
                  />
                </div>
              </div>
            )}

            {/* last run metrics */}
            {retrainStatus.last_metrics && !retrainStatus.isRetraining && (
              <div className="space-y-2">
                <p className="text-xs text-green-600 dark:text-green-400 font-medium">
                  Last retrain complete
                  {retrainStatus.last_metrics.source
                    ? ` (${retrainStatus.last_metrics.source})`
                    : ''}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Rows used',  value: retrainStatus.last_metrics.rows_used?.toLocaleString() },
                    { label: 'Energy R²',  value: retrainStatus.last_metrics.energy_r2?.toFixed(4)       },
                    { label: 'Fault AUC',  value: retrainStatus.last_metrics.roc_auc?.toFixed(4)         },
                  ].map(m => (
                    <div key={m.label}
                      className="bg-gray-50 dark:bg-gray-900 rounded-lg p-2 text-center">
                      <p className="text-xs text-gray-400 dark:text-gray-500">{m.label}</p>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        {m.value ?? '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* timing */}
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 text-xs
                            text-gray-500 dark:text-gray-400 space-y-1.5">
              <div className="flex justify-between">
                <span>Last retrain</span>
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {retrainStatus.lastRetrain
                    ? new Date(retrainStatus.lastRetrain).toLocaleString('en-IN')
                    : 'Never'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Next retrain</span>
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {retrainStatus.nextRetrainIn ?? '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Status</span>
                <span className={`font-medium ${
                  retrainStatus.isRetraining
                    ? 'text-blue-500'
                    : retrainStatus.status === 'done'
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-gray-500 dark:text-gray-400'
                }`}>
                  {retrainStatus.isRetraining
                    ? 'Retraining...'
                    : retrainStatus.status === 'done'
                    ? 'Done'
                    : 'Idle'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* schedule */}
        <div className="mb-5">
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-2">
            Retraining schedule
          </label>
          <div className="space-y-2">
            {SCHEDULE_OPTIONS.map(opt => (
              <label key={opt.value}
                className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="radio" name="schedule" value={opt.value}
                  checked={selectedSchedule === opt.value}
                  onChange={() => handleSetSchedule(opt.value)}
                  className="text-blue-600"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300
                                 group-hover:text-blue-600 transition-colors">
                  {opt.label}
                </span>
              </label>
            ))}
          </div>
          {scheduleMsg && (
            <p className={`mt-2 text-xs ${
              scheduleMsg.type === 'success' ? 'text-green-600' : 'text-red-500'
            }`}>
              {scheduleMsg.text}
            </p>
          )}
        </div>

        {/* buttons */}
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={handleTriggerRetrain}
            disabled={triggerLoading || retrainStatus?.isRetraining}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg
                       hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {triggerLoading ? 'Checking...' : 'Retrain (real data)'}
          </button>
          <button
            onClick={handleForceRetrain}
            disabled={forceLoading || retrainStatus?.isRetraining}
            className="px-4 py-2 text-sm bg-gray-600 dark:bg-gray-700
                       text-white rounded-lg
                       hover:bg-gray-700 dark:hover:bg-gray-600
                       disabled:opacity-40 transition-colors"
          >
            {forceLoading ? 'Checking...' : 'Force retrain (simulation)'}
          </button>
        </div>
      </section>

      {/* account */}
      <section className="bg-white dark:bg-gray-800 rounded-xl border
                          border-gray-200 dark:border-gray-700 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">
          Account
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Signed in as{' '}
          <strong className="text-gray-800 dark:text-gray-200">
            {user?.username}
          </strong>
        </p>
        <button
          onClick={() => { logout(); window.location.href = '/login' }}
          className="px-4 py-2 text-sm text-red-600 dark:text-red-400
                     border border-red-200 dark:border-red-800
                     rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20
                     transition-colors"
        >
          Sign out
        </button>
      </section>
    </div>
  )
}