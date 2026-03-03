<script setup>
import { onMounted, ref } from 'vue'
import { useAppStore } from '@/stores/app'
import { useRouter } from 'vue-router'

const store = useAppStore()
const router = useRouter()
const newProjectName = ref('')
const showNewProjectForm = ref(false)

onMounted(async () => {
  await store.fetchProjects()
})

const createProject = async () => {
  if (!newProjectName.value.trim()) return
  
  try {
    const newProject = await store.createProject({
      name: newProjectName.value,
      description: '',
    })
    newProjectName.value = ''
    showNewProjectForm.value = false
    store.setCurrentProject(newProject)
    await router.push(`/project/${newProject.id}`)
  } catch (error) {
    console.error('Failed to create project:', error)
  }
}

const openProject = (project) => {
  store.setCurrentProject(project)
  router.push(`/project/${project.id}`)
}
</script>

<template>
  <div class="dashboard">
    <div class="dashboard-header">
      <h1>My Projects</h1>
      <button @click="showNewProjectForm = !showNewProjectForm" class="btn-primary">
        + New Project
      </button>
    </div>

    <!-- New Project Form -->
    <div v-if="showNewProjectForm" class="new-project-form">
      <input
        v-model="newProjectName"
        type="text"
        placeholder="Project name"
        @keyup.enter="createProject"
      />
      <button @click="createProject" class="btn-primary">Create</button>
      <button @click="showNewProjectForm = false" class="btn-secondary">Cancel</button>
    </div>

    <!-- Projects Grid -->
    <div class="projects-grid">
      <div
        v-if="store.projects.length === 0"
        class="empty-state"
      >
        <p>No projects yet. Create one to get started!</p>
      </div>

      <div
        v-for="project in store.projects"
        :key="project.id"
        class="project-card"
        @click="openProject(project)"
      >
        <h3>{{ project.name }}</h3>
        <p>{{ project.description || 'No description' }}</p>
        <span class="project-meta">
          Updated: {{ new Date(project.updated_at).toLocaleDateString() }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.dashboard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.dashboard-header h1 {
  margin: 0;
  color: #2c3e50;
}

.btn-primary {
  background: #667eea;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.2s;
}

.btn-primary:hover {
  background: #5568d3;
}

.btn-secondary {
  background: #95a5a6;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 500;
  transition: background 0.2s;
  margin-left: 0.5rem;
}

.btn-secondary:hover {
  background: #7f8c8d;
}

.new-project-form {
  background: white;
  padding: 1.5rem;
  border-radius: 8px;
  margin-bottom: 2rem;
  display: flex;
  gap: 0.5rem;
}

.new-project-form input {
  flex: 1;
  padding: 0.75rem;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  font-size: 1rem;
}

.new-project-form input:focus {
  outline: none;
  border-color: #667eea;
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1.5rem;
}

.empty-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 3rem;
  color: #7f8c8d;
}

.project-card {
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid #e0e0e0;
}

.project-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  border-color: #667eea;
  transform: translateY(-2px);
}

.project-card h3 {
  margin: 0 0 0.5rem;
  color: #2c3e50;
}

.project-card p {
  color: #7f8c8d;
  margin: 0 0 1rem;
  font-size: 0.9rem;
}

.project-meta {
  font-size: 0.8rem;
  color: #95a5a6;
}
</style>
