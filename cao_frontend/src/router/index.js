/**
 * Vue Router configuration
 * Defines routes for dashboard, sketcher, 3D editor, and authentication
 */

import { createRouter, createWebHistory } from 'vue-router'
import { useAppStore } from '@/stores/app'

const routes = [
  {
    path: '/',
    redirect: '/dashboard',
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/pages/LoginPage.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('@/pages/RegisterPage.vue'),
    meta: { requiresAuth: false },
  },
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: () => import('@/pages/DashboardPage.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/project/:id',
    name: 'ProjectView',
    component: () => import('@/pages/ProjectPage.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/sketch/:projectId/:sketchId',
    name: 'SketchEditor',
    component: () => import('@/pages/SketchEditorPage.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/editor/:projectId/:geometryId',
    name: 'GeometryEditor',
    component: () => import('@/pages/GeometryEditorPage.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/pages/NotFoundPage.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

// Navigation guard for authentication
router.beforeEach(async (to, from, next) => {
  const store = useAppStore()

  // Fetch current user if not already loaded
  if (!store.isAuthenticated && !to.meta.requiresAuth === false) {
    try {
      await store.fetchCurrentUser()
    } catch {
      // User is not authenticated
    }
  }

  // Check if route requires authentication
  if (to.meta.requiresAuth && !store.isAuthenticated) {
    next('/login')
  } else if (to.path === '/login' && store.isAuthenticated) {
    next('/dashboard')
  } else {
    next()
  }
})

export default router
