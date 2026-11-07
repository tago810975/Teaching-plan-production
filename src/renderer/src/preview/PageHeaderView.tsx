/**
 * 预览中的页眉与水印。版式参数取自 core/document/header.ts，与导出共用。
 */
import type { CSSProperties } from 'react'
import {
  HEADER_DISTANCE_TWIP,
  HEADER_SIZE_HALF_PT,
  HEADER_TAB_CENTER_TWIP,
  HEADER_TAB_RIGHT_TWIP,
  WATERMARK_OFFSET_EMU
} from '@core/document/header'
import type { PageSetup } from '@core/document/units'
import { emuToPt, twipToPt } from '@core/document/units'
import type { HeaderImage, PageHeader } from '@core/model/types'

interface Props {
  header: PageHeader
  page: PageSetup
  assetUrls: ReadonlyMap<string, string>
  selected: boolean
  onSelect?: () => void
}

const size = (img: HeaderImage): CSSProperties => ({
  width: `${emuToPt(img.widthEmu)}pt`,
  height: `${emuToPt(img.heightEmu)}pt`
})

export function PageWatermark({ header, page, assetUrls }: Omit<Props, 'selected' | 'onSelect'>) {
  const wm = header.watermark
  if (wm === undefined) return null
  return (
    <img
      className="page-watermark"
      src={assetUrls.get(wm.assetId)}
      alt=""
      style={{
        ...size(wm),
        left: `${twipToPt(page.marginLeftTwip) + emuToPt(WATERMARK_OFFSET_EMU.x)}pt`,
        top: `${twipToPt(page.marginTopTwip) + emuToPt(WATERMARK_OFFSET_EMU.y)}pt`
      }}
    />
  )
}

export function PageHeaderView({ header, page, assetUrls, selected, onSelect }: Props) {
  const centerPt = twipToPt(HEADER_TAB_CENTER_TWIP)
  const rightPt = twipToPt(HEADER_TAB_RIGHT_TWIP)
  return (
    <header
      className={`page-header${selected ? ' is-selected' : ''}`}
      style={{
        top: `${twipToPt(HEADER_DISTANCE_TWIP)}pt`,
        left: `${twipToPt(page.marginLeftTwip)}pt`,
        fontSize: `${HEADER_SIZE_HALF_PT / 2}pt`
      }}
      onClick={onSelect}
      title={onSelect === undefined ? undefined : '点击编辑页眉'}
    >
      {header.logo !== undefined && (
        <img className="page-header-logo" src={assetUrls.get(header.logo.assetId)} alt="" style={size(header.logo)} />
      )}
      <div className="page-header-line" style={{ width: `${rightPt}pt` }}>
        <span>{header.left}</span>
        {header.phone !== '' && (
          // 居中制表位：内容以 centerPt 为中心
          <span className="page-header-phone" style={{ left: `${centerPt}pt` }}>
            {header.phoneIcon !== undefined && (
              <img src={assetUrls.get(header.phoneIcon.assetId)} alt="" style={size(header.phoneIcon)} />
            )}
            {header.phone}
          </span>
        )}
        <span className="page-header-right">{header.right}</span>
      </div>
    </header>
  )
}
