import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// 三个进程共用的路径别名。core 与 shared 是纯 TypeScript，不依赖 Electron 或 DOM。
const alias = {
  '@core': resolve(import.meta.dirname, 'src/core'),
  '@shared': resolve(import.meta.dirname, 'src/shared')
}

export default defineConfig({
  main: {
    resolve: { alias }
  },
  preload: {
    resolve: { alias },
    // index：主窗口；moan：墨案采集窗口（在页面里记录接口请求）
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/preload/index.ts'),
          moan: resolve(import.meta.dirname, 'src/preload/moan.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: { ...alias, '@renderer': resolve(import.meta.dirname, 'src/renderer/src') }
    },
    plugins: [react()]
  }
})
