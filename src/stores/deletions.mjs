// deletions.mjs — 筆記明示刪除之紀錄(墓碑與封存)之檔名與唯讀讀取:寫入者為明示刪除與其還原、撤銷(ops/noteOps),讀者為關聯段與
//   讀關聯之下游(如撤出以已刪筆記為出處之產物)
//
// 【檔名只定義一次】刪除墓碑是「筆記已被明示刪除」之系統紀錄,寫者與讀者皆依它判定——檔名只定義一次(關聯段之 LEDGER_FILES 取自此處),
//   讀不到不等於刪除(墓碑是正面證據)。
// 【封存】<id>.json＝{ deletedAt, reason, record(刪除前之記錄), edges(刪除前之邊值), reverse(刪除前涉及該篇之反向待處理對) }、<id>.md(md 副本);
//   還原或撤銷完成即改名歸檔(<id>.restored-<時戳>.*、<id>.undone-<時戳>.*)。封存是還原與撤銷之唯一依據:讀到壞檔或形狀不符即拋(不當沒有)。
// 【半狀態】刪除、還原、撤銷皆分步且可續作;中途中斷而未續作者每輪由關聯段偵測(deletionHalfStatesOf),發必看字樣——
//   ①墓碑在而記錄在(刪除停在刪記錄之前,或還原／撤銷停在移除墓碑之前;關聯段不以之為對象)②封存未歸檔而無墓碑(還原／撤銷停在歸檔之前;
//   再刪除會誤併舊封存,故 deleteNote 拒做)③記錄已刪而 md 仍在且與封存副本相同(刪除停在刪 md 之前)。

import fs from 'fs'
import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { readJson } from '../core/capturePackage.mjs'

/** 刪除紀錄之檔名(dirs.state 下):墓碑 { ids:{ 筆記 id: { at, reason } } }、封存目錄(見檔頭【封存】) */
export const DELETION_FILES = { tombstones: 'relate-tombstones.json', archive: 'deleted-notes' }

/** 半狀態之說明(檔頭【半狀態】;日誌與回報用) */
export const DELETION_HALF_STATE_LABEL = Object.freeze({ 'tombstone-with-record': '墓碑在而記錄在', 'archive-without-tombstone': '封存未歸檔', 'md-left': '記錄已刪而 md 仍在' })

/** 已歸檔之封存之檔名(還原、撤銷完成後改名;不是待處理之封存) */
const SETTLED_RE = /\.(restored|undone)-\d+$/

/**
 * 某篇之封存檔路徑
 *
 * @param {String} stateDir 輸入 dirs.state
 * @param {String} slug 輸入筆記 id
 * @returns {Object} 回傳 { dir(封存目錄), json, md }
 * @example
 * console.log(archiveFilesOf('/kb/state', 'n1').json.replace(/\\/g, '/'))
 * // => /kb/state/deleted-notes/n1.json
 */
export function archiveFilesOf(stateDir, slug) {
    const dir = path.join(stateDir, DELETION_FILES.archive)
    return { dir, json: path.join(dir, `${slug}.json`), md: path.join(dir, `${slug}.md`) }
}

/**
 * 讀封存(缺檔回 null;壞檔、形狀不符、讀取失敗即拋——封存是還原與撤銷之唯一依據,見檔頭【封存】)
 *
 * @param {String} file 輸入封存 JSON 之路徑
 * @returns {Object|null} 回傳 { deletedAt, reason, record, edges, reverse(舊封存無此鍵即 []) }
 * @throws {Error} 讀取失敗(非缺檔)、JSON 解析失敗、非 { record:物件, edges:陣列 } 時拋出
 * @example
 * const fs = process.getBuiltinModule('fs')
 * const dir = fs.mkdtempSync('ex-')
 * const f = archiveFilesOf(dir, 'n1')
 * console.log(readArchive(f.json))
 * // => null
 *
 * fs.mkdirSync(f.dir, { recursive: true })
 * fs.writeFileSync(f.json, JSON.stringify({ deletedAt: 'T1', reason: '重複', record: { id: 'n1', title: '太陽黑子' }, edges: [{ id: 'e1' }, 'x'] }))
 * const arc = readArchive(f.json)
 * console.log(arc.record.title, arc.edges, arc.reverse)
 * // => 太陽黑子 [ { id: 'e1' } ] []
 *
 * fs.writeFileSync(f.json, '{壞')
 * try { readArchive(f.json) } catch (e) { console.log(e.message.startsWith('封存損壞')) }
 * // => true
 * fs.rmSync(dir, { recursive: true, force: true })
 */
export function readArchive(file) {
    let text
    try {
        text = fs.readFileSync(file, 'utf8')
    }
    catch (e) {
        if (e.code === 'ENOENT') return null
        throw new Error(`封存讀取失敗（${path.basename(file)}）：${e.message}`)
    }
    let arc
    try {
        arc = JSON.parse(text)
    }
    catch (e) {
        throw new Error(`封存損壞（${path.basename(file)}）：${e.message}`)
    }
    if (!isobj(arc) || !isobj(arc.record) || !isarr(arc.edges)) throw new Error(`封存形狀不符（${path.basename(file)}）：須為 { record:物件, edges:陣列, … }`)
    return { ...arc, edges: arc.edges.filter(isobj), reverse: isarr(arc.reverse) ? arc.reverse.filter((p) => isobj(p) && isestr(p.o) && isestr(p.n)) : [] }
}

/**
 * 刪除、還原、撤銷之半狀態(檔頭【半狀態】;唯讀:不寫、不隔離壞檔——壞墓碑由開帳者告警)
 *
 * @param {String} stateDir 輸入 dirs.state
 * @param {Function} hasRecord 輸入 (筆記 id) => Boolean(記錄是否在)
 * @returns {Array} 回傳 [{ id, state:'tombstone-with-record'|'archive-without-tombstone'|'md-left' }](依 id 排序)
 * @example
 * const fs = process.getBuiltinModule('fs')
 * const dir = fs.mkdtempSync('ex-')
 * console.log(deletionHalfStatesOf(dir, () => false))
 * // => []
 *
 * fs.writeFileSync(`${dir}/${DELETION_FILES.tombstones}`, JSON.stringify({ ids: { n1: { at: 'T1', reason: '重複' } } }))
 * console.log(deletionHalfStatesOf(dir, (id) => id === 'n1'))
 * // => [ { id: 'n1', state: 'tombstone-with-record' } ]
 * console.log(deletionHalfStatesOf(dir, () => false))
 * // => []
 *
 * fs.mkdirSync(`${dir}/${DELETION_FILES.archive}`)
 * fs.writeFileSync(`${dir}/${DELETION_FILES.archive}/n2.json`, JSON.stringify({ record: { id: 'n2' }, edges: [] }))
 * console.log(deletionHalfStatesOf(dir, () => false))
 * // => [ { id: 'n2', state: 'archive-without-tombstone' } ]
 * fs.rmSync(dir, { recursive: true, force: true })
 */
export function deletionHalfStatesOf(stateDir, hasRecord) {
    const raw = readJson(path.join(stateDir, DELETION_FILES.tombstones), null)
    const tomb = new Set(Object.keys(isobj(raw?.ids) ? raw.ids : {}))
    const dir = path.join(stateDir, DELETION_FILES.archive)
    const pending = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((b) => !SETTLED_RE.test(b)) : []
    const out = new Map()
    for (const id of tomb) if (hasRecord(id)) out.set(id, 'tombstone-with-record')
    for (const id of pending) {
        if (out.has(id)) continue
        if (!tomb.has(id)) {
            out.set(id, 'archive-without-tombstone')
            continue
        }
        if (hasRecord(id)) continue
        // 記錄已刪:md 仍在且與封存副本相同 → 刪 md 之前中斷(不同者非本次刪除之物,不列)
        let arc = null
        try {
            arc = readArchive(path.join(dir, `${id}.json`))
        }
        catch { /* 壞封存由還原或撤銷時報錯;此處不列 */ }
        const file = arc?.record?.file
        const copy = path.join(dir, `${id}.md`)
        if (isestr(file) && fs.existsSync(file) && fs.existsSync(copy) && fs.readFileSync(file).equals(fs.readFileSync(copy))) out.set(id, 'md-left')
    }
    return [...out].map(([id, state]) => ({ id, state })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * 唯讀開啟刪除紀錄(不寫入、不隔離壞檔;壞檔或缺檔視為無墓碑)
 *
 * @param {String} stateDir 輸入 dirs.state
 * @returns {Object} 回傳 { has(id):Boolean, reasonOf(id):String(墓碑所記之刪除理由,無則 ''), titleOf(id):String(封存之記錄標題,無則 id) }
 * @example
 * const fs = process.getBuiltinModule('fs')
 * const dir = fs.mkdtempSync('ex-')
 * console.log(openDeletions(dir).has('n1'))
 * // => false
 *
 * fs.writeFileSync(`${dir}/${DELETION_FILES.tombstones}`, JSON.stringify({ ids: { n1: { at: 'T1', reason: '重複' } } }))
 * fs.mkdirSync(`${dir}/${DELETION_FILES.archive}`)
 * fs.writeFileSync(`${dir}/${DELETION_FILES.archive}/n1.json`, JSON.stringify({ record: { id: 'n1', title: '太陽黑子' }, edges: [] }))
 * const d = openDeletions(dir)
 * console.log(d.has('n1'), d.has('n2'), d.reasonOf('n1'), d.titleOf('n1'), d.titleOf('n2'))
 * // => true false 重複 太陽黑子 n2
 * fs.rmSync(dir, { recursive: true, force: true })
 */
export function openDeletions(stateDir) {
    const raw = readJson(path.join(stateDir, DELETION_FILES.tombstones), null)
    const ids = isobj(raw?.ids) ? raw.ids : {}
    const archive = path.join(stateDir, DELETION_FILES.archive)
    const has = (id) => Object.prototype.hasOwnProperty.call(ids, id)
    return {
        has,
        reasonOf: (id) => (has(id) ? String(ids[id]?.reason || '') : ''),
        titleOf: (id) => String(readJson(path.join(archive, `${id}.json`), null)?.record?.title || '').trim() || id,
    }
}

export default { DELETION_FILES, DELETION_HALF_STATE_LABEL, archiveFilesOf, readArchive, deletionHalfStatesOf, openDeletions }
