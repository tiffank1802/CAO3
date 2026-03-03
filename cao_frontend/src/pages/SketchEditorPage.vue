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
const constraintType = ref('') // 'horizontal', 'vertical', 'distance', 'length', 'equal_length', 'angle', 'symmetry', 'tangent', 'on_line'
const constraintValue = ref(0)
const secondGeometry = ref(null) // For constraints requiring 2 geometries
const showConstraintPanel = ref(true)

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

   // If constraint dialog is open, allow selecting second geometry
   if (showConstraintDialog.value && constraintType.value) {
     const clickRadius = 10

     if (constraintType.value === 'equal_length') {
       // Looking for second line
       for (let i = 0; i < lines.value.length; i++) {
         const line = lines.value[i]
         const start = points.value[line.start]
         const end = points.value[line.end]
         
         if (start && end && i !== selectedGeometry.value?.index) {
           const dist = distancePointToLine(pos, start, end)
           if (dist < clickRadius) {
             secondGeometry.value = { type: 'line', index: i }
             success.value = `Selected second line ${i}`
             redrawCanvas()
             return
           }
         }
       }
     } else if (constraintType.value === 'symmetry') {
       // Looking for second point
       for (let i = 0; i < points.value.length; i++) {
         const p = points.value[i]
         const dist = Math.sqrt((p.x - pos.x) ** 2 + (p.y - pos.y) ** 2)
         if (dist < clickRadius && i !== selectedGeometry.value?.index) {
           secondGeometry.value = { type: 'point', index: i }
           success.value = `Selected second point ${i}`
           redrawCanvas()
           return
         }
       }
     } else if (constraintType.value === 'tangent') {
       // Looking for circle if line was selected, or line if circle was selected
       if (selectedGeometry.value?.type === 'line') {
         // Looking for circle
         for (let i = 0; i < circles.value.length; i++) {
           const circle = circles.value[i]
           const center = points.value[circle.center]
           if (center) {
             const dist = Math.sqrt((center.x - pos.x) ** 2 + (center.y - pos.y) ** 2)
             if (Math.abs(dist - circle.radius) < clickRadius) {
               secondGeometry.value = { type: 'circle', index: i }
               success.value = `Selected circle ${i}`
               redrawCanvas()
               return
             }
           }
         }
       } else if (selectedGeometry.value?.type === 'circle') {
         // Looking for line
         for (let i = 0; i < lines.value.length; i++) {
           const line = lines.value[i]
           const start = points.value[line.start]
           const end = points.value[line.end]
           
           if (start && end) {
             const dist = distancePointToLine(pos, start, end)
             if (dist < clickRadius) {
               secondGeometry.value = { type: 'line', index: i }
               success.value = `Selected line ${i}`
               redrawCanvas()
               return
             }
           }
         }
       }
     } else if (constraintType.value === 'on_line') {
       // Looking for line
       for (let i = 0; i < lines.value.length; i++) {
         const line = lines.value[i]
         const start = points.value[line.start]
         const end = points.value[line.end]
         
         if (start && end) {
           const dist = distancePointToLine(pos, start, end)
           if (dist < clickRadius) {
             secondGeometry.value = { type: 'line', index: i }
             success.value = `Selected line ${i}`
             redrawCanvas()
             return
           }
         }
       }
     }
     return
   }

   if (tool.value === 'select') {
     // Handle geometry selection for constraints
     const clickRadius = 10

     // Check if clicking on a line
     for (let i = 0; i < lines.value.length; i++) {
       const line = lines.value[i]
       const start = points.value[line.start]
       const end = points.value[line.end]
       
       if (start && end) {
         // Calculate distance from point to line
         const dist = distancePointToLine(pos, start, end)
         if (dist < clickRadius) {
           selectedGeometry.value = { type: 'line', index: i }
           success.value = `Selected line ${i}`
           redrawCanvas()
           return
         }
       }
     }

     // Check if clicking on a point
     for (let i = 0; i < points.value.length; i++) {
       const p = points.value[i]
       const dist = Math.sqrt((p.x - pos.x) ** 2 + (p.y - pos.y) ** 2)
       if (dist < clickRadius) {
         selectedGeometry.value = { type: 'point', index: i, x: p.x, y: p.y }
         success.value = `Selected point ${i}`
         redrawCanvas()
         return
       }
     }

     // Check if clicking on a circle
     for (let i = 0; i < circles.value.length; i++) {
       const circle = circles.value[i]
       const center = points.value[circle.center]
       if (center) {
         const dist = Math.sqrt((center.x - pos.x) ** 2 + (center.y - pos.y) ** 2)
         // Check if clicked on circle perimeter
         if (Math.abs(dist - circle.radius) < clickRadius) {
           selectedGeometry.value = { type: 'circle', index: i }
           success.value = `Selected circle ${i}`
           redrawCanvas()
           return
         }
       }
     }

     selectedGeometry.value = null
     redrawCanvas()
   } else if (tool.value === 'point') {
     addPoint(pos.x, pos.y)
   } else if (tool.value === 'line') {
     handleLineClick(pos)
   } else if (tool.value === 'circle') {
     handleCircleClick(pos)
   }
 }

const distancePointToLine = (point, lineStart, lineEnd) => {
  const A = point.x - lineStart.x
  const B = point.y - lineStart.y
  const C = lineEnd.x - lineStart.x
  const D = lineEnd.y - lineStart.y

  const dot = A * C + B * D
  const lenSq = C * C + D * D

  let param = -1
  if (lenSq !== 0) param = dot / lenSq

  let xx, yy

  if (param < 0) {
    xx = lineStart.x
    yy = lineStart.y
  } else if (param > 1) {
    xx = lineEnd.x
    yy = lineEnd.y
  } else {
    xx = lineStart.x + param * C
    yy = lineStart.y + param * D
  }

  const dx = point.x - xx
  const dy = point.y - yy
  return Math.sqrt(dx * dx + dy * dy)
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

const addConstraint = (type) => {
   error.value = ''
   success.value = ''

   if (type === 'horizontal' || type === 'vertical') {
     // For horizontal/vertical, need a selected line
     const selectedLine = lines.value.findIndex(l => 
       selectedGeometry.value?.type === 'line' && selectedGeometry.value?.index === lines.value.indexOf(l)
     )
     
     if (selectedLine === -1 && selectedGeometry.value?.type !== 'line') {
       error.value = `Select a line to apply ${type} constraint`
       return
     }

     const lineIdx = selectedGeometry.value?.type === 'line' ? selectedGeometry.value.index : selectedLine
     const constraint = {
       type,
       line_name: `line_${lineIdx}`
     }

     constraints.value.push(constraint)
     success.value = `${type} constraint added to line ${lineIdx}`
     selectedGeometry.value = null
   } else if (type === 'distance' || type === 'length') {
     constraintType.value = type
     showConstraintDialog.value = true
   } else if (type === 'equal_length') {
     // For equal_length, need 2 lines selected
     if (!selectedGeometry.value || selectedGeometry.value.type !== 'line') {
       error.value = 'Select first line for equal_length constraint'
       return
     }
     constraintType.value = 'equal_length'
     secondGeometry.value = null
     showConstraintDialog.value = true
   } else if (type === 'angle') {
     if (!selectedGeometry.value || selectedGeometry.value.type !== 'line') {
       error.value = 'Select a line to apply angle constraint'
       return
     }
     constraintType.value = 'angle'
     showConstraintDialog.value = true
   } else if (type === 'symmetry') {
     if (!selectedGeometry.value || selectedGeometry.value.type !== 'point') {
       error.value = 'Select first point for symmetry constraint'
       return
     }
     constraintType.value = 'symmetry'
     secondGeometry.value = null
     showConstraintDialog.value = true
   } else if (type === 'tangent') {
     if (!selectedGeometry.value) {
       error.value = 'Select a line and circle for tangent constraint'
       return
     }
     constraintType.value = 'tangent'
     secondGeometry.value = null
     showConstraintDialog.value = true
   } else if (type === 'on_line') {
     if (!selectedGeometry.value || selectedGeometry.value.type !== 'point') {
       error.value = 'Select a point for on_line constraint'
       return
     }
     constraintType.value = 'on_line'
     secondGeometry.value = null
     showConstraintDialog.value = true
   }

   redrawCanvas()
 }

const deleteConstraint = (index) => {
   if (confirm('Delete this constraint?')) {
     constraints.value.splice(index, 1)
     success.value = 'Constraint deleted'
   }
 }

const confirmConstraintValue = () => {
   error.value = ''

   if (constraintType.value === 'equal_length') {
     if (!secondGeometry.value || secondGeometry.value.type !== 'line') {
       error.value = 'Must select two lines for equal_length constraint'
       return
     }
     const constraint = {
       type: 'equal_length',
       line1: `line_${selectedGeometry.value.index}`,
       line2: `line_${secondGeometry.value.index}`
     }
     constraints.value.push(constraint)
     success.value = 'equal_length constraint added'
   } else if (constraintType.value === 'angle') {
     if (constraintValue.value < 0 || constraintValue.value > 360) {
       error.value = 'Angle must be between 0 and 360 degrees'
       return
     }
     const constraint = {
       type: 'angle',
       line_name: `line_${selectedGeometry.value.index}`,
       angle: parseFloat(constraintValue.value)
     }
     constraints.value.push(constraint)
     success.value = `angle constraint added: ${constraintValue.value}°`
   } else if (constraintType.value === 'symmetry') {
     if (!secondGeometry.value || secondGeometry.value.type !== 'point') {
       error.value = 'Must select two points for symmetry constraint'
       return
     }
     const axisType = prompt('Axis type (vertical/horizontal/origin)?', 'vertical')
     if (!axisType || !['vertical', 'horizontal', 'origin'].includes(axisType)) {
       error.value = 'Invalid axis type'
       return
     }
     const constraint = {
       type: 'symmetry',
       point1: `point_${selectedGeometry.value.index}`,
       point2: `point_${secondGeometry.value.index}`,
       axis_type: axisType
     }
     constraints.value.push(constraint)
     success.value = `symmetry constraint added (${axisType})`
   } else if (constraintType.value === 'tangent') {
     if (!secondGeometry.value) {
       error.value = 'Must select a line and circle for tangent constraint'
       return
     }
     let lineIdx, circleIdx
     if (selectedGeometry.value.type === 'line') {
       lineIdx = selectedGeometry.value.index
       if (secondGeometry.value.type !== 'circle') {
         error.value = 'Second geometry must be a circle'
         return
       }
       circleIdx = secondGeometry.value.index
     } else {
       error.value = 'First geometry must be a line'
       return
     }
     const constraint = {
       type: 'tangent',
       line_name: `line_${lineIdx}`,
       circle_name: `circle_${circleIdx}`
     }
     constraints.value.push(constraint)
     success.value = 'tangent constraint added'
   } else if (constraintType.value === 'on_line') {
     if (!secondGeometry.value || secondGeometry.value.type !== 'line') {
       error.value = 'Must select a point and line for on_line constraint'
       return
     }
     const constraint = {
       type: 'on_line',
       point_name: `point_${selectedGeometry.value.index}`,
       line_name: `line_${secondGeometry.value.index}`
     }
     constraints.value.push(constraint)
     success.value = 'on_line constraint added'
   } else if (constraintValue.value <= 0) {
     error.value = 'Constraint value must be positive'
     return
   } else {
     const constraint = {
       type: constraintType.value,
       value: parseFloat(constraintValue.value)
     }

     if (constraintType.value === 'length' && selectedGeometry.value?.type === 'line') {
       constraint.line_name = `line_${selectedGeometry.value.index}`
     } else if (constraintType.value === 'distance' && selectedGeometry.value?.type === 'point') {
       constraint.point = `point_${selectedGeometry.value.index}`
       constraint.x = selectedGeometry.value.x || 0
       constraint.y = selectedGeometry.value.y || 0
     } else {
       error.value = 'Invalid selection for this constraint type'
       return
     }

     constraints.value.push(constraint)
     success.value = `${constraintType.value} constraint added with value ${constraintValue.value}`
   }

   showConstraintDialog.value = false
   constraintValue.value = 0
   constraintType.value = ''
   selectedGeometry.value = null
   secondGeometry.value = null
   
   redrawCanvas()
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
  points.value.forEach((p, i) => {
    const isSelected = selectedGeometry.value?.type === 'point' && selectedGeometry.value?.index === i
    layer.value.add(
      new Konva.Circle({
        x: p.x,
        y: p.y,
        radius: pointRadius,
        fill: isSelected ? '#ff6b6b' : '#667eea',
        stroke: isSelected ? '#c92a2a' : '#4c51bf',
        strokeWidth: isSelected ? 2 : 1,
      })
    )
  })

  // Redraw lines
  lines.value.forEach((line, i) => {
    const start = points.value[line.start]
    const end = points.value[line.end]
    const isSelected = selectedGeometry.value?.type === 'line' && selectedGeometry.value?.index === i
    
    if (start && end) {
      layer.value.add(
        new Konva.Line({
          points: [start.x, start.y, end.x, end.y],
          stroke: isSelected ? '#ff6b6b' : '#764ba2',
          strokeWidth: isSelected ? 3 : lineWidth,
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
           <button 
             class="tool-btn" 
             @click="addConstraint('horizontal')"
             :disabled="!selectedGeometry || selectedGeometry.type !== 'line'"
             title="Constrain selected line to be horizontal"
           >
             ⟷ Horizontal
           </button>
           <button 
             class="tool-btn" 
             @click="addConstraint('vertical')"
             :disabled="!selectedGeometry || selectedGeometry.type !== 'line'"
             title="Constrain selected line to be vertical"
           >
             ⟨ Vertical
           </button>
           <button 
             class="tool-btn" 
             @click="addConstraint('length')"
             :disabled="!selectedGeometry || selectedGeometry.type !== 'line'"
             title="Set length constraint for selected line"
           >
             ⏺ Length
           </button>
           <button 
             class="tool-btn" 
             @click="addConstraint('equal_length')"
             :disabled="!selectedGeometry || selectedGeometry.type !== 'line'"
             title="Make two lines equal length"
           >
             ⟹ Equal Len
           </button>
           <button 
             class="tool-btn" 
             @click="addConstraint('angle')"
             :disabled="!selectedGeometry || selectedGeometry.type !== 'line'"
             title="Constrain line to specific angle"
           >
             ∠ Angle
           </button>
           <button 
             class="tool-btn" 
             @click="addConstraint('symmetry')"
             :disabled="!selectedGeometry || selectedGeometry.type !== 'point'"
             title="Make two points symmetric"
           >
             ⇄ Symmetry
           </button>
           <button 
             class="tool-btn" 
             @click="addConstraint('tangent')"
             title="Constrain line tangent to circle"
           >
             ⌢ Tangent
           </button>
           <button 
             class="tool-btn" 
             @click="addConstraint('on_line')"
             :disabled="!selectedGeometry || selectedGeometry.type !== 'point'"
             title="Constrain point to lie on line"
           >
             ⊙ On Line
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

         <!-- Constraints List Panel -->
         <div v-if="showConstraintPanel" class="constraints-panel">
           <div class="panel-header">
             <h3>Applied Constraints ({{ constraints.length }})</h3>
             <button class="btn-toggle" @click="showConstraintPanel = false" title="Collapse">−</button>
           </div>
           <div v-if="constraints.length === 0" class="empty-state">
             No constraints applied yet
           </div>
           <div v-else class="constraints-list">
             <div v-for="(constraint, idx) in constraints" :key="idx" class="constraint-item">
               <div class="constraint-info">
                 <span class="constraint-type">{{ constraint.type }}</span>
                 <span class="constraint-details">
                   <template v-if="constraint.line_name">Line: {{ constraint.line_name }}</template>
                   <template v-else-if="constraint.point">Point: {{ constraint.point }}</template>
                   <template v-else-if="constraint.point_name">{{ constraint.point_name }}</template>
                   <template v-else-if="constraint.line1">{{ constraint.line1 }} = {{ constraint.line2 }}</template>
                   <template v-if="constraint.value">, Value: {{ constraint.value }}</template>
                   <template v-if="constraint.angle">, Angle: {{ constraint.angle }}°</template>
                   <template v-if="constraint.axis_type">, Axis: {{ constraint.axis_type }}</template>
                 </span>
               </div>
               <button class="btn-delete" @click="deleteConstraint(idx)" title="Delete constraint">×</button>
             </div>
           </div>
         </div>
         <div v-else class="panel-header">
           <button class="btn-toggle" @click="showConstraintPanel = true" title="Expand">+</button>
         </div>
      </div>
    </div>

    <!-- Constraint Dialog Modal -->
     <div v-if="showConstraintDialog" class="modal-overlay" @click="showConstraintDialog = false">
       <div class="modal-content" @click.stop>
         <h3>Set {{ constraintType }} Constraint</h3>
         
         <!-- For constraints needing two geometries -->
         <div v-if="constraintType === 'equal_length'">
           <p class="modal-instruction">Click on a second line to complete equal_length constraint</p>
           <div class="selected-items">
             <span v-if="selectedGeometry" class="item">Line 1: {{ selectedGeometry.index }}</span>
             <span v-if="secondGeometry" class="item">Line 2: {{ secondGeometry.index }}</span>
           </div>
         </div>

         <div v-else-if="constraintType === 'symmetry'">
           <p class="modal-instruction">Click on a second point to complete symmetry constraint</p>
           <div class="selected-items">
             <span v-if="selectedGeometry" class="item">Point 1: {{ selectedGeometry.index }}</span>
             <span v-if="secondGeometry" class="item">Point 2: {{ secondGeometry.index }}</span>
           </div>
         </div>

         <div v-else-if="constraintType === 'tangent'">
           <p class="modal-instruction">Click on a circle to make selected line tangent</p>
           <div class="selected-items">
             <span v-if="selectedGeometry" class="item">
               {{ selectedGeometry.type }}: {{ selectedGeometry.index }}
             </span>
             <span v-if="secondGeometry" class="item">
               {{ secondGeometry.type }}: {{ secondGeometry.index }}
             </span>
           </div>
         </div>

         <div v-else-if="constraintType === 'on_line'">
           <p class="modal-instruction">Click on a line to constrain point to it</p>
           <div class="selected-items">
             <span v-if="selectedGeometry" class="item">Point: {{ selectedGeometry.index }}</span>
             <span v-if="secondGeometry" class="item">Line: {{ secondGeometry.index }}</span>
           </div>
         </div>

         <!-- For constraints needing a value -->
         <div v-else class="form-group">
           <label>
             <template v-if="constraintType === 'angle'">Angle (degrees, 0-360):</template>
             <template v-else>Value (mm):</template>
           </label>
           <input 
             v-model.number="constraintValue" 
             type="number" 
             placeholder="Enter value"
             @keyup.enter="confirmConstraintValue"
           />
         </div>

         <div class="modal-actions">
           <button class="btn-cancel" @click="showConstraintDialog = false">Cancel</button>
           <button 
             class="btn-confirm" 
             @click="confirmConstraintValue"
             :disabled="constraintType === 'equal_length' && !secondGeometry || 
                        constraintType === 'symmetry' && !secondGeometry ||
                        constraintType === 'tangent' && !secondGeometry ||
                        constraintType === 'on_line' && !secondGeometry"
           >
             Apply
           </button>
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

.modal-content {
  background: white;
  border-radius: 8px;
  padding: 2rem;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
  min-width: 300px;
}

.modal-content h3 {
  margin: 0 0 1rem;
  font-size: 1.2rem;
  color: #2c3e50;
  text-transform: capitalize;
}

.form-group {
  margin-bottom: 1.5rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  color: #2c3e50;
  font-weight: 500;
}

.form-group input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  font-size: 1rem;
  box-sizing: border-box;
}

.form-group input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.1);
}

.modal-actions {
  display: flex;
  gap: 1rem;
  justify-content: flex-end;
}

.btn-cancel,
.btn-confirm {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel {
  background: #f5f5f5;
  color: #2c3e50;
  border: 1px solid #e0e0e0;
}

.btn-cancel:hover {
  background: #e0e0e0;
}

.btn-confirm {
  background: #667eea;
  color: white;
}

.btn-confirm:hover {
   background: #5568d3;
 }

/* Constraints Panel Styles */
.constraints-panel {
   background: #f5f5f5;
   border: 1px solid #e0e0e0;
   border-radius: 4px;
   padding: 1rem;
   margin-top: 1rem;
   max-height: 300px;
   overflow-y: auto;
 }

.panel-header {
   display: flex;
   justify-content: space-between;
   align-items: center;
   margin-bottom: 0.5rem;
 }

.panel-header h3 {
   margin: 0;
   font-size: 0.9rem;
   color: #2c3e50;
 }

.btn-toggle {
   background: none;
   border: none;
   color: #667eea;
   font-size: 1.2rem;
   cursor: pointer;
   padding: 0;
   width: 24px;
   height: 24px;
   display: flex;
   align-items: center;
   justify-content: center;
 }

.btn-toggle:hover {
   background: #e0e7ff;
   border-radius: 4px;
 }

.empty-state {
   padding: 1rem;
   text-align: center;
   color: #95a5a6;
   font-size: 0.85rem;
 }

.constraints-list {
   display: flex;
   flex-direction: column;
   gap: 0.5rem;
 }

.constraint-item {
   display: flex;
   justify-content: space-between;
   align-items: center;
   background: white;
   padding: 0.75rem;
   border-radius: 4px;
   border-left: 3px solid #667eea;
   font-size: 0.85rem;
 }

.constraint-info {
   display: flex;
   flex-direction: column;
   gap: 0.25rem;
   flex: 1;
 }

.constraint-type {
   font-weight: 600;
   color: #2c3e50;
   text-transform: capitalize;
 }

.constraint-details {
   color: #7f8c8d;
   font-size: 0.8rem;
 }

.btn-delete {
   background: #ff6b6b;
   color: white;
   border: none;
   border-radius: 4px;
   width: 24px;
   height: 24px;
   cursor: pointer;
   display: flex;
   align-items: center;
   justify-content: center;
   font-size: 1rem;
   transition: background 0.2s;
   margin-left: 0.5rem;
   flex-shrink: 0;
 }

.btn-delete:hover {
   background: #c92a2a;
 }

/* Modal instruction text */
.modal-instruction {
   margin: 0 0 1rem;
   color: #667eea;
   font-size: 0.9rem;
   font-style: italic;
 }

.selected-items {
   display: flex;
   flex-direction: column;
   gap: 0.5rem;
   margin-bottom: 1rem;
   padding: 0.75rem;
   background: #f5f5f5;
   border-radius: 4px;
 }

.selected-items .item {
   color: #2c3e50;
   font-size: 0.9rem;
   padding: 0.25rem 0;
 }
</style>
