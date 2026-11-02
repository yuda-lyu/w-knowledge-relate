// reevalPolicy.mjs — 知識變更時調整關聯:內容變更後既有邊之重評——純函數(待重評判定、選邊、分頁、裁決驗證、兩評一致、閘門分級、進度標記)
//   (共用之核對件——單票驗證之前段、票之相同、決定性打亂——在 stores/edgeCheckKit)
//
// 【版本】待重評＝knowledgeChangedAt 為字串、≠ edgesReviewedChangeAt、且正向已評完此版本(relatedChangeAt === knowledgeChangedAt;判定在
//   stores/relatedNotes 之 needsEdgeReview——筆記狀態機一處):先由正向新增／升衝突,再裁既有邊。秒級時刻作版本與 relatedChangeAt 同一判準
//   (內容同步每輪一次、維運取執行鎖)。
// 【進度與否決存字串】筆記欄位 edgesReviewed／relatedPicks 皆為「版本\t以換行分隔之 id」——集合之 patch 為深合併,陣列欄位變短會殘留
//   舊元素;字串整值覆寫,無此問題。
// 【待裁之邊】兩端皆在、未在刪除墓碑(懸空邊只告警,不由重評隱性清除)、判定時刻(updatedAt‖createdAt)早於本版本
//   (本版本正向剛建或升級者已以新內容判過)、本版本尚未裁過;同輪兩端皆待重評之對只排入 id 小者之頁。
// 【判定小組(摘要套件之 panel)】同一條邊兩票皆為明確裁決、裁決相同(change 另須新型別相同)、實際成交之供應者不同才成立;
//   不確定(unsure)為合法裁決;前兩票未成立而可成立者叫第三席(呼叫端)。
//   未成立者不記已審:缺票、同一供應者 → 下輪重評;不確定、不一致 → 待判(使用者)。
// 【閘門分級】false:一律只記候選;'additive':升為衝突、非衝突間改型、理由更新(可見、可逆、不撤除下游所依之衝突);'all':另含撤銷與降級。
// 【否決】本版本正向段以新內容又選中之鄰居(只入 history 而邊值未變者),撤銷一票否決——同一版本之兩次判斷互相矛盾時不撤。

import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { cmp } from '../core/capturePackage.mjs'
import { edgeTimeOf } from './edgeStore.mjs'
import { decidePanel } from '../core/summarizePackage.mjs'
import { baseVerdictOf, sameEdgeVerdict } from './edgeCheckKit.mjs'

/** 振盪觀察窗(天):重評撤銷後此期間內正向／反向／輪巡段又建同一對 → 計 reevalReproposed(只觀察、不擋) */
export const REEVAL_REPROPOSE_DAYS = 30

/**
 * 重評提示詞之一項(RS5 之題項:一篇內容已更新之目標、其一句話重點、本頁之鄰居與現行邊——重評段之兩席與第三席、評分同一形狀;domain 之
 *   buildReevalPrompt 收之)
 *
 * @param {Object} target 輸入目標筆記記錄
 * @param {String} summary 輸入目標之一句話重點全文
 * @param {Array} pairs 輸入 [{ note(鄰居記錄), edge(現行邊) }]
 * @returns {Object} 回傳 { target, summary, neighbors:[{ note, edge }] }
 * @example
 * console.log(reevalPromptItemOf({ id: 't' }, '重點', [{ note: { id: 'n' }, edge: { type: '甲' } }]).neighbors.length)
 * // => 1
 */
export function reevalPromptItemOf(target, summary, pairs) {
    return { target, summary, neighbors: (isarr(pairs) ? pairs : []).map((p) => ({ note: p?.note, edge: p?.edge })) }
}

/**
 * 「版本\tid 清單」之打包(id 以換行分隔、排序去重)
 *
 * @param {String} version 輸入版本(knowledgeChangedAt)
 * @param {Iterable} ids 輸入 id
 * @returns {String} 回傳打包字串(無 id 回 '')
 * @example
 * console.log(JSON.stringify(packIds('V1', ['b', 'a', 'a'])), JSON.stringify(packIds('V1', [])))
 * // => "V1\ta\nb" ""
 */
export function packIds(version, ids) {
    const list = [...new Set([...(ids || [])].filter(isestr))].sort(cmp)
    return list.length ? `${version}\t${list.join('\n')}` : ''
}

/**
 * 解包:版本相符才回傳其 id 集合,否則空集合(版本前進即舊進度失效)
 *
 * @param {String} packed 輸入打包字串
 * @param {String} version 輸入目前版本
 * @returns {Set} 回傳 id 集合
 * @example
 * const packed = packIds('V1', ['b', 'a'])
 * console.log(unpackIds(packed, 'V1'), unpackIds(packed, 'V2'))
 * // => Set(2) { 'a', 'b' } Set(0) {}
 */
export function unpackIds(packed, version) {
    const s = typeof packed === 'string' ? packed : ''
    const i = s.indexOf('\t')
    if (i < 0 || s.slice(0, i) !== version) return new Set()
    return new Set(s.slice(i + 1).split('\n').filter(Boolean))
}

/**
 * 某篇本版本待裁之邊
 *
 * @param {Object} note 輸入筆記(待重評者)
 * @param {Object} o 輸入 { adj:Map(id→Map(鄰居 id→邊)), byId:Map, isTombstoned:(id)=>Boolean, coSelected:Set(同輪入選之待重評筆記 id),
 *   isHeld:(邊 id)=>Boolean(待判中、未要求重試之邊——交使用者判讀,不再自動重評,亦不擋本版本評完) }
 * @returns {Object} 回傳 { edges:[{ edge, nb }], deferred:Array(邊 id;由鄰居之頁裁) , excluded:{ dangling, fresh, reviewed, held } }
 * @example
 * const note = { id: 'n1', knowledgeChangedAt: '2026-10-05T10:00:00+08:00' }
 * const edgeTo = (nb, at) => ({ id: `e-${nb}`, from: 'n1', to: nb, type: '甲', createdAt: at })
 * const adj = new Map([['n1', new Map([
 *     ['n2', edgeTo('n2', '2026-10-01T00:00:00+08:00')],
 *     ['n3', edgeTo('n3', '2026-10-06T00:00:00+08:00')],
 *     ['n9', edgeTo('n9', '2026-10-01T00:00:00+08:00')],
 * ])]])
 * const byId = new Map([['n1', note], ['n2', {}], ['n3', {}]])
 * const r = reviewEdgesOf(note, { adj, byId })
 * console.log(r.edges.map((x) => x.edge.id), r.deferred, r.excluded)
 * // => [ 'e-n2' ] [] { dangling: 1, fresh: 1, reviewed: 0, held: 0 }
 */
export function reviewEdgesOf(note, o = {}) {
    const version = note.knowledgeChangedAt
    const reviewed = unpackIds(note.edgesReviewed, version)
    const co = o.coSelected instanceof Set ? o.coSelected : new Set()
    const isTomb = typeof o.isTombstoned === 'function' ? o.isTombstoned : () => false
    const isHeld = typeof o.isHeld === 'function' ? o.isHeld : () => false
    const out = { edges: [], deferred: [], excluded: { dangling: 0, fresh: 0, reviewed: 0, held: 0 } }
    for (const [nb, edge] of o.adj?.get(note.id) || []) {
        if (!o.byId?.has(nb) || isTomb(nb)) {
            out.excluded.dangling++
            continue
        }
        if (reviewed.has(edge.id)) {
            out.excluded.reviewed++
            continue
        }
        if (isHeld(edge.id)) {
            out.excluded.held++
            continue
        }
        // 已以新內容判過＝邊時刻「晚於」本版本才排除;同一秒(時刻精度到秒)無法分先後 → 未能判定,照樣重評(寧多評一次,不漏評);
        //   無時刻者同理不排除(「≥ 版本即排除」會使同秒碰撞之邊漏評)
        const at = edgeTimeOf(edge)
        if (at && at > version) {
            out.excluded.fresh++
            continue
        }
        if (co.has(nb) && nb < note.id) {
            out.deferred.push(edge.id)
            continue
        }
        out.edges.push({ edge, nb })
    }
    return out
}

/**
 * 分頁:衝突在前 → 邊時刻新到舊 → 鄰居 id;每頁 size 條
 *
 * @param {Array} items 輸入 reviewEdgesOf 之 edges
 * @param {Integer} size 輸入每頁條數(正整數)
 * @param {String} conflictType 輸入衝突型之名
 * @returns {Array} 回傳頁陣列(每頁為 items 之子陣列)
 * @example
 * const items = [
 *     { edge: { id: 'e1', type: '甲', createdAt: 'T1' }, nb: 'a' },
 *     { edge: { id: 'e2', type: '衝突', createdAt: 'T0' }, nb: 'b' },
 *     { edge: { id: 'e3', type: '甲', createdAt: 'T3' }, nb: 'c' },
 * ]
 * console.log(pagesOf(items, 2, '衝突').map((page) => page.map((x) => x.nb).join('')))
 * // => [ 'bc', 'a' ]
 */
export function pagesOf(items, size, conflictType) {
    const at = (x) => edgeTimeOf(x.edge)
    const sorted = [...(isarr(items) ? items : [])].sort((a, b) => Number(b.edge.type === conflictType) - Number(a.edge.type === conflictType) || cmp(at(b), at(a)) || cmp(a.nb, b.nb))
    const n = Number.isInteger(size) && size > 0 ? size : 10
    const pages = []
    for (let i = 0; i < sorted.length; i += n) pages.push(sorted.slice(i, i + n))
    return pages
}

/**
 * 一席之回覆 → 項編號 → 該項之 verdicts:只採結構完整之項(index 為整數、verdicts 為陣列),同一 index 重複取第一個——與批次 AI 之調度
 *   (摘要套件之 runAiBatchStage)之部分接受同一規則;重評之第一、二席與第三席同讀此函數(各席同一取法——否則同一回覆會因席別而得不同之票)
 *
 * @param {*} data 輸入一席之回覆(非陣列視為空)
 * @returns {Map} 回傳 index → verdicts
 * @example
 * console.log(verdictsByIndexOf([{ index: 1, verdicts: 'x' }, { index: 1, verdicts: ['a'] }, { index: 1, verdicts: ['b'] }, { index: 2.5, verdicts: [] }]))
 * // => Map(1) { 1 => [ 'a' ] }
 */
export function verdictsByIndexOf(data) {
    const out = new Map()
    for (const it of isarr(data) ? data : []) {
        if (!Number.isInteger(it?.index) || !isarr(it?.verdicts) || out.has(it.index)) continue
        out.set(it.index, it.verdicts)
    }
    return out
}

/**
 * 單評之裁決驗證(逐條;單票之前段為 edgeCheckKit.baseVerdictOf——含「型別與理由皆同現行＝沒有改,視同 keep」;同型別而理由不同為理由更新;
 *   同一 to 之矛盾裁決作廢)
 *
 * @param {*} rawVerdicts 輸入模型回覆之 verdicts
 * @param {Array} page 輸入本頁 [{ edge, nb }]
 * @param {Object} o 輸入 { resolve:(raw)=>筆記 id|null(限本頁鄰居), relationTypes:Array, resolveType?:(raw)=>清單內型別|''(別名／改名對映;
 *        未給則只認清單內原樣), selfId }
 * @returns {Object} 回傳 { byEdge:Map(邊 id → { verdict, type?, reason }|PANEL_UNSURE), invalid:Number }(理由只去多餘空白、不截斷——寫入前由納入閘處置長度)
 * @example
 * const page = [{ edge: { id: 'e1', type: '甲', reason: '原本的理由原本的理由' }, nb: 'n2' }]
 * const raw = [{ to: 'n2', verdict: 'keep' }, { to: 'nX', verdict: 'keep' }]
 * const r = verdictsOf(raw, page, { resolve: (to) => (to === 'n2' ? 'n2' : null), relationTypes: ['甲'], selfId: 'n1' })
 * console.log(r.byEdge, r.invalid)
 * // => Map(1) { 'e1' => { verdict: 'keep', reason: '' } } 1
 */
export function verdictsOf(rawVerdicts, page, o = {}) {
    const resolve = typeof o.resolve === 'function' ? o.resolve : () => null
    const edgeOfNb = new Map((isarr(page) ? page : []).map((p) => [p.nb, p.edge]))
    const byEdge = new Map()
    const conflicted = new Set()
    let invalid = 0
    for (const v of isarr(rawVerdicts) ? rawVerdicts : []) {
        const nb = v && typeof v === 'object' ? resolve(v.to) : null
        const edge = nb && nb !== o.selfId ? edgeOfNb.get(nb) : null
        const rec = edge ? baseVerdictOf(v, { relationTypes: o.relationTypes, resolveType: o.resolveType, current: edge }) : null
        if (rec === null) {
            invalid++
            continue
        }
        const prev = byEdge.get(edge.id)
        const same = prev === rec || (prev && typeof prev === 'object' && typeof rec === 'object' && prev.verdict === rec.verdict && prev.type === rec.type)
        if (prev !== undefined && !same) conflicted.add(edge.id)
        else if (prev === undefined) byEdge.set(edge.id, rec)
    }
    for (const id of conflicted) {
        byEdge.delete(id)
        invalid++
    }
    return { byEdge, invalid }
}

/**
 * 判定小組之逐邊裁定(摘要套件之 decidePanel;兩席,有第三席之票者一併)
 *
 * @param {Array} page 輸入本頁 [{ edge, nb }]
 * @param {Array} seats 輸入 [{ seat, provider, byEdge:Map(verdictsOf().byEdge) }](第三席只含其所送之邊)
 * @returns {Array} 回傳 [{ edge, nb, votes, decided:Boolean, why:''|PANEL_WHY 之一, outcome?:'keep'|'change'|'retire', type?, reason?, a?, b?(成立之兩票) }]
 * @example
 * const page = [{ edge: { id: 'e1', type: '甲' }, nb: 'n2' }, { edge: { id: 'e2', type: '甲' }, nb: 'n3' }]
 * const keep = { verdict: 'keep', reason: '' }
 * const retire = { verdict: 'retire', reason: '兩者無實質關聯可言' }
 * const seats = [
 *     { seat: 'first', provider: 'A', byEdge: new Map([['e1', keep], ['e2', keep]]) },
 *     { seat: 'second', provider: 'B', byEdge: new Map([['e1', keep], ['e2', retire]]) },
 * ]
 * const r = decideOf(page, seats)
 * console.log(r.map((x) => `${x.edge.id}:${x.decided}:${x.why || x.outcome}`).join(' '))
 * // => e1:true:keep e2:false:disagree
 */
export function decideOf(page, seats) {
    return (isarr(page) ? page : []).map(({ edge, nb }) => {
        const votes = (isarr(seats) ? seats : []).filter((s) => s && (s.seat !== 'third' || s.byEdge?.has(edge.id))).map((s) => ({ seat: s.seat, provider: s.provider, verdict: s.byEdge?.has(edge.id) ? s.byEdge.get(edge.id) : null }))
        const d = decidePanel(votes, { same: sameEdgeVerdict })
        if (d.status !== 'decided') return { edge, nb, votes, decided: false, why: d.why }
        const pair = votes.filter((v) => d.seats.includes(v.seat))
        return { edge, nb, votes, decided: true, why: '', outcome: d.verdict.verdict, type: d.verdict.type, reason: d.verdict.reason, a: pair[0]?.verdict || null, b: pair[1]?.verdict || null }
    })
}

/**
 * 裁決之破壞級別:none(保留)｜additive(升為衝突、非衝突間改型、理由更新)｜destructive(撤銷、衝突降級)
 *
 * @param {Object} r 輸入 decideOf 之一項
 * @param {String} conflictType 輸入衝突型之名
 * @returns {String} 回傳級別
 * @example
 * const edge = { type: '甲' }
 * console.log(levelOf({ outcome: 'keep', edge }, '衝突'), levelOf({ outcome: 'change', edge, type: '衝突' }, '衝突'))
 * // => none additive
 * console.log(levelOf({ outcome: 'change', edge: { type: '衝突' }, type: '甲' }, '衝突'), levelOf({ outcome: 'retire', edge }, '衝突'))
 * // => destructive destructive
 */
export function levelOf(r, conflictType) {
    if (r.outcome === 'retire') return 'destructive'
    if (r.outcome !== 'change') return 'none'
    if (r.edge.type === conflictType && r.type !== conflictType) return 'destructive'
    return 'additive'
}

/**
 * 閘門是否允許套用該級別
 *
 * @param {*} apply 輸入 settings.relate.reeval.apply(false｜'additive'｜'all')
 * @param {String} level 輸入 levelOf 之回傳
 * @returns {Boolean} 回傳是否允許
 * @example
 * console.log(gateAllows(false, 'additive'), gateAllows('additive', 'additive'), gateAllows('additive', 'destructive'))
 * // => false true false
 * console.log(gateAllows('all', 'destructive'), gateAllows('all', 'none'))
 * // => true false
 */
export function gateAllows(apply, level) {
    if (level === 'none') return false
    if (apply === 'all') return true
    return apply === 'additive' && level === 'additive'
}

export default { REEVAL_REPROPOSE_DAYS, packIds, unpackIds, reviewEdgesOf, pagesOf, verdictsByIndexOf, verdictsOf, decideOf, levelOf, gateAllows }
