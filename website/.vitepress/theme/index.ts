import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import DownloadCenter from './components/DownloadCenter.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('DownloadCenter', DownloadCenter)
  }
} satisfies Theme
