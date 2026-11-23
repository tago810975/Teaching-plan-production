/**
 * 题型整理示例：把 reference/samples/物理题型整理_放缩圆 的 LaTeX 样张（mag-scalecircle-01.tex）
 * 用本软件的块重新搭出来。测试用它检查排版与导出；设置环境变量 TYPE_SUMMARY_OUT 时，
 * test/type-summary.test.ts 还会把它存成 .tplan 并导出教师版、学生版 Word，供人工查看。
 *
 * 文字写法（只在这个文件里用）：$…$ 公式，**…** 加粗（可包住公式），[1] 上标圈号①。
 */
import { readFileSync } from 'node:fs'
import { createEmptyBundle, createQuestion, newId } from '@core/model/factory'
import { circled, createNoteBox, createThinkWriteTable } from '@core/model/type-summary'
import type { Asset, Block, Inline, ProjectBundle, QuestionFigure, RichParagraph, RichText } from '@core/model/types'
import { createAsset } from '@core/project-file/codec'
import { getPreset } from '@core/presets'
import { A4_PAGE, contentWidthTwip } from '@core/document/units'

export const SAMPLE_DIR = 'reference/samples/物理题型整理_放缩圆'

/** 一段文字：$…$ 公式，**…** 加粗，[n] 上标圈号 */
export function rich(s: string, format?: RichParagraph['format']): RichParagraph {
  const inlines: Inline[] = []
  const push = (text: string, bold: boolean): void => {
    const re = /\$([^$]+)\$|\[(\d+)\]/g
    let last = 0
    for (const m of text.matchAll(re)) {
      if (m.index > last) inlines.push({ type: 'text', text: text.slice(last, m.index), ...(bold ? { marks: { bold: true } } : {}) })
      if (m[1] !== undefined) inlines.push({ type: 'math', latex: m[1], ...(bold ? { bold: true } : {}) })
      else inlines.push({ type: 'text', text: circled(Number(m[2])), marks: { script: 'sup' } })
      last = m.index + m[0].length
    }
    if (last < text.length) inlines.push({ type: 'text', text: text.slice(last), ...(bold ? { marks: { bold: true } } : {}) })
  }
  s.split(/\*\*/).forEach((part, i) => part !== '' && push(part, i % 2 === 1))
  return { inlines, ...(format !== undefined ? { format } : {}) }
}

const lines = (...ss: string[]): RichText => ss.map((s) => rich(s))
const items = (...ss: string[]): RichText => ss.map((s, i) => rich(`${circled(i + 1)} ${s}`))

/** PNG 的像素尺寸（IHDR） */
function pngSize(data: Uint8Array): { w: number; h: number } {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return { w: v.getUint32(16), h: v.getUint32(20) }
}

/** 图片：宽度为版心的 ratio 倍 */
async function figure(path: string, ratio: number, assets: Record<string, Asset>): Promise<QuestionFigure> {
  const data = new Uint8Array(readFileSync(path))
  const asset = await createAsset(data, 'image/png')
  assets[asset.id] = asset
  const { w, h } = pngSize(data)
  const widthEmu = Math.round(contentWidthTwip(A4_PAGE) * 635 * ratio)
  return { assetId: asset.id, widthEmu, heightEmu: Math.round((widthEmu * h) / w), placement: 'below' }
}

async function headerImage(file: string, widthEmu: number, heightEmu: number, assets: Record<string, Asset>) {
  const asset = await createAsset(new Uint8Array(readFileSync(`resources/templates/physics-default/header/${file}`)), 'image/png')
  assets[asset.id] = asset
  return { assetId: asset.id, widthEmu, heightEmu }
}

export async function createTypeSummarySample(): Promise<ProjectBundle> {
  const preset = getPreset('physics-typesummary-v1')
  const bundle = createEmptyBundle(new Date('2026-11-10T00:00:00Z'))
  const { project, assets } = bundle
  project.presetId = preset.id
  project.meta.title = '放缩圆母题01'
  project.header = {
    left: preset.header.left ?? '',
    phoneIcon: await headerImage('phone-icon.png', 111125, 111125, assets),
    phone: '000-0000-0000',
    right: '选修二　磁场 磁场力　带电粒子圆周运动'
  }
  const [example, review, solve, summary] = preset.sectionNames

  const square = await figure(`${SAMPLE_DIR}/tex/assets/figure-square.png`, 0.5, assets)
  const scale = await figure(`${SAMPLE_DIR}/tex/assets/figure-scale.png`, 0.42, assets)
  const opt = (label: string, s: string) => ({ label, content: rich(s) })

  const blocks: Block[] = [
    { id: newId(), type: 'title', text: '放缩圆法：速度方向一定，大小不同' },
    { id: newId(), type: 'section', text: example! },
    {
      id: newId(),
      type: 'question',
      question: createQuestion({
        kind: 'multi-choice',
        stem: [
          rich(
            '（多选）如图，垂直于纸面向里的匀强磁场分布在正方形 $abcd$ 区域内，$O$ 点是 $cd$ 边的中点[1]。一个带正电的粒子**仅**在磁场力的作用下，从 $O$ 点沿纸面以垂直于 $cd$ 边的速度射入正方形内[2]，经过时间 $t_0$ 刚好从 $c$ 点射出磁场[3]。现设法使该带电粒子从 $O$ 点沿纸面以与 $Od$ 成 $30°$ 角的方向、以大小不同的速率射入正方形内[4]，粒子重力不计。下列说法中正确的是（　　）'
          )
        ],
        figures: [square],
        options: [
          opt('A', '若该带电粒子从 $ab$ 边射出，它经历的时间可能为 $t_0$'),
          opt('B', '若该带电粒子从 $bc$ 边射出，它经历的时间可能为 $5t_0/4$'),
          opt('C', '若该带电粒子从 $cd$ 边射出，它经历的时间为 $5t_0/3$'),
          opt('D', '若该带电粒子从 $ad$ 边射出，它经历的时间可能为 $2t_0/3$')
        ],
        layout: { optionColumns: 1 }
      })
    },
    { id: newId(), type: 'section', text: review!, pageBreakBefore: true },
    createNoteBox(
      items(
        '正方形四条边、$O$ 在 $cd$ 中点：$O$ 到 $c$、$O$ 到 $d$ 都是半条边，题里所有几何量都从这条半边长出来。',
        '“仅在磁场力作用下”：重力不计，只受洛伦兹力，做匀速圆周运动；洛伦兹力总垂直于速度，**圆心在过 $O$ 且垂直于初速度方向的直线上**。',
        '“经过 $t_0$ 刚好从 $c$ 射出”：弦 $Oc$ 与直径的关系给出半径，$t_0$ 与周期的比例给出 $T$，周期由此变成已知量。',
        '“同一点、同一方向、大小不同”：这是**放缩圆**——圆心共线，轨迹圆随速率放大或缩小；$T$ 不随速率变，剩下的就只是圆心角的比较。'
      )
    ),
    {
      id: newId(),
      type: 'paragraph',
      content: [
        rich('审题总结：本题将包含', { firstLineChars: 2 }),
        rich('（1）**「认题型」**：入射点固定、初速度方向固定、只改变速率，圆心落在同一条直线上，圆以入射点为中心放大或缩小。'),
        rich('（2）**「定不变量」**：同一粒子、同一磁场，$T=2\\pi m/qB$ 与速率无关；又 $t=\\theta T/360°$，**比时间就是比圆心角**（圆心角等于速度偏向角）。'),
        rich('（3）**「用原情景定 $T$」**：垂直 $cd$ 射入、从 $c$ 射出，弦与直径重合，由此得 $r$ 与 $T$。'),
        rich('（4）**「按边求临界」**：逐条边列出“从该边射出”的圆心角区间，端点由**相切**或**过顶点**给出，再把选项的时间换成角度对区间。')
      ]
    },
    { id: newId(), type: 'section', text: solve! },
    createThinkWriteTable([
      {
        think: items(
          '垂直 $cd$ 射入、从 $c$ 射出这条轨迹，弦 $Oc$ 与直径是什么关系？半径怎么求？',
          '速率变了，半径跟着变，圆心受什么约束？圆心落在哪条直线上？',
          '速度与 $Od$ 成 $30°$，垂直于速度的方向与 $Od$ 成多少度？',
          '粒子带正电、磁场向里，轨迹往哪边偏？圆心在速度的哪一侧？',
          '周期已定，时间与圆心角怎么换算？判时间是否就等价于判圆心角？'
        ),
        write: lines(
          '**设边长 $L$，用原情景定 $T$**',
          '垂直 $cd$ 射入、从 $c$ 射出：轨迹为半圆，弦 $Oc=L/2$ 即直径，$2r=L/2$，$r=L/4$；又 $t_0=T/2$，得 **$T=2t_0$**。',
          '**圆心线（放缩圆）**：$r=mv/qB$ 随 $v$ 变，圆心都在过 $O$、垂直初速度方向的直线上。',
          '**时间换角度**：$t=\\theta T/360°=(\\theta/180°)t_0$；与 $Od$ 成 $30°$ 射入 $\\Rightarrow$ 速度与 $cd$ 边成 $60°$、圆心线与 $Od$ 成 $120°$。'
        ),
        lines: 8
      }
    ]),
    createThinkWriteTable([
      {
        think: items(
          '从 $cd$ 边射出：轨迹要在正方形内走完再回到 $cd$ 边，半径再大一点会先撞上哪条边？',
          '从 $bc$ 边射出：哪条轨迹恰好擦过 $bc$ 边？此时圆心角取到极大还是极小？',
          '从 $ab$ 边射出：偏向角最多能转到多少度？极限位置在哪个顶点？',
          '从 $ad$ 边射出：与 $ad$ 相切的轨迹，半径和边长满足什么关系？'
        ),
        write: lines(
          '**四条边对应的圆心角（度）**',
          '$cd$：$\\theta=300°$ 为**定值**，条件是 $r\\le L/3$（轨迹不能先碰到 $bc$）。',
          '$bc$：$176°<\\theta\\le240°$；$\\theta=240°$ 时轨迹**与 $bc$ 边相切**（$r=L/3$）。',
          '$ab$：$72°<\\theta\\le150°$；最大偏向角 $60°+90°=150°=5\\pi/6$。',
          '$ad$：$0<\\theta\\le60°$；$\\theta=60°$ 时轨迹**与 $ad$ 边相切**（$r=L$）。',
          '规律：$r$ 由小到大，射出边依次为 $cd\\rightarrow bc\\rightarrow ab\\rightarrow ad$。'
        ),
        lines: 8
      },
      {
        think: items(
          'A：$t_0$ 对应多少度？$ab$ 边射出的最大圆心角是多少度？两者谁大？',
          'B：$5t_0/4$ 对应多少度？落在 $bc$ 的区间内吗？',
          'C：$cd$ 射出时圆心角随速率变不变？“一定为”要求什么？',
          'D：$2t_0/3$ 对应多少度？$ad$ 边的圆心角上限是多少？'
        ),
        write: lines(
          'A：$t_0=T/2\\Rightarrow\\theta=180°$，而 $ab$ 边 $\\theta\\le150°<180°$，**A 错**。',
          'B：$5t_0/4=5T/8\\Rightarrow\\theta=225°$，落在 $bc$ 的区间内，**B 对**。',
          'C：从 $cd$ 射出时 $\\theta$ 恒为 $300°$，故 $t=5T/6=5t_0/3$，与速率无关，**C 对**。',
          'D：$2t_0/3=T/3\\Rightarrow\\theta=120°$，而 $ad$ 边 $\\theta\\le60°$，**D 错**。',
          '故选 **BC**。'
        ),
        lines: 8
      }
    ], false),
    {
      id: newId(),
      type: 'paragraph',
      content: [
        rich('**易错提醒**：'),
        rich('①“与 $Od$ 成 $30°$”说的是速度方向。圆心线与 $Od$ 差 $90°$，不能把 $30°$ 当成圆心线的角度。'),
        rich('②“时间为”要求圆心角是定值，“可能为”只要求落在区间内。'),
        rich('③用 $t=s/v$ 算不出结果：弧长 $s=r\\theta$ 与速率成正比，比值不变，时间只由圆心角决定。'),
        rich('④区间的端点容易漏：与边相切的 $bc$、$ad$，偏向角取极值的 $ab$；少算一处，“可能”会被误判成“不可能”。')
      ]
    },
    { id: newId(), type: 'section', text: summary!, pageBreakBefore: true },
    {
      id: newId(),
      type: 'knowledge',
      title: '',
      content: [
        rich('**放缩圆三步法**：', { firstLineChars: 2 }),
        rich('第一步 **认题型**：同一入射点、同一初速度方向、速率不同，圆心共线，按“放大缩小”作图找临界。', { firstLineChars: 2 }),
        rich('第二步 **定不变量**：$T=2\\pi m/qB$ 与速率无关，$t=\\theta T/360°$，比时间就是比速度偏向角。', { firstLineChars: 2 }),
        rich('第三步 **逐边求临界**：每条边找两条临界轨迹（与边相切、过顶点或偏向角取极值），列出该边的 $\\theta$ 区间。', { firstLineChars: 2 }),
        rich('**圆心为什么共线**：洛伦兹力垂直于速度，圆心必在过入射点、垂直初速度方向的直线上；$r=mv/qB$ 随 $v$ 增大，圆心沿这条直线外移。这条直线就是图中的 $PP\'$。', { firstLineChars: 2 })
      ],
      figures: [{ ...scale, anchorParagraph: 4 }],
      layout: { studentSpaceLines: 0, teacherSpaceLines: 0, keepTogether: 'never', pageBreakBefore: false }
    },
    {
      id: newId(),
      type: 'paragraph',
      content: [
        rich('**拓展思考**：把入射方向改成“与 $Od$ 成 $60°$”，原情景给出的 $T=2t_0$ 还成立吗？C 项“从 $cd$ 边射出用时 $5t_0/3$”还成立吗？', { firstLineChars: 2 }),
        rich('（提示：$T$ 只由 $q$、$B$、$m$ 决定，与初速度方向无关；但四条边的圆心角区间全部要重算。）', { firstLineChars: 2 })
      ]
    }
  ]
  project.blocks = blocks
  return bundle
}
