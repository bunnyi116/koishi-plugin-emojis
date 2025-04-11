import { Context, HTTP, Schema, segment } from 'koishi'
import { resolve, dirname } from 'path'
import * as fs from 'fs'
import * as utils from './utils'

export const name = 'emojis'

export interface Config {
  autoUpdate: boolean
  updateInterval: number
  metadataUrl: string
  timeout: number
}

export const Config: Schema<Config> = Schema.object({
  autoUpdate: Schema.boolean().default(true).description('自动更新元数据'),
  updateInterval: Schema.number()
    .default(86400)
    .min(3600)
    .description('更新间隔时间（秒）'),
  metadataUrl: Schema.string()
    .default('https://raw.githubusercontent.com/xsalazar/emoji-kitchen-backend/main/app/metadata.json')
    .description('元数据文件地址（支持镜像源）'),
  timeout: Schema.number()
    .default(30000)
    .min(1000)
    .description('请求超时时间（毫秒）'),
})

interface CacheMeta {
  etag?: string
  lastModified?: string
}

function getDataDir(ctx: Context) {
  return resolve(ctx.baseDir, `data/${name}`)
}

function getMetadataPath(ctx: Context) {
  return resolve(getDataDir(ctx), 'metadata.json')
}

function getMetadataCachePath(ctx: Context) {
  return resolve(getDataDir(ctx), 'metadata.cache.json')
}

const decoder: HTTP.Decoder<HTTP.Response> = async (rawResponse) => {
  return {
    url: rawResponse.url,
    data: await rawResponse.arrayBuffer(), // 根据实际内容解析数据（如 .text()）
    status: rawResponse.status,
    statusText: rawResponse.statusText,
    headers: rawResponse.headers,
  }
}

async function getMetadataFile(ctx: Context, config: Config): Promise<boolean> {
  const dataDir = getDataDir(ctx)
  const metadataPath = getMetadataPath(ctx)
  const cachePath = getMetadataCachePath(ctx)

  try {
    await fs.promises.mkdir(dataDir, { recursive: true })

    let cacheMeta: CacheMeta = {}
    try {
      const cacheData = await fs.promises.readFile(cachePath, 'utf-8')
      cacheMeta = JSON.parse(cacheData)
    } catch { }

    const headers: Record<string, string> = {}
    if (cacheMeta.etag) headers['If-None-Match'] = cacheMeta.etag
    if (cacheMeta.lastModified) headers['If-Modified-Since'] = cacheMeta.lastModified
    const response = await ctx.http.get(config.metadataUrl, {
      headers,
      timeout: config.timeout,
      responseType: decoder
    })

    if (response.status === 304) {
      ctx.logger.info('目标文件未发送变化，本次跳过更新')
      return false;
    }
    if (!response.data || response.data.byteLength === 0) {
      ctx.logger.info('服务器响应数据为空')
      return false;
    }
    ctx.logger.info('开始更新文件')
    await fs.promises.writeFile(metadataPath, Buffer.from(response.data))
    const newMeta: CacheMeta = {
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
    }
    await fs.promises.writeFile(cachePath, JSON.stringify(newMeta))
    ctx.logger.info('下载成功')
    return true

  } catch (error) {
    if (error.response) {
      ctx.logger.error(`HTTP错误 [${error.response.status}]: ${error.response.statusText}`)
      return false
    }
    if (error.code === 'ECONNABORTED') {
      ctx.logger.error('请求超时，请检查网络连接或调整超时时间')
      return false
    }
    ctx.logger.error('元数据下载失败:', error.message)
    return false
  }
}


async function loadMetadata(ctx: Context, config: Config) {
  const metadataPath = getMetadataPath(ctx);
  const cacheMetaPath = getMetadataCachePath(ctx);
  // 检查文件是否存在
  if (fs.existsSync(metadataPath)) {
    // 检查是否有更新
    if (fs.existsSync(cacheMetaPath)) {
      const updated = await getMetadataFile(ctx, config)
      if (updated) {
        ctx.logger.info('元数据文件已更新');
      } else {
        ctx.logger.info('元数据文件未更新');
      }
    }
  } else {
    ctx.logger.info('元数据文件不存在，尝试下载');
    const success = await getMetadataFile(ctx, config);
    if (!success) {
      throw new Error('元数据文件下载失败');
    }
    ctx.logger.info('元数据文件下载成功');
    loadMetadata(ctx, config);
  }
}

export async function apply(ctx: Context, config: Config) {
  await loadMetadata(ctx, config)
  if (config.autoUpdate) {
    ctx.setInterval(async () => {
      try {
        const updated = await getMetadataFile(ctx, config)
        if (updated) await loadMetadata(ctx, config)
      } catch (error) {
        ctx.logger.error('定时更新失败:', error.message)
      }
    }, config.updateInterval * 1000)
  }

  ctx.command('emoji.update', '手动更新Emoji元数据')
    .action(async () => {
      const updated = await getMetadataFile(ctx, config)
      if (updated) {
        await loadMetadata(ctx, config)
        return '元数据更新成功'
      }
      return '元数据未变更'
    })

  ctx.command('emoji <emojis:string>', '合成两个Emoji表情')
    .usage('输入两个emoji, 不需要空格分隔, 例如: emojikitchen 🍎🔥')
    .example('emoji 😂🐶')
    .action(async ({ }, emojis) => {
      if (!emojis) return '请输入两个emoji表情'
      const emojiArr = Array.from(emojis.trim())
      if (emojiArr.length !== 2) return '请输入恰好两个emoji表情'

      const [first, second] = emojiArr
      try {
        const cp1 = utils.getEmojiCodepoint(first)
        const cp2 = utils.getEmojiCodepoint(second)
        const data1 = utils.getEmojiData(cp1)
        const combinations = data1?.combinations?.[cp2]

        if (!combinations?.length) {
          return `找不到 ${first} 和 ${second} 的组合`
        }

        const combo = combinations.find(c => c.isLatest) || combinations[0]
        return segment.image(combo.gStaticUrl)
      } catch (error) {
        return `处理失败: ${error.message}`
      }
    })
}
