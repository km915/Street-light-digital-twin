// src/pages/RegionSelector.jsx
import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import client from '../api/client'

const MODEL_STATUS_LABEL = {
  ready:    { label: 'Ready',    color: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'  },
  pending:  { label: 'Pending',  color: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'  },
  training: { label: 'Training', color: 'bg-blue-100  text-blue-700  dark:bg-blue-900  dark:text-blue-300'   },
  failed:   { label: 'Failed',   color: 'bg-red-100   text-red-700   dark:bg-red-900   dark:text-red-300'    },
}

export default function RegionSelector() {
  const { user, logout, selectRegion } = useAuth()
  const navigate = useNavigate()

  const [regions,     setRegions]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [showAdd,     setShowAdd]     = useState(false)

  useEffect(() => {
    client.get('/regions')
      .then(res => { setRegions(res.data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function handleSelectRegion(region) {
    if (region.model_status !== 'ready') return
    selectRegion(region.id)
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6">

      {/* header */}
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
              Your Regions
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              Signed in as <strong className="text-gray-600 dark:text-gray-300">
                {user?.username}
              </strong>
            </p>
          </div>
          <button
            onClick={logout}
            className="text-sm text-gray-500 dark:text-gray-400
                       hover:text-gray-700 dark:hover:text-gray-200
                       transition-colors"
          >
            Sign out
          </button>
        </div>

        {/* region tiles */}
        {loading ? (
          <div className="text-gray-400 text-sm">Loading regions...</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">

            {regions.map(region => {
              const status = MODEL_STATUS_LABEL[region.model_status] || MODEL_STATUS_LABEL.pending
              const isReady = region.model_status === 'ready'

              return (
                <div
                  key={region.id}
                  onClick={() => handleSelectRegion(region)}
                  className={`
                    bg-white dark:bg-gray-900
                    border-2 rounded-2xl p-6 shadow-sm
                    transition-all duration-200
                    ${isReady
                      ? 'border-gray-200 dark:border-gray-700 cursor-pointer hover:border-blue-400 hover:shadow-md'
                      : 'border-gray-100 dark:border-gray-800 cursor-not-allowed opacity-70'
                    }
                  `}
                >
                  {/* region name + status */}
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="font-bold text-gray-800 dark:text-gray-100">
                        {region.name}
                      </h2>
                      {region.description && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {region.description}
                        </p>
                      )}
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ml-2 ${status.color}`}>
                      {status.label}
                    </span>
                  </div>

                  {/* stats */}
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {[
                      { label: 'Lights',  value: region.light_count || 0      },
                      { label: 'Faults',  value: region.fault_count || 0,
                        color: Number(region.fault_count) > 0 ? 'text-red-500' : 'text-gray-700 dark:text-gray-300' },
                      { label: 'Health',  value: region.avg_health ? `${region.avg_health}%` : '—',
                        color: 'text-green-600'                                },
                    ].map(s => (
                      <div key={s.label} className="text-center">
                        <p className={`text-lg font-bold ${s.color || 'text-gray-700 dark:text-gray-300'}`}>
                          {s.value}
                        </p>
                        <p className="text-xs text-gray-400">{s.label}</p>
                      </div>
                    ))}
                  </div>

                  {!isReady && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {region.model_status === 'training'
                        ? 'Models are being trained — please wait...'
                        : 'Models not yet trained. Upload historical data to get started.'
                      }
                    </p>
                  )}

                  {isReady && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                      Click to open dashboard
                    </p>
                  )}
                </div>
              )
            })}

            {/* add new region tile */}
            <div
              onClick={() => setShowAdd(true)}
              className="bg-white dark:bg-gray-900
                         border-2 border-dashed border-gray-300 dark:border-gray-700
                         rounded-2xl p-6 shadow-sm cursor-pointer
                         hover:border-blue-400 hover:shadow-md
                         transition-all duration-200
                         flex flex-col items-center justify-center gap-3
                         min-h-45"
            >
              <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800
                              flex items-center justify-center
                              text-2xl text-gray-400">
                +
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  Add region
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Upload a CSV to create a new region
                </p>
              </div>
            </div>

          </div>
        )}
      </div>

      {/* add region modal */}
      {showAdd && (
        <AddRegionModal
          onClose={() => setShowAdd(false)}
          onCreated={newRegion => {
            setRegions(r => [...r, newRegion])
            setShowAdd(false)
          }}
        />
      )}
    </div>
  )
}


function AddRegionModal({ onClose, onCreated }) {
  const [name,       setName]       = useState('')
  const [description, setDescription] = useState('')
  const [campusLat,  setCampusLat]  = useState('')
  const [campusLng,  setCampusLng]  = useState('')
  const [csvFile,    setCsvFile]    = useState(null)
  const [dragging,   setDragging]   = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)
  const fileRef = useRef()

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file?.name.endsWith('.csv')) setCsvFile(file)
    else setError('Only CSV files are accepted')
  }

  async function handleSubmit() {
    if (!name || !csvFile) {
      setError('Region name and CSV file are required')
      return
    }
    setLoading(true)
    setError(null)

    const formData = new FormData()
    formData.append('csv',         csvFile)
    formData.append('name',        name)
    formData.append('description', description)
    if (campusLat) formData.append('campus_lat', campusLat)
    if (campusLng) formData.append('campus_lng', campusLng)

    try {
      // multer upload needs different content-type header — use fetch directly
      const token    = localStorage.getItem('token')
      const response = await fetch('http://localhost:3001/api/regions', {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
        body:    formData,
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error)
      onCreated({ ...data, model_status: 'pending', light_count: data.lights_added })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center
                    bg-black bg-opacity-60">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl
                      w-full max-w-lg mx-4">

        {/* header */}
        <div className="flex items-center justify-between px-6 py-4
                        border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">
            Add new region
          </h2>
          <button onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl font-bold
                       w-8 h-8 flex items-center justify-center">
            x
          </button>
        </div>

        <div className="p-6 space-y-4">

          {/* name */}
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
              Region name
            </label>
            <input
              type="text" value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. IIT Bombay"
              className="w-full border border-gray-200 dark:border-gray-600
                         dark:bg-gray-800 dark:text-gray-100
                         rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          {/* description */}
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
              Description (optional)
            </label>
            <input
              type="text" value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Main campus lighting network"
              className="w-full border border-gray-200 dark:border-gray-600
                         dark:bg-gray-800 dark:text-gray-100
                         rounded-lg px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          {/* campus center */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
                Campus latitude (optional)
              </label>
              <input
                type="number" step="any" value={campusLat}
                onChange={e => setCampusLat(e.target.value)}
                placeholder="22.3149"
                className="w-full border border-gray-200 dark:border-gray-600
                           dark:bg-gray-800 dark:text-gray-100
                           rounded-lg px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
                Campus longitude (optional)
              </label>
              <input
                type="number" step="any" value={campusLng}
                onChange={e => setCampusLng(e.target.value)}
                placeholder="87.3105"
                className="w-full border border-gray-200 dark:border-gray-600
                           dark:bg-gray-800 dark:text-gray-100
                           rounded-lg px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
          </div>

          {/* CSV drop zone */}
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
              Historical data CSV
            </label>
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={`
                border-2 border-dashed rounded-xl p-6 text-center cursor-pointer
                transition-colors duration-150
                ${dragging
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 dark:border-gray-600 hover:border-blue-300'
                }
              `}
            >
              <input
                ref={fileRef} type="file" accept=".csv"
                className="hidden"
                onChange={e => setCsvFile(e.target.files[0])}
              />
              {csvFile ? (
                <div>
                  <p className="text-sm font-medium text-green-600 dark:text-green-400">
                    {csvFile.name}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {(csvFile.size / 1024).toFixed(1)} KB — click to change
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Drop CSV file here or click to browse
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Required columns: light_id, zone, lamp_type, rated_power
                  </p>
                  <p className="text-xs text-gray-400">
                    Optional: efficiency, install_age_days, initial_health,
                    latitude, longitude, timestamp, brightness, health_score,
                    energy_consumed, fault_occurred, weather, hour
                  </p>
                </div>
              )}
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20
                          rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* footer */}
        <div className="flex justify-end gap-3 px-6 py-4
                        border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400
                       border border-gray-200 dark:border-gray-600
                       rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800
                       transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !name || !csvFile}
            className="px-5 py-2 text-sm text-white bg-blue-600
                       rounded-lg hover:bg-blue-700 disabled:opacity-40
                       transition-colors font-medium"
          >
            {loading ? 'Creating...' : 'Create region'}
          </button>
        </div>

      </div>
    </div>
  )
}