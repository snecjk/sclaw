const { mkdir, mkdtemp, readFile, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const sharp = require('sharp')

const THEMES = ['light', 'dark']
const FIXTURE_PATH = path.join(__dirname, 'theme-fixture.html')
const TOKENS_PATH = path.resolve(__dirname, '../../src/styles/theme/tokens.css')
const RECIPES_PATH = path.resolve(__dirname, '../../src/styles/theme/recipes.css')
const BASELINE_DIR = path.join(__dirname, 'baselines')
const UPDATE = process.argv.includes('--update')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.commandLine.appendSwitch('disable-lcd-text')
app.on('window-all-closed', () => undefined)

async function capture(theme, outputPath, productionCss) {
  const win = new BrowserWindow({
    width: 1440,
    height: 1000,
    useContentSize: true,
    resizable: false,
    show: false,
    backgroundColor: theme === 'dark' ? '#0D0D0D' : '#F7F8FA',
    webPreferences: { backgroundThrottling: false },
  })

  try {
    await win.loadFile(FIXTURE_PATH, { query: { theme } })
    const cssKey = await win.webContents.insertCSS(productionCss)
    await win.webContents.executeJavaScript(`
      document.fonts.ready.then(() => new Promise(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      }))
    `)
    const image = await win.webContents.capturePage()
    await sharp(image.toPNG()).resize(1440, 1000).png().toFile(outputPath)
    await win.webContents.removeInsertedCSS(cssKey)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

async function readRaw(filePath) {
  return sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
}

async function compare(theme, actualPath, baselinePath) {
  const [actual, baseline] = await Promise.all([
    readRaw(actualPath),
    readRaw(baselinePath),
  ])

  const actualSize = `${actual.info.width}x${actual.info.height}x${actual.info.channels}`
  const baselineSize = `${baseline.info.width}x${baseline.info.height}x${baseline.info.channels}`
  if (actualSize !== baselineSize) {
    throw new Error(`${theme}: dimensions differ (${actualSize} actual, ${baselineSize} baseline)`)
  }

  if (!actual.data.equals(baseline.data)) {
    let changedBytes = 0
    for (let index = 0; index < actual.data.length; index += 1) {
      if (actual.data[index] !== baseline.data[index]) changedBytes += 1
    }
    throw new Error(`${theme}: pixel mismatch (${changedBytes} channel values changed)`)
  }

  console.log(`${theme}: matched ${actual.info.width}x${actual.info.height}`)
}

async function run() {
  await mkdir(BASELINE_DIR, { recursive: true })
  const productionCss = (await Promise.all([
    readFile(TOKENS_PATH, 'utf8'),
    readFile(RECIPES_PATH, 'utf8'),
  ])).join('\n')

  if (UPDATE) {
    for (const theme of THEMES) {
      const baselinePath = path.join(BASELINE_DIR, `theme-${theme}.png`)
      await capture(theme, baselinePath, productionCss)
      const { info } = await readRaw(baselinePath)
      console.log(`${theme}: updated ${info.width}x${info.height}`)
    }
    return
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'sclaw-theme-'))
  try {
    for (const theme of THEMES) {
      const actualPath = path.join(tempDir, `theme-${theme}.png`)
      const baselinePath = path.join(BASELINE_DIR, `theme-${theme}.png`)
      await capture(theme, actualPath, productionCss)
      await compare(theme, actualPath, baselinePath)
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

app.whenReady()
  .then(run)
  .then(() => {
    app.quit()
  })
  .catch(error => {
    console.error(error instanceof Error ? error.stack : error)
    app.exit(1)
  })
