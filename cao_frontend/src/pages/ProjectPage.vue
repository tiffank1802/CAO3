<script setup>
import { ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAppStore } from '@/stores/app'
import api from '@/services/api'

const router = useRouter()
const route = useRoute()
const store = useAppStore()

const projectId = ref(route.params.id)
const project = ref(null)
const sketches = ref([])
const geometries = ref([])
const loading = ref(false)
const error = ref('')
const showNewSketchForm = ref(false)
const newSketchName = ref('')
const showExtrudeForm = ref(false)
const selectedSketchForExtrude = ref(null)
const extrudeLength = ref(10)
const extrudeSymmetric = ref(false)
const extruding = ref(false)

// Load project and its sketches/geometries
const loadProject = async () => {
  loading.value = true
  error.value = ''

  try {
    // Load project
    const projectData = await api.getProject(projectId.value)
    project.value = projectData

    // Load sketches
    const sketchesData = await api.getSketches(projectId.value)
    sketches.value = Array.isArray(sketchesData) ? sketchesData : sketchesData.results || []

    // Load geometries
    const geometriesData = await api.getGeometries(projectId.value)
    geometries.value = Array.isArray(geometriesData) ? geometriesData : geometriesData.results || []
  } catch (err) {
    error.value = err.response?.data?.detail || 'Failed to load project'
  } finally {
    loading.value = false
  }
}

// Create new sketch
const createSketch = async () => {
  if (!newSketchName.value.trim()) {
    error.value = 'Sketch name is required'
    return
  }

  try {
    error.value = ''
    const sketch = await api.createSketch(projectId.value, {
      name: newSketchName.value,
      description: '',
    })
    sketches.value.push(sketch)
    newSketchName.value = ''
    showNewSketchForm.value = false
  } catch (err) {
    error.value = err.response?.data?.detail || 'Failed to create sketch'
  }
}

// Edit sketch
const editSketch = (sketchId) => {
  router.push(`/sketch/${projectId.value}/${sketchId}`)
}

// View geometry
const viewGeometry = (geometryId) => {
  router.push(`/geometry/${geometryId}`)
}

// Delete sketch
const deleteSketch = async (sketchId) => {
  if (!confirm('Delete this sketch?')) return

  try {
    await api.deleteSketch(sketchId)
    sketches.value = sketches.value.filter(s => s.id !== sketchId)
  } catch (err) {
    error.value = 'Failed to delete sketch'
  }
}

// Delete geometry
const deleteGeometry = async (geometryId) => {
  if (!confirm('Delete this geometry?')) return

  try {
    await api.deleteGeometry(geometryId)
    geometries.value = geometries.value.filter(g => g.id !== geometryId)
  } catch (err) {
    error.value = 'Failed to delete geometry'
  }
}

// Extrude sketch to create 3D geometry
const startExtrude = (sketchId) => {
  selectedSketchForExtrude.value = sketchId
  showExtrudeForm.value = true
}

const cancelExtrude = () => {
  showExtrudeForm.value = false
  selectedSketchForExtrude.value = null
  extrudeLength.value = 10
  extrudeSymmetric.value = false
}

const performExtrude = async () => {
  if (!extrudeLength.value || extrudeLength.value <= 0) {
    error.value = 'Extrude length must be greater than 0'
    return
  }

  try {
    extruding.value = true
    error.value = ''
    const geometry = await api.extrude(
      projectId.value,
      selectedSketchForExtrude.value,
      extrudeLength.value,
      extrudeSymmetric.value
    )
    geometries.value.push(geometry)
    cancelExtrude()
  } catch (err) {
    error.value = err.response?.data?.detail || 'Failed to extrude sketch'
  } finally {
    extruding.value = false
  }
}

// Go back
const goBack = () => {
  router.push('/dashboard')
}

onMounted(() => {
  loadProject()
})
</script>

<template>
  <div class="project-page">
    <!-- Header -->
    <div class="page-header">
      <button class="btn-back" @click="goBack">← Back to Projects</button>
      <div class="header-content">
        <h1 v-if="project">{{ project.name }}</h1>
        <p v-if="project" class="project-description">{{ project.description }}</p>
      </div>
    </div>

    <!-- Main content -->
    <div class="page-container">
      <!-- Error message -->
      <div v-if="error" class="error-banner">
        {{ error }}
        <button @click="error = ''" class="btn-close">×</button>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="loading-spinner">
        Loading project...
      </div>

      <!-- Content -->
      <div v-else class="content">
        <!-- Sketches section -->
        <div class="section">
          <div class="section-header">
            <h2>Sketches</h2>
            <button
              class="btn-primary"
              @click="showNewSketchForm = !showNewSketchForm"
            >
              {{ showNewSketchForm ? '✕ Cancel' : '+ New Sketch' }}
            </button>
          </div>

          <!-- New sketch form -->
          <div v-if="showNewSketchForm" class="new-item-form">
            <input
              v-model="newSketchName"
              type="text"
              placeholder="Enter sketch name"
              @keyup.enter="createSketch"
              class="form-input"
            />
            <button @click="createSketch" class="btn-primary">Create</button>
          </div>

          <!-- Sketches list -->
          <div v-if="sketches.length > 0" class="items-grid">
            <div v-for="sketch in sketches" :key="sketch.id" class="item-card">
              <div class="item-header">
                <h3>{{ sketch.name }}</h3>
              </div>
              <p v-if="sketch.description" class="item-description">
                {{ sketch.description }}
              </p>
              <div class="item-meta">
                <span>Created: {{ new Date(sketch.created_at).toLocaleDateString() }}</span>
              </div>
              <div class="item-actions">
                <button @click="editSketch(sketch.id)" class="btn-secondary">
                  Edit
                </button>
                <button @click="startExtrude(sketch.id)" class="btn-success">
                  Extrude
                </button>
                <button @click="deleteSketch(sketch.id)" class="btn-danger">
                  Delete
                </button>
              </div>
            </div>
          </div>

          <div v-else class="empty-state">
            <p>No sketches yet. Create one to get started!</p>
          </div>
        </div>

        <!-- Extrude Form Modal -->
        <div v-if="showExtrudeForm" class="modal-overlay" @click="cancelExtrude">
          <div class="modal" @click.stop>
            <div class="modal-header">
              <h3>Extrude Sketch to 3D</h3>
              <button @click="cancelExtrude" class="btn-close">×</button>
            </div>
            <div class="modal-body">
              <div class="form-group">
                <label for="extrude-length">Extrusion Length (mm)</label>
                <input
                  id="extrude-length"
                  v-model.number="extrudeLength"
                  type="number"
                  min="0.1"
                  step="1"
                  placeholder="Enter extrusion length"
                />
              </div>
              <div class="form-group">
                <label>
                  <input v-model="extrudeSymmetric" type="checkbox" />
                  Symmetric (extrude both directions)
                </label>
              </div>
            </div>
            <div class="modal-footer">
              <button @click="cancelExtrude" class="btn-secondary">Cancel</button>
              <button 
                @click="performExtrude" 
                class="btn-primary"
                :disabled="extruding"
              >
                {{ extruding ? 'Extruding...' : 'Extrude' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Geometries section -->
        <div class="section">
          <div class="section-header">
            <h2>Geometries</h2>
            <span class="section-count">{{ geometries.length }} total</span>
          </div>

          <div v-if="geometries.length > 0" class="items-grid">
            <div v-for="geometry in geometries" :key="geometry.id" class="item-card">
              <div class="item-header">
                <h3>{{ geometry.name }}</h3>
                <span class="geometry-type">{{ geometry.operation_type }}</span>
              </div>
              <p v-if="geometry.description" class="item-description">
                {{ geometry.description }}
              </p>
              <div class="item-meta">
                <span v-if="geometry.volume" class="meta-item">
                  Volume: {{ geometry.volume.toFixed(2) }} mm³
                </span>
                <span class="meta-item">
                  Created: {{ new Date(geometry.created_at).toLocaleDateString() }}
                </span>
              </div>
              <div class="item-actions">
                <button @click="viewGeometry(geometry.id)" class="btn-secondary">
                  View
                </button>
                <button @click="deleteGeometry(geometry.id)" class="btn-danger">
                  Delete
                </button>
              </div>
            </div>
          </div>

          <div v-else class="empty-state">
            <p>No geometries yet. Create a sketch and extrude it!</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.project-page {
  background: #f5f5f5;
  min-height: 100vh;
}

.page-header {
  background: white;
  border-bottom: 1px solid #e0e0e0;
  padding: 1.5rem 2rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.btn-back {
  background: none;
  border: none;
  color: #667eea;
  font-size: 1rem;
  cursor: pointer;
  padding: 0.5rem;
  margin-bottom: 1rem;
  border-radius: 4px;
  transition: background 0.2s;
}

.btn-back:hover {
  background: #f5f5f5;
}

.header-content h1 {
  margin: 0 0 0.5rem;
  color: #2c3e50;
  font-size: 2rem;
}

.project-description {
  margin: 0;
  color: #7f8c8d;
  font-size: 0.95rem;
}

.page-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem 1rem;
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
  text-align: center;
  padding: 3rem;
  color: #7f8c8d;
  font-size: 1.1rem;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.section {
  background: white;
  border-radius: 8px;
  padding: 2rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 2px solid #f5f5f5;
}

.section h2 {
  margin: 0;
  color: #2c3e50;
  font-size: 1.5rem;
}

.section-count {
  color: #7f8c8d;
  font-size: 0.9rem;
}

.new-item-form {
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: #f5f5f5;
  border-radius: 4px;
}

.form-input {
  flex: 1;
  padding: 0.75rem;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  font-size: 1rem;
}

.form-input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.items-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1.5rem;
}

.item-card {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 1.5rem;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
}

.item-card:hover {
  border-color: #667eea;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.1);
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.item-header h3 {
  margin: 0;
  color: #2c3e50;
  font-size: 1.1rem;
  flex: 1;
}

.geometry-type {
  background: #e0e7ff;
  color: #667eea;
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  white-space: nowrap;
}

.item-description {
  color: #7f8c8d;
  font-size: 0.9rem;
  margin: 0.5rem 0;
  flex: 1;
}

.item-meta {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  color: #95a5a6;
  font-size: 0.85rem;
  margin: 1rem 0;
}

.meta-item {
  display: block;
}

.item-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: auto;
}

.btn-primary,
.btn-secondary,
.btn-danger {
  flex: 1;
  padding: 0.5rem;
  border: none;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: #667eea;
  color: white;
}

.btn-primary:hover {
  background: #5568d3;
}

.btn-secondary {
  background: #f5f5f5;
  color: #2c3e50;
  border: 1px solid #e0e0e0;
}

.btn-secondary:hover {
  background: #e0e7ff;
  border-color: #667eea;
}

.btn-danger {
  background: #fee2e2;
  color: #dc2626;
}

.btn-danger:hover {
  background: #fecaca;
}

.btn-success {
  background: #dcfce7;
  color: #16a34a;
  border: 1px solid #bbf7d0;
}

.btn-success:hover {
  background: #bbf7d0;
  border-color: #16a34a;
}

.btn-success:disabled {
  background: #d1d5db;
  color: #6b7280;
  cursor: not-allowed;
}

.empty-state {
  text-align: center;
  padding: 3rem;
  color: #7f8c8d;
}

.empty-state p {
  margin: 0;
  font-size: 1rem;
}

/* Modal styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  border-radius: 8px;
  box-shadow: 0 20px 25px rgba(0, 0, 0, 0.15);
  max-width: 400px;
  width: 90%;
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid #e0e0e0;
  background: #f9f9f9;
}

.modal-header h3 {
  margin: 0;
  color: #2c3e50;
  font-size: 1.2rem;
}

.modal-header .btn-close {
  background: none;
  border: none;
  color: #7f8c8d;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
}

.modal-header .btn-close:hover {
  color: #2c3e50;
}

.modal-body {
  padding: 1.5rem;
}

.modal-body .form-group {
  margin-bottom: 1rem;
}

.modal-body label {
  display: block;
  color: #2c3e50;
  font-weight: 500;
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
}

.modal-body input[type="number"],
.modal-body input[type="text"] {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  font-size: 1rem;
}

.modal-body input[type="number"]:focus,
.modal-body input[type="text"]:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.modal-body input[type="checkbox"] {
  margin-right: 0.5rem;
}

.modal-footer {
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
  padding: 1.5rem;
  border-top: 1px solid #e0e0e0;
  background: #f9f9f9;
}

.modal-footer button {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

@media (max-width: 768px) {
  .section-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }

  .items-grid {
    grid-template-columns: 1fr;
  }

  .new-item-form {
    flex-direction: column;
  }
}
</style>
