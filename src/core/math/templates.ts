/**
 * 公式编辑器的模板库，分类参照 WPS 公式编辑器。
 *
 * 模板写法沿用 MathLive：#? 为待填写的占位符，#@ 表示插入时选中的内容（没有选中时同占位符）。
 * 显示在按钮上时，占位符以 □ 表示（见 templatePreview）。
 */

export interface FormulaTemplate {
  latex: string
  /** 鼠标悬停时的说明 */
  title: string
}

export interface TemplateGroup {
  id: string
  /** 工具栏上的类别名 */
  label: string
  /** 工具栏按钮上显示的图标公式 */
  icon: string
  /** 面板中每行显示几个模板 */
  columns: number
  templates: FormulaTemplate[]
}

const t = (latex: string, title: string): FormulaTemplate => ({ latex, title })

export const TEMPLATE_GROUPS: readonly TemplateGroup[] = [
  {
    id: 'common',
    label: '常用公式',
    icon: '\\sqrt{x}',
    columns: 2,
    templates: [
      t('F=ma', '牛顿第二定律'),
      t('v=v_0+at', '匀变速速度公式'),
      t('x=v_0t+\\frac{1}{2}at^2', '匀变速位移公式'),
      t('v^2-v_0^2=2ax', '速度位移关系'),
      t('E_k=\\frac{1}{2}mv^2', '动能'),
      t('W=Fl\\cos\\alpha', '功'),
      t('F=G\\frac{Mm}{r^2}', '万有引力'),
      t('F=k\\frac{q_1q_2}{r^2}', '库仑定律'),
      t('E=\\frac{F}{q}', '电场强度'),
      t('I=\\frac{U}{R}', '欧姆定律'),
      t('F=qvB', '洛伦兹力'),
      t('qvB=m\\frac{v^2}{r}', '洛伦兹力提供向心力'),
      t('r=\\frac{mv}{qB}', '轨迹半径'),
      t('T=\\frac{2\\pi m}{qB}', '周期'),
      t('t=\\frac{\\theta}{2\\pi}T', '运动时间'),
      t('E=BLv', '动生电动势')
    ]
  },
  {
    id: 'fraction',
    label: '分数',
    icon: '\\frac{x}{y}',
    columns: 4,
    templates: [
      t('\\frac{#@}{#?}', '分数'),
      t('{#@}/{#?}', '斜分数'),
      t('\\frac{1}{#?}', '分子为 1'),
      t('\\frac{1}{2}', '二分之一'),
      t('\\frac{\\Delta #?}{\\Delta #?}', '变化率'),
      t('\\frac{\\mathrm{d}#?}{\\mathrm{d}#?}', '导数')
    ]
  },
  {
    id: 'script',
    label: '上下标',
    icon: 'e^{x}',
    columns: 4,
    templates: [
      t('#@^{#?}', '上标'),
      t('#@_{#?}', '下标'),
      t('#@_{#?}^{#?}', '上下标'),
      t('{}_{#?}^{#?}#@', '左上下标'),
      t('x^2', 'x 的平方'),
      t('v_0', 'v₀'),
      t('e^{-#?}', 'e 的负幂'),
      t('#@^{\\prime}', '撇号')
    ]
  },
  {
    id: 'radical',
    label: '根式',
    icon: '\\sqrt[n]{x}',
    columns: 4,
    templates: [
      t('\\sqrt{#@}', '平方根'),
      t('\\sqrt[#?]{#@}', 'n 次根'),
      t('\\sqrt[3]{#@}', '立方根'),
      t('\\sqrt{#?^2+#?^2}', '勾股')
    ]
  },
  {
    id: 'integral',
    label: '积分',
    icon: '\\int x',
    columns: 4,
    templates: [
      t('\\int #?', '积分'),
      t('\\int_{#?}^{#?}#?', '定积分'),
      t('\\iint #?', '二重积分'),
      t('\\oint #?', '环路积分'),
      t('\\int_{#?}^{#?}#?\\,\\mathrm{d}#?', '定积分（含 d）')
    ]
  },
  {
    id: 'large',
    label: '大型运算符',
    icon: '\\sum',
    columns: 4,
    templates: [
      t('\\sum #?', '求和'),
      t('\\sum_{#?}^{#?}#?', '带上下限求和'),
      t('\\sum_{i=1}^{n}#?', 'i 从 1 到 n'),
      t('\\prod_{#?}^{#?}#?', '连乘')
    ]
  },
  {
    id: 'bracket',
    label: '括号',
    icon: '\\{()\\}',
    columns: 4,
    templates: [
      t('\\left(#@\\right)', '圆括号'),
      t('\\left[#@\\right]', '方括号'),
      t('\\left\\{#@\\right\\}', '花括号'),
      t('\\left|#@\\right|', '绝对值'),
      t('\\left\\|#@\\right\\|', '范数'),
      t('\\left\\langle #@\\right\\rangle', '尖括号'),
      t('\\begin{cases}#?\\\\#?\\end{cases}', '方程组（两行）'),
      t('\\begin{cases}#?\\\\#?\\\\#?\\end{cases}', '方程组（三行）')
    ]
  },
  {
    id: 'function',
    label: '函数',
    icon: '\\sin\\theta',
    columns: 4,
    templates: [
      t('\\sin #?', '正弦'),
      t('\\cos #?', '余弦'),
      t('\\tan #?', '正切'),
      t('\\cot #?', '余切'),
      t('\\arcsin #?', '反正弦'),
      t('\\arccos #?', '反余弦'),
      t('\\arctan #?', '反正切'),
      t('\\sin^2 #?', '正弦平方')
    ]
  },
  {
    id: 'accent',
    label: '导数符号',
    icon: '\\ddot{a}',
    columns: 4,
    templates: [
      t('\\vec{#@}', '矢量'),
      t('\\overrightarrow{#@}', '长矢量'),
      t('\\overline{#@}', '上划线（线段）'),
      t('\\underline{#@}', '下划线'),
      t('\\hat{#@}', '尖号'),
      t('\\dot{#@}', '一阶导'),
      t('\\ddot{#@}', '二阶导'),
      t('\\tilde{#@}', '波浪号'),
      t('#@^{\\prime}', '撇'),
      t('#@^{\\prime\\prime}', '双撇')
    ]
  },
  {
    id: 'limit',
    label: '极限和对数',
    icon: '\\lim',
    columns: 3,
    templates: [
      t('\\lim_{#?\\to #?}#?', '极限'),
      t('\\lim_{x\\to 0}#?', 'x 趋于 0'),
      t('\\lim_{n\\to\\infty}#?', 'n 趋于无穷'),
      t('\\log_{#?}#?', '对数'),
      t('\\lg #?', '常用对数'),
      t('\\ln #?', '自然对数'),
      t('\\max #?', '最大值'),
      t('\\min #?', '最小值')
    ]
  },
  {
    id: 'operator',
    label: '运算符',
    icon: '\\triangleq',
    columns: 8,
    templates: [
      t('+', '加'),
      t('-', '减'),
      t('\\times', '乘'),
      t('\\cdot', '点乘'),
      t('\\div', '除'),
      t('\\pm', '正负'),
      t('\\mp', '负正'),
      t('=', '等于'),
      t('\\ne', '不等于'),
      t('\\approx', '约等于'),
      t('\\equiv', '恒等于'),
      t('\\propto', '正比于'),
      t('<', '小于'),
      t('>', '大于'),
      t('\\le', '小于等于'),
      t('\\ge', '大于等于'),
      t('\\ll', '远小于'),
      t('\\gg', '远大于'),
      t('\\infty', '无穷'),
      t('^{\\circ}', '度'),
      t('\\angle', '角'),
      t('\\perp', '垂直'),
      t('\\parallel', '平行'),
      t('\\triangle', '三角形'),
      t('\\therefore', '所以'),
      t('\\because', '因为'),
      t('\\in', '属于'),
      t('\\Delta', '变化量')
    ]
  },
  {
    id: 'arrow',
    label: '箭头',
    icon: '\\rightarrow',
    columns: 6,
    templates: [
      t('\\rightarrow', '右箭头'),
      t('\\leftarrow', '左箭头'),
      t('\\uparrow', '上箭头'),
      t('\\downarrow', '下箭头'),
      t('\\leftrightarrow', '双向箭头'),
      t('\\Rightarrow', '推出'),
      t('\\Leftarrow', '被推出'),
      t('\\Leftrightarrow', '等价'),
      t('\\rightleftharpoons', '可逆'),
      t('\\xrightarrow{#?}', '带文字的箭头'),
      t('\\nearrow', '右上'),
      t('\\searrow', '右下')
    ]
  },
  {
    id: 'greek',
    label: '希腊字母',
    icon: '\\Omega',
    columns: 8,
    templates: [
      ...[
        'alpha', 'beta', 'gamma', 'delta', 'varepsilon', 'zeta', 'eta', 'theta',
        'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau',
        'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda',
        'Pi', 'Sigma', 'Phi', 'Psi', 'Omega'
      ].map((name) => t(`\\${name}`, name))
    ]
  },
  {
    id: 'matrix',
    label: '矩阵',
    icon: '\\left[\\begin{smallmatrix}1&0\\\\0&1\\end{smallmatrix}\\right]',
    columns: 4,
    templates: [
      t('\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}', '2×2 圆括号矩阵'),
      t('\\begin{bmatrix}#?&#?\\\\#?&#?\\end{bmatrix}', '2×2 方括号矩阵'),
      t('\\begin{vmatrix}#?&#?\\\\#?&#?\\end{vmatrix}', '2×2 行列式'),
      t('\\begin{pmatrix}#?&#?&#?\\\\#?&#?&#?\\\\#?&#?&#?\\end{pmatrix}', '3×3 矩阵'),
      t('\\begin{pmatrix}#?\\\\#?\\end{pmatrix}', '列向量'),
      t('\\begin{pmatrix}#?&#?\\end{pmatrix}', '行向量')
    ]
  }
]

/** 按钮上显示用的 LaTeX：占位符换成方框 */
export function templatePreview(latex: string): string {
  return latex.replace(/#[?@0-9]/g, '\\square ')
}

/** 填写占位符后的 LaTeX（测试用：检查模板填上内容后能否导出） */
export function templateFilled(latex: string, filler = 'x'): string {
  return latex.replace(/#[?@0-9]/g, filler)
}
