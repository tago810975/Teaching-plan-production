/**
 * 下载页面配置文件
 *
 * 【后续如何补充网盘链接或更新版本？】
 * 1. 发布新版本后，将下方 `version` 改为新版本号（例如 '0.4.0'）。
 * 2. 找到对应平台的网盘渠道，把链接填入 `url`（例如 'https://pan.quark.cn/s/xxxxxx'）；
 *    若网盘需要提取码，填入 `code`（例如 'abcd'），无需提取码则留空 ''。
 * 3. `url` 为空字符串 '' 时，页面会自动显示为“即将补充”占位；填入有效链接后即自动变为可点击按钮。
 */

export interface DownloadChannel {
  /** 渠道名称 */
  name: string
  /** 下载页或分享链接；留空 '' 时显示占位状态 */
  url: string
  /** 提取码（可选，没有可留空 ''） */
  code?: string
  /** 角标（如 '推荐'） */
  badge?: string
  /** 渠道补充说明 */
  note?: string
}

export interface PlatformDownloads {
  id: 'windows' | 'macos'
  name: string
  subtitle: string
  fileHint: string
  channels: DownloadChannel[]
}

export interface DownloadConfig {
  version: string
  releaseRepo: string
  latestReleaseUrl: string
  allReleasesUrl: string
  platforms: PlatformDownloads[]
}

const LATEST_RELEASE_URL = 'https://github.com/tago810975/Teaching-plan-production/releases/latest'

const SHARED_CHANNELS: DownloadChannel[] = [
  {
    name: '小飞机网盘',
    url: 'https://share.feijipan.com/s/Zsz8oKHa',
    code: 'modi',
    badge: '推荐',
    note: '国内直连高速下载，免登录更方便'
  },
  {
    name: '夸克网盘',
    url: 'https://pan.quark.cn/s/28ffc6f3020b',
    code: 'modi',
    note: '国内网盘分流'
  },
  {
    name: '123 网盘',
    url: 'https://1813707651.share.123pan.cn/123pan/11QlVv-A7O8A',
    code: 'modi',
    note: '国内网盘分流'
  },
  {
    name: '阿里云盘',
    url: 'https://www.alipan.com/s/9hxc9EHNj1b',
    code: 'modi',
    note: '国内网盘分流'
  },
  {
    name: '百度网盘',
    url: 'https://pan.baidu.com/s/109suKgdXmnw__XcHKyUknA',
    code: 'modi',
    note: '国内网盘备用'
  },
  {
    name: 'GitHub Release（官方直链）',
    url: LATEST_RELEASE_URL,
    note: '获取最新正式版安装包'
  }
]

export const DOWNLOAD_CONFIG: DownloadConfig = {
  version: '0.4.0',
  releaseRepo: 'https://github.com/tago810975/Teaching-plan-production',
  latestReleaseUrl: LATEST_RELEASE_URL,
  allReleasesUrl: 'https://github.com/tago810975/Teaching-plan-production/releases',
  platforms: [
    {
      id: 'windows',
      name: 'Windows 版',
      subtitle: 'Windows 10 / 11（64 位安装程序）',
      fileHint: 'TeachingPlan-0.4.0-Windows-setup.exe',
      channels: SHARED_CHANNELS
    },
    {
      id: 'macos',
      name: 'macOS 版',
      subtitle: 'Apple Silicon（arm64）/ Intel（x64）',
      fileHint: 'TeachingPlan-0.4.0-Mac-arm64.dmg / x64.dmg',
      channels: SHARED_CHANNELS
    }
  ]
}
