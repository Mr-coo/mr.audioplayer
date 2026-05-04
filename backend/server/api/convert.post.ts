import { isValidYouTubeURL, getVideoInfo, createMp3Stream } from "../utils/converter"

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const url = body?.url

  if (!url || typeof url !== "string") {
    throw createError({ statusCode: 400, statusMessage: "url is required" })
  }

  if (!isValidYouTubeURL(url)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid YouTube URL" })
  }

  const authenticated = !!process.env.YOUTUBE_COOKIE

  let title: string
  let ytInfo: Awaited<ReturnType<typeof getVideoInfo>>["info"]

  try {
    ;({ title, info: ytInfo } = await getVideoInfo(url))
  } catch (err: any) {
    const msg: string = err?.message ?? "Unknown error"
    const msgLower = msg.toLowerCase()
    if (msgLower.includes("unavailable")) {
      throw createError({
        statusCode: 403,
        statusMessage: authenticated
          ? "Video unavailable: this video cannot be played."
          : "Video unavailable: the creator has disabled external playback. Set YOUTUBE_COOKIE to unlock all videos.",
      })
    }
    const status =
      msgLower.includes("private") || msgLower.includes("login required") ? 403 : 502
    throw createError({ statusCode: status, statusMessage: `Could not fetch video info: ${msg}` })
  }

  // HTTP headers must be ASCII; use RFC 6266 filename* for Unicode titles.
  const asciiName = title.replace(/[^\x20-\x7E]/g, "_") + ".mp3"
  const encodedName = encodeURIComponent(title + ".mp3")
  setResponseHeader(event, "Content-Type", "audio/mpeg")
  setResponseHeader(event, "Content-Disposition", `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`)
  setResponseHeader(event, "Transfer-Encoding", "chunked")

  const stream = await createMp3Stream(ytInfo, authenticated)
  return sendStream(event, stream)
})
