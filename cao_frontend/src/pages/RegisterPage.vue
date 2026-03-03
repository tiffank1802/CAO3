<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import api from '@/services/api'

const router = useRouter()
const store = useAppStore()

const username = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const registerError = ref('')
const isLoading = ref(false)

const handleRegister = async () => {
  registerError.value = ''

  // Validation
  if (!username.value || !email.value || !password.value || !confirmPassword.value) {
    registerError.value = 'Please fill in all fields'
    return
  }

  if (password.value !== confirmPassword.value) {
    registerError.value = 'Passwords do not match'
    return
  }

  if (password.value.length < 8) {
    registerError.value = 'Password must be at least 8 characters'
    return
  }

  try {
    isLoading.value = true
    const data = await api.register({
      username: username.value,
      email: email.value,
      password: password.value,
    })
    store.user = data.user
    store.isAuthenticated = true
    await router.push('/dashboard')
  } catch (error) {
    registerError.value = error.response?.data?.detail || 'Registration failed'
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="register-page">
    <div class="register-container">
      <div class="register-box">
        <h1>Create Account</h1>
        <p class="subtitle">Join CAO Web Application</p>

        <form @submit.prevent="handleRegister" class="register-form">
          <div class="form-group">
            <label for="username">Username</label>
            <input
              id="username"
              v-model="username"
              type="text"
              placeholder="Choose a username"
              required
            />
          </div>

          <div class="form-group">
            <label for="email">Email</label>
            <input
              id="email"
              v-model="email"
              type="email"
              placeholder="your@email.com"
              required
            />
          </div>

          <div class="form-group">
            <label for="password">Password</label>
            <input
              id="password"
              v-model="password"
              type="password"
              placeholder="At least 8 characters"
              required
            />
          </div>

          <div class="form-group">
            <label for="confirm-password">Confirm Password</label>
            <input
              id="confirm-password"
              v-model="confirmPassword"
              type="password"
              placeholder="Confirm your password"
              required
            />
          </div>

          <div v-if="registerError" class="error-message">
            {{ registerError }}
          </div>

          <button type="submit" class="btn-register" :disabled="isLoading">
            {{ isLoading ? 'Creating Account...' : 'Create Account' }}
          </button>
        </form>

        <p class="login-link">
          Already have an account?
          <router-link to="/login">Login here</router-link>
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.register-page {
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.register-container {
  width: 100%;
  max-width: 400px;
  padding: 2rem;
}

.register-box {
  background: white;
  border-radius: 8px;
  padding: 3rem;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
}

h1 {
  text-align: center;
  color: #2c3e50;
  margin: 0 0 0.5rem;
  font-size: 1.8rem;
}

.subtitle {
  text-align: center;
  color: #7f8c8d;
  margin: 0 0 2rem;
  font-size: 0.9rem;
}

.register-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  color: #2c3e50;
  font-weight: 500;
  font-size: 0.9rem;
}

.form-group input {
  padding: 0.75rem;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  font-size: 1rem;
  transition: border-color 0.2s;
}

.form-group input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.error-message {
  padding: 0.75rem;
  background: #ffe6e6;
  color: #c0392b;
  border-radius: 4px;
  font-size: 0.9rem;
  border-left: 4px solid #c0392b;
}

.btn-register {
  padding: 0.75rem;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
  margin-top: 1rem;
}

.btn-register:hover:not(:disabled) {
  background: #5568d3;
}

.btn-register:disabled {
  background: #95a5a6;
  cursor: not-allowed;
}

.login-link {
  text-align: center;
  color: #7f8c8d;
  margin-top: 1rem;
  font-size: 0.9rem;
}

.login-link a {
  color: #667eea;
  text-decoration: none;
  font-weight: 500;
}

.login-link a:hover {
  text-decoration: underline;
}
</style>
