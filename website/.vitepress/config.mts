import { defineConfig } from 'vitepress'

const base = process.env.SITE_BASE || '/'

export default defineConfig({
  lang: 'zh-CN',
  title: '教学案制作',
  description: '导入题目、自动排版，一份工程同时导出教师版（教案）与学生版（学案）Word 文档',
  base,
  cleanUrls: false,
  lastUpdated: true,
  srcExclude: ['DEPLOY.md'],

  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }]],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: '首页', link: '/' },
      { text: '使用教程', link: '/guide/getting-started' },
      { text: '下载', link: '/download' },
      {
        text: '更新日志',
        link: 'https://github.com/tago810975/TeachingPlan-downloads/releases'
      }
    ],

    sidebar: {
      '/guide/': [
        {
          text: '开始使用',
          items: [{ text: '快速上手', link: '/guide/getting-started' }]
        },
        {
          text: '核心功能',
          items: [
            { text: '导入题目与知识点', link: '/guide/import' },
            { text: '编辑与排版', link: '/guide/editing' },
            { text: '插图与图像处理', link: '/guide/images' },
            { text: '格式预设与自制模板', link: '/guide/templates' }
          ]
        },
        {
          text: '其他',
          items: [
            { text: '常见问题与主题设置', link: '/guide/faq' },
            { text: '下载安装', link: '/download' }
          ]
        }
      ]
    },

    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索文档',
            buttonAriaLabel: '搜索文档'
          },
          modal: {
            noResultsText: '没有找到相关内容',
            resetButtonTitle: '清除搜索条件',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭'
            }
          }
        }
      }
    },

    outline: {
      label: '本页目录',
      level: [2, 3]
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇'
    },

    lastUpdated: {
      text: '最后更新于'
    },

    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',

    socialLinks: [
      {
        icon: 'github',
        link: 'https://github.com/tago810975/TeachingPlan-downloads/releases',
        ariaLabel: 'GitHub Releases'
      }
    ],

    footer: {
      message: '基于 MIT 协议开源 · 支持 Windows 与 macOS',
      copyright: '教学案制作（TeachingPlan）'
    }
  }
})
