import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import DownloadCenter from './components/DownloadCenter.vue'
import TutorialVideo from './components/TutorialVideo.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('DownloadCenter', DownloadCenter)
    app.component('TutorialVideo', TutorialVideo)
  }
} satisfies Theme
