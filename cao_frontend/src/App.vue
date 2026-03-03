<script setup>
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'

const router = useRouter()
const store = useAppStore()
</script>

<template>
  <div class="app">
    <!-- Navigation -->
    <nav v-if="store.isAuthenticated" class="navbar">
      <div class="navbar-brand">
        <h1>CAO - Web CAD Application</h1>
      </div>
      <div class="navbar-menu">
        <router-link to="/dashboard" class="nav-link">Dashboard</router-link>
        <div class="user-menu">
          <span v-if="store.user" class="username">{{ store.user.username }}</span>
          <button @click="store.logout()" class="btn-logout">Logout</button>
        </div>
      </div>
    </nav>

    <!-- Main Content -->
    <div class="main-content">
      <!-- Loading Indicator -->
      <div v-if="store.loading" class="loading-overlay">
        <div class="spinner"></div>
        <p>Loading...</p>
      </div>

      <!-- Error Message -->
      <div v-if="store.error" class="error-banner">
        <p>{{ store.error }}</p>
        <button @click="store.clearError()" class="btn-close">×</button>
      </div>

      <!-- Router View -->
      <router-view />
    </div>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f5f5;
}

.navbar {
  background: #2c3e50;
  color: white;
  padding: 1rem 2rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.navbar-brand h1 {
  margin: 0;
  font-size: 1.5rem;
}

.navbar-menu {
  display: flex;
  gap: 2rem;
  align-items: center;
}

.nav-link {
  color: white;
  text-decoration: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  transition: background 0.2s;
}

.nav-link:hover {
  background: rgba(255, 255, 255, 0.1);
}

.user-menu {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.username {
  font-size: 0.9rem;
}

.btn-logout {
  background: #e74c3c;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-logout:hover {
  background: #c0392b;
}

.main-content {
  flex: 1;
  position: relative;
}

.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 9999;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-overlay p {
  color: white;
  margin-top: 1rem;
}

.error-banner {
  background: #e74c3c;
  color: white;
  padding: 1rem;
  margin: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.error-banner p {
  margin: 0;
}

.btn-close {
  background: none;
  border: none;
  color: white;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
}
</style>
