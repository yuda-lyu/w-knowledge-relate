// edgeStore.mjs — 關聯邊之身分、合併與寫入
//
// 【一對一條:無序對】id＝sha1(min|max)(字碼序,非 localeCompare);from／to＝勝出提案之方向(提案方向,非語意方向)。
//   一對只留一個結論(同一對兩說法即缺陷),敗方提案不丟——入 history。方向互逆之一致對(如 A 為 B 之前置、B 為 A 之延伸)不標爭議:
//   無型別之互逆表即無從判定是否矛盾,history 保留其另一說法。
// 【合併＝提案之全序】衝突恆勝 → 型別序(typeRankOf)→ createdAt 早者 → from → to → reason(皆字碼序)。勝出提案之
//   {from,to,type,reason,createdAt} 一起採用(提案原子)。提案集合＝雙方現值＋雙方 history,依身分(方向＋型別)各取全序最優。
// 【兩種模式】allowTypeChange:true(本輪新建之邊、遷移)＝完整全序:可交換、可結合、冪等,並行批次之完成順序
//   與遷移之處理順序不影響結果;false(跨輪再現)＝既有邊只升不改:只有「衝突勝非衝突」改寫,其餘以庫內為準、來者入 history。
//   代數性質只在完整全序模式成立。
// 【寫入:單次原子寫入＋回讀】更新走 patch(集合之 patch 於單次原子寫入內合併現值與新值;replace 為先刪後插之兩次寫入,
//   中途被砍即遺失真理邊)。合併對陣列依索引合併,正確之前提:①history 長度只增不減(新提案只新增身分或替換同身分之代表;
//   勝者換人時舊勝者入 history、新勝者之身分出 history)②每筆 history 鍵集固定、值皆字串(proposalOf)③頂層不需刪鍵。
//   寫後回讀比對;不符即 replace 再驗,仍不符拋錯(該項落 tries)。
// 【寫入互斥】「get → merge → 寫」以 createMutex 序列化(同一行程之並行批次);跨行程由執行鎖排除。
// 【history 浮上再驗(檢定標準 RS1／RS2／RS3)】會讓 history 條目成為現值者只有 mergeEdge 之完整全序模式
//   (勝出身分之最優代表可為雙方 history 之同身分條目);reviseEdge(現值＝已過閘之裁決提案,舊現值入 history)、renameEdgeTypes(現值留任、
//   只改型別名,與現值同身分之 history 移出而非升任)、只升不改模式(現值＝庫內現值或來者)皆不會。呼叫端給 o.admit(提案)=>Boolean 時,
//   浮上之條目須過之才成為現值;不過 → 以該身分之勝方提案本身(來者或庫內現值)為現值,未過者自 history 移出(同一身分只留一筆)。
// 【理由截短之明示(檢定標準 RS2)】現值之理由經納入閘於句界截短者,邊記 reasonCut＝原字數(整數);現值換成未截短之理由時
//   記 0(鍵一旦存在即保留,守住「頂層不刪鍵」之寫入前提)。只隨現值走,不入 history(history 鍵集固定);浮上之 history 條目一律記 0。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import pmKeyMutex from 'wsemi/src/pmKeyMutex.mjs'
import { sha1, strOf, cmp } from '../core/capturePackage.mjs'

/** 寫入互斥之鍵(本套件只序列化一種資源——邊集合;wsemi 之 pmKeyMutex 依鍵排隊,本套件以固定鍵包裝為單一互斥) */
const MUTEX_KEY = 'edges'

/**
 * 邊之身分:無序對雜湊
 *
 * @param {String} a 輸入一端筆記 id
 * @param {String} b 輸入另一端筆記 id
 * @returns {String} 回傳 sha1(min|max)
 * @example
 * console.log(edgeId('b', 'a') === edgeId('a', 'b'))
 * // => true
 */
export function edgeId(a, b) {
    const x = strOf(a)
    const y = strOf(b)
    return x < y ? sha1(`${x}|${y}`) : sha1(`${y}|${x}`)
}

/**
 * 建一條邊(提案;欄位一律字串)
 *
 * @param {Object} p 輸入 { from, to, type, reason, nowIso }
 * @returns {Object} 回傳 { id, from, to, type, reason, createdAt, updatedAt }
 * @example
 * const e = makeEdge({ from: 'b', to: 'a', type: '甲', reason: '理由', nowIso: 'T1' })
 * console.log(e.from, e.to, e.type, e.reason, e.createdAt, e.updatedAt, e.id === edgeId('a', 'b'))
 * // => b a 甲 理由 T1 T1 true
 */
export function makeEdge(p) {
    return { id: edgeId(p.from, p.to), from: strOf(p.from), to: strOf(p.to), type: strOf(p.type), reason: strOf(p.reason), createdAt: strOf(p.nowIso), updatedAt: strOf(p.nowIso) }
}

/**
 * 邊之時刻(一份;投影之排序與 related_at、重評與核對之分頁與挑邊同讀):updatedAt,缺則 createdAt;皆無為 ''
 *
 * @param {Object} e 輸入邊
 * @returns {String} 回傳時刻字串
 * @example
 * console.log(edgeTimeOf({ createdAt: 'T1', updatedAt: 'T2' }), edgeTimeOf({ createdAt: 'T1' }), edgeTimeOf(null))
 * // => T2 T1
 */
export function edgeTimeOf(e) {
    return strOf(e?.updatedAt || e?.createdAt)
}

/**
 * 型別序:衝突第一;其餘依 relationTypes 列序、fallbackType 殿後;不在清單者最後(同序)
 *
 * @param {Object} vocab 輸入詞彙表或關聯 domain(取 relationTypes、conflictType、fallbackType;domain 可直接給)
 * @returns {Function} 回傳 (type) => 序位(數字小者優先)
 * @example
 * const rank = typeRankOf({ relationTypes: ['甲', '乙', '丙'], conflictType: '衝突', fallbackType: '丙' })
 * console.log(rank('衝突'), rank('甲'), rank('乙'), rank('丙'), rank('未知'))
 * // => 0 1 2 3 4
 */
export function typeRankOf(vocab) {
    const types = isarr(vocab?.relationTypes) ? vocab.relationTypes : []
    const conflict = vocab?.conflictType
    const fallback = vocab?.fallbackType
    const seq = [conflict, ...types.filter((t) => t !== conflict && t !== fallback), fallback].filter((t) => isestr(t))
    const m = new Map(seq.map((t, i) => [t, i]))
    return (type) => (m.has(type) ? m.get(type) : seq.length)
}

/**
 * 提案之欄位(history 與比較用;值一律字串——patch 之 merge 不會以 undefined 覆寫舊值,見檔頭)
 *
 * @param {Object} e 輸入邊或提案
 * @returns {Object} 回傳 { from, to, type, reason, createdAt }
 */
const proposalOf = (e) => ({ from: strOf(e.from), to: strOf(e.to), type: strOf(e.type), reason: strOf(e.reason), createdAt: strOf(e.createdAt) })
const idKey = (p) => `${p.from}|${p.to}|${p.type}`
const histOf = (e) => (isarr(e?.history) ? e.history.filter(isobj).map(proposalOf) : [])
/**
 * 同身分(from|to|type)各取全序最優之代表(合併、裁決改寫、型別改名同一規則;與合併順序無關);skipKey 之身分不收
 * @param {Array} proposals 輸入提案陣列(proposalOf 之形)
 * @param {Function} rank 輸入型別序
 * @param {String} [skipKey=''] 輸入不收之身分鍵
 * @returns {Map} 回傳 身分鍵 → 代表提案
 */
function bestByIdentity(proposals, rank, skipKey = '') {
    const best = new Map()
    for (const p of proposals) {
        const k = idKey(p)
        if (k === skipKey) continue
        if (!best.has(k) || compareProposals(p, best.get(k), rank) < 0) best.set(k, p)
    }
    return best
}
/** 代表集合去掉勝方身分、依全序排成 history */
const historyOf = (best, winKey, rank) => [...best.entries()].filter(([k]) => k !== winKey).map(([, p]) => p).sort((a, b) => compareProposals(a, b, rank))
/** 現值理由之截短原字數(檔頭【理由截短之明示】;非正整數＝未截短) */
const cutOf = (e) => (Number.isInteger(e?.reasonCut) && e.reasonCut > 0 ? e.reasonCut : 0)
/**
 * 新現值之 reasonCut:有截短 → 原字數;未截短而舊值已有此鍵 → 0(頂層不刪鍵);皆無 → 不加鍵
 * @param {Object} out 輸入(並就地修改)新現值
 * @param {Object} stored 輸入庫內之舊值
 * @param {Integer} cut 輸入新現值之截短原字數
 * @returns {Object} 回傳 out
 */
const withCut = (out, stored, cut) => {
    if (cut || Object.hasOwn(isobj(stored) ? stored : {}, 'reasonCut')) out.reasonCut = cut
    return out
}

/**
 * 兩提案之全序比較:回傳負數＝a 勝
 *
 * @param {Object} a 輸入提案
 * @param {Object} b 輸入提案
 * @param {Function} rank 輸入型別序(typeRankOf 之產物)
 * @returns {Number} 回傳比較值(0＝同一提案)
 * @example
 * const rank = typeRankOf({ relationTypes: ['甲', '乙'], conflictType: '衝突' })
 * const a = { from: 'a', to: 'b', type: '衝突', reason: 'r', createdAt: 'T2' }
 * const b = { from: 'a', to: 'b', type: '甲', reason: 'r', createdAt: 'T1' }
 * console.log(compareProposals(a, b, rank) < 0, compareProposals(b, a, rank) > 0, compareProposals(a, a, rank))
 * // => true true 0
 */
export function compareProposals(a, b, rank) {
    return rank(a.type) - rank(b.type) || cmp(strOf(a.createdAt), strOf(b.createdAt)) || cmp(strOf(a.from), strOf(b.from)) || cmp(strOf(a.to), strOf(b.to)) || cmp(strOf(a.reason), strOf(b.reason))
}

/**
 * 物件之正規化字串(鍵排序,陣列保序;比對用——JSON.stringify 受鍵序影響)
 *
 * @param {*} v 輸入值
 * @returns {String} 回傳正規化字串
 */
function canon(v) {
    if (isarr(v)) return `[${v.map(canon).join(',')}]`
    if (isobj(v)) return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
    return JSON.stringify(v)
}

/**
 * 兩邊是否逐欄相同(鍵序無關)
 *
 * @param {Object} a 輸入邊
 * @param {Object} b 輸入邊
 * @returns {Boolean} 回傳是否相同
 * @example
 * console.log(sameEdge({ a: 1, b: 2 }, { b: 2, a: 1 }), sameEdge({ a: 1 }, { a: 2 }), sameEdge(null, null))
 * // => true false false
 */
export function sameEdge(a, b) {
    return isobj(a) && isobj(b) && canon(a) === canon(b)
}

/**
 * 合併同一無序對之既有邊與來者提案
 *
 * @param {Object|null} stored 輸入庫內之邊(無則 null)
 * @param {Object} incoming 輸入來者(makeEdge 之產物,或帶 history 之邊)
 * @param {Object} o 輸入 { rank, conflictType, allowTypeChange=true, admit?:(提案)=>Boolean(浮上之 history 條目之再驗;檔頭【history 浮上再驗】) }
 * @returns {Object} 回傳 { edge, changed(任何欄位變), visibleChanged(from／to／type／reason 變), created, upgradedToConflict, surfaceRejected(浮上未過再驗) }
 * @example
 * const rank = typeRankOf({ relationTypes: ['甲', '乙'], conflictType: '衝突' })
 * const stored = makeEdge({ from: 'a', to: 'b', type: '乙', reason: '舊理由', nowIso: 'T1' })
 * const incoming = makeEdge({ from: 'b', to: 'a', type: '衝突', reason: '新理由', nowIso: 'T2' })
 * const r = mergeEdge(stored, incoming, { rank, conflictType: '衝突' })
 * console.log(r.edge.type, r.edge.from, r.edge.updatedAt, r.upgradedToConflict, r.edge.history.map((h) => h.type))
 * // => 衝突 b T2 true [ '乙' ]
 * console.log(mergeEdge(null, incoming, { rank }).created, mergeEdge(stored, stored, { rank }).changed)
 * // => true false
 */
export function mergeEdge(stored, incoming, o = {}) {
    const rank = typeof o.rank === 'function' ? o.rank : () => 0
    if (!isobj(stored)) {
        const edge = { ...incoming, ...proposalOf(incoming), id: edgeId(incoming.from, incoming.to), updatedAt: edgeTimeOf(incoming) }
        const h = histOf(incoming)
        if (h.length) edge.history = h.sort((a, b) => compareProposals(a, b, rank))
        else delete edge.history
        return { edge, changed: true, visibleChanged: true, created: true, upgradedToConflict: false, surfaceRejected: false }
    }
    const conflict = o.conflictType
    const allow = o.allowTypeChange !== false
    const sp = proposalOf(stored)
    const ip = proposalOf(incoming)
    const storedConflict = sp.type === conflict
    const inConflict = ip.type === conflict
    let incomingWins
    if (inConflict && !storedConflict) incomingWins = true // 衝突恆勝(跨輪亦然:升級)
    else if (!allow) incomingWins = false // 既有邊只升不改
    else incomingWins = compareProposals(ip, sp, rank) < 0
    // 提案集合＝雙方現值＋雙方 history,依身分去重、各取全序最優(與合併順序、括號位置無關)
    const best = bestByIdentity([sp, ...histOf(stored), ip, ...histOf(incoming)], rank)
    const winner = incomingWins ? ip : sp
    const winKey = idKey(winner)
    // 完整全序取該身分之最優代表;只升不改模式保留庫內現值(來者同身分之較早提案不改寫)
    let win = allow ? best.get(winKey) : winner
    // 浮上之 history 條目(非雙方現值)再驗(檔頭【history 浮上再驗】):不過 → 該身分以勝方提案本身為代表,未過者不升任
    const surfaced = canon(win) !== canon(ip) && canon(win) !== canon(sp)
    const surfaceRejected = surfaced && typeof o.admit === 'function' && !o.admit(win)
    if (surfaceRejected) win = winner
    const history = historyOf(best, winKey, rank)
    const { history: _h, ...rest } = stored
    const winnerIsStored = canon(win) === canon(sp)
    const edge = {
        ...rest,
        ...win,
        id: stored.id,
        ...(history.length ? { history } : {}),
        updatedAt: winnerIsStored ? edgeTimeOf(stored) : edgeTimeOf(incoming),
    }
    // reasonCut 隨現值走(檔頭【理由截短之明示】):現值為庫內現值 → 沿用;為來者 → 取來者;浮上之 history 條目 → 0
    withCut(edge, stored, winnerIsStored ? cutOf(stored) : (canon(win) === canon(ip) ? cutOf(incoming) : 0))
    const visibleChanged = ['from', 'to', 'type', 'reason'].some((k) => edge[k] !== strOf(stored[k]))
    return { edge, changed: !sameEdge(edge, stored), visibleChanged, created: false, upgradedToConflict: incomingWins && inConflict && !storedConflict, surfaceRejected }
}

/**
 * 裁決之改型／理由更新(重評、衝突核對、既有邊覆核):以裁決提案為新現值,與 mergeEdge 同一身分集合語意——
 *   新勝者之身分自 history 移出、舊勝者入 history、同身分取全序最優;history 長度不減(檔頭寫入前提①),updatedAt＝提案時刻。
 *   同方向同型別之理由更新:身分相同,舊理由不入 history(由重評帳 relate-reeval.jsonl 留存變更前之邊值)。
 *
 * @param {Object} stored 輸入庫內之邊
 * @param {Object} proposal 輸入裁決提案(makeEdge 之產物:from＝被重評之筆記;納入閘截短理由者另帶 reasonCut)
 * @param {Object} [o={}] 輸入 { rank }
 * @returns {Object} 回傳新邊值(id 不變;reasonCut 依提案,檔頭【理由截短之明示】)
 * @example
 * const rank = typeRankOf({ relationTypes: ['甲', '乙'], conflictType: '衝突' })
 * const stored = makeEdge({ from: 'a', to: 'b', type: '乙', reason: '舊理由', nowIso: 'T1' })
 * const proposal = makeEdge({ from: 'a', to: 'b', type: '甲', reason: '新理由', nowIso: 'T3' })
 * const e = reviseEdge(stored, proposal, { rank })
 * console.log(e.type, e.reason, e.updatedAt, e.history.map((h) => h.type + ':' + h.reason))
 * // => 甲 新理由 T3 [ '乙:舊理由' ]
 */
export function reviseEdge(stored, proposal, o = {}) {
    const rank = typeof o.rank === 'function' ? o.rank : () => 0
    const win = proposalOf(proposal)
    const winKey = idKey(win)
    const history = historyOf(bestByIdentity([proposalOf(stored), ...histOf(stored)], rank, winKey), winKey, rank)
    const { history: _h, ...rest } = stored
    return withCut({ ...rest, ...win, id: stored.id, ...(history.length ? { history } : {}), updatedAt: edgeTimeOf(proposal) }, stored, cutOf(proposal))
}

/**
 * 型別改名之機械改寫(檢定標準 RS1′;詞彙表 relationTypeRenames):現值與 history 之型別依對照改名;id 不變、updatedAt 不動
 *   (改名不是內容變更,重評以 updatedAt 挑邊)。現值恆為原現值(只換型別名;理由與 reasonCut 不變)——改名後與現值同身分之 history
 *   移出而「不升任」為現值(故不會讓 history 之舊理由浮上),history 之間同身分者取全序最優;
 *   history 因此變短時由 writeEdge 之 replace 路徑落庫。
 *
 * @param {Object} edge 輸入庫內之邊
 * @param {Function} renamed 輸入 (type) => 改名後之型別｜''(非改名表之舊名回 '')
 * @param {Object} [o={}] 輸入 { rank }
 * @returns {Object|null} 回傳改寫後之邊;無須改寫回 null
 * @example
 * const edge = makeEdge({ from: 'a', to: 'b', type: '舊型', reason: '理由', nowIso: 'T1' })
 * const renamed = (t) => (t === '舊型' ? '新型' : '')
 * const e = renameEdgeTypes(edge, renamed)
 * console.log(e.type, e.updatedAt, e.id === edge.id)
 * // => 新型 T1 true
 * console.log(renameEdgeTypes(e, renamed))
 * // => null
 */
export function renameEdgeTypes(edge, renamed, o = {}) {
    const rank = typeof o.rank === 'function' ? o.rank : () => 0
    const to = (t) => {
        const r = typeof renamed === 'function' ? renamed(t) : ''
        return r && r !== t ? r : t
    }
    const cur = proposalOf(edge)
    const hist = histOf(edge)
    const win = { ...cur, type: to(cur.type) }
    const hs = hist.map((h) => ({ ...h, type: to(h.type) }))
    if (win.type === cur.type && hs.every((h, i) => h.type === hist[i].type)) return null
    const winKey = idKey(win)
    const history = historyOf(bestByIdentity(hs, rank, winKey), winKey, rank)
    const { history: _h, ...rest } = edge
    return { ...rest, ...win, id: edge.id, ...(history.length ? { history } : {}), updatedAt: edgeTimeOf(edge) }
}

/**
 * 依 domain 之型別改名表之機械改寫(每輪維護與撤銷刪除同一規則):改名表宣告之舊型別 → resolveType 之新型別;現值與 history 一併改寫
 *   (id、updatedAt 不動)。不在改名表之型別原樣(未宣告之改名或移除不由程式猜——交 RS1 掃描與既有邊覆核)
 *
 * @param {Object} domain 輸入關聯 domain(取 relationTypeRenames、resolveType、relationTypes、conflictType、fallbackType)
 * @returns {Function|null} 回傳 (edge) => 改寫後之邊|null(無須改寫);改名表為空回 null
 * @example
 * const domain = { relationTypes: ['新型'], conflictType: '衝突', relationTypeRenames: { 舊型: '新型' }, resolveType: (t) => (t === '舊型' ? '新型' : '') }
 * const rename = domainTypeRenamerOf(domain)
 * const edge = makeEdge({ from: 'a', to: 'b', type: '舊型', reason: '理由', nowIso: 'T1' })
 * console.log(rename(edge).type, rename(rename(edge)), domainTypeRenamerOf({ relationTypes: ['新型'] }))
 * // => 新型 null null
 */
export function domainTypeRenamerOf(domain) {
    const renames = isobj(domain?.relationTypeRenames) ? domain.relationTypeRenames : {}
    if (!Object.keys(renames).length) return null
    const rank = typeRankOf(domain)
    const renamed = (t) => (Object.hasOwn(renames, t) ? domain.resolveType(t) : '')
    return (edge) => renameEdgeTypes(edge, renamed, { rank })
}

/**
 * 行程內互斥:同一時間只有一個 fn 在跑(序列化寫入;FIFO、某次之例外只回該次呼叫者、不擋後續)——wsemi 之 pmKeyMutex 以固定鍵包裝
 *
 * @returns {Function} 回傳 (fn) => Promise(fn 之回傳)
 * @example
 * const run = createMutex()
 * const order = []
 * await Promise.all([
 *     run(async () => {
 *         await new Promise((resolve) => setTimeout(resolve, 20))
 *         order.push('先')
 *     }),
 *     run(async () => {
 *         order.push('後')
 *     }),
 * ])
 * console.log(order.join(','))
 * // => 先,後
 */
export function createMutex() {
    const run = pmKeyMutex()
    return (fn) => run(MUTEX_KEY, fn)
}

/**
 * 更新一條既有邊:patch(單次原子寫入之合併)→ 回讀比對;不符即 replace 再驗
 *
 * @param {Object} relations 輸入邊集合(get／patch／replace)
 * @param {Object} edge 輸入目標值(mergeEdge 之 edge)
 * @returns {Promise} 回傳 Promise，resolve 無回傳值
 * @throws {Error} replace 後回讀仍不符時拋出
 * @example
 * const m = new Map()
 * const relations = {
 *     get: async (id) => m.get(id) ?? null,
 *     patch: async (id, v) => { m.set(id, { ...m.get(id), ...v }) },
 *     replace: async (r) => { m.set(r.id, r) },
 * }
 * const edge = makeEdge({ from: 'a', to: 'b', type: '甲', reason: '理由', nowIso: 'T1' })
 * m.set(edge.id, edge)
 * await writeEdge(relations, { ...edge, reason: '新理由' })
 * console.log((await relations.get(edge.id)).reason)
 * // => 新理由
 */
export async function writeEdge(relations, edge) {
    await relations.patch(edge.id, edge)
    if (sameEdge(await relations.get(edge.id), edge)) return
    await relations.replace(edge)
    if (!sameEdge(await relations.get(edge.id), edge)) throw new Error(`關聯邊 ${edge.id} 寫入後回驗不符`)
}

/**
 * 寫入一條提案:get → mergeEdge → insertNew｜patch(回讀驗證);呼叫端以 createMutex 包住
 *
 * @param {Object} relations 輸入邊集合(get／insertNew／patch／replace)
 * @param {Object} incoming 輸入來者提案(makeEdge 之產物)
 * @param {Object} o 輸入 mergeEdge 之選項
 * @returns {Promise} 回傳 Promise，resolve 回傳 mergeEdge 之結果(edge 為落庫後之值)
 * @throws {Error} 寫入後回驗不符時拋出
 * @example
 * const m = new Map()
 * const relations = {
 *     get: async (id) => m.get(id) ?? null,
 *     insertNew: async (rows) => { rows.forEach((r) => m.set(r.id, r)); return { addCount: rows.length } },
 *     patch: async (id, v) => { m.set(id, { ...m.get(id), ...v }) },
 *     replace: async (r) => { m.set(r.id, r) },
 * }
 * const first = makeEdge({ from: 'a', to: 'b', type: '甲', reason: '理由', nowIso: 'T1' })
 * const r1 = await persistEdge(relations, first, {})
 * const r2 = await persistEdge(relations, first, {})
 * console.log(r1.created, r1.changed, r2.created, r2.changed, m.size)
 * // => true true false false 1
 */
export async function persistEdge(relations, incoming, o = {}) {
    const stored = await relations.get(incoming.id)
    const r = mergeEdge(stored, incoming, o)
    if (!r.changed) return r
    if (r.created) {
        const ins = await relations.insertNew([r.edge])
        if (ins.addCount === 1) {
            if (!sameEdge(await relations.get(r.edge.id), r.edge)) throw new Error(`關聯邊 ${r.edge.id} 新增後回驗不符`)
            return r
        }
        // 他處先插入(互斥內不應發生;跨行程由執行鎖排除):以庫內為準再合併一次
        const again = mergeEdge(await relations.get(incoming.id), incoming, o)
        if (again.changed) await writeEdge(relations, again.edge)
        return again
    }
    await writeEdge(relations, r.edge)
    return r
}

/**
 * 鄰接表:id → Map(鄰居 id → 邊)
 *
 * @param {Array} edges 輸入邊陣列
 * @returns {Map} 回傳鄰接表
 * @example
 * const adj = buildAdjacency([
 *     { id: 'e1', from: 'a', to: 'b', type: '甲' },
 *     { id: 'e2', from: 'b', to: 'c', type: '乙' },
 * ])
 * console.log([...adj.keys()], [...adj.get('b').keys()], adj.get('a').get('b').id)
 * // => [ 'a', 'b', 'c' ] [ 'a', 'c' ] e1
 */
export function buildAdjacency(edges) {
    const adj = new Map()
    for (const e of isarr(edges) ? edges : []) addToAdjacency(adj, e)
    return adj
}

/**
 * 鄰接表加入或更新一條邊(兩端)
 *
 * @param {Map} adj 輸入鄰接表
 * @param {Object} e 輸入邊
 * @returns {undefined} 無回傳值(就地修改 adj)
 * @example
 * const adj = new Map()
 * addToAdjacency(adj, { id: 'e1', from: 'a', to: 'b' })
 * console.log(adj.get('a').get('b').id, adj.get('b').get('a').id, adj.size)
 * // => e1 e1 2
 */
export function addToAdjacency(adj, e) {
    for (const [x, y] of [[e.from, e.to], [e.to, e.from]]) {
        if (!adj.has(x)) adj.set(x, new Map())
        adj.get(x).set(y, e)
    }
}

/**
 * 鄰接表移除一條邊(兩端)
 *
 * @param {Map} adj 輸入鄰接表
 * @param {Object} e 輸入邊
 * @returns {undefined} 無回傳值(就地修改 adj;兩端之鄰居項移除，端點的空 Map 仍保留)
 * @example
 * const adj = new Map()
 * const e = { id: 'e1', from: 'a', to: 'b' }
 * addToAdjacency(adj, e)
 * removeFromAdjacency(adj, e)
 * console.log(adj.get('a').size, adj.get('b').size)
 * // => 0 0
 */
export function removeFromAdjacency(adj, e) {
    adj.get(e.from)?.delete(e.to)
    adj.get(e.to)?.delete(e.from)
}

/**
 * 某篇之衝突鄰居集合(候選排除用:已是衝突者無可升級)
 *
 * @param {Map} adj 輸入鄰接表
 * @param {String} id 輸入筆記 id
 * @param {String} conflictType 輸入衝突型之名
 * @returns {Set} 回傳衝突鄰居 id 集合
 * @example
 * const adj = buildAdjacency([
 *     { id: 'e1', from: 'a', to: 'b', type: '衝突' },
 *     { id: 'e2', from: 'a', to: 'c', type: '甲' },
 * ])
 * console.log(conflictNeighborsOf(adj, 'a', '衝突'), conflictNeighborsOf(adj, 'x', '衝突').size)
 * // => Set(1) { 'b' } 0
 */
export function conflictNeighborsOf(adj, id, conflictType) {
    const out = new Set()
    for (const [nb, e] of adj.get(id) || []) if (e.type === conflictType) out.add(nb)
    return out
}

/**
 * 邊庫世代檢核:id 不等於無序對雜湊者之筆數(>0＝未遷移之有序對庫;新碼寫入前須 fail-closed)
 *
 * @param {Array} edges 輸入邊陣列
 * @returns {Number} 回傳不符筆數
 * @example
 * const good = makeEdge({ from: 'a', to: 'b', type: '甲', reason: 'r', nowIso: 'T1' })
 * console.log(generationMismatchOf([good, { ...good, id: 'old-ordered-pair-id' }]), generationMismatchOf([]))
 * // => 1 0
 */
export function generationMismatchOf(edges) {
    let n = 0
    for (const e of isarr(edges) ? edges : []) if (e?.id !== edgeId(e?.from, e?.to)) n++
    return n
}

export default { edgeId, makeEdge, edgeTimeOf, typeRankOf, compareProposals, sameEdge, mergeEdge, reviseEdge, renameEdgeTypes, domainTypeRenamerOf, createMutex, writeEdge, persistEdge, buildAdjacency, addToAdjacency, removeFromAdjacency, conflictNeighborsOf, generationMismatchOf }
