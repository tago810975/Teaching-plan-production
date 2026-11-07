/**
 * 演示工程：内容取自参考样例《动态圆专题》，用于开发时的预览与测试。
 * 导入功能完成后，可改为直接导入样例文档。
 */
import { createEmptyProject, createQuestion, newId, para } from '../model/factory'
import type { MathInline, ProjectBundle } from '../model/types'
import { createAsset } from '../project-file/codec'
import { cmToEmu } from '../document/units'
import { withTemplateDefaults, type TemplateDefaults } from '../template/defaults'

const m = (latex: string): MathInline => ({ type: 'math', latex })

/** 例题 1 的配图：正方形磁场区域 abcd，O 为 cd 中点 */
const FIGURE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 190" font-family="Times New Roman" font-style="italic" font-size="15">
<rect x="30" y="20" width="150" height="150" fill="none" stroke="#000" stroke-width="1.5"/>
${[0, 1, 2, 3]
  .flatMap((r) =>
    [0, 1, 2, 3].map(
      (c) =>
        `<text x="${52 + c * 36}" y="${50 + r * 36}" font-style="normal" font-size="16">×</text>`
    )
  )
  .join('')}
<text x="18" y="18">c</text><text x="184" y="18">b</text>
<text x="18" y="184">d</text><text x="184" y="184">a</text>
<text x="10" y="100">O</text><circle cx="30" cy="95" r="2.5"/>
<line x1="30" y1="95" x2="68" y2="95" stroke="#2a7fd4" stroke-width="2"/>
<polygon points="68,90 78,95 68,100" fill="#2a7fd4"/>
</svg>`

/** defaults 为模板默认页眉；不传则页眉为空（测试中使用） */
export async function createDemoBundle(defaults?: TemplateDefaults, now?: Date): Promise<ProjectBundle> {
  const project = createEmptyProject(now)
  project.meta.title = '动态圆专题'

  const figure = await createAsset(new TextEncoder().encode(FIGURE_SVG), 'image/svg+xml')

  project.blocks = [
    { id: newId(), type: 'title', text: '动态圆专题' },
    {
      id: newId(),
      type: 'paragraph',
      content: [
        para(
          '本节课的内容主要有动态圆问题的三类基本模型——放缩圆、旋转圆与平移圆，以及圆形边界磁场的动态圆分析和磁聚焦、磁发散。'
        )
      ]
    },
    { id: newId(), type: 'section', text: '例题精讲' },
    { id: newId(), type: 'topic', text: '放缩圆' },
    {
      id: newId(),
      type: 'question',
      question: createQuestion({
        kind: 'multi-choice',
        stem: [
          para(
            '（多选）如图所示，垂直于纸面向里的匀强磁场分布在正方形abcd区域内，O点是cd边的中点．一个带正电的粒子仅在磁场力的作用下，从O点沿纸面以垂直于cd边的速度射入正方形内，经过时间',
            m('t_0'),
            '刚好从c点射出磁场．现设法使该带电粒子从O点沿纸面以与Od成30°角的方向，以大小不同的速率射入正方形内，粒子重力不计，那么下列说法中正确的是（　　）'
          )
        ],
        figures: [
          { assetId: figure.id, widthEmu: cmToEmu(5.4), heightEmu: cmToEmu(5.13), placement: 'right' }
        ],
        options: [
          { label: 'A', content: para('若该带电粒子从ab边射出，它经历的时间可能为', m('t_0')) },
          { label: 'B', content: para('若该带电粒子从bc边射出，它经历的时间可能为', m('\\frac{5}{4}t_0')) },
          { label: 'C', content: para('若该带电粒子从cd边射出，它经历的时间为', m('\\frac{5}{3}t_0')) },
          { label: 'D', content: para('若该带电粒子从ad边射出，它经历的时间可能为', m('\\frac{2}{3}t_0')) }
        ],
        answer: [para('BC')],
        knowledgePoints: ['放缩圆'],
        analysis: [
          para(
            '【详解】由题，带电粒子以垂直于cd边的速度射入正方形内，经过时间',
            m('t_0'),
            '刚好从c点射出磁场，则知带电粒子的运动周期为',
            m('T=2t_0'),
            '．'
          ),
          para('【点睛】抓住粒子的周期一定，根据速度的偏向角等于轨迹的圆心角，由圆心角确定粒子在磁场中的运动时间．')
        ]
      })
    },
    { id: newId(), type: 'topic', text: '圆形边界磁场动态圆' },
    {
      id: newId(),
      type: 'question',
      question: createQuestion({
        stem: [
          para(
            '如图所示，圆形区域内有一垂直纸面的匀强磁场，P为磁场边界上的一点。有无数带有同样电荷、具有同样质量的粒子在纸面内沿各个方向以相同的速率通过P点进入磁场。这些粒子射出边界的位置均处于边界的某一段圆弧上，这段圆弧的弧长是圆周长的',
            m('\\frac{1}{3}'),
            '。将磁感应强度的大小从原来的',
            m('B_1'),
            '变为',
            m('B_2'),
            '，结果相应的弧长变为原来的一半，则',
            m('\\frac{B_2}{B_1}'),
            '等于（　　）'
          )
        ],
        options: [
          { label: 'A', content: para(m('\\sqrt{2}')) },
          { label: 'B', content: para(m('\\sqrt{3}')) },
          { label: 'C', content: para('2') },
          { label: 'D', content: para('3') }
        ],
        answer: [para('B')],
        knowledgePoints: ['圆形边界磁场动态圆-半径小于磁场半径']
      })
    },
    { id: newId(), type: 'section', text: '课堂练习' },
    { id: newId(), type: 'topic', text: '放缩圆' },
    {
      id: newId(),
      type: 'question',
      question: createQuestion({
        kind: 'solve',
        difficulty: 'B',
        stem: [
          para(
            '一足够长的矩形区域abcd内充满磁感应强度为B，方向垂直纸面向里的匀强磁场，矩形区域的左边界ad宽为L，现从ad中点O垂直于磁场射入一带电粒子，速度大小为',
            m('v_0'),
            '，方向与ad边夹角为30°，已知粒子质量为m，带电量为q，粒子重力不计。'
          )
        ],
        subQuestions: [
          { id: newId(), content: [para('若粒子带负电，且恰能从d点射出磁场，求', m('v_0'), '的大小；')] },
          { id: newId(), content: [para('若粒子带正电，使粒子能从ad边射出磁场，求', m('v_0'), '的取值范围。')] }
        ],
        answer: [para('(1) ', m('v_0=\\frac{qBL}{m}'), '；(2) ', m('v_0\\le\\frac{qBL}{3m}'))],
        knowledgePoints: ['放缩圆'],
        keyPoint: '电性未知导致多解',
        layout: { studentSpaceLines: 8 }
      })
    }
  ]

  const bundle: ProjectBundle = { project, assets: { [figure.id]: figure } }
  return defaults === undefined ? bundle : withTemplateDefaults(bundle, defaults)
}
