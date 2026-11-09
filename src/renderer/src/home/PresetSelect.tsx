/**
 * 格式预设选择（目前只有物理教学案 V1.0，其他学科、其他格式的预设以后加入 core/presets）。
 */
import { useEffect, useState } from 'react'
import { getPreset, PRESETS } from '@core/presets'

export function PresetSelect({ value, onChange, id }: { value: string; onChange: (id: string) => void; id?: string }) {
  return (
    <>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <p className="field-hint">{getPreset(value).description}</p>
    </>
  )
}

/** 设置中的“导入时默认预设”：读取后作为选择的初始值 */
export function useDefaultPreset(): [string, (id: string) => void] {
  const [presetId, setPresetId] = useState(getPreset(undefined).id)
  useEffect(() => {
    void window.api.getDefaultPreset().then(setPresetId)
  }, [])
  return [presetId, setPresetId]
}
