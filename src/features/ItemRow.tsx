interface ItemRowProps {
  iconLink: string | null
  name: string
  shortName: string
}

// 아이콘 + 이름 셀 (여러 테이블에서 공용)
export function ItemCell({ iconLink, name, shortName }: ItemRowProps) {
  return (
    <div className="item-cell">
      {iconLink && <img src={iconLink} alt="" loading="lazy" />}
      <span>
        {name} <span className="dim">({shortName})</span>
      </span>
    </div>
  )
}
