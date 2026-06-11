// src/pages/Login.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login }    = useAuth()
  const navigate     = useNavigate()
  const [username,   setUsername]   = useState('')
  const [password,   setPassword]   = useState('')
  const [error,      setError]      = useState(null)
  const [loading,    setLoading]    = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await login(username, password)
      navigate('/regions')
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
      <div className="bg-white dark:bg-gray-900 rounded-2xl border
                      border-gray-200 dark:border-gray-700
                      shadow-lg p-8 w-full max-w-sm">

        <div className="text-center mb-8">
          <div className="text-4xl mb-3">◎</div>
          <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">
            Street Light Twin
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Sign in to your account
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              className="w-full border border-gray-200 dark:border-gray-600
                         dark:bg-gray-800 dark:text-gray-100
                         rounded-lg px-4 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="admin"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-600
                         dark:bg-gray-800 dark:text-gray-100
                         rounded-lg px-4 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="admin123"
            />
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20
                          rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold
                       rounded-lg hover:bg-blue-700 disabled:opacity-40
                       transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}