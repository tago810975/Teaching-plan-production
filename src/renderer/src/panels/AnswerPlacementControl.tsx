/**
 * 综合题答案与解析的位置：集中在整道综合题最后 / 分到每道小题后面（属性面板与右键快捷窗口共用）。
 * 切换时把内容搬过去（见 core/model/composite-answers.ts），可撤销；按题号没能全部分开时给出提示。
 */
import { useState, type Dispatch } from 'react'
import { answerPlacement, collectAnswers, distributeAnswers } from '@core/model/composite-answers'
import type { Block, CompositeBlock } from '@core/model/types'
import type { EditorAction } from '../state/store'

interface Props {
  block: CompositeBlock
  /** 小题在全卷中的题号（如 "6."），集中到最后时写在答案、解析前面 */
  questionNumbers: ReadonlyMap<string, string>
  dispatch: Dispatch<EditorAction>
}

/** 最近一次切换的提示：属性面板会在切换后重新创建本控件，提示在这几秒内仍然显示 */
let lastNote: { blockId: string; text: string; at: number } | null = null
const NOTE_MS = 6000

export function AnswerPlacementControl({ block, questionNumbers, dispatch }: Props) {
  const [note, setNoteState] = useState<string | null>(() => (lastNote !== null && lastNote.blockId === block.id && Date.now() - lastNote.at < NOTE_MS ? lastNote.text : null))
  const setNote = (text: string): void => {
    lastNote = { blockId: block.id, text, at: Date.now() }
    setNoteState(text)
  }
  const placement = answerPlacement(block)
  const apply = (to: 'end' | 'items'): void => {
    if (to === 'items') {
      const r = distributeAnswers(block)
      const n = block.items.length
      setNote(
        r.answerParts >= n || (n === 1 && r.answerParts === 0)
          ? `已分到 ${n} 道小题。`
          : r.answerParts === 0
            ? '答案中没有找到题号，答案仍留在综合题最后，请手动分到各小题。'
            : `答案中只找到 ${r.answerParts} 个题号（共 ${n} 道小题），其余请手动补充。`
      )
      dispatch({ type: 'update-block', blockId: block.id, update: (b) => (b.type === 'composite' ? (distributeAnswers(b).composite as Block) : b) })
    } else {
      const numbers = block.items.map((it, i) => Number((questionNumbers.get(it.id) ?? `${i + 1}`).replace(/\D/g, '')) || i + 1)
      setNote('已集中到综合题最后。')
      dispatch({ type: 'update-block', blockId: block.id, update: (b) => (b.type === 'composite' ? (collectAnswers(b, numbers) as Block) : b) })
    }
    // 属性面板中的输入框重新读取内容（答案、解析都换了地方）
    dispatch({ type: 'refresh-inspector' })
  }
  return (
    <div className="answer-placement">
      <div className="segmented" role="radiogroup" aria-label="答案与解析的位置">
        <button type="button" role="radio" aria-checked={placement === 'end'} className={placement === 'end' ? 'is-active' : undefined} disabled={placement === 'end'} onClick={() => apply('end')}>
          集中在最后
        </button>
        <button type="button" role="radio" aria-checked={placement === 'items'} className={placement === 'items' ? 'is-active' : undefined} disabled={placement === 'items'} onClick={() => apply('items')}>
          分到各小题
        </button>
      </div>
      {placement === 'mixed' && <p className="field-hint">现在综合题最后与各小题都有答案或解析；点上面任一项可合到一处。</p>}
      {note !== null && <p className="field-hint">{note}</p>}
    </div>
  )
}
