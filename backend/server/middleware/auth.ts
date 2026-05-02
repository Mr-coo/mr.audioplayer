import { checkRateLimit } from "../utils/rateLimit"

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname

  if (!path.startsWith("/api/")) return

  const ip =
    getRequestHeader(event, "x-forwarded-for")?.split(",")[0]?.trim() ||
    event.node.req.socket?.remoteAddress ||
    "unknown"

  if (!checkRateLimit(ip, 20, 60_000)) {
    throw createError({ statusCode: 429, statusMessage: "Too many requests" })
  }

  const config = useRuntimeConfig(event)
  const password = config.authPassword

  if (!password) {
    throw createError({ statusCode: 500, statusMessage: "Server misconfigured: AUTH_PASSWORD not set" })
  }

  const authHeader = getRequestHeader(event, "authorization") ?? ""

  if (!authHeader.startsWith("Bearer ")) {
    throw createError({ statusCode: 401, statusMessage: "Missing Authorization header (Bearer <password>)" })
  }

  const token = authHeader.slice(7)
  if (token !== password) {
    throw createError({ statusCode: 401, statusMessage: "Invalid password" })
  }
})
