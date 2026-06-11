// src/api/client.js
import axios from 'axios'

const client = axios.create({
  //baseURL: 'http://localhost:3001/api',
  baseURL: import.meta.env.VITE_API_URL || '/api',            //for docker
  timeout: 300000,
})

// attach JWT to every request automatically
client.interceptors.request.use(config => {
  const token    = localStorage.getItem('token')
  const regionId = localStorage.getItem('regionId')
  if (token)    config.headers.Authorization  = `Bearer ${token}`
  if (regionId) config.headers['x-region-id'] = regionId
  return config
})

// redirect to login on 401
client.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      localStorage.removeItem('regionId')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default client