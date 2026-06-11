// src/context/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react'
import client from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,     setUser]     = useState(() => {
    const saved = localStorage.getItem('user')
    return saved ? JSON.parse(saved) : null
  })
  const [regionId, setRegionId] = useState(() =>
    localStorage.getItem('regionId') || null
  )
  const [region,   setRegion]   = useState(null)

  useEffect(() => {
    if (regionId) {
      client.get(`/regions/${regionId}`)
        .then(res => setRegion(res.data))
        .catch(() => {})
    }
  }, [regionId])

  async function login(username, password) {
    const res = await client.post('/auth/login', { username, password })
    const { token, username: uname, userId } = res.data
    localStorage.setItem('token', token)
    const u = { username: uname, userId }
    localStorage.setItem('user', JSON.stringify(u))
    setUser(u)
    return u
  }

  function logout() {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    localStorage.removeItem('regionId')
    setUser(null)
    setRegionId(null)
    setRegion(null)
  }

  function selectRegion(id) {
    localStorage.setItem('regionId', String(id))
    setRegionId(String(id))
  }

  return (
    <AuthContext.Provider value={{
      user, region, regionId,
      login, logout, selectRegion,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() { return useContext(AuthContext) }