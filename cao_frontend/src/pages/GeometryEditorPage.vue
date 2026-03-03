<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAppStore } from '@/stores/app'
import api from '@/services/api'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

const router = useRouter()
const route = useRoute()
const store = useAppStore()

// State
const geometryId = ref(route.params.id)
const geometry = ref(null)
const loading = ref(false)
const error = ref('')
const renderer = ref(null)
const scene = ref(null)
const camera = ref(null)
const renderContainer = ref(null)
const controls = ref(null)

// Properties display
const properties = ref({
  volume: 0,
  boundingBox: { 
    x_min: 0, x_max: 0,
    y_min: 0, y_max: 0,
    z_min: 0, z_max: 0,
    width: 0, height: 0, depth: 0
  },
})

// Load geometry
const loadGeometry = async () => {
  loading.value = true
  error.value = ''

  try {
    const geometryData = await api.getGeometry(geometryId.value)
    geometry.value = geometryData
    properties.value = {
      volume: geometryData.volume || 0,
      boundingBox: geometryData.bounding_box || {
        x_min: 0, x_max: 0,
        y_min: 0, y_max: 0,
        z_min: 0, z_max: 0,
        width: 0, height: 0, depth: 0
      },
    }

    // Initialize 3D viewer if we have container
    if (renderContainer.value) {
      await initializeViewer()
    }
  } catch (err) {
    error.value = err.response?.data?.detail || 'Failed to load geometry'
  } finally {
    loading.value = false
  }
}

// Initialize Three.js viewer
const initializeViewer = async () => {
  if (!renderContainer.value) return

  try {
    // Scene setup
    scene.value = new THREE.Scene()
    scene.value.background = new THREE.Color(0xf5f5f5)

    // Camera setup
    const bbox = properties.value.boundingBox
    const maxDim = Math.max(bbox.width, bbox.height, bbox.depth) || 10
    const distance = maxDim * 1.5

    camera.value = new THREE.PerspectiveCamera(
      75,
      renderContainer.value.clientWidth / renderContainer.value.clientHeight,
      0.1,
      10000
    )
    camera.value.position.z = distance

    // Renderer setup
    renderer.value = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.value.setSize(renderContainer.value.clientWidth, renderContainer.value.clientHeight)
    renderer.value.setPixelRatio(window.devicePixelRatio)
    renderContainer.value.appendChild(renderer.value.domElement)

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.value.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(10, 10, 10)
    scene.value.add(directionalLight)

    // Load geometry model from STL file
    await loadGeometryModel()

    // Basic mouse controls
    setupMouseControls()

    // Handle window resize
    window.addEventListener('resize', onWindowResize)

    // Start animation loop
    animate()
  } catch (err) {
    error.value = 'Failed to initialize 3D viewer'
    console.error(err)
  }
}

// Load geometry model from STL file
const loadGeometryModel = async () => {
  if (!geometry.value?.stl_file) {
    // Fallback to placeholder if no STL file
    addPlaceholderGeometry()
    return
  }

  try {
    const loader = new STLLoader()
    const geometry_mesh = await new Promise((resolve, reject) => {
      loader.load(
        geometry.value.stl_file,
        resolve,
        undefined,
        reject
      )
    })

    const material = new THREE.MeshPhongMaterial({
      color: 0x667eea,
      emissive: 0x333333,
      shininess: 100
    })
    const mesh = new THREE.Mesh(geometry_mesh, material)

    // Center the mesh
    geometry_mesh.center()
    geometry_mesh.computeBoundingBox()

    // Add edges for visualization
    const edges = new THREE.EdgesGeometry(geometry_mesh)
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x333333 }))
    mesh.add(line)

    scene.value.add(mesh)

    // Fit camera to geometry
    fitCameraToGeometry(geometry_mesh)
  } catch (err) {
    console.error('Failed to load STL file:', err)
    // Fallback to placeholder geometry
    addPlaceholderGeometry()
  }
}

// Add placeholder geometry (cube) as fallback
const addPlaceholderGeometry = () => {
  const bbox = properties.value.boundingBox
  const width = bbox.width || 10
  const height = bbox.height || 5
  const depth = bbox.depth || 20

  const geometry = new THREE.BoxGeometry(width, height, depth)
  const material = new THREE.MeshPhongMaterial({
    color: 0x667eea,
    emissive: 0x333333,
    shininess: 100
  })
  const mesh = new THREE.Mesh(geometry, material)

  // Center the mesh
  mesh.position.set(
    bbox.x_min + width / 2,
    bbox.y_min + height / 2,
    bbox.z_min + depth / 2
  )

  // Add edges for visualization
  const edges = new THREE.EdgesGeometry(geometry)
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x333333 }))
  mesh.add(line)

  scene.value.add(mesh)

  // Fit camera to geometry
  fitCameraToGeometry(geometry)
}

// Fit camera to geometry bounds
const fitCameraToGeometry = (geometry) => {
  geometry.computeBoundingBox()
  const bbox = geometry.boundingBox

  const center = new THREE.Vector3()
  bbox.getCenter(center)

  const size = new THREE.Vector3()
  bbox.getSize(size)

  const maxDim = Math.max(size.x, size.y, size.z)
  const fov = camera.value.fov * (Math.PI / 180) // convert vertical FOV to radians
  let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2))

  cameraZ *= 1.5 // padding

  camera.value.position.x = center.x
  camera.value.position.y = center.y
  camera.value.position.z = center.z + cameraZ

  camera.value.lookAt(center)
  camera.value.updateProjectionMatrix()
}

// Setup basic mouse controls
const setupMouseControls = () => {
  let isDragging = false
  let previousMousePosition = { x: 0, y: 0 }
  let rotation = { x: 0, y: 0 }

  const meshes = scene.value.children.filter(obj => obj.isMesh)

  renderContainer.value.addEventListener('mousedown', (e) => {
    isDragging = true
    previousMousePosition = { x: e.clientX, y: e.clientY }
  })

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return

    const deltaX = e.clientX - previousMousePosition.x
    const deltaY = e.clientY - previousMousePosition.y

    rotation.x -= deltaY * 0.01
    rotation.y += deltaX * 0.01

    meshes.forEach(mesh => {
      mesh.rotation.x = rotation.x
      mesh.rotation.y = rotation.y
    })

    previousMousePosition = { x: e.clientX, y: e.clientY }
  })

  document.addEventListener('mouseup', () => {
    isDragging = false
  })

  renderContainer.value.addEventListener('wheel', (e) => {
    e.preventDefault()
    const direction = e.deltaY > 0 ? 1.1 : 0.9
    camera.value.position.multiplyScalar(direction)
  })
}

// Animation loop
const animate = () => {
  requestAnimationFrame(animate)
  if (renderer.value && scene.value && camera.value) {
    renderer.value.render(scene.value, camera.value)
  }
}

// Handle window resize
const onWindowResize = () => {
  if (!renderContainer.value || !camera.value || !renderer.value) return

  const width = renderContainer.value.clientWidth
  const height = renderContainer.value.clientHeight

  camera.value.aspect = width / height
  camera.value.updateProjectionMatrix()
  renderer.value.setSize(width, height)
}

// Export geometry
const exportGeometry = async (format) => {
  try {
    const data = await api.exportGeometry(geometryId.value, format)
    // Download file
    const url = window.URL.createObjectURL(new Blob([data]))
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `geometry.${format.toLowerCase()}`)
    document.body.appendChild(link)
    link.click()
    link.parentNode.removeChild(link)
  } catch (err) {
    error.value = `Failed to export ${format} file`
  }
}

// Go back
const goBack = () => {
  router.push(`/project/${route.params.projectId}`)
}

// Cleanup
const cleanup = () => {
  window.removeEventListener('resize', onWindowResize)
  if (renderer.value && renderContainer.value) {
    renderContainer.value.removeChild(renderer.value.domElement)
  }
}

onMounted(() => {
  loadGeometry()
})

onUnmounted(() => {
  cleanup()
})
</script>

<template>
  <div class="geometry-editor-page">
    <!-- Header -->
    <div class="editor-header">
      <button class="btn-back" @click="goBack">← Back</button>
      <div class="header-content">
        <h1 v-if="geometry">{{ geometry.name }}</h1>
        <p v-if="geometry" class="geometry-type">{{ geometry.operation_type }} Operation</p>
      </div>
    </div>

    <!-- Main content -->
    <div class="editor-container">
      <!-- Error message -->
      <div v-if="error" class="error-banner">
        {{ error }}
        <button @click="error = ''" class="btn-close">×</button>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="loading-spinner">
        Loading geometry...
      </div>

      <!-- 3D Viewer -->
      <div v-else class="viewer-area">
        <div ref="renderContainer" class="vtk-viewer"></div>

        <!-- Properties panel -->
        <div class="properties-panel">
          <h3>Properties</h3>

          <div class="property-group">
            <label>Volume</label>
            <span class="property-value">
              {{ properties.volume.toFixed(2) }} mm³
            </span>
          </div>

          <div class="property-group">
            <label>Bounding Box</label>
            <div class="bbox-info">
              <div>
                <span class="bbox-label">Min:</span>
                <span class="bbox-value">
                  [{{ properties.boundingBox.min[0].toFixed(1) }},
                  {{ properties.boundingBox.min[1].toFixed(1) }},
                  {{ properties.boundingBox.min[2].toFixed(1) }}]
                </span>
              </div>
              <div>
                <span class="bbox-label">Max:</span>
                <span class="bbox-value">
                  [{{ properties.boundingBox.max[0].toFixed(1) }},
                  {{ properties.boundingBox.max[1].toFixed(1) }},
                  {{ properties.boundingBox.max[2].toFixed(1) }}]
                </span>
              </div>
            </div>
          </div>

          <div class="property-group" v-if="geometry">
            <label>Created</label>
            <span class="property-value">
              {{ new Date(geometry.created_at).toLocaleString() }}
            </span>
          </div>

          <div class="export-section">
            <h4>Export</h4>
            <button @click="exportGeometry('STEP')" class="btn-export">
              Export STEP
            </button>
            <button @click="exportGeometry('STL')" class="btn-export">
              Export STL
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.geometry-editor-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f5f5;
}

.editor-header {
  background: white;
  border-bottom: 1px solid #e0e0e0;
  padding: 1rem 2rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  display: flex;
  align-items: center;
  gap: 2rem;
}

.btn-back {
  background: none;
  border: none;
  color: #667eea;
  font-size: 1rem;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 4px;
  transition: background 0.2s;
}

.btn-back:hover {
  background: #f5f5f5;
}

.header-content h1 {
  margin: 0;
  font-size: 1.5rem;
  color: #2c3e50;
}

.geometry-type {
  margin: 0;
  color: #7f8c8d;
  font-size: 0.9rem;
}

.editor-container {
  display: flex;
  flex: 1;
  gap: 1rem;
  padding: 1rem;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

.error-banner {
  background: #ffe6e6;
  border-left: 4px solid #c0392b;
  color: #c0392b;
  padding: 1rem;
  border-radius: 4px;
  margin-bottom: 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: absolute;
  top: 5rem;
  left: 1rem;
  right: 1rem;
  z-index: 10;
}

.btn-close {
  background: none;
  border: none;
  color: #c0392b;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
}

.loading-spinner {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: #7f8c8d;
  font-size: 1.1rem;
}

.viewer-area {
  display: flex;
  flex: 1;
  gap: 1rem;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

.vtk-viewer {
  flex: 1;
  position: relative;
  background: #f5f5f5;
}

.properties-panel {
  width: 280px;
  background: white;
  border-left: 1px solid #e0e0e0;
  padding: 1.5rem;
  overflow-y: auto;
}

.properties-panel h3 {
  margin: 0 0 1rem;
  font-size: 1rem;
  color: #2c3e50;
  border-bottom: 1px solid #e0e0e0;
  padding-bottom: 0.75rem;
}

.properties-panel h4 {
  margin: 1rem 0 0.75rem;
  font-size: 0.85rem;
  color: #7f8c8d;
  text-transform: uppercase;
  font-weight: 600;
}

.property-group {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #f5f5f5;
}

.property-group label {
  display: block;
  color: #7f8c8d;
  font-size: 0.85rem;
  font-weight: 500;
  margin-bottom: 0.5rem;
  text-transform: uppercase;
}

.property-value {
  display: block;
  color: #2c3e50;
  font-size: 1rem;
  font-weight: 500;
  word-break: break-all;
}

.bbox-info {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.bbox-info > div {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.bbox-label {
  color: #7f8c8d;
  font-size: 0.75rem;
  font-weight: 600;
}

.bbox-value {
  color: #2c3e50;
  font-size: 0.85rem;
  font-family: monospace;
}

.export-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.btn-export {
  padding: 0.5rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-export:hover {
  background: #5568d3;
}

@media (max-width: 1024px) {
  .editor-container {
    flex-direction: column-reverse;
  }

  .properties-panel {
    width: 100%;
    border-left: none;
    border-top: 1px solid #e0e0e0;
  }
}
</style>
