/**
 * Word 旧式 EQ 域公式 → LaTeX。
 *
 * EQ 域是 Word 早期的公式写法，域代码如：
 *   eq \f(mv,qB)        分数
 *   eq \r(3) / \r(3,x)  平方根 / 根指数为 3
 *   eq \s\up6(2)        上标；\s\do6(1) 下标
 *   eq \o\al(2,1)       叠放（常用来写同位素记号左侧的质量数与电荷数，如 ²₁H）
 *   eq \b\lc\{(...)     括号
 *   eq \a\al\co2(a,b,c,d) 数组
 * 无法识别时返回 null，调用方保留域代码中的文字。
 */
import { escapeLatexText } from './latex-text'

export function isEqField(instr: string): boolean {
  return /^\s*eq\b/i.test(instr)
}

export function eqFieldToLatex(instr: string): string | null {
  const body = instr.replace(/^\s*eq\b/i, '')
  try {
    const p = new Parser(body)
    const latex = p.sequence(new Set()).trim()
    return latex === '' ? null : latex
  } catch {
    return null
  }
}

class Parser {
  pos = 0
  constructor(private s: string) {}

  private peek(): string {
    return this.s[this.pos] ?? ''
  }

  /** 读取一串内容，直到遇到 stops 中的字符（不消耗） */
  sequence(stops: ReadonlySet<string>): string {
    let out = ''
    while (this.pos < this.s.length) {
      const c = this.peek()
      if (stops.has(c)) break
      if (c === '\\') {
        out += this.command()
      } else {
        this.pos += 1
        out += plainChar(c)
      }
    }
    return out
  }

  /** 读取一个开关及其参数，如 \f(a,b) */
  private command(): string {
    this.pos += 1 // 跳过反斜杠
    const name = this.word().toLowerCase()
    switch (name) {
      case 'f': {
        const [num = '', den = ''] = this.args()
        return `\\frac{${num}}{${den}}`
      }
      case 'r': {
        const args = this.args()
        if (args.length >= 2 && args[0] !== '') return `\\sqrt[${args[0]}]{${args[1]}}`
        return `\\sqrt{${args[args.length - 1] ?? ''}}`
      }
      case 's': {
        // \s\up6(x) 上标，\s\do6(x) 下标；可以连写多个
        let out = ''
        while (this.peek() === '\\') {
          const save = this.pos
          this.pos += 1
          const opt = this.word().toLowerCase()
          this.number()
          if (opt === 'up' || opt === 'do' || opt === 'ai' || opt === 'di') {
            if (this.peek() === '(') {
              const [x = ''] = this.args()
              out += opt === 'up' ? `^{${x}}` : opt === 'do' ? `_{${x}}` : ''
            }
          } else {
            this.pos = save
            break
          }
        }
        if (this.peek() === '(') {
          const [x = ''] = this.args()
          return `{}^{${x}}${out}`
        }
        return out === '' ? '' : `{}${out}`
      }
      case 'o': {
        this.options()
        const args = this.args()
        // 两个短小的数字/字母叠放：同位素记号的质量数（上）与电荷数（下）
        if (args.length === 2 && args.every((a) => /^-?[0-9A-Za-z+\-]{1,4}$/.test(a))) {
          return `{}^{${args[0]}}_{${args[1]}}`
        }
        return args.join('')
      }
      case 'b': {
        let left = '('
        let right = ')'
        while (this.peek() === '\\') {
          const save = this.pos
          this.pos += 1
          const opt = this.word().toLowerCase()
          if (opt === 'lc' || opt === 'rc' || opt === 'bc') {
            const ch = this.s[this.pos] === '\\' ? this.s[++this.pos] ?? '' : (this.s[this.pos] ?? '')
            this.pos += 1
            if (opt !== 'rc') left = ch
            if (opt !== 'lc') right = closing(ch)
            if (opt === 'lc') right = '.'
            if (opt === 'rc') left = '.'
          } else {
            this.pos = save
            break
          }
        }
        const inner = this.args().join(',')
        return `\\left${fence(left)}${inner}\\right${fence(right)}`
      }
      case 'a': {
        let cols = 1
        while (this.peek() === '\\') {
          const save = this.pos
          this.pos += 1
          const opt = this.word().toLowerCase()
          const n = this.number()
          if (opt === 'co' && n !== null) cols = n
          else if (!['al', 'ac', 'ar', 'vs', 'hs'].includes(opt)) {
            this.pos = save
            break
          }
        }
        const items = this.args()
        const rows: string[] = []
        for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols).join('&'))
        return `\\begin{array}{${'l'.repeat(cols)}}${rows.join('\\\\')}\\end{array}`
      }
      case 'i': {
        this.options()
        const [lower = '', upper = '', body = ''] = this.args()
        return `\\int_{${lower}}^{${upper}}${body}`
      }
      case 'x': {
        this.options()
        return `\\boxed{${this.args().join('')}}`
      }
      case 'd':
        this.options()
        if (this.peek() === '(') this.args()
        return '\\,'
      default:
        // 转义字符，如 \( \, \\
        if (name === '' && this.pos < this.s.length) {
          const ch = this.s[this.pos]!
          this.pos += 1
          return plainChar(ch)
        }
        throw new Error(`不支持的 EQ 开关：${name}`)
    }
  }

  private word(): string {
    const m = /^[A-Za-z]+/.exec(this.s.slice(this.pos))
    if (m === null) return ''
    this.pos += m[0].length
    return m[0]
  }

  private number(): number | null {
    const m = /^\d+/.exec(this.s.slice(this.pos))
    if (m === null) return null
    this.pos += m[0].length
    return Number(m[0])
  }

  /** 跳过形如 \al \ac \ar 的对齐等选项 */
  private options(): void {
    while (this.peek() === '\\') {
      const save = this.pos
      this.pos += 1
      const opt = this.word().toLowerCase()
      this.number()
      if (!['al', 'ac', 'ar', 'le', 'ri', 'to', 'bo', 'lo', 'up', 'fo', 'ba', 'li', 'vc', 'lc', 'rc', 'bc'].includes(opt)) {
        this.pos = save
        return
      }
    }
  }

  /** 读取括号中的参数，以逗号（或分号）分隔，支持嵌套 */
  private args(): string[] {
    while (this.peek() === ' ') this.pos += 1
    if (this.peek() !== '(') return []
    this.pos += 1
    const out: string[] = []
    for (;;) {
      out.push(this.sequence(new Set([',', ';', ')'])).trim())
      const c = this.peek()
      if (c === ')') {
        this.pos += 1
        return out
      }
      if (c === '') throw new Error('EQ 域括号不配对')
      this.pos += 1
    }
  }
}

function plainChar(c: string): string {
  if (/\s/.test(c)) return ''
  return escapeLatexText(c)
}

function closing(c: string): string {
  return { '(': ')', '[': ']', '{': '}', '<': '>' }[c] ?? c
}

function fence(c: string): string {
  if (c === '.' || c === '') return '.'
  return { '{': '\\{', '}': '\\}', '<': '\\langle ', '>': '\\rangle ' }[c] ?? c
}
