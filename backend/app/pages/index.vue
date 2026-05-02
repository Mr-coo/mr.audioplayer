<template>
  <div class="min-h-screen bg-gray-950 text-white flex items-center justify-center p-4">
    <div class="w-full max-w-lg space-y-6">

      <!-- Header -->
      <div class="text-center space-y-1">
        <h1 class="text-4xl font-bold tracking-tight">Mr. Player</h1>
        <p class="text-gray-400 text-sm">YouTube → MP3 converter</p>
      </div>

      <!-- Password -->
      <div class="space-y-1">
        <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">Password</label>
        <div class="flex gap-2">
          <input
            v-model="rawPassword"
            :type="showPassword ? 'text' : 'password'"
            placeholder="Enter access password"
            class="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
            @input="auth.save(rawPassword)"
          />
          <button
            type="button"
            class="px-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-400 hover:text-white transition text-xs"
            @click="showPassword = !showPassword"
          >
            {{ showPassword ? 'Hide' : 'Show' }}
          </button>
        </div>
      </div>

      <!-- URL -->
      <div class="space-y-1">
        <label class="text-xs font-medium text-gray-400 uppercase tracking-wider">YouTube URL</label>
        <input
          v-model="url"
          type="url"
          placeholder="https://youtube.com/watch?v=..."
          class="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm placeholder-gray-600 focus:outline-none focus:border-blue-500 transition"
          @keydown.enter="convert"
        />
      </div>

      <!-- Convert button -->
      <button
        class="w-full py-3 rounded-lg font-semibold text-sm transition"
        :class="canConvert
          ? 'bg-blue-600 hover:bg-blue-500 text-white'
          : 'bg-gray-800 text-gray-600 cursor-not-allowed'"
        :disabled="!canConvert || isLoading"
        @click="convert"
      >
        <span v-if="isLoading" class="flex items-center justify-center gap-2">
          <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          {{ statusText }}
        </span>
        <span v-else>Convert to MP3</span>
      </button>

      <!-- Error -->
      <div
        v-if="error"
        class="flex items-start gap-2 bg-red-950 border border-red-800 rounded-lg px-4 py-3 text-red-300 text-sm"
      >
        <span class="mt-0.5">⚠</span>
        <span>{{ error }}</span>
      </div>

      <!-- Success -->
      <div
        v-if="lastFile"
        class="flex items-center justify-between bg-green-950 border border-green-800 rounded-lg px-4 py-3 text-sm"
      >
        <span class="text-green-300 truncate">{{ lastFile }}</span>
        <span class="text-green-500 shrink-0 ml-2">Downloaded ✓</span>
      </div>

      <!-- API hint -->
      <details class="text-xs text-gray-600 border border-gray-800 rounded-lg">
        <summary class="px-4 py-2 cursor-pointer hover:text-gray-400 transition">API usage</summary>
        <div class="px-4 pb-3 pt-1 space-y-2 font-mono text-gray-500">
          <p>POST /api/convert</p>
          <p>Authorization: Bearer &lt;password&gt;</p>
          <p>Content-Type: application/json</p>
          <p>{{ '{"url":"https://youtube.com/watch?v=..."}' }}</p>
        </div>
      </details>

    </div>
  </div>
</template>

<script setup lang="ts">
const auth = useAuth()
const rawPassword = ref("")
const showPassword = ref(false)
const url = ref("")
const isLoading = ref(false)
const statusText = ref("Converting…")
const error = ref("")
const lastFile = ref("")

const canConvert = computed(() => !!rawPassword.value && !!url.value && !isLoading.value)

onMounted(() => {
  auth.load()
  rawPassword.value = auth.password.value
})

async function convert() {
  if (!canConvert.value) return
  error.value = ""
  lastFile.value = ""
  isLoading.value = true
  statusText.value = "Fetching video info…"

  try {
    const response = await fetch("/api/convert", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${rawPassword.value}`,
      },
      body: JSON.stringify({ url: url.value }),
    })

    if (!response.ok) {
      let msg = `Error ${response.status}`
      try {
        const data = await response.json()
        msg = data.statusMessage ?? data.message ?? msg
      } catch {}
      error.value = msg
      return
    }

    statusText.value = "Downloading audio…"

    const disposition = response.headers.get("content-disposition") ?? ""
    const match = disposition.match(/filename="([^"]+)"/)
    const filename = match?.[1] ?? "audio.mp3"

    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(objectUrl)

    lastFile.value = filename
    url.value = ""
  } catch (e: any) {
    error.value = e?.message ?? "Unexpected error"
  } finally {
    isLoading.value = false
  }
}
</script>
