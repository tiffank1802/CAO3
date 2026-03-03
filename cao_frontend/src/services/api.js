/**
 * API Service - Central point for all backend communication
 * Handles authentication, requests, and WebSocket connections
 */

import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'
const WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws'

class APIService {
  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    this.token = localStorage.getItem('auth_token')
    if (this.token) {
      this.setAuthToken(this.token)
    }

    // Add response interceptor for auth errors
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          // Handle unauthorized - clear token and redirect to login
          this.clearAuth()
          window.location.href = '/login'
        }
        return Promise.reject(error)
      }
    )
  }

  setAuthToken(token) {
    this.token = token
    localStorage.setItem('auth_token', token)
    this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`
  }

  clearAuth() {
    this.token = null
    localStorage.removeItem('auth_token')
    delete this.client.defaults.headers.common['Authorization']
  }

  // ============================================================================
  // User & Auth APIs
  // ============================================================================

  async login(username, password) {
    const response = await this.client.post('/auth/token/', {
      username,
      password,
    })
    if (response.data.access) {
      this.setAuthToken(response.data.access)
    }
    return response.data
  }

  async logout() {
    this.clearAuth()
  }

  async register(userData) {
    const response = await this.client.post('/auth/register/', userData)
    if (response.data.access) {
      this.setAuthToken(response.data.access)
    }
    return response.data
  }

  async getCurrentUser() {
    return this.client.get('/auth/me/')
  }

  // ============================================================================
  // Project APIs
  // ============================================================================

  async getProjects() {
    const response = await this.client.get('/projects/')
    return response.data
  }

  async getProject(projectId) {
    const response = await this.client.get(`/projects/${projectId}/`)
    return response.data
  }

  async createProject(projectData) {
    const response = await this.client.post('/projects/', projectData)
    return response.data
  }

  async updateProject(projectId, projectData) {
    const response = await this.client.put(`/projects/${projectId}/`, projectData)
    return response.data
  }

  async deleteProject(projectId) {
    await this.client.delete(`/projects/${projectId}/`)
  }

  // ============================================================================
  // Sketch APIs
  // ============================================================================

  async getSketches(projectId) {
    const response = await this.client.get(`/sketches/?project=${projectId}`)
    return response.data
  }

  async getSketch(sketchId) {
    const response = await this.client.get(`/sketches/${sketchId}/`)
    return response.data
  }

  async createSketch(projectId, sketchData) {
    const response = await this.client.post('/sketches/', {
      project: projectId,
      ...sketchData,
    })
    return response.data
  }

  async updateSketch(sketchId, sketchData) {
    const response = await this.client.put(`/sketches/${sketchId}/`, sketchData)
    return response.data
  }

  async deleteSketch(sketchId) {
    await this.client.delete(`/sketches/${sketchId}/`)
  }

  // ============================================================================
  // Sketcher Operations (2D Constraint Solving)
  // ============================================================================

  async validateSketch(sketchData) {
    const response = await this.client.post('/sketcher/validate/', {
      sketch_data: sketchData,
    })
    return response.data
  }

  async solveConstraints(sketchData, constraints) {
    const response = await this.client.post('/sketcher/solve-constraints/', {
      sketch_data: sketchData,
      constraints: constraints,
    })
    return response.data
  }

  // ============================================================================
  // Geometry & CAD Operations
  // ============================================================================

  async getGeometries(projectId) {
    const response = await this.client.get(`/geometries/?project=${projectId}`)
    return response.data
  }

  async getGeometry(geometryId) {
    const response = await this.client.get(`/geometries/${geometryId}/`)
    return response.data
  }

  async extrude(projectId, sketchId, length, isSymmetric = false) {
    const response = await this.client.post('/operations/extrude/', {
      project_id: projectId,
      sketch_id: sketchId,
      length: length,
      is_symmetric: isSymmetric,
    })
    return response.data
  }

  async pocket(projectId, geometryId, sketchId, depth) {
    const response = await this.client.post('/operations/pocket/', {
      project_id: projectId,
      geometry_id: geometryId,
      sketch_id: sketchId,
      depth: depth,
    })
    return response.data
  }

  async getSTEPFile(geometryId) {
    const response = await this.client.get(
      `/geometries/${geometryId}/step/`,
      { responseType: 'blob' }
    )
    return response.data
  }

  async getSTLFile(geometryId) {
    const response = await this.client.get(
      `/geometries/${geometryId}/stl/`,
      { responseType: 'blob' }
    )
    return response.data
  }

  // ============================================================================
  // WebSocket Connection
  // ============================================================================

  connectWebSocket(projectId, onMessage, onError) {
    const wsUrl = `${WS_BASE_URL}/collaboration/${projectId}/?token=${this.token}`
    
    const ws = new WebSocket(wsUrl)
    
    ws.onopen = () => {
      console.log('WebSocket connected')
    }
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onMessage?.(data)
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error)
      }
    }
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      onError?.(error)
    }
    
    ws.onclose = () => {
      console.log('WebSocket disconnected')
    }
    
    return ws
  }
}

// Export singleton instance
export default new APIService()
