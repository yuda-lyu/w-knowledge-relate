// relateLedgers.mjs — 關聯段之持久帳(皆在 dirs.state 下,原子寫):待投影(dirty)、反向待處理對、狀態(總覽待重建)、
//   刪除墓碑、稽核紀錄
//
// 【缺檔與壞檔分流】缺檔＝空帳;壞檔(JSON 解析失敗或錯形狀——逐帳驗結構)＝隔離為 <檔>.corrupt-<時戳>、經 onCorrupt 告警(日誌「關聯帳檔損壞」,
//   字樣只一份 ledgerCorruptTextOf,外部巡檢必看)、以空帳續跑——不可把壞檔當空帳而在下次寫入時無聲覆蓋(通用之 readJson 對缺檔與壞檔回同一
//   fallback,故本檔自行分流)。隔離失敗不假稱成功:告警明寫「隔離失敗」(壞檔仍在原位);關鍵帳(墓碑)壞而無法隔離即拒(以空帳續行會讓已刪之筆記
//   被重新收件)。讀取本身失敗(權限等)即拋錯:寫入大概率同樣失敗,不假裝成功。
// 【預演不開帳】開帳會隔離壞檔,預演(dryRun、非 apply)之路徑一律唯讀直讀(墓碑 stores/deletions 之 openDeletions、稽核 readAuditRows),不經本檔開帳。
// 【寫入即落檔】add／remove 即時原子寫;空帳刪檔(不留空殼)。JSONL 帳(稽核、裁決紀錄)之讀寫為抓取套件之共用件。

import fs from 'fs'
import path from 'path'
import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { writeFileAtomic, oneline, readJsonlRows, appendJsonlRow, cmp } from '../core/capturePackage.mjs'
import { DELETION_FILES } from '../stores/deletions.mjs'
import { CONFLICT_EVENT_FILE } from '../stores/conflictEvents.mjs'
import { EDGE_AUDIT_FILE } from '../stores/edgeAudit.mjs'
import { RELATE_API_HINT } from './relateHolds.mjs'

/** 帳檔名(皆在 dirs.state 下) */
export const LEDGER_FILES = {
    dirty: 'relate-dirty.json',
    reverse: 'relate-reverse.json',
    state: 'relate-state.json',
    tombstones: DELETION_FILES.tombstones, // 刪除紀錄之檔名只定義一次(stores/deletions;下游亦讀之)
    retired: EDGE_AUDIT_FILE, // 撤出稽核(下游讀之為撤銷之證據;stores/edgeAudit,檔名只定義一次)
    archive: DELETION_FILES.archive,
    manual: 'relate-manual',
    reeval: 'relate-reeval.jsonl', // 重評之裁決紀錄(候選／套用／不一致／同一家／陳舊;append-only,含變更前之邊值)
    conflictCheck: 'relate-conflict-check.jsonl', // 衝突核對(檢定標準 RS4)之裁決紀錄(入口、各票含供應者、結果、寫入值;append-only)
    edgeReview: 'relate-edge-review.jsonl', // 既有邊覆核(檢定標準 RS6)之裁決紀錄(入口、各票含供應者、結果、寫入值;append-only)
    conflictEvents: CONFLICT_EVENT_FILE, // 衝突撤銷／降級事件(下游讀;stores/conflictEvents)
}

/**
 * 讀 JSON 帳檔並分流
 *
 * @param {String} file 輸入檔案路徑
 * @param {Object} [o={}] 輸入 { onCorrupt:(info)=>void, stamp:String(隔離檔名之時戳), shape:(data)=>String(結構之問題,'' 為合格;錯形狀＝壞檔),
 *   critical:Boolean(關鍵帳——壞而無法隔離即拒,不以空帳續行), quarantine:Boolean(預設 true;false＝唯讀讀法:壞檔不改名、不拋,只經 onCorrupt 回報
 *   { movedTo:null, readOnly:true }——預演、掃描、預覽、驗證等純讀入口用,讀到壞帳不得修改檔案;下游套件之 JSON 帳同讀本函數) }
 * @returns {Object|null} 回傳解析後之資料(缺檔或壞檔為 null)
 * @throws {Error} 讀取失敗(非缺檔)、關鍵帳壞而無法隔離時拋出(唯讀讀法不拋)
 * @example
 * const { mkdtempSync, writeFileSync, existsSync, rmSync } = await import('fs')
 * const { join } = await import('path')
 * const { tmpdir } = await import('os')
 * const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
 * const file = join(dir, 'relate-dirty.json')
 * console.log(loadLedgerJson(file))
 * // => null
 * writeFileSync(file, '{"ids":["n1"]}', 'utf8')
 * console.log(loadLedgerJson(file))
 * // => { ids: [ 'n1' ] }
 * writeFileSync(file, '壞掉的檔', 'utf8')
 * const seen = []
 * const data = loadLedgerJson(file, { stamp: '1', onCorrupt: (info) => seen.push(info.movedTo !== null) })
 * console.log(data, seen, existsSync(file), existsSync(`${file}.corrupt-1`))
 * // => null [ true ] false true
 * rmSync(dir, { recursive: true, force: true })
 */
export function loadLedgerJson(file, o = {}) {
    let text
    try {
        text = fs.readFileSync(file, 'utf8')
    }
    catch (e) {
        if (e.code === 'ENOENT') return null
        throw new Error(`關聯帳檔讀取失敗（${path.basename(file)}）：${e.message}`)
    }
    let error = ''
    let data = null
    try {
        data = JSON.parse(text)
        error = typeof o.shape === 'function' ? String(o.shape(data) || '') : ''
    }
    catch (e) {
        error = e.message
    }
    if (!error) return data
    // 唯讀讀法:不改名、不拋,只回報(純讀入口不得因讀到壞帳而修改檔案)
    if (o.quarantine === false) {
        if (typeof o.onCorrupt === 'function') o.onCorrupt({ file, movedTo: null, error, readOnly: true })
        return null
    }
    // 壞檔(解析失敗或錯形狀):隔離為 .corrupt-<時戳> 並告警;隔離失敗如實告知(movedTo:null、quarantineError),關鍵帳即拒
    const to = `${file}.corrupt-${o.stamp || Date.now()}`
    let moved = null
    let quarantineError = ''
    try {
        fs.renameSync(file, to)
        moved = to
    }
    catch (e) {
        quarantineError = e.message
    }
    if (!moved && o.critical === true) throw new Error(`關聯帳檔損壞且無法隔離（${path.basename(file)}：${error}；隔離失敗：${quarantineError}）——拒寫`)
    if (typeof o.onCorrupt === 'function') o.onCorrupt({ file, movedTo: moved, error, ...(moved ? {} : { quarantineError }) })
    return null
}

/**
 * 寫 JSON 帳檔(原子;data 為 null 即刪檔)
 *
 * @param {String} file 輸入檔案路徑
 * @param {*} data 輸入資料
 */
function saveLedgerJson(file, data) {
    if (data === null) {
        fs.rmSync(file, { force: true })
        return
    }
    writeFileAtomic(file, JSON.stringify(data))
}

/**
 * 待投影帳(筆記 id 集合)
 *
 * @param {String} file 輸入帳檔路徑(dirs.state/relate-dirty.json)
 * @param {Object} [o={}] 輸入 loadLedgerJson 之選項
 * @returns {Object} 回傳 { ids():Array, has(id), size(), add(ids), remove(ids) }
 * @example
 * const { mkdtempSync, existsSync, rmSync } = await import('fs')
 * const { join } = await import('path')
 * const { tmpdir } = await import('os')
 * const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
 * const file = join(dir, 'relate-dirty.json')
 * const ledger = createDirtyLedger(file)
 * ledger.add(['n2', 'n1', 'n1'])
 * console.log(ledger.ids(), ledger.has('n1'), ledger.size())
 * // => [ 'n1', 'n2' ] true 2
 * console.log(createDirtyLedger(file).ids())
 * // => [ 'n1', 'n2' ]
 * ledger.remove(['n1', 'n2'])
 * console.log(ledger.size(), existsSync(file))
 * // => 0 false
 * rmSync(dir, { recursive: true, force: true })
 */
export function createDirtyLedger(file, o = {}) {
    const raw = loadLedgerJson(file, { ...o, shape: (d) => (isobj(d) && isarr(d.ids) ? '' : '結構應為 { ids:[筆記 id] }') })
    const set = new Set(isarr(raw?.ids) ? raw.ids.filter(isestr) : [])
    const save = () => saveLedgerJson(file, set.size ? { ids: [...set].sort(cmp) } : null)
    return {
        ids: () => [...set].sort(cmp),
        has: (id) => set.has(id),
        size: () => set.size,
        add: (ids) => {
            const before = set.size
            for (const id of ids || []) if (isestr(id)) set.add(id)
            if (set.size !== before) save()
        },
        remove: (ids) => {
            const before = set.size
            for (const id of ids || []) set.delete(id)
            if (set.size !== before) save()
        },
    }
}

/**
 * 反向待處理對帳:[{ o(舊筆記), n(新筆記), score, at(入帳時刻), tries }];同一對只留一筆。add 為新入帳(tries 歸零);restore 為原樣放回
 *   (撤銷刪除時放回封存之對,含 tries;已有者不動)
 *
 * @param {String} file 輸入帳檔路徑(dirs.state/relate-reverse.json)
 * @param {Object} [o={}] 輸入 loadLedgerJson 之選項
 * @returns {Object} 回傳 { pairs():Array(副本), size(), add(pairs), restore(pairs)→Integer(放回之對數), remove(pred), bump(pairs) }
 * @example
 * const { mkdtempSync, rmSync } = await import('fs')
 * const { join } = await import('path')
 * const { tmpdir } = await import('os')
 * const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
 * const ledger = createReverseLedger(join(dir, 'relate-reverse.json'))
 * ledger.add([{ o: 'old', n: 'new', score: 21, at: 'T1' }])
 * ledger.bump([{ o: 'old', n: 'new' }])
 * console.log(ledger.pairs())
 * // => [ { o: 'old', n: 'new', score: 21, at: 'T1', tries: 1 } ]
 * console.log(ledger.restore([{ o: 'old', n: 'new', tries: 5 }, { o: 'a', n: 'b', score: 11, at: 'T2', tries: 2 }]), ledger.size())
 * // => 1 2
 * ledger.remove((p) => p.tries >= 2)
 * console.log(ledger.pairs().map((p) => `${p.o}>${p.n}`))
 * // => [ 'old>new' ]
 * rmSync(dir, { recursive: true, force: true })
 */
export function createReverseLedger(file, o = {}) {
    const raw = loadLedgerJson(file, { ...o, shape: (d) => (isobj(d) && isarr(d.pairs) ? '' : '結構應為 { pairs:[反向待處理對] }') })
    const map = new Map()
    for (const p of isarr(raw?.pairs) ? raw.pairs : []) {
        if (isobj(p) && isestr(p.o) && isestr(p.n)) map.set(`${p.o}|${p.n}`, { o: p.o, n: p.n, score: Number(p.score) || 0, at: String(p.at || ''), tries: Number(p.tries) || 0 })
    }
    const save = () => saveLedgerJson(file, map.size ? { pairs: [...map.values()].sort((a, b) => cmp(a.o, b.o) || cmp(a.n, b.n)) } : null)
    return {
        pairs: () => [...map.values()].map((p) => ({ ...p })),
        size: () => map.size,
        add: (pairs) => {
            let changed = false
            for (const p of pairs || []) {
                const k = `${p.o}|${p.n}`
                if (map.has(k)) continue
                map.set(k, { o: p.o, n: p.n, score: Number(p.score) || 0, at: String(p.at || ''), tries: 0 })
                changed = true
            }
            if (changed) save()
        },
        restore: (pairs) => {
            let n = 0
            for (const p of pairs || []) {
                if (!isobj(p) || !isestr(p.o) || !isestr(p.n)) continue
                const k = `${p.o}|${p.n}`
                if (map.has(k)) continue
                map.set(k, { o: p.o, n: p.n, score: Number(p.score) || 0, at: String(p.at || ''), tries: Number(p.tries) || 0 })
                n++
            }
            if (n) save()
            return n
        },
        remove: (pred) => {
            let changed = false
            for (const [k, p] of map) {
                if (pred(p)) {
                    map.delete(k)
                    changed = true
                }
            }
            if (changed) save()
        },
        bump: (pairs) => {
            let changed = false
            for (const p of pairs || []) {
                const cur = map.get(`${p.o}|${p.n}`)
                if (cur) {
                    cur.tries++
                    changed = true
                }
            }
            if (changed) save()
        },
    }
}

/**
 * 關聯狀態(總覽待重建旗標:內容變更、刪除 op 等無新邊或管線外之事件所設,relationIndex 重建成功後清)
 *
 * @param {String} file 輸入檔案路徑(dirs.state/relate-state.json)
 * @param {Object} [o={}] 輸入 loadLedgerJson 之選項
 * @returns {Object} 回傳 { get():{indexDirty}, set(patch) }
 * @example
 * const { mkdtempSync, rmSync } = await import('fs')
 * const { join } = await import('path')
 * const { tmpdir } = await import('os')
 * const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
 * const file = join(dir, 'relate-state.json')
 * const state = createRelateState(file)
 * console.log(state.get())
 * // => { indexDirty: false }
 * state.set({ indexDirty: true })
 * console.log(createRelateState(file).get())
 * // => { indexDirty: true }
 * rmSync(dir, { recursive: true, force: true })
 */
export function createRelateState(file, o = {}) {
    const raw = loadLedgerJson(file, { ...o, shape: (d) => (isobj(d) ? '' : '結構應為物件 { indexDirty }') })
    const st = { indexDirty: raw?.indexDirty === true }
    return {
        get: () => ({ ...st }),
        set: (patch) => {
            Object.assign(st, patch)
            saveLedgerJson(file, st)
        },
    }
}

/**
 * 總覽是否待重建(relationIndex 之 when 用;同步讀檔,壞檔視為否——壞檔之告警由關聯段負責)
 *
 * @param {String} stateDir 輸入 dirs.state
 * @returns {Boolean} 回傳是否待重建
 * @example
 * const { mkdtempSync, rmSync } = await import('fs')
 * const { join } = await import('path')
 * const { tmpdir } = await import('os')
 * const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
 * console.log(indexDirtyOf(dir))
 * // => false
 * createRelateState(join(dir, 'relate-state.json')).set({ indexDirty: true })
 * console.log(indexDirtyOf(dir))
 * // => true
 * rmSync(dir, { recursive: true, force: true })
 */
export function indexDirtyOf(stateDir) {
    try {
        return JSON.parse(fs.readFileSync(path.join(stateDir, LEDGER_FILES.state), 'utf8'))?.indexDirty === true
    }
    catch {
        return false
    }
}

/**
 * 刪除墓碑({ ids: { 筆記 id: { at:刪除時刻, reason:刪除理由 } } }):懸空清理只認墓碑內之端點(開錯集合不致整批刪掉真理);墓碑記理由(刪除可追溯)
 *
 * @param {String} file 輸入檔案路徑(dirs.state/relate-tombstones.json)
 * @param {Object} [o={}] 輸入 loadLedgerJson 之選項
 * @returns {Object} 回傳 { has(id), at(id), reasonOf(id), ids(), add(id, at, reason), remove(id) }
 * @throws {Error} 墓碑檔損壞且無法隔離時拋出(關鍵帳，拒絕以空帳續行)
 * @example
 * const { mkdtempSync, rmSync } = await import('fs')
 * const { join } = await import('path')
 * const { tmpdir } = await import('os')
 * const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
 * const t = createTombstones(join(dir, 'relate-tombstones.json'))
 * t.add('n1', '2026-10-05T10:00:00+08:00', '使用者刪除')
 * console.log(t.has('n1'), t.at('n1'), t.reasonOf('n1'), t.ids())
 * // => true 2026-10-05T10:00:00+08:00 使用者刪除 [ 'n1' ]
 * t.remove('n1')
 * console.log(t.has('n1'), t.ids())
 * // => false []
 * rmSync(dir, { recursive: true, force: true })
 */
export function createTombstones(file, o = {}) {
    // 墓碑為關鍵帳:壞而無法隔離即拒(以空帳續行會讓已刪之筆記被重新收件)
    const raw = loadLedgerJson(file, { ...o, critical: true, shape: (d) => (isobj(d) && isobj(d.ids) ? '' : '結構應為 { ids:{ 筆記 id:時刻 } }') })
    const ids = isobj(raw?.ids) ? { ...raw.ids } : {}
    const save = () => saveLedgerJson(file, Object.keys(ids).length ? { ids } : null)
    return {
        has: (id) => Object.prototype.hasOwnProperty.call(ids, id),
        at: (id) => String(ids[id]?.at || ''),
        reasonOf: (id) => String(ids[id]?.reason || ''),
        ids: () => Object.keys(ids).sort(cmp),
        add: (id, at, reason) => {
            ids[id] = { at: String(at || ''), reason: String(reason || '') }
            save()
        },
        remove: (id) => {
            if (!Object.prototype.hasOwnProperty.call(ids, id)) return
            delete ids[id]
            save()
        },
    }
}

/**
 * 稽核紀錄(append-only JSONL;刪邊一律先記再刪)
 *
 * @param {String} file 輸入檔案路徑(dirs.state/relate-retired.jsonl)
 * @param {Object} entry 輸入紀錄 { at, reason, note?, edge }
 * @returns {undefined} 無回傳值(追加一行 JSON 至檔尾)
 * @example
 * const { mkdtempSync, rmSync } = await import('fs')
 * const { join } = await import('path')
 * const { tmpdir } = await import('os')
 * const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
 * const file = join(dir, 'relate-retired.jsonl')
 * appendAudit(file, { at: '2026-10-05T10:00:00Z', reason: 'reeval-retire', edge: { id: 'e1' } })
 * appendAudit(file, { at: '2026-10-06T10:00:00Z', reason: 'restore', edge: { id: 'e1' } })
 * console.log(readAuditRows(file).map((x) => x.reason))
 * // => [ 'reeval-retire', 'restore' ]
 * rmSync(dir, { recursive: true, force: true })
 */
export function appendAudit(file, entry) {
    appendJsonlRow(file, entry)
}

/**
 * 讀 append-only JSONL 帳(稽核 relate-retired.jsonl、重評帳 relate-reeval.jsonl 共用之單一讀法):缺檔＝空、壞行略過(append 中途被砍之半行);
 *   讀取本身失敗(權限等)即拋錯(同檔頭之分流)
 *
 * @param {String} file 輸入檔案路徑
 * @returns {Array} 回傳依寫入序之紀錄
 * @example
 * const { mkdtempSync, appendFileSync, rmSync } = await import('fs')
 * const { join } = await import('path')
 * const { tmpdir } = await import('os')
 * const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
 * const file = join(dir, 'relate-retired.jsonl')
 * console.log(readAuditRows(file))
 * // => []
 * appendAudit(file, { at: 'T1', reason: 'a' })
 * appendFileSync(file, '{"at":"T2","rea', 'utf8')
 * console.log(readAuditRows(file))
 * // => [ { at: 'T1', reason: 'a' } ]
 * rmSync(dir, { recursive: true, force: true })
 */
export function readAuditRows(file) {
    return readJsonlRows(file) // 單一讀法為抓取套件之 JSONL 共用件(下游同用)
}

/**
 * 近期被重評撤銷之邊 id(振盪觀察:正向／反向／輪巡段再建同一對時計 reevalReproposed;只觀察、不擋——撤銷是否過度由此判斷)
 *
 * @param {String} file 輸入稽核檔(dirs.state/relate-retired.jsonl)
 * @param {Number} sinceMs 輸入起算時刻(毫秒;撤銷時刻 ≥ 此者計入)
 * @returns {Set} 回傳邊 id 集合
 * @example
 * const { mkdtempSync, rmSync } = await import('fs')
 * const { join } = await import('path')
 * const { tmpdir } = await import('os')
 * const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
 * const file = join(dir, 'relate-retired.jsonl')
 * appendAudit(file, { at: '2026-10-05T10:00:00Z', reason: 'reeval-retire', edge: { id: 'e1' } })
 * appendAudit(file, { at: '2026-09-01T10:00:00Z', reason: 'reeval-retire', edge: { id: 'e2' } })
 * appendAudit(file, { at: '2026-10-06T10:00:00Z', reason: 'other', edge: { id: 'e3' } })
 * console.log(recentReevalRetiredIds(file, Date.parse('2026-10-01T00:00:00Z')))
 * // => Set(1) { 'e1' }
 * rmSync(dir, { recursive: true, force: true })
 */
export function recentReevalRetiredIds(file, sinceMs) {
    return new Set(readAuditRows(file).filter((x) => x?.reason === 'reeval-retire' && isestr(x?.edge?.id) && Date.parse(x.at) >= sinceMs).map((x) => x.edge.id))
}

/**
 * 帳檔損壞之告警文(唯一一份;開帳者之日誌與外部巡檢之必看字樣「關聯帳檔損壞」):已隔離者附隔離檔名;隔離失敗者明寫失敗原因與壞檔仍在原位
 *
 * @param {Object} info 輸入 loadLedgerJson 之 onCorrupt 參數 { file, movedTo, error, quarantineError? }
 * @returns {String} 回傳告警文
 * @example
 * console.log(ledgerCorruptTextOf({ file: '/s/relate-dirty.json', movedTo: '/s/relate-dirty.json.corrupt-1', error: 'Unexpected token' }))
 * // => 關聯帳檔損壞：relate-dirty.json（Unexpected token），已隔離為 relate-dirty.json.corrupt-1；以空帳續跑——可用 projectAll（opt.all）全庫重投補回
 */
export function ledgerCorruptTextOf(info) {
    const name = path.basename(String(info?.file || ''))
    const how = info?.movedTo
        ? `，已隔離為 ${path.basename(String(info.movedTo))}`
        : `，隔離失敗：${oneline(info?.quarantineError || '', 80)}（壞檔仍在原位，下次寫入會覆寫——請先手動移走）`
    return `關聯帳檔損壞：${name}（${oneline(info?.error, 80)}）${how}；以空帳續跑——${RELATE_API_HINT.projectAll}`
}

/**
 * 以 dirs.state 開齊全部帳(壞檔之告警:給 onCorrupt 者從之;否則給 log 者以 ledgerCorruptTextOf 之字樣 warn;皆無即靜默)
 *
 * @param {String} stateDir 輸入 dirs.state
 * @param {Object} [o={}] 輸入 { onCorrupt?:(info)=>void, log?:{ warn }, stamp?:String(隔離檔名之時戳) }
 * @returns {Object} 回傳 { dirty, reverse, state, tombstones, files, touch:(ids, { has? })=>undefined(邊庫將變:端點記待投影＋總覽待重建,先記後寫之「記」) }
 * @throws {Error} 關鍵帳(墓碑)損壞且無法隔離時拋出(拒寫)
 * @example
 * const { mkdtempSync, writeFileSync, rmSync } = await import('fs')
 * const { join } = await import('path')
 * const { tmpdir } = await import('os')
 * const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
 * writeFileSync(join(dir, 'relate-dirty.json'), '壞掉的檔', 'utf8')
 * const warns = []
 * const ledgers = openRelateLedgers(dir, { stamp: '1', log: { warn: (m) => warns.push(m) } })
 * console.log(warns.length, warns[0].startsWith('關聯帳檔損壞：relate-dirty.json'))
 * // => 1 true
 * ledgers.touch(['n1', 'n2', 'gone'], { has: (id) => id !== 'gone' })
 * console.log(ledgers.dirty.ids(), ledgers.state.get())
 * // => [ 'n1', 'n2' ] { indexDirty: true }
 * ledgers.tombstones.add('n3', 'T1', '理由')
 * console.log(ledgers.tombstones.has('n3'), ledgers.reverse.size(), Object.keys(ledgers.files).length)
 * // => true 0 6
 * rmSync(dir, { recursive: true, force: true })
 */
export function openRelateLedgers(stateDir, o = {}) {
    const f = (k) => path.join(stateDir, LEDGER_FILES[k])
    const warn = typeof o?.log?.warn === 'function' ? (m) => o.log.warn(m) : null
    const onCorrupt = typeof o?.onCorrupt === 'function' ? o.onCorrupt : (warn ? (i) => warn(ledgerCorruptTextOf(i)) : undefined)
    const lo = { stamp: o?.stamp, onCorrupt }
    const dirty = createDirtyLedger(f('dirty'), lo)
    const state = createRelateState(f('state'), lo)
    return {
        dirty,
        reverse: createReverseLedger(f('reverse'), lo),
        state,
        tombstones: createTombstones(f('tombstones'), lo),
        files: { retired: f('retired'), archive: f('archive'), manual: f('manual'), reeval: f('reeval'), conflictCheck: f('conflictCheck'), edgeReview: f('edgeReview') },
        // 寫邊之前一律經此(單一規則):受影響之筆記(has 篩出現存者)記待投影、總覽待重建——兩者成對,不各自手寫
        touch: (ids, t = {}) => {
            const has = typeof t?.has === 'function' ? t.has : () => true
            dirty.add((Array.isArray(ids) ? ids : []).filter((x) => has(x)))
            state.set({ indexDirty: true })
        },
    }
}

export default { LEDGER_FILES, loadLedgerJson, createDirtyLedger, createReverseLedger, createRelateState, indexDirtyOf, createTombstones, appendAudit, readAuditRows, recentReevalRetiredIds, ledgerCorruptTextOf, openRelateLedgers }
