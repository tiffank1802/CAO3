<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import Konva from 'konva'
import { useAppStore } from '@/stores/app'
import api from '@/services/api'

const router = useRouter()
const route = useRoute()
const store = useAppStore()

// State
const sketchId = ref(route.params.id)
const sketch = ref(null)
const stage = ref(null)
const layer = ref(null)
const canvas = ref(null)

const drawing = ref(false)
const points = ref([]) // Array of points: {x, y, id}
const lines = ref([]) // Array of lines: {start, end, id}
const circles = ref([]) // Array of circles: {center, radius, id}
const constraints = ref([])
const tool = ref('select') // 'select', 'point', 'line', 'circle'
const error = ref('')
const success = ref('')
const loading = ref(false)

// Constraint state
const selectedGeometry = ref(null) // Currently selected line/point for constraint {type, index}
const showConstraintDialog = ref(false)
const constraintType = ref('') // 'horizontal', 'vertical', 'distance', 'length'
const constraintValue = ref(0)

// Line drawing state
const lineStartPoint = ref(null) // Index of start point for line drawing
const circleStartPoint = ref(null) // Index of center point for circle
const isDrawingCircle = ref(false)

const pointRadius = 4
const lineWidth = 2
const canvasWidth = ref(800)
const canvasHeight = ref(600)

// Computed
const totalElements = computed(() => points.value.length + lines.value.length + circles.value.length)
const isEditing = computed(() => tool.value !== 'select')

// Initialize Konva stage and layer
const initializeCanvas = () => {
  if (!canvas.value) return

  stage.value = new Konva.Stage({
    container: canvas.value,
    width: canvasWidth.value,
    height: canvasHeight.value,
  })

  layer.value = new Konva.Layer()
  stage.value.add(layer.value)

  // Add grid background
  drawGrid()

  // Mouse events
  stage.value.on('click', handleCanvasClick)
  stage.value.on('mousemove', handleCanvasMouseMove)
}

const drawGrid = () => {
  if (!layer.value) return

  const spacing = 20
  for (let x = 0; x < canvasWidth.value; x += spacing) {
    layer.value.add(
      new Konva.Line({
        points: [x, 0, x, canvasHeight.value],
        stroke: '#f0f0f0',
        strokeWidth: 1,
      })
    )
  }
  for (let y = 0; y < canvasHeight.value; y += spacing) {
    layer.value.add(
      new Konva.Line({
        points: [0, y, canvasWidth.value, y],
        stroke: '#f0f0f0',
        strokeWidth: 1,
      })
    )
  }
  layer.value.draw()
}

const handleCanvasClick = (e) => {
  if (!stage.value || !layer.value) return

  const pos = stage.value.getPointerPosition()

  if (tool.value === 'point') {
    addPoint(pos.x, pos.y)
  } else if (tool.value === 'line') {
    handleLineClick(pos)
  } else if (tool.value === 'circle') {
    handleCircleClick(pos)
  }
}

const handleCanvasMouseMove = () => {
  // Could be used for preview of shapes being drawn
}

const handleLineClick = (pos) => {
  // Find closest point to click
  const clickRadius = 10
  let closestPoint = null
  let closestDist = clickRadius

  points.value.forEach((p, i) => {
    const dist = Math.sqrt((p.x - pos.x) ** 2 + (p.y - pos.y) ** 2)
    if (dist < closestDist) {
      closestDist = dist
      closestPoint = i
    }
  })

  if (closestPoint === null) {
    // Create new point if no point nearby
    addPoint(pos.x, pos.y)
    closestPoint = points.value.length - 1
  }

  if (lineStartPoint.value === null) {
    lineStartPoint.value = closestPoint
    success.value = `Line start: Point ${closestPoint}`
  } else if (lineStartPoint.value !== closestPoint) {
    // Add line between two points
    const lineId = `line_${Date.now()}`
    lines.value.push({
      start: lineStartPoint.value,
      end: closestPoint,
      id: lineId,
    })
    success.value = `Line added: Point ${lineStartPoint.value} to Point ${closestPoint}`
    lineStartPoint.value = null
    redrawCanvas()
  }
}

const handleCircleClick = (pos) => {
  if (!isDrawingCircle.value) {
    // First click: select center point
    const clickRadius = 10
    let closestPoint = null
    let closestDist = clickRadius

    points.value.forEach((p, i) => {
      const dist = Math.sqrt((p.x - pos.x) ** 2 + (p.y - pos.y) ** 2)
      if (dist < closestDist) {
        closestDist = dist
        closestPoint = i
      }
    })

    if (closestPoint === null) {
      addPoint(pos.x, pos.y)
      closestPoint = points.value.length - 1
    }

    circleStartPoint.value = closestPoint
    isDrawingCircle.value = true
    success.value = `Circle center: Point ${closestPoint} - Click to set radius`
  } else {
    // Second click: set radius and complete circle
    const center = points.value[circleStartPoint.value]
    const radius = Math.sqrt((center.x - pos.x) ** 2 + (center.y - pos.y) ** 2)

    const circleId = `circle_${Date.now()}`
    circles.value.push({
      center: circleStartPoint.value,
      radius,
      id: circleId,
    })

    success.value = `Circle added: Center Point ${circleStartPoint.value}, Radius ${radius.toFixed(2)}`
    circleStartPoint.value = null
    isDrawingCircle.value = false
    redrawCanvas()
  }
}

const addPoint = (x, y) => {
  const id = `point_${Date.now()}`
  points.value.push({ x, y, id })

  // Draw point on canvas
  const circle = new Konva.Circle({
    x,
    y,
    radius: pointRadius,
    fill: '#667eea',
    stroke: '#4c51bf',
    strokeWidth: 1,
    name: 'point',
    userData: { id },
  })

  layer.value.add(circle)
  layer.value.draw()
}

const solveConstraints = async () => {
  error.value = ''
  success.value = ''

  if (points.value.length === 0) {
    error.value = 'No points to solve'
    return
  }

  try {
    const constraintData = {
      points: points.value.map(p => ({ x: p.x, y: p.y })),
      lines: lines.value,
      circles: circles.value,
      constraints: constraints.value,
    }

    const result = await api.solveConstraints(constraintData)
    success.value = 'Constraints solved successfully'

    // Update points with solved positions
    if (result.points) {
      points.value = result.points.map((p, i) => ({
        ...points.value[i],
        x: p.x,
        y: p.y,
      }))
      redrawCanvas()
    }
  } catch (err) {
    error.value = err.response?.data?.detail || 'Failed to solve constraints'
  }
}

const redrawCanvas = () => {
  if (!layer.value) return

  // Clear all shapes except grid
  layer.value.destroyChildren()
  drawGrid()

  // Redraw points
  points.value.forEach(p => {
    layer.value.add(
      new Konva.Circle({
        x: p.x,
        y: p.y,
        radius: pointRadius,
        fill: '#667eea',
        stroke: '#4c51bf',
        strokeWidth: 1,
      })
    )
  })

  // Redraw lines
  lines.value.forEach(line => {
    const start = points.value[line.start]
    const end = points.value[line.end]
    if (start && end) {
      layer.value.add(
        new Konva.Line({
          points: [start.x, start.y, end.x, end.y],
          stroke: '#764ba2',
          strokeWidth: lineWidth,
        })
      )
    }
  })

  // Redraw circles
  circles.value.forEach(circle => {
    const center = points.value[circle.center]
    if (center) {
      layer.value.add(
        new Konva.Circle({
          x: center.x,
          y: center.y,
          radius: circle.radius,
          fill: 'transparent',
          stroke: '#f59e0b',
          strokeWidth: lineWidth,
        })
      )
    }
  })

  layer.value.draw()
}

const clearSketch = () => {
  if (confirm('Clear all geometry? This cannot be undone.')) {
    points.value = []
    lines.value = []
    circles.value = []
    constraints.value = []
    redrawCanvas()
  }
}

const exportSketch = async () => {
  error.value = ''
  success.value = ''

  if (points.value.length === 0) {
    error.value = 'Sketch is empty. Add some geometry.'
    return
  }

  loading.value = true

  try {
    // Format data for backend
    const sketchData = {
      name: `Sketch ${new Date().toLocaleString()}`,
      geometry_data: {
        points: points.value.map(p => ({ x: p.x, y: p.y })),
        lines: lines.value.map(l => ({ start: l.start, end: l.end })),
      },
    }

    if (sketchId.value) {
      // Update existing sketch
      await api.updateSketch(sketchId.value, sketchData)
      success.value = 'Sketch saved successfully!'
    } else {
      // Create new sketch
      const response = await api.createSketch(route.params.projectId, sketchData)
      sketchId.value = response.id
      success.value = 'Sketch created successfully! ID: ' + response.id
    }

    setTimeout(() => {
      router.push(`/project/${route.params.projectId}`)
    }, 1500)
  } catch (err) {
    error.value = err.response?.data?.detail || 'Failed to save sketch'
    console.error(err)
  } finally {
    loading.value = false
  }
}

const goBack = () => {
  router.push(`/project/${route.params.projectId}`)
}

onMounted(() => {
  initializeCanvas()
  
  // Load sketch from backend if sketchId exists
  if (sketchId.value) {
    loadSketch()
  }
})

const loadSketch = async () => {
  loading.value = true
  error.value = ''
  
  try {
    const response = await api.getSketch(sketchId.value)
    sketch.value = response
    
    // Load geometry data
    if (response.geometry_data) {
      const data = response.geometry_data
      points.value = (data.points || []).map((p, i) => ({
        ...p,
        id: `point_${i}`,
      }))
      lines.value = (data.lines || []).map((l, i) => ({
        ...l,
        id: `line_${i}`,
      }))
    }
    
    redrawCanvas()
    success.value = 'Sketch loaded successfully!'
  } catch (err) {
    error.value = err.response?.data?.detail || 'Failed to load sketch'
    console.error(err)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="sketch-editor-page">
    <!-- Header -->
    <div class="editor-header">
      <div class="header-content">
        <button class="btn-back" @click="goBack">← Back</button>
        <h1>Sketch Editor</h1>
        <div class="header-stats">
          <span>Points: {{ points.length }}</span>
          <span>Lines: {{ lines.length }}</span>
          <span>Circles: {{ circles.length }}</span>
        </div>
      </div>
    </div>

    <!-- Main content -->
    <div class="editor-container">
      <!-- Toolbar -->
      <div class="toolbar">
        <div class="tool-group">
          <h3>Drawing Tools</h3>
          <button
            class="tool-btn"
            :class="{ active: tool === 'select' }"
            @click="tool = 'select'"
            title="Select tool"
          >
            ✓ Select
          </button>
          <button
            class="tool-btn"
            :class="{ active: tool === 'point' }"
            @click="tool = 'point'"
            title="Add points"
          >
            • Point
          </button>
          <button
            class="tool-btn"
            :class="{ active: tool === 'line' }"
            @click="tool = 'line'"
            title="Draw lines"
          >
            — Line
          </button>
          <button
            class="tool-btn"
            :class="{ active: tool === 'circle' }"
            @click="tool = 'circle'"
            title="Draw circles"
          >
            ○ Circle
          </button>
        </div>

        <div class="tool-group">
          <h3>Constraints</h3>
          <button class="tool-btn" disabled title="Coming soon">
            Horizontal
          </button>
          <button class="tool-btn" disabled title="Coming soon">
            Vertical
          </button>
          <button class="tool-btn" disabled title="Coming soon">
            Distance
          </button>
        </div>

        <div class="tool-group">
          <h3>Actions</h3>
          <button class="tool-btn btn-primary" @click="solveConstraints" :disabled="loading">
            Solve
          </button>
          <button class="tool-btn btn-secondary" @click="exportSketch" :disabled="loading || points.length === 0">
            {{ loading ? 'Saving...' : 'Save Sketch' }}
          </button>
          <button class="tool-btn btn-danger" @click="clearSketch" :disabled="loading">
            Clear
          </button>
        </div>
      </div>

      <!-- Canvas area -->
      <div class="canvas-area">
        <!-- Messages -->
        <div v-if="error" class="message error">{{ error }}</div>
        <div v-if="success" class="message success">{{ success }}</div>

        <!-- Canvas -->
        <div ref="canvas" class="konva-canvas"></div>

        <!-- Properties panel (placeholder) -->
        <div class="properties-panel">
          <h3>Properties</h3>
          <div class="property">
            <label>Elements:</label>
            <span>{{ totalElements }}</span>
          </div>
          <div class="property">
            <label>Tool:</label>
            <span>{{ tool }}</span>
          </div>
          <div class="property">
            <label>Constraints:</label>
            <span>{{ constraints.length }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sketch-editor-page {
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
}

.header-content {
  display: flex;
  align-items: center;
  gap: 2rem;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
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

.editor-header h1 {
  margin: 0;
  font-size: 1.5rem;
  color: #2c3e50;
  flex: 1;
}

.header-stats {
  display: flex;
  gap: 2rem;
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

.toolbar {
  background: white;
  border-radius: 8px;
  padding: 1rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  width: 150px;
  overflow-y: auto;
}

.tool-group {
  margin-bottom: 2rem;
}

.tool-group h3 {
  margin: 0 0 0.5rem;
  font-size: 0.85rem;
  text-transform: uppercase;
  color: #7f8c8d;
  font-weight: 600;
}

.tool-btn {
  width: 100%;
  padding: 0.5rem;
  background: #f5f5f5;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  font-size: 0.85rem;
  cursor: pointer;
  margin-bottom: 0.5rem;
  transition: all 0.2s;
}

.tool-btn:hover:not(:disabled) {
  background: #e0e7ff;
  border-color: #667eea;
}

.tool-btn.active {
  background: #667eea;
  color: white;
  border-color: #667eea;
}

.tool-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tool-btn.btn-primary {
  background: #667eea;
  color: white;
  border-color: #667eea;
}

.tool-btn.btn-primary:hover {
  background: #5568d3;
}

.tool-btn.btn-secondary {
  background: #10b981;
  color: white;
  border-color: #10b981;
}

.tool-btn.btn-secondary:hover {
  background: #059669;
}

.tool-btn.btn-danger {
  background: #ef4444;
  color: white;
  border-color: #ef4444;
}

.tool-btn.btn-danger:hover {
  background: #dc2626;
}

.canvas-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  padding: 1rem;
  gap: 1rem;
}

.message {
  padding: 0.75rem 1rem;
  border-radius: 4px;
  font-size: 0.9rem;
  animation: slideDown 0.3s ease-out;
}

.message.error {
  background: #ffe6e6;
  color: #c0392b;
  border-left: 4px solid #c0392b;
}

.message.success {
  background: #e6ffe6;
  color: #27ae60;
  border-left: 4px solid #27ae60;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.konva-canvas {
  flex: 1;
  background: white;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.properties-panel {
  background: #f5f5f5;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  padding: 1rem;
  font-size: 0.85rem;
}

.properties-panel h3 {
  margin: 0 0 0.5rem;
  font-size: 0.9rem;
}

.property {
  display: flex;
  justify-content: space-between;
  padding: 0.25rem 0;
  color: #7f8c8d;
}

.property label {
  font-weight: 500;
}

@media (max-width: 1024px) {
  .editor-container {
    flex-direction: column;
  }

  .toolbar {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
  }

  .tool-group {
    margin: 0;
  }
}
</style>
