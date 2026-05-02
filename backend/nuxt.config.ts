import tailwindcss from "@tailwindcss/vite"

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },

  devServer: {
    host: "0.0.0.0",
  },

  vite: {
    plugins: [tailwindcss()],
  },

  css: ["~/assets/css/main.css"],

  runtimeConfig: {
    authPassword: process.env.AUTH_PASSWORD ?? "",
  },

  nitro: {
    experimental: {
      asyncContext: true,
    },
    // Prevent youtubei.js (and ffmpeg bindings) from being inlined into the bundle
    externals: {
      external: ["youtubei.js", "ffmpeg-static", "fluent-ffmpeg"],
    },
  },
})
