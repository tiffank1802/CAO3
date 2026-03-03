/**
 * Main application store using Pinia
 * Manages projects, sketches, geometries, and UI state
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/services/api'

export const useAppStore = defineStore('app', () => {
  // ============================================================================
  // State
  // ============================================================================

  const user = ref(null)
  const isAuthenticated = ref(false)
  const projects = ref([])
  const currentProject = ref(null)
  const currentSketch = ref(null)
  const currentGeometry = ref(null)
  const sketches = ref([])
  const geometries = ref([])
  const loading = ref(false)
  const error = ref(null)

  // UI State
  const viewMode = ref('dashboard') // 'dashboard', 'sketcher', 'editor'
  const showSketcherCanvas = ref(false)
  const show3DViewer = ref(false)
  const showProperties = ref(true)

  // ============================================================================
  // Computed
  // ============================================================================

  const hasProject = computed(() => currentProject.value !== null)
  const hasSketch = computed(() => currentSketch.value !== null)
  const hasGeometry = computed(() => currentGeometry.value !== null)

  // ============================================================================
  // Actions
  // ============================================================================

  // Auth
  async function login(username, password) {
    try {
      loading.value = true
      error.value = null
      const data = await api.login(username, password)
      user.value = data.user
      isAuthenticated.value = true
      return data
    } catch (err) {
      error.value = err.response?.data?.detail || 'Login failed'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function logout() {
    try {
      await api.logout()
      user.value = null
      isAuthenticated.value = false
      currentProject.value = null
      currentSketch.value = null
      currentGeometry.value = null
    } catch (err) {
      error.value = err.message
      throw err
    }
  }

  async function fetchCurrentUser() {
    try {
      const userData = await api.getCurrentUser()
      user.value = userData
      isAuthenticated.value = true
    } catch (err) {
      isAuthenticated.value = false
    }
  }

  // Projects
  async function fetchProjects() {
    try {
      loading.value = true
      error.value = null
      const data = await api.getProjects()
      projects.value = Array.isArray(data) ? data : data.results || []
    } catch (err) {
      error.value = err.message
      projects.value = []
    } finally {
      loading.value = false
    }
  }

  async function createProject(projectData) {
    try {
      loading.value = true
      error.value = null
      const newProject = await api.createProject(projectData)
      projects.value.push(newProject)
      return newProject
    } catch (err) {
      error.value = err.response?.data?.detail || 'Failed to create project'
      throw err
    } finally {
      loading.value = false
    }
  }

  function setCurrentProject(project) {
    currentProject.value = project
    if (project) {
      fetchSketches(project.id)
      fetchGeometries(project.id)
    }
  }

  // Sketches
  async function fetchSketches(projectId) {
    try {
      loading.value = true
      error.value = null
      const data = await api.getSketches(projectId)
      sketches.value = Array.isArray(data) ? data : data.results || []
    } catch (err) {
      error.value = err.message
      sketches.value = []
    } finally {
      loading.value = false
    }
  }

  async function createSketch(projectId, sketchData) {
    try {
      loading.value = true
      error.value = null
      const newSketch = await api.createSketch(projectId, sketchData)
      sketches.value.push(newSketch)
      return newSketch
    } catch (err) {
      error.value = err.response?.data?.detail || 'Failed to create sketch'
      throw err
    } finally {
      loading.value = false
    }
  }

  function setCurrentSketch(sketch) {
    currentSketch.value = sketch
    if (sketch) {
      viewMode.value = 'sketcher'
      showSketcherCanvas.value = true
    }
  }

  // Geometries
  async function fetchGeometries(projectId) {
    try {
      loading.value = true
      error.value = null
      const data = await api.getGeometries(projectId)
      geometries.value = Array.isArray(data) ? data : data.results || []
    } catch (err) {
      error.value = err.message
      geometries.value = []
    } finally {
      loading.value = false
    }
  }

  function setCurrentGeometry(geometry) {
    currentGeometry.value = geometry
    if (geometry) {
      viewMode.value = 'editor'
      show3DViewer.value = true
    }
  }

  // CAD Operations
  async function performExtrude(length, isSymmetric = false) {
    if (!currentProject.value || !currentSketch.value) {
      throw new Error('Project and sketch required for extrude')
    }

    try {
      loading.value = true
      error.value = null
      const geometry = await api.extrude(
        currentProject.value.id,
        currentSketch.value.id,
        length,
        isSymmetric
      )
      geometries.value.push(geometry)
      setCurrentGeometry(geometry)
      return geometry
    } catch (err) {
      error.value = err.response?.data?.detail || 'Extrude operation failed'
      throw err
    } finally {
      loading.value = false
    }
  }

  async function performPocket(depth) {
    if (!currentProject.value || !currentGeometry.value || !currentSketch.value) {
      throw new Error('Project, geometry, and sketch required for pocket')
    }

    try {
      loading.value = true
      error.value = null
      const updatedGeometry = await api.pocket(
        currentProject.value.id,
        currentGeometry.value.id,
        currentSketch.value.id,
        depth
      )
      // Update geometry in list
      const index = geometries.value.findIndex((g) => g.id === updatedGeometry.id)
      if (index !== -1) {
        geometries.value[index] = updatedGeometry
      }
      setCurrentGeometry(updatedGeometry)
      return updatedGeometry
    } catch (err) {
      error.value = err.response?.data?.detail || 'Pocket operation failed'
      throw err
    } finally {
      loading.value = false
    }
  }

  // Constraint Solving
  async function solveConstraints(sketchData, constraints) {
    try {
      loading.value = true
      error.value = null
      const result = await api.solveConstraints(sketchData, constraints)
      return result
    } catch (err) {
      error.value = err.response?.data?.detail || 'Constraint solving failed'
      throw err
    } finally {
      loading.value = false
    }
  }

  // UI
  function setViewMode(mode) {
    viewMode.value = mode
  }

  function toggleProperties() {
    showProperties.value = !showProperties.value
  }

  function clearError() {
    error.value = null
  }

  return {
    // State
    user,
    isAuthenticated,
    projects,
    currentProject,
    currentSketch,
    currentGeometry,
    sketches,
    geometries,
    loading,
    error,
    viewMode,
    showSketcherCanvas,
    show3DViewer,
    showProperties,

    // Computed
    hasProject,
    hasSketch,
    hasGeometry,

    // Actions
    login,
    logout,
    fetchCurrentUser,
    fetchProjects,
    createProject,
    setCurrentProject,
    fetchSketches,
    createSketch,
    setCurrentSketch,
    fetchGeometries,
    setCurrentGeometry,
    performExtrude,
    performPocket,
    solveConstraints,
    setViewMode,
    toggleProperties,
    clearError,
  }
})
