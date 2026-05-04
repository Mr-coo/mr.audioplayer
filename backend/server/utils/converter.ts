import { Innertube, Platform, ClientType } from "youtubei.js"
import BG from "bgutils-js"
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

const SESSION_TTL_MS = 25 * 60 * 1000

interface Session {
  yt: Awaited<ReturnType<typeof Innertube.create>>
  expiresAt: number
}

let _session: Session | null = null
let _creating: Promise<Session> | null = null

async function createSession(): Promise<Session> {
  // IOS client: no embedding restrictions, no BotGuard enforcement, and uses
  // non-SABR stream URLs so the cold-start PO token can be attached as pot=.
  const yt = await Innertube.create({
    generate_session_locally: true,
    client_type: ClientType.IOS,
  })

  const visitorData = yt.session.context.client.visitorData ?? ""

  if (visitorData && yt.session.player) {
    const poToken = BG.PoToken.generateColdStartToken(visitorData)
    // Apply the token only to the player so it reaches CDN stream URLs (pot=)
    // but is not injected into InnerTube API request bodies.
    ;(yt.session.player as { po_token: string }).po_token = poToken
  }

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
  let info: Awaited<ReturnType<typeof yt.getBasicInfo>>
  try {
    info = await yt.getBasicInfo(id)
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
  ytInfo: Awaited<ReturnType<Innertube["getBasicInfo"]>> | Awaited<ReturnType<Innertube["getInfo"]>>,
): PassThrough {
  const output = new PassThrough()

  ;(async () => {
    const webStream = await ytInfo.download({
      type: "video+audio",
      quality: "best",
      format: "any",
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
