// src/components/Navbar.jsx
import { NavLink } from 'react-router-dom'
import { useState } from 'react'
import { useTwin } from '../context/TwinContext'

const SPEEDS = ['0.5x', '1x', '2x', '5x', '10x']

const DATA_SOURCES = [
  {
    value: 'no_connection',
    label: 'No connection',
    color: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  },
  {
    value: 'simulated',
    label: 'Simulated',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  },
  {
    value: 'live',
    label: 'Live feed',
    color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  },
]

function SimulatedModal({ onConfirm, onClose }) {
  const [flaskUrl, setFlaskUrl] = useState('http://localhost:5001')
  const [checking, setChecking] = useState(false)
  const [error,    setError]    = useState(null)

  async function handleConfirm() {
    setChecking(true)
    setError(null)
    try {
      const res = await fetch(`${flaskUrl}/health`, {
        signal: AbortSignal.timeout(4000),
      })
      if (!res.ok) throw new Error(`Server responded with status ${res.status}`)
      onConfirm(flaskUrl)
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        setError(
          `Could not reach Flask server at ${flaskUrl}. ` +
          `Make sure it is running with: python flask_model_api.py`
        )
      } else {
        setError(`Flask server error: ${err.message}`)
      }
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center
                    bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl
                      border border-gray-200 dark:border-gray-700
                      w-full max-w-md mx-4 p-6 space-y-4">

        <h2 className="font-semibold text-gray-800 dark:text-gray-100">
          Start simulated twin
        </h2>

        <p className="text-sm text-gray-500 dark:text-gray-400">
          The simulation requires the Flask model server to be running.
          Confirm the server URL below before connecting.
        </p>

        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
            Flask model server URL
          </label>
          <input
            type="text"
            value={flaskUrl}
            onChange={e => setFlaskUrl(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-600
                       dark:bg-gray-800 dark:text-gray-100
                       rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          <p className="text-xs text-gray-400 mt-1">
            Start the server with:
            <code className="ml-1 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
              python flask_model_api.py
            </code>
          </p>
        </div>

        {error && (
          <div className="text-sm text-red-600 dark:text-red-400
                          bg-red-50 dark:bg-red-900/20
                          rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400
                       border border-gray-200 dark:border-gray-600
                       rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800
                       transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={checking || !flaskUrl}
            className="px-5 py-2 text-sm text-white bg-blue-600
                       rounded-lg hover:bg-blue-700 disabled:opacity-40
                       transition-colors font-medium"
          >
            {checking ? 'Checking...' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}

function LiveFeedModal({ onConfirm, onClose }) {
  const [feedUrl,  setFeedUrl]  = useState('ws://localhost:5002')
  const [checking, setChecking] = useState(false)
  const [error,    setError]    = useState(null)

  async function handleConfirm() {
    if (!feedUrl.startsWith('ws://') && !feedUrl.startsWith('wss://')) {
      setError('URL must start with ws:// or wss://')
      return
    }
    setChecking(true)
    setError(null)
    try {
      await new Promise((resolve, reject) => {
        const ws      = new WebSocket(feedUrl)
        const timeout = setTimeout(() => {
          ws.close()
          reject(new Error('Connection timed out after 5 seconds'))
        }, 5000)
        ws.onopen  = () => { clearTimeout(timeout); ws.close(); resolve() }
        ws.onerror = () => { clearTimeout(timeout); reject(new Error('Could not connect to that URL')) }
      })
      onConfirm(feedUrl)
    } catch (err) {
      setError(err.message)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center
                    bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl
                      border border-gray-200 dark:border-gray-700
                      w-full max-w-md mx-4 p-6 space-y-4">

        <h2 className="font-semibold text-gray-800 dark:text-gray-100">
          Connect to live feed
        </h2>

        <p className="text-sm text-gray-500 dark:text-gray-400">
          Connect to a real street light sensor network via WebSocket.
          The live feed replaces the simulated twin engine entirely.
        </p>

        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
            Live feed WebSocket URL
          </label>
          <input
            type="text"
            value={feedUrl}
            onChange={e => setFeedUrl(e.target.value)}
            placeholder="ws://your-sensor-server:5002"
            className="w-full border border-gray-200 dark:border-gray-600
                       dark:bg-gray-800 dark:text-gray-100
                       rounded-lg px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>

        <div className="bg-amber-50 dark:bg-amber-900/20
                        border border-amber-200 dark:border-amber-700
                        rounded-lg px-3 py-2.5 space-y-1">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            Expected message format
          </p>
          <code className="block text-xs text-amber-600 dark:text-amber-500
                           bg-amber-100 dark:bg-amber-900/40 rounded px-2 py-1">
            {`{ "type": "TICK", "lights": [...], "simulatedHour": 0 }`}
          </code>
        </div>

        {error && (
          <div className="text-sm text-red-600 dark:text-red-400
                          bg-red-50 dark:bg-red-900/20
                          rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400
                       border border-gray-200 dark:border-gray-600
                       rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800
                       transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={checking || !feedUrl}
            className="px-5 py-2 text-sm text-white bg-green-600
                       rounded-lg hover:bg-green-700 disabled:opacity-40
                       transition-colors font-medium"
          >
            {checking ? 'Testing connection...' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RealTimeDisplay() {
  const { simHour, realTimestamp } = useTwin()

  const timeStr = String(simHour).padStart(2, '0') + ':00'

  const dateStr = realTimestamp
    ? realTimestamp.toLocaleDateString('en-IN', {
        day:   '2-digit',
        month: 'short',
        year:  'numeric',
      })
    : null

  return (
    <div className="text-right">
      <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 leading-none">
        {timeStr}
      </div>
      {dateStr && (
        <div className="text-xs text-gray-400 dark:text-gray-500 leading-none mt-0.5">
          {dateStr}
        </div>
      )}
    </div>
  )
}

export default function Navbar({ sidebarExpanded }) {
  const {
    connected, simHour, simState, setSimControl,
    dataSource, changeDataSource,
  } = useTwin()

  const [speedOpen,     setSpeedOpen]     = useState(false)
  const [sourceOpen,    setSourceOpen]    = useState(false)
  const [showSimModal,  setShowSimModal]  = useState(false)
  const [showLiveModal, setShowLiveModal] = useState(false)

  const linkClass = ({ isActive }) =>
    `px-4 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ` +
    (isActive
      ? 'bg-blue-600 text-white'
      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800')

  async function togglePause() {
    await setSimControl(simState.running ? 'pause' : 'resume')
  }

  async function handleSpeed(s) {
    await setSimControl('setSpeed', s)
    setSpeedOpen(false)
  }

  function handleSourceClick(value) {
    setSourceOpen(false)
    if (value === 'simulated')     { setShowSimModal(true);  return }
    if (value === 'live')          { setShowLiveModal(true); return }
    if (value === 'no_connection') { changeDataSource('no_connection') }
  }

  const currentSource = DATA_SOURCES.find(s => s.value === dataSource) || DATA_SOURCES[0]

  return (
    <>
      <header className={`
        fixed top-0 right-0 h-14 z-30
        bg-white dark:bg-gray-900
        border-b border-gray-200 dark:border-gray-700
        flex items-center justify-between px-6
        transition-all duration-300
        ${sidebarExpanded ? 'left-52' : 'left-14'}
      `}>

        {/* quick nav */}
        <div className="flex gap-2">
          <NavLink to="/"          className={linkClass}>Fleet</NavLink>
          <NavLink to="/analytics" className={linkClass}>Analytics</NavLink>
          <NavLink to="/whatif"    className={linkClass}>What-If</NavLink>
        </div>

        <div className="flex items-center gap-3">

          {/* data source selector */}
          <div className="relative">
            <button
              onClick={() => { setSourceOpen(o => !o); setSpeedOpen(false) }}
              className={`px-3 py-1 rounded-lg text-xs font-semibold
                          transition-colors ${currentSource.color}`}
            >
              {currentSource.label}
            </button>

            {sourceOpen && (
              <div className="absolute right-0 top-8 bg-white dark:bg-gray-800
                              border border-gray-200 dark:border-gray-700
                              rounded-xl shadow-lg z-50 overflow-hidden w-44">
                {DATA_SOURCES.map(s => (
                  <button
                    key={s.value}
                    onClick={() => handleSourceClick(s.value)}
                    className={`w-full text-left px-4 py-2.5 text-sm
                      hover:bg-gray-50 dark:hover:bg-gray-700
                      ${dataSource === s.value
                        ? 'font-bold text-blue-600 dark:text-blue-400'
                        : 'text-gray-700 dark:text-gray-300'
                      }`}
                  >
                    {s.label}
                    {dataSource === s.value && (
                      <span className="float-right text-blue-500">✓</span>
                    )}
                  </button>
                ))}
                <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700">
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    {dataSource === 'live'
                      ? 'Connected to real sensor network'
                      : dataSource === 'simulated'
                      ? 'Running digital twin simulation'
                      : 'No data stream active'
                    }
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* sim controls — only in simulated mode */}
          {dataSource === 'simulated' && (
            <>
              <RealTimeDisplay />

              <button
                onClick={togglePause}
                className={`px-3 py-1 rounded-lg text-xs font-semibold
                            transition-colors
                  ${simState.running
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 hover:bg-amber-200'
                    : 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 hover:bg-green-200'
                  }`}
              >
                {simState.running ? 'Pause' : 'Resume'}
              </button>

              <div className="relative">
                <button
                  onClick={() => { setSpeedOpen(o => !o); setSourceOpen(false) }}
                  className="px-3 py-1 rounded-lg text-xs font-semibold
                             bg-gray-100 dark:bg-gray-800
                             text-gray-600 dark:text-gray-400
                             hover:bg-gray-200 dark:hover:bg-gray-700
                             transition-colors"
                >
                  {simState.speed || '1x'}
                </button>

                {speedOpen && (
                  <div className="absolute right-0 top-8 bg-white dark:bg-gray-800
                                  border border-gray-200 dark:border-gray-700
                                  rounded-xl shadow-lg z-1000 overflow-hidden w-24">
                    {SPEEDS.map(s => (
                      <button
                        key={s}
                        onClick={() => handleSpeed(s)}
                        className={`w-full text-left px-4 py-2 text-sm
                          hover:bg-gray-50 dark:hover:bg-gray-700
                          ${simState.speed === s
                            ? 'font-bold text-blue-600 dark:text-blue-400'
                            : 'text-gray-700 dark:text-gray-300'
                          }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* connection indicator — hide when no_connection */}
          {dataSource !== 'no_connection' && (
            <span className={`flex items-center gap-1 px-2 py-1 rounded-full
                              text-xs font-medium
              ${connected
                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                : 'bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400'
              }`}>
              <span className={`w-1.5 h-1.5 rounded-full
                ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
              {connected ? 'Live' : 'Connecting...'}
            </span>
          )}

        </div>
      </header>

      {/* modals — rendered outside header so they're not clipped */}
      {showSimModal && (
        <SimulatedModal
          onConfirm={() => {
            changeDataSource('simulated')
            setShowSimModal(false)
          }}
          onClose={() => setShowSimModal(false)}
        />
      )}

      {showLiveModal && (
        <LiveFeedModal
          onConfirm={url => {
            changeDataSource('live', url)
            setShowLiveModal(false)
          }}
          onClose={() => setShowLiveModal(false)}
        />
      )}
    </>
  )
}