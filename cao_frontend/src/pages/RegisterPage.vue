<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const username = ref('')
const password = ref('')
const error = ref('')

const handleRegister = async () => {
  if (!username.value || !password.value) {
    error.value = 'Please enter username and password'
    return
  }
  // TODO: Implement registration API call
  await router.push('/login')
}
</script>

<template>
  <div class="register-page">
    <div class="register-container">
      <h1>Create Account</h1>
      <form @submit.prevent="handleRegister">
        <input v-model="username" type="text" placeholder="Username" />
        <input v-model="password" type="password" placeholder="Password" />
        <button type="submit">Register</button>
      </form>
      <p><router-link to="/login">Already have an account? Login</router-link></p>
    </div>
  </div>
</template>

<style scoped>
.register-page {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: #f5f5f5;
}

.register-container {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
</style>
