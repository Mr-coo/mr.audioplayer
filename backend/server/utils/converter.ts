import { Innertube, Platform } from "youtubei.js"
import { runInNewContext } from "node:vm"
import ffmpeg from "fluent-ffmpeg"
import ffmpegPath from "ffmpeg-static"
import { Readable, PassThrough } from "node:stream"

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath)
}

// youtubei.js ships a stub eval that throws by design — replace it with
// Node.js vm so the player can decipher the `n` parameter in stream URLs.
Platform.load({
  ...Platform.shim,
  eval: (data, _env) =>
    runInNewContext(`(function(){${data.output}})()`, {}) as ReturnType<
      typeof Platform.shim.eval
    >,
})

let _yt: Awaited<ReturnType<typeof Innertube.create>> | null = null

async function getInnertube() {
  if (!_yt) {
    _yt = await Innertube.create({ generate_session_locally: true })
  }
  return _yt
}

function invalidateSession() {
  _yt = null
}

const YT_ID_RE =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/

export function isValidYouTubeURL(url: string): boolean {
  return YT_ID_RE.test(url)
}

function extractId(url: string): string {
  const m = url.match(YT_ID_RE)
  if (!m?.[1]) throw new Error("Invalid YouTube URL")
  return m[1]
}

export async function getVideoInfo(url: string) {
  const yt = await getInnertube()
  const id = extractId(url)
  let info: Awaited<ReturnType<typeof yt.getInfo>>
  try {
    info = await yt.getInfo(id)
  } catch (err) {
    invalidateSession()
    throw err
  }

  const raw = info.basic_info.title ?? "audio"
  const title =
    raw
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 100) || "audio"

  return { title, info }
}

export function createMp3Stream(
  ytInfo: Awaited<ReturnType<Innertube["getInfo"]>>,
): PassThrough {
  const output = new PassThrough()

  ;(async () => {
    // YouTube withholds DASH audio-only URLs in non-browser sessions.
    // The combined video+audio format always has a real URL — ffmpeg
    // drops the video track and outputs audio-only MP3.
    const webStream = await ytInfo.download({
      type: "video+audio",
      quality: "best",
      format: "mp4",
    })

    const nodeStream = Readable.fromWeb(
      webStream as Parameters<typeof Readable.fromWeb>[0],
    )

    ffmpeg(nodeStream)
      .noVideo()
      .audioBitrate(128)
      .format("mp3")
      .on("error", (err: Error) => {
        console.error("[converter] ffmpeg error:", err.message)
        output.destroy(err)
      })
      .pipe(output, { end: true })
  })().catch((err: Error) => {
    console.error("[converter] download error:", err.message)
    invalidateSession()
    output.destroy(err)
  })

  return output
}