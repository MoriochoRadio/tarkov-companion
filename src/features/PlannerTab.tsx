import { useEffect, useMemo, useState } from 'react'
import { fetchMaps } from '../api/maps'
import { biName, fetchQuests, type Quest, type QuestObjective } from '../api/quests'
import { useAsyncData } from '../hooks/useAsyncData'
import { ACTIVE_QUESTS_KEY, useIdSet } from '../lib/favorites'
import {
  fetchMapMeta,
  metaForNormalizedName,
  type MapMeta,
} from '../lib/mapProject'
import { usePlannerPicks } from '../lib/plannerPicks'
import { usePlayerLevel } from '../lib/playerLevel'
import { MapViewer, type ViewMarker } from './MapViewer'
import { TableSkeleton } from './Skeleton'

// 맵 퀘스트 플래너 1단계 (Phase 25) — "한 레이드에 퀘스트 몰아 밀기".
// 맵 선택 → 그 맵에 목표가 있는 퀘스트를 체크 → 목표 유형 분류 +
// "레이드 가방"(지참물 합산·처치 요약)만 보고 가방을 싸면 되게.
// 맵 위 마커 렌더는 Phase 26 (docs/map-planner-research.md 조사 선행)

const FIRST_PAINT_ROWS = 20

const collator = new Intl.Collator('ko')

// objective type → 유형 분류 (1510개 목표 실측 기반 매핑).
// 분류에 없는 type(extract/giveItem/skill 등)은 '기타'
type Cat = 'mark' | 'install' | 'visit' | 'hide' | 'kill' | 'other'

const CAT_OF: Record<string, Cat> = {
  mark: 'mark', // 99 — 마커 설치 (MS2000)
  plantItem: 'install', // 123 — 재머·송신기 등 설치
  useItem: 'install', // 8 — 신호탄 등 사용
  visit: 'visit', // 212 — 지점 방문
  findQuestItem: 'visit', // 114 — 퀘스트 아이템 회수
  findItem: 'visit', // 144 — 현장 획득 (맵 지정분만 여기 옴)
  plantQuestItem: 'hide', // 13 — 아이템 숨기기
  shoot: 'kill', // 200 — 처치
}

const CATS: { key: Cat; icon: string; label: string }[] = [
  { key: 'mark', icon: '📍', label: '마커 설치' },
  { key: 'install', icon: '🧰', label: '아이템 설치·사용' },
  { key: 'visit', icon: '👣', label: '발견·방문·회수' },
  { key: 'hide', icon: '📥', label: '아이템 숨기기' },
  { key: 'kill', icon: '💀', label: '처치' },
  { key: 'other', icon: '📋', label: '기타' },
]

const catOf = (o: QuestObjective): Cat => CAT_OF[o.type] ?? 'other'

const onMap = (o: QuestObjective, mapId: string) =>
  o.maps.some((m) => m.id === mapId)

// 퀘스트별 마커 색 — 다크 배경에서 구분되는 8색 순환
const QUEST_COLORS = [
  '#e8c66a', '#6ab7e8', '#7fd98c', '#e87f7f',
  '#c89be8', '#e8a85f', '#62d9c8', '#e86ab4',
]

// ---------- 레이드 가방: 선택 퀘스트의 이 맵 목표에서 지참물·처치 합산 ----------

interface BagItem {
  id: string
  label: string
  iconLink: string | null
  count: number
}

interface Bag {
  carry: BagItem[] // 가방에 넣어 갈 것 (마커·설치물·사용물)
  hide: { label: string; quest: string }[] // 숨길 퀘스트 아이템 (수령 후 지참)
  kills: { label: string; count: number }[]
  visitCount: number
  otherCount: number
}

function buildBag(selected: { quest: Quest; objectives: QuestObjective[] }[]): Bag {
  const carry = new Map<string, BagItem>()
  const hide: Bag['hide'] = []
  const kills = new Map<string, number>()
  let visitCount = 0
  let otherCount = 0

  const addCarry = (
    id: string,
    label: string,
    iconLink: string | null,
    count: number,
  ) => {
    const cur = carry.get(id)
    if (cur) cur.count += count
    else carry.set(id, { id, label, iconLink, count })
  }

  for (const { quest, objectives } of selected) {
    for (const o of objectives) {
      const cat = catOf(o)
      if (cat === 'mark' && o.markerItem) {
        addCarry(
          o.markerItem.id,
          biName(o.markerItem.nameKo, o.markerItem.nameEn),
          o.markerItem.iconLink,
          1, // mark 목표 1개 = 마커 1개
        )
      } else if (o.type === 'plantItem' && o.items?.length) {
        const i = o.items[0]
        addCarry(i.id, biName(i.nameKo, i.nameEn), i.iconLink, o.count ?? 1)
      } else if (o.type === 'useItem' && o.useItems?.length) {
        // useAny = 보기 중 하나 사용 가능 — 첫 항목 기준으로 합산하고 '류' 표기
        const i = o.useItems[0]
        addCarry(
          i.id,
          `${biName(i.nameKo, i.nameEn)}${o.useItems.length > 1 ? ' 류' : ''}`,
          i.iconLink,
          o.count ?? 1,
        )
      } else if (cat === 'hide' && o.questItem) {
        hide.push({
          label: biName(o.questItem.nameKo, o.questItem.nameEn),
          quest: quest.nameKo,
        })
      } else if (cat === 'kill') {
        const label = o.targetNames?.length ? o.targetNames.join('/') : '대상'
        kills.set(label, (kills.get(label) ?? 0) + (o.count ?? 1))
      } else if (cat === 'visit') {
        visitCount++
      } else {
        otherCount++
      }
    }
  }
  return {
    carry: [...carry.values()].sort((a, b) => b.count - a.count),
    hide,
    kills: [...kills.entries()].map(([label, count]) => ({ label, count })),
    visitCount,
    otherCount,
  }
}

function BagPanel({
  bag,
  pickCount,
  mapName,
  normalizedName,
  onClear,
}: {
  bag: Bag
  pickCount: number
  mapName: string
  normalizedName: string | null
  onClear: () => void
}) {
  return (
    <details className="planner-bag" open>
      <summary>
        🎒 레이드 가방 — {mapName} · 퀘스트 {pickCount}개
      </summary>
      <div className="planner-bag-body">
        {pickCount === 0 && (
          <p className="hint">
            아래 목록에서 퀘스트를 체크하면 지참물이 여기에 합산됩니다.
          </p>
        )}
        {bag.carry.length > 0 && (
          <>
            <h4>가방에 넣을 것</h4>
            <ul className="planner-carry">
              {bag.carry.map((c) => (
                <li key={c.id}>
                  {c.iconLink && <img src={c.iconLink} alt="" loading="lazy" />}
                  <span>{c.label}</span>
                  <span className="num">× {c.count}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {bag.hide.length > 0 && (
          <>
            <h4>숨길 아이템 (퀘스트 수령 시 지급분 지참)</h4>
            <ul className="planner-lines">
              {bag.hide.map((h, i) => (
                <li key={i}>
                  📥 {h.label} <span className="dim">— {h.quest}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {bag.kills.length > 0 && (
          <>
            <h4>처치 목표</h4>
            <ul className="planner-lines">
              {bag.kills.map((k) => (
                <li key={k.label}>
                  💀 {k.label} <span className="num">{k.count}킬</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {(bag.visitCount > 0 || bag.otherCount > 0) && (
          <p className="hint planner-etc">
            {bag.visitCount > 0 && <>👣 방문·회수 지점 {bag.visitCount}곳</>}
            {bag.visitCount > 0 && bag.otherCount > 0 && ' · '}
            {bag.otherCount > 0 && <>📋 기타 목표 {bag.otherCount}개</>}
          </p>
        )}
        <div className="planner-bag-actions">
          {normalizedName && (
            <a
              className="btn-ext"
              href={`https://tarkov.dev/map/${normalizedName}`}
              target="_blank"
              rel="noreferrer"
            >
              🗺️ tarkov.dev 맵 ↗
            </a>
          )}
          {pickCount > 0 && (
            <button className="btn-ext" onClick={onClear}>
              선택 초기화
            </button>
          )}
        </div>
      </div>
    </details>
  )
}

// ---------- 본체 ----------

export function PlannerTab({
  onQuest,
  onItem,
}: {
  onQuest?: (id: string) => void
  onItem?: (name: string) => void
}) {
  const questsState = useAsyncData(fetchQuests)
  const mapsState = useAsyncData(fetchMaps) // normalizedName(딥링크)용 — 맵 탭과 캐시 공유
  const [mapId, setMapId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [level, setLevel] = usePlayerLevel()
  const [activeOnly, setActiveOnly] = useState(false)
  const [visible, setVisible] = useState(FIRST_PAINT_ROWS)
  const [showMap, setShowMap] = useState(false)
  const { picks, toggle, clear } = usePlannerPicks()
  const { ids: activeIds } = useIdSet(ACTIVE_QUESTS_KEY)

  // 맵 메타(투영·층 정의)는 맵 보기를 처음 켤 때만 로드 (lazy)
  const metaState = useAsyncData(
    () => (showMap ? fetchMapMeta() : Promise.resolve(null)),
    [showMap],
  )

  const quests = questsState.status === 'ready' ? questsState.data : []

  // 맵 칩: 목표가 묶인 맵별 퀘스트 수 (목표 단위 maps 기준 — 태스크 단위 map보다 정확)
  const mapStats = useMemo(() => {
    const stats = new Map<string, { id: string; name: string; quests: number }>()
    for (const q of quests) {
      const seen = new Set<string>()
      for (const o of q.objectives) {
        for (const m of o.maps) {
          if (seen.has(m.id)) continue
          seen.add(m.id)
          const s = stats.get(m.id) ?? { id: m.id, name: m.name, quests: 0 }
          s.quests++
          stats.set(m.id, s)
        }
      }
    }
    return [...stats.values()].sort((a, b) => b.quests - a.quests)
  }, [quests])

  const selectedMap = mapStats.find((m) => m.id === mapId) ?? null
  const normalizedName = useMemo(() => {
    if (mapsState.status !== 'ready' || !mapId) return null
    return mapsState.data.find((m) => m.id === mapId)?.normalizedName ?? null
  }, [mapsState, mapId])

  // 맵 전환마다 2단계 렌더 리셋
  useEffect(() => {
    setVisible(FIRST_PAINT_ROWS)
    const t = setTimeout(() => setVisible(Infinity), 60)
    return () => clearTimeout(t)
  }, [mapId])

  // 이 맵에 목표가 있는 퀘스트 + 그 맵의 목표만 추림
  const mapQuests = useMemo(() => {
    if (!mapId) return []
    const lvl = Number(level)
    const q = query.trim().toLowerCase()
    const out: { quest: Quest; objectives: QuestObjective[] }[] = []
    for (const quest of quests) {
      if (level && quest.minPlayerLevel > lvl) continue
      if (activeOnly && !activeIds.has(quest.id)) continue
      if (q && !quest.searchKey.includes(q)) continue
      const objectives = quest.objectives.filter((o) => onMap(o, mapId))
      if (objectives.length === 0) continue
      out.push({ quest, objectives })
    }
    return out.sort(
      (a, b) =>
        a.quest.minPlayerLevel - b.quest.minPlayerLevel ||
        collator.compare(a.quest.nameKo, b.quest.nameKo),
    )
  }, [quests, mapId, level, query, activeOnly, activeIds])

  const pickedIds = useMemo(
    () => new Set(mapId ? picks[mapId] ?? [] : []),
    [picks, mapId],
  )
  // 가방·브리핑은 필터와 무관하게 "체크된 퀘스트 전부" 기준 (레이드 중 폰 확인 시나리오)
  const selected = useMemo(() => {
    if (!mapId) return []
    const byId = new Map(quests.map((q) => [q.id, q]))
    const out: { quest: Quest; objectives: QuestObjective[] }[] = []
    for (const id of pickedIds) {
      const quest = byId.get(id)
      if (!quest) continue
      const objectives = quest.objectives.filter((o) => onMap(o, mapId))
      if (objectives.length) out.push({ quest, objectives })
    }
    return out
  }, [quests, mapId, pickedIds])

  const bag = useMemo(() => buildBag(selected), [selected])

  // 퀘스트 → 마커 색 (선택 순서 기준 순환)
  const questColor = useMemo(() => {
    const m = new Map<string, string>()
    selected.forEach(({ quest }, i) =>
      m.set(quest.id, QUEST_COLORS[i % QUEST_COLORS.length]),
    )
    return m
  }, [selected])

  // 이 맵의 수록 SVG 메타 — 없으면(쇄빙선·연구소·미궁) 맵 보기 비활성
  const mapMeta: MapMeta | null = useMemo(() => {
    if (metaState.status !== 'ready' || !metaState.data) return null
    return metaForNormalizedName(metaState.data, normalizedName)
  }, [metaState, normalizedName])
  // 메타 파일을 아직 안 받았어도 "버튼 활성 여부"는 알아야 함 — 별칭 포함
  // 수록 목록은 정적이므로 normalizedName 기준 하드체크 대신 메타 로드 후 판별,
  // 로드 전에는 활성으로 두고 로드 후 없으면 안내를 보여준다

  // 마커: 체크한 퀘스트의 이 맵 목표 중 좌표 보유분
  const markers: ViewMarker[] = useMemo(() => {
    if (!mapId) return []
    const out: ViewMarker[] = []
    for (const { quest, objectives } of selected) {
      const color = questColor.get(quest.id) ?? QUEST_COLORS[0]
      for (const o of objectives) {
        const cat = CATS.find((c) => c.key === catOf(o))!
        // 잠긴 목표면 필요 열쇠를 칩으로 (한/영 표시명 + 검색어 미리 가공)
        const keys = o.requiredKeys?.map((grp) =>
          grp.map((k) => ({
            id: k.id,
            label: biName(k.nameKo, k.nameEn),
            search: k.nameKo,
            iconLink: k.iconLink,
          })),
        )
        for (const [i, loc] of (o.locations ?? []).entries()) {
          if (loc.mapId !== mapId) continue
          out.push({
            key: `${o.id}-${i}`,
            x: loc.x,
            z: loc.z,
            icon: cat.icon,
            color,
            questName: quest.displayName,
            desc: o.description || cat.label,
            ...(keys?.length ? { keys } : {}),
          })
        }
      }
    }
    return out
  }, [selected, mapId, questColor])

  // 좌표 미제공 목표 — 조용히 숨기지 않고 명시
  const noCoordObjectives = useMemo(() => {
    if (!mapId) return []
    const out: { quest: Quest; o: QuestObjective }[] = []
    for (const { quest, objectives } of selected) {
      for (const o of objectives) {
        if (!(o.locations ?? []).some((l) => l.mapId === mapId)) {
          out.push({ quest, o })
        }
      }
    }
    return out
  }, [selected, mapId])

  // 작전 브리핑: 선택 퀘스트의 목표를 유형별로 묶음
  const briefing = useMemo(() => {
    const byCat = new Map<Cat, { quest: Quest; o: QuestObjective }[]>()
    for (const { quest, objectives } of selected) {
      for (const o of objectives) {
        const c = catOf(o)
        if (!byCat.has(c)) byCat.set(c, [])
        byCat.get(c)!.push({ quest, o })
      }
    }
    return CATS.filter((c) => byCat.has(c.key)).map((c) => ({
      ...c,
      entries: byCat.get(c.key)!,
    }))
  }, [selected])

  if (questsState.status === 'loading') {
    return <TableSkeleton rows={8} label="퀘스트 데이터 불러오는 중… (최초 1회, 약 7초)" />
  }
  if (questsState.status === 'error') {
    return <p className="status error">불러오기 실패: {questsState.message}</p>
  }

  return (
    <div>
      <p className="hint">
        맵을 고르고 이번 레이드에 밀 퀘스트를 체크 — 우측(모바일은 상단) 레이드
        가방만 보고 짐을 싸면 됩니다. 선택은 맵별로 이 브라우저에 저장.
      </p>
      <div className="planner-maps">
        {mapStats.map((m) => (
          <button
            key={m.id}
            className={`planner-map${m.id === mapId ? ' active' : ''}`}
            onClick={() => setMapId(m.id === mapId ? null : m.id)}
          >
            {m.name}
            <span className="dim num"> {m.quests}</span>
            {(picks[m.id]?.length ?? 0) > 0 && (
              <span className="planner-map-picked num">✓{picks[m.id]!.length}</span>
            )}
          </button>
        ))}
      </div>

      {!selectedMap && (
        <p className="hint">↑ 맵을 선택하세요 — 숫자는 그 맵에 목표가 있는 퀘스트 수</p>
      )}

      {selectedMap && (
        <>
          <div className="toolbar">
            <button
              className={`btn-ext${showMap ? ' active' : ''}`}
              onClick={() => setShowMap((v) => !v)}
            >
              🗺️ 맵 보기 {showMap ? '끄기' : ''}
            </button>
            {showMap && metaState.status === 'ready' && !mapMeta && (
              <span className="hint" style={{ margin: 0 }}>
                이 맵은 수록 지도가 없습니다 (신맵·연구소·미궁) — 가방 패널의
                tarkov.dev 맵 링크를 이용하세요
              </span>
            )}
          </div>
          {showMap && metaState.status === 'loading' && (
            <p className="hint">맵 메타 불러오는 중…</p>
          )}
          {showMap && mapMeta && (
            <>
              <MapViewer
                meta={mapMeta}
                svgUrl={`${import.meta.env.BASE_URL}maps/${mapMeta.svg}`}
                markers={markers}
                onItem={onItem}
              />
              {noCoordObjectives.length > 0 && (
                <details className="planner-nocoord">
                  <summary>
                    좌표 미제공 목표 {noCoordObjectives.length}개 — 마커로 못
                    찍는 목표 (API에 좌표 없음)
                  </summary>
                  <ul className="planner-lines">
                    {noCoordObjectives.map(({ quest, o }) => (
                      <li key={o.id}>
                        <span
                          className="mapmark-dot"
                          style={{ background: questColor.get(quest.id) }}
                        />
                        {CATS.find((c) => c.key === catOf(o))!.icon}{' '}
                        {o.description || o.type}
                        <span className="dim"> — {quest.nameKo}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        <div className="tracker-split planner-split">
          <div className="tracker-left">
            <div className="toolbar">
              <input
                className="search-input"
                type="search"
                placeholder="퀘스트 이름 검색 (한국어/영어)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <input
                className="level-input"
                type="number"
                min="1"
                max="79"
                placeholder="내 레벨"
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              />
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={activeOnly}
                  onChange={(e) => setActiveOnly(e.target.checked)}
                />
                ★ 진행 중만
              </label>
            </div>
            <ul className="planner-quests">
              {mapQuests.slice(0, visible).map(({ quest, objectives }) => {
                const cats = [...new Set(objectives.map(catOf))]
                return (
                  <li key={quest.id} className="planner-quest">
                    <label className="planner-pick">
                      <input
                        type="checkbox"
                        checked={pickedIds.has(quest.id)}
                        onChange={() => toggle(selectedMap.id, quest.id)}
                      />
                      <span className="planner-quest-main">
                        <span className="planner-quest-name">
                          {pickedIds.has(quest.id) && questColor.get(quest.id) && (
                            <span
                              className="mapmark-dot"
                              style={{ background: questColor.get(quest.id) }}
                              title="맵 마커 색"
                            />
                          )}
                          {quest.displayName}
                          {quest.kappaRequired && (
                            <span className="badge-kappa">κ</span>
                          )}
                        </span>
                        <span className="planner-quest-meta dim">
                          {quest.trader.name} · Lv {quest.minPlayerLevel} ·{' '}
                          {CATS.filter((c) => cats.includes(c.key))
                            .map((c) => c.icon)
                            .join(' ')}
                        </span>
                      </span>
                    </label>
                    <button
                      className="quest-link planner-detail"
                      onClick={() => onQuest?.(quest.id)}
                      title="퀘스트 상세·공략 보기"
                    >
                      상세 →
                    </button>
                  </li>
                )
              })}
            </ul>
            {mapQuests.length === 0 && (
              <p className="hint">조건에 맞는 퀘스트가 없습니다.</p>
            )}

            {briefing.length > 0 && (
              <section className="planner-briefing">
                <h3>작전 브리핑 — 목표 유형별</h3>
                {briefing.map((c) => (
                  <div key={c.key} className="planner-cat">
                    <h4>
                      {c.icon} {c.label}{' '}
                      <span className="dim num">{c.entries.length}</span>
                    </h4>
                    <ul className="planner-lines">
                      {c.entries.map(({ quest, o }) => (
                        <li key={o.id}>
                          {o.description || o.type}
                          {o.optional && <span className="dim"> (선택)</span>}
                          <span className="dim"> — {quest.nameKo}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            )}
          </div>
          <aside className="tracker-right planner-bag-col">
            <BagPanel
              bag={bag}
              pickCount={selected.length}
              mapName={selectedMap.name}
              normalizedName={normalizedName}
              onClear={() => clear(selectedMap.id)}
            />
          </aside>
        </div>
        </>
      )}
    </div>
  )
}
