const cheerio = require("cheerio")
const axios = require("axios")
const decode = require("./decode")
const fs = require("fs")
const { spawn } = require("child_process")

const getEncryptedStr = async url => {
  const result = await axios.get(url)
  return result.data.data.info
}

const write = (path, data) => {
  fs.writeFileSync(path, data)
}

const remove = path => {
  fs.unlink(path, err => {
    if (err) {
      return console.error(err)
    }
  })
}

const getStreamFile = async (url, streamFile) => {
  // get 3 real m3u8 urls
  const result = await getEncryptedStr(url)
  const deText = decode(result)
  const urls = deText.match(/^http.*/gm)
  // use the first one, basiclly the highest quality
  const streamUrl = urls[0]

  // get m3u8 content with encrypted key
  const result2 = await getEncryptedStr(streamUrl)
  const text2 = decode(result2)
  // decode the key in m3u8
  const keyUrl = /URI="(.*?)"/gm.exec(text2)[1]
  const result3 = await getEncryptedStr(keyUrl)
  const keyArray = decode(result3, true)
  const keyBase64 = Buffer.from(keyArray).toString("base64")
  const keyURI = `data:text/plain;base64,${keyBase64}`
  // replace the key with decoded key
  const streamText = text2.replace(/(URI=").*?(")/, `$1${keyURI}$2`)

  // write the m3u8 to file, and download using ffmpeg
  write(streamFile, streamText)
}

const download = (streamFile, outFile) => {
  const cmd = `ffmpeg -protocol_whitelist crypto,https,tls,http,tcp,file,data -allowed_extensions ALL -i ${streamFile} -c copy -y ${outFile}`
  const args = cmd.split(" ")
  const command = args.shift()
  const download = spawn(command, args, { stdio: "inherit" })
  // after downloading, remove the m3u8 file
  download.on("close", () => {
    remove(streamFile)
  })
}

const getVideoInfo = async videoId => {
  const url = `https://www.imooc.com/video/${videoId}`
  const html = await axios.get(url)
  try {
    const mongoId = html.data.match(/OP_CONFIG.mongo_id="(.*?)"/)[1]
    const title = html.data.match(/<em>(.*?)<\/em>/)[1].replace(/ /g, ".")
    return [mongoId, title]
  } catch (e) {
    console.log(`Current downloading: ${url}`)
    console.error(e)
  }
}

const downloadVideo = async videoId => {
  const [mongoId, title] = await getVideoInfo(videoId)
  // console.log("mongoId: ", mongoId)
  console.log("Downloading video: ", title)
  const url = `https://www.imooc.com/course/playlist/${videoId}?t=m3u8&_id=${mongoId}`
  const streamFile = `${title}.m3u8`
  const outFile = `${title}.mp4`
  await getStreamFile(url, streamFile)
  download(streamFile, outFile)
}

const getLessonInfo = html => {
  const $ = cheerio.load(html.data)
  const hrefs = $(".J-media-item")
    .map((_, data) => $(data).attr("href"))
    .get()
  const videoIds = hrefs
    .filter(s => s.startsWith("/video"))
    .map(s => s.split("/").pop())
  const lessonName = $("title").text().trim().replace(/ /g, ".").replace(/\//g, ".")
  // console.log("videoIds: ", videoIds)
  console.log("number: ", videoIds.length)
  console.log("lessonName: ", lessonName)
  return [lessonName, videoIds]
}

const main = async () => {
  const lessonId = process.argv[2]
  const lessonUrl = `http://www.imooc.com/learn/${lessonId}`
  const html = await axios.get(lessonUrl)
  const [lessonName, videoIds] = getLessonInfo(html)
  if (!fs.existsSync(lessonName)) {
    fs.mkdirSync(lessonName)
  }
  process.chdir(lessonName)
  for (const id of videoIds) {
    await downloadVideo(id)
  }
}

// usage: node test.js lessonId
main()
