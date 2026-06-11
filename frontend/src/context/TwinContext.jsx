// src/context/TwinContext.jsx
import { createContext, useContext, useEffect, useState } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'
import client from '../api/client'

const TwinContext = createContext(null) // Leave this outside

export function TwinProvider({ children, active }) {
  // active = false on login/region pages, true inside the dashboard
  const [lights,      setLights]      = useState([])
  const [simHour,     setSimHour]     = useState(0)
  const [simState,    setSimState]    = useState({ running: true, tickMs: 5000, speed: '1x' })
  const [loading,     setLoading]     = useState(true)
  const [customZones, setCustomZones] = useState([])
  
  //  MOVED INSIDE THE COMPONENT:
  const [realTimestamp, setRealTimestamp] = useState(null) 
  const [history, setHistory] = useState({})
  
  const [dataSource,  setDataSource]  = useState(
    () => localStorage.getItem('dataSource') || 'no_connection'
  )

  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem('darkMode') === 'true'
  )

  // only connect WebSocket when active and data source is not 'no_connection'
  const wsUrl = (() => {
    if (!active || dataSource === 'no_connection') return null
    if (dataSource === 'live') return localStorage.getItem('liveUrl') || null
    const defaultWs = import.meta.env.VITE_WS_URL || `ws://${window.location.host}/ws`
    return defaultWs
  })()

  const { lastMessage, connected } = useWebSocket(wsUrl)

  const tickToSpeed = { 10000: '0.5x', 5000: '1x', 2500: '2x', 1000: '5x', 500: '10x' }

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    localStorage.setItem('darkMode', darkMode)
  }, [darkMode])

  // only fetch data when active
  useEffect(() => {
    if (!active) return

    if (dataSource === 'no_connection') {
      setLights([])
      setLoading(false)
      return
    }

    setLoading(true)
    client.get('/lights')
      .then(res => { setLights(res.data); setLoading(false) })
      .catch(() => setLoading(false))

    if (dataSource === 'simulated') {
      client.get('/simulation/state')
        .then(res => setSimState({
          ...res.data,
          speed: tickToSpeed[res.data.tickMs] || '1x'
        }))
        .catch(() => {})
    }
  }, [active, dataSource])

  useEffect(() => {
    if (!lastMessage) return
    if (lastMessage.type === 'TICK') {
      setLights(lastMessage.lights)
      setSimHour(lastMessage.simulatedHour)
      if (lastMessage.realTimestamp) {
        setRealTimestamp(new Date(lastMessage.realTimestamp))
      }
      if (lastMessage.history) {
        setHistory(lastMessage.history)
      }
      if (dataSource === 'live' && lastMessage.lights?.length > 0) {
        client.post('/simulation/live-reading', { lights: lastMessage.lights })
          .catch(() => {})
      }
    }
  }, [lastMessage, dataSource])

  // add this useEffect inside TwinProvider in TwinContext.jsx
  useEffect(() => {
    if (!active) return
    client.post('/simulation/source', { source: dataSource }).catch(() => {})
  }, [active, dataSource])

  async function setSimControl(action, speed) {
    const body = speed ? { action, speed } : { action }
    const res  = await client.post('/simulation/control', body)
    setSimState({ ...res.data, speed: tickToSpeed[res.data.tickMs] || '1x' })
  }

  function changeDataSource(source, liveUrl) {
    setDataSource(source)
    localStorage.setItem('dataSource', source)
    if (liveUrl) localStorage.setItem('liveUrl', liveUrl)
  }

  function addCustomZone(name) {
    const trimmed = name.trim()
    if (!trimmed) return
    setCustomZones(prev => prev.includes(trimmed) ? prev : [...prev, trimmed])
  }

  function resetCustomZones() { setCustomZones([]) }
  function toggleDarkMode()   { setDarkMode(prev => !prev) }

  return (
    <TwinContext.Provider value={{
      lights, simHour, simState, loading, connected,
      customZones, addCustomZone, resetCustomZones,
      setSimControl, darkMode, toggleDarkMode,
      dataSource, changeDataSource,
      realTimestamp,
      history,
    }}>
      {children}
    </TwinContext.Provider>
  )
}

export function useTwin() { return useContext(TwinContext) }