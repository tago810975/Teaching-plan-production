import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// temml 的配套样式：Chromium 不支持 <menclose> 等 MathML 3 特性，由这份样式补画
// 上划线（线段）、下划线、删除线、方框，并修正矢量箭头的位置
import 'temml/dist/Temml-Local.css'
import './styles/app.css'
import './styles/page.css'

import { setUserPresets } from '@core/presets'
import { initTheme } from './theme/theme'

initTheme()

// 先登记用户模板的预设（主进程启动时已读取“教学案库\模板”），再显示界面：
// 打开用自制模板做的教学案时才找得到它的预设
void window.api
  .listTemplates()
  .then((catalog) => setUserPresets(catalog.presets))
  .catch((err: unknown) => console.error('读取用户模板失败', err))
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  })
