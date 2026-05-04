import { Innertube, Platform } from "youtubei.js"
import BG, { type BgConfig } from "bgutils-js"
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

const BG_REQUEST_KEY = "O43z0dpjhgX20SCx4KAo"
const SESSION_TTL_MS = 25 * 60 * 1000

interface Session {
  yt: Awaited<ReturnType<typeof Innertube.create>>
  expiresAt: number
}

let _session: Session | null = null
let _creating: Promise<Session> | null = null

async function buildPoToken(visitorData: string): Promise<string | null> {
  try {
    // Each challenge run needs its own globalObj so BotGuard VM instances
    // don't bleed across calls.
    const globalObj: Record<string, any> = {}

    const bgConfig: BgConfig = {
      fetch,
      globalObj,
      identifier: visitorData,
      requestKey: BG_REQUEST_KEY,
    }

    const challenge = await BG.Challenge.create(bgConfig)
    if (!challenge) return null

    const interpreterJs =
      challenge.interpreterJavascript.privateDoNotAccessOrElseSafeScriptWrappedValue
    if (interpreterJs) {
      // Run BotGuard script in an isolated context that shares globalObj, so
      // the VM is registered under globalObj[challenge.globalName].
      runInNewContext(interpreterJs, globalObj)
    }

    const { poToken } = await BG.PoToken.generate({
      program: challenge.program,
      globalName: challenge.globalName,
      bgConfig,
    })

    return poToken
  } catch (err) {
    console.warn("[converter] PO token generation failed:", err)
    return null
  }
}

async function createSession(): Promise<Session> {
  // Step 1: bootstrap a session just to obtain a stable visitor data string.
  const bootstrap = await Innertube.create({ generate_session_locally: true })
  const visitorData = bootstrap.session.context.client.visitorData ?? ""

  if (!visitorData) {
    console.warn("[converter] No visitor data — session created without PO token")
    return { yt: bootstrap, expiresAt: Date.now() + SESSION_TTL_MS }
  }

  // Step 2: generate a PO token bound to that visitor data.
  const poToken = await buildPoToken(visitorData)

  if (!poToken) {
    console.warn("[converter] PO token unavailable — some videos may fail with LOGIN_REQUIRED")
    return { yt: bootstrap, expiresAt: Date.now() + SESSION_TTL_MS }
  }

  // Step 3: create the real session with PO token so stream URLs are trusted.
  const yt = await Innertube.create({
    generate_session_locally: true,
    po_token: poToken,
    visitor_data: visitorData,
  })

  return { yt, expiresAt: Date.now() + SESSION_TTL_MS }
}

async function getInnertube() {
  if (_session && Date.now() < _session.expiresAt) {
    return _session.yt
  }

  if (!_creating) {
    _creating = createSession()
      .then((session) => {
        _session = session
        _creating = null
        return session
      })
      .catch((err) => {
        _creating = null
        throw err
      })
  }

  return (await _creating).yt
}

function invalidateSession() {
  _session = null
  _creating = null
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
