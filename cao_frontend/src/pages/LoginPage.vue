<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'

const router = useRouter()
const store = useAppStore()

const username = ref('')
const password = ref('')
const loginError = ref('')

const handleLogin = async () => {
  if (!username.value || !password.value) {
    loginError.value = 'Please enter username and password'
    return
  }

  try {
    loginError.value = ''
    await store.login(username.value, password.value)
    await router.push('/dashboard')
  } catch (error) {
    loginError.value = error.response?.data?.detail || 'Login failed'
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-container">
      <div class="login-box">
        <h1>CAO Web Application</h1>
        <p class="subtitle">Computer-Aided Design</p>

        <form @submit.prevent="handleLogin" class="login-form">
          <div class="form-group">
            <label for="username">Username</label>
            <input
              id="username"
              v-model="username"
              type="text"
              placeholder="Enter your username"
              required
            />
          </div>

          <div class="form-group">
            <label for="password">Password</label>
            <input
              id="password"
              v-model="password"
              type="password"
              placeholder="Enter your password"
              required
            />
          </div>

          <div v-if="loginError" class="error-message">
            {{ loginError }}
          </div>

          <button type="submit" class="btn-login">
            {{ store.loading ? 'Logging in...' : 'Login' }}
          </button>
        </form>

        <p class="signup-link">
          Don't have an account?
          <router-link to="/register">Sign up here</router-link>
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.login-container {
  width: 100%;
  max-width: 400px;
  padding: 2rem;
}

.login-box {
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

.login-form {
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

.btn-login {
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

.btn-login:hover {
  background: #5568d3;
}

.btn-login:disabled {
  background: #95a5a6;
  cursor: not-allowed;
}

.signup-link {
  text-align: center;
  color: #7f8c8d;
  margin-top: 1rem;
  font-size: 0.9rem;
}

.signup-link a {
  color: #667eea;
  text-decoration: none;
  font-weight: 500;
}

.signup-link a:hover {
  text-decoration: underline;
}
</style>
