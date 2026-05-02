const STORAGE_KEY = "mr_player_password"

export function useAuth() {
  const password = ref("")

  function load() {
    if (import.meta.client) {
      password.value = localStorage.getItem(STORAGE_KEY) ?? ""
    }
  }

  function save(pwd: string) {
    password.value = pwd
    if (import.meta.client) {
      localStorage.setItem(STORAGE_KEY, pwd)
    }
  }

  function clear() {
    password.value = ""
    if (import.meta.client) {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  return { password, load, save, clear }
}
