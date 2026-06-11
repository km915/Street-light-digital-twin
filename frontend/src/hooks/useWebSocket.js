// src/hooks/useWebSocket.js
import { useEffect, useRef, useState } from 'react'

export function useWebSocket(url) {
  const [lastMessage, setLastMessage] = useState(null)
  const [connected,   setConnected]   = useState(false)
  const wsRef     = useRef(null)
  const retryRef  = useRef(null)

  useEffect(() => {
    // null url = intentionally disconnected
    if (!url) {
      setConnected(false)
      setLastMessage(null)
      if (wsRef.current) {
        wsRef.current.onclose = null  // prevent retry
        wsRef.current.close()
        wsRef.current = null
      }
      return
    }

    function connect() {
      if (wsRef.current?.readyState === WebSocket.OPEN) return

      const ws      = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        console.log('WebSocket connected')
      }

      ws.onmessage = e => {
        try { setLastMessage(JSON.parse(e.data)) }
        catch {}
      }

      ws.onclose = () => {
        setConnected(false)
        retryRef.current = setTimeout(connect, 3000)
      }

      ws.onerror = () => ws.close()
    }

    connect()

    return () => {
      clearTimeout(retryRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [url])

  return { lastMessage, connected }
}