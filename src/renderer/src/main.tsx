import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// temml 的配套样式：Chromium 不支持 <menclose> 等 MathML 3 特性，由这份样式补画
// 上划线（线段）、下划线、删除线、方框，并修正矢量箭头的位置
import 'temml/dist/Temml-Local.css'
import './styles/app.css'
import './styles/page.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
