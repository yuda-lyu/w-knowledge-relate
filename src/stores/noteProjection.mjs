// noteProjection.mjs — 筆記 md 之關聯投影:由邊庫重算「關聯」「⚠ 衝突與反例」兩章與 frontmatter related／conflicts／related_at
//
// 【投影＝邊庫之純函數】該篇全部邊(含入邊)整章重算;同一組邊投影兩次逐位元組相同(冪等),內容不變即不寫檔
//   (md 若入版控,不因每輪重寫而產生異動)。入邊亦投影:舊筆記看得到後來連到它之筆記。
// 【章名＝跨套件之契約】兩章之名(RELATE_SECTION_TITLES)定義於摘要套件(PROJECTION_SECTION_TITLES;其列為非內容章——內容章與數字紮根之材料不含之),
//   本套件轉出同一實體,下游亦依名讀之;故章名為常數、不開放更換——換名即令他方把投影章誤當內容。
// 【手改偵測】記錄存上次投影兩章之雜湊(projHash);覆寫前現況兩章之雜湊與之不符、**且**覆寫會改變兩章者才先另存一份
//   (dirs.state/relate-manual/<id>-<時戳>.md)再覆寫——兩章是邊庫之投影,手加之關聯行不會進邊庫,但不讓它無聲消失;覆寫不改變兩章者(如他處改了
//   md 之其他部分而記錄之 projHash 未同步——存量處置之回退)無手改可失,不另存。
// 【行序】衝突在前 → 型別序 → 同型以邊之更新時刻新到舊 → 對方 id;⚠ 章同序(讀者只取此章前段時,保留最新之衝突)。
// 【方向記號】關聯章 → ＝本篇提出之提案、← ＝對方提出(提案方向,非語意方向);⚠ 章維持「- 與 [[slug]] 標題：理由」行式
//   (下游讀之格式,不帶方向)。
// 【related_at】＝該篇各邊之 max(updatedAt||createdAt)(取自邊,不取時鐘——否則每次投影都改檔);與記錄之 relatedAt
//   (完成正向評估之時刻)語意不同,零邊之成功評估不改 relatedAt。
// 【換行】正文 CRLF 一律轉 LF 後處理與寫出(版控之換行轉換可使筆記以 CRLF 取出)。

import fs from 'fs'
import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import fsCreateFolder from 'wsemi/src/fsCreateFolder.mjs'
import { readMd, writeMd, mdText, sectionOf, dropSection, PROJECTION_SECTION_TITLES } from '../core/summarizePackage.mjs'
import { sha1, cmp } from '../core/capturePackage.mjs'
import { edgeTimeOf, typeRankOf, buildAdjacency } from './edgeStore.mjs'
import { LEDGER_FILES } from './relateLedgers.mjs'

/**
 * 投影之兩章章名(跨套件之契約:定義於摘要套件之 PROJECTION_SECTION_TITLES——同一實體;檔頭【章名＝跨套件之契約】)
 *
 * @type {Object}
 */
export const RELATE_SECTION_TITLES = PROJECTION_SECTION_TITLES
const REL_TITLE = RELATE_SECTION_TITLES.relations
const CONF_TITLE = RELATE_SECTION_TITLES.conflicts

/**
 * 由該篇之邊算出投影內容(純函數)
 *
 * @param {String} noteId 輸入本篇 id
 * @param {Array} edges 輸入該篇之全部邊(from 或 to 為本篇)
 * @param {Function} titleOf 輸入 (id) => 標題
 * @param {Object} o 輸入 { rank:(type)=>Number, conflictType }
 * @returns {Object} 回傳 { relLines, conflictLines, related, conflicts, relatedAt }
 * @example
 * const edges = [
 *     { id: 'e1', from: 'n1', to: 'n2', type: '前置概念', reason: '理由甲', createdAt: 'T1' },
 *     { id: 'e2', from: 'n3', to: 'n1', type: '衝突', reason: '理由乙', createdAt: 'T2' },
 * ]
 * const r = renderRelationSections('n1', edges, (id) => `標題${id}`, { rank: (t) => (t === '衝突' ? 0 : 1), conflictType: '衝突' })
 * console.log(r.relLines.join('\n'))
 * // => - [衝突] ← [[n3]] 標題n3：理由乙
 * // => - [前置概念] → [[n2]] 標題n2：理由甲
 * console.log(r.conflictLines.join('\n'))
 * // => - 與 [[n3]] 標題n3：理由乙
 * console.log(r.related, r.conflicts, r.relatedAt)
 * // => [ 'n2', 'n3' ] [ 'n3' ] T2
 */
export function renderRelationSections(noteId, edges, titleOf, o = {}) {
    if (!isobj(o)) o = {}
    const rank = isfun(o.rank) ? o.rank : () => 0
    const title = isfun(titleOf) ? titleOf : () => ''
    const rows = (isarr(edges) ? edges : [])
        .filter((e) => e && (e.from === noteId || e.to === noteId) && e.from !== e.to)
        .map((e) => ({ e, out: e.from === noteId, other: e.from === noteId ? e.to : e.from }))
        .sort((a, b) => rank(a.e.type) - rank(b.e.type) || cmp(edgeTimeOf(b.e), edgeTimeOf(a.e)) || cmp(a.other, b.other))
    const oneline = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
    const relLines = rows.map((r) => `- [${r.e.type}] ${r.out ? '→' : '←'} [[${r.other}]] ${oneline(title(r.other))}：${oneline(r.e.reason)}`)
    const conflictRows = rows.filter((r) => r.e.type === o.conflictType)
    const conflictLines = conflictRows.map((r) => `- 與 [[${r.other}]] ${oneline(title(r.other))}：${oneline(r.e.reason)}`)
    const related = [...new Set(rows.map((r) => r.other))].sort(cmp)
    const conflicts = [...new Set(conflictRows.map((r) => r.other))].sort(cmp)
    const relatedAt = rows.reduce((m, r) => (edgeTimeOf(r.e) > m ? edgeTimeOf(r.e) : m), '')
    return { relLines, conflictLines, related, conflicts, relatedAt }
}

/**
 * 移除某標題之全部 H2 章節(重複章一併清除)
 *
 * @param {String} body 輸入正文
 * @param {String} title 輸入章名
 * @returns {String} 回傳移除後之正文
 */
function dropAll(body, title) {
    let b = String(body || '')
    for (let i = 0; i < 20 && sectionOf(b, title); i++) b = dropSection(b, title)
    return b
}

/**
 * 兩章(關聯、⚠ 衝突與反例)現況之雜湊(手改偵測用;換行統一、各章去尾空白;兩章皆無時為空字串之雜湊)
 *
 * @param {String} body 輸入正文
 * @returns {String} 回傳雜湊
 * @example
 * const a = sectionsHashOf('# 標題\n\n## 關聯\n\n- x\n')
 * const b = sectionsHashOf('# 另一標題\r\n\r\n## 關聯\r\n\r\n- x  \r\n')
 * console.log(a === b, a === sectionsHashOf('# 標題'), a.length)
 * // => true false 40
 */
export function sectionsHashOf(body) {
    const b = String(body || '').replace(/\r\n/g, '\n')
    const parts = [REL_TITLE, CONF_TITLE].map((t) => {
        const all = []
        let rest = b
        for (let i = 0; i < 20; i++) {
            const sec = sectionOf(rest, t)
            if (!sec) break
            all.push(sec.text.split('\n').map((l) => l.trimEnd()).join('\n').trim())
            rest = rest.slice(sec.end)
        }
        return all.join('\n')
    })
    return sha1(parts.join('\n\u0000\n'))
}

/**
 * 投影之純計算:給 md(readMd 之產物)與該篇之邊,回傳投影後之 front／body／全文與是否改變(不讀寫檔;遷移試跑與正式投影共用)
 *
 * @param {Object} md 輸入 { front, body }
 * @param {String} noteId 輸入本篇 id
 * @param {Array} edges 輸入該篇之全部邊
 * @param {Function} titleOf 輸入 (id) => 標題
 * @param {Object} [cfg={}] 輸入 { rank, conflictType }(章名為常數 RELATE_SECTION_TITLES)
 * @returns {Object} 回傳 { front, body, text, changed, related, conflicts, projHash(投影後兩章之雜湊), prevProjHash(投影前兩章之雜湊) }
 * @example
 * const md = { front: { title: 'n1' }, body: '# n1\n\n## 核心知識\n\n- 要點' }
 * const edges = [{ id: 'e1', from: 'n1', to: 'n2', type: '前置概念', reason: '理由甲', createdAt: 'T1' }]
 * const p = projectText(md, 'n1', edges, (id) => `標題${id}`)
 * console.log(p.changed, p.related, p.conflicts, p.front.related_at)
 * // => true [ 'n2' ] [] T1
 * console.log(p.body.includes('## 關聯'), p.body.split('\n').at(-1))
 * // => true - [前置概念] → [[n2]] 標題n2：理由甲
 * console.log(projectText({ front: p.front, body: p.body }, 'n1', edges, (id) => `標題${id}`).changed)
 * // => false
 */
export function projectText(md, noteId, edges, titleOf, cfg = {}) {
    if (!isobj(cfg)) cfg = {}
    const r = renderRelationSections(noteId, edges, titleOf, cfg)
    const src = String(md?.body || '').replace(/\r\n/g, '\n')
    const base = dropAll(dropAll(src, REL_TITLE), CONF_TITLE).trimEnd()
    const parts = [base]
    if (r.relLines.length) parts.push(`## ${REL_TITLE}\n\n${r.relLines.join('\n')}`)
    if (r.conflictLines.length) parts.push(`## ${CONF_TITLE}\n\n${r.conflictLines.join('\n')}`)
    const body = parts.filter(Boolean).join('\n\n')
    const front = { ...(md?.front || {}) }
    for (const [k, v] of [['related', r.related], ['conflicts', r.conflicts]]) {
        if (v.length) front[k] = v
        else delete front[k]
    }
    if (r.relatedAt) front.related_at = r.relatedAt
    else delete front.related_at
    const text = mdText(front, body)
    return { front, body, text, changed: text !== mdText(md?.front, md?.body), related: r.related, conflicts: r.conflicts, projHash: sectionsHashOf(body), prevProjHash: sectionsHashOf(md?.body) }
}

/**
 * 投影一篇筆記:讀 md → 純計算 → 手改偵測(prevHash 給定且現況不符即另存)→ 內容不變不寫、否則原子寫
 *
 * @param {Object} note 輸入筆記記錄(取 id、file、projHash)
 * @param {Array} edges 輸入該篇之全部邊
 * @param {Function} titleOf 輸入 (id) => 標題
 * @param {Object} [cfg={}] 輸入 projectText 之 cfg，另 { manualDir:另存目錄, stamp:時戳 }
 * @returns {Object} 回傳 { ok(md 讀得到並處理完), changed(有寫檔), projHash, degree, manual(偵測到手改), backup(另存檔路徑) }
 * @example
 * const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('fs')
 * const { join } = await import('path')
 * const { tmpdir } = await import('os')
 * const dir = mkdtempSync(join(tmpdir(), 'proj-'))
 * const file = join(dir, 'n1.md')
 * writeFileSync(file, '---\ntitle: "n1"\n---\n\n# n1\n\n## 核心知識\n\n- 要點\n', 'utf8')
 * const edges = [{ id: 'e1', from: 'n1', to: 'n2', type: '前置概念', reason: '理由甲', createdAt: 'T1' }]
 * const titleOf = (id) => `標題${id}`
 * const r1 = projectNote({ id: 'n1', file }, edges, titleOf)
 * const r2 = projectNote({ id: 'n1', file, projHash: r1.projHash }, edges, titleOf)
 * console.log(r1.ok, r1.changed, r1.degree, r1.manual, r2.changed)
 * // => true true 1 false false
 * console.log(readFileSync(file, 'utf8').includes('- [前置概念] → [[n2]] 標題n2：理由甲'))
 * // => true
 * rmSync(dir, { recursive: true, force: true })
 */
export function projectNote(note, edges, titleOf, cfg = {}) {
    if (!isobj(note) || !isestr(note.file)) return { ok: false, changed: false }
    if (!isobj(cfg)) cfg = {}
    const md = readMd(note.file)
    if (!md) return { ok: false, changed: false }
    const p = projectText(md, note.id, edges, titleOf, cfg)
    let manual = false
    let backup = ''
    if (isestr(note.projHash) && note.projHash !== p.prevProjHash && p.projHash !== p.prevProjHash) {
        manual = true
        if (isestr(cfg.manualDir)) {
            fsCreateFolder(cfg.manualDir)
            backup = path.join(cfg.manualDir, `${note.id}-${cfg.stamp || Date.now()}.md`)
            fs.copyFileSync(note.file, backup)
        }
    }
    if (p.changed) writeMd(note.file, p.front, p.body)
    return { ok: true, changed: p.changed, projHash: p.projHash, degree: p.related.length, manual, backup }
}

/**
 * 投影一批筆記(投影子階段與維運——刪除、還原、撤銷、存量處置之連鎖、projectAll——共用;同一處發「關聯投影手改另存」之必看字樣):逐篇 projectNote →
 *   成功者 patch 記錄 { projHash, relatedCount(＝度數) } 並出帳;記錄已不存在者出帳;md 讀不到者留帳(下輪再補)
 *
 * @param {Object} deps 輸入 { stores, dirs, clock, log, domain(取 relationTypes、conflictType、fallbackType) }
 * @param {Array} ids 輸入筆記 id 陣列
 * @param {Object} [o={}] 輸入 { ledger(待投影帳;給了即成功出帳), notes(筆記陣列;未給即 select), edges(邊陣列;未給即 select), onProgress }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { projected, changed, failed, gone, manual, failedSample:Array, manualFiles:Array }
 * @example
 * const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('fs')
 * const { join } = await import('path')
 * const { tmpdir } = await import('os')
 * const dir = mkdtempSync(join(tmpdir(), 'proj-'))
 * const notes = ['n1', 'n2'].map((id) => {
 *     const file = join(dir, `${id}.md`)
 *     writeFileSync(file, `---\ntitle: "${id}"\n---\n\n# ${id}\n\n## 核心知識\n\n- 要點\n`, 'utf8')
 *     return { id, title: `標題${id}`, file }
 * })
 * const edges = [{ id: 'e1', from: 'n1', to: 'n2', type: '前置概念', reason: '理由甲', createdAt: 'T1' }]
 * const patched = []
 * const deps = {
 *     stores: {
 *         notes: { select: async () => notes, patch: async (id, v) => { patched.push(`${id}:${v.relatedCount}`) } },
 *         relations: { select: async () => edges },
 *     },
 *     dirs: { state: dir },
 *     clock: { stamp8: () => '20261005' },
 *     domain: { relationTypes: ['前置概念'], conflictType: '衝突' },
 * }
 * const det = await projectNotes(deps, ['n1', 'n2', 'n9'])
 * console.log(det.projected, det.changed, det.failed, det.gone, det.manual, patched)
 * // => 2 2 0 1 0 [ 'n1:1', 'n2:1' ]
 * console.log(readFileSync(notes[1].file, 'utf8').includes('- [前置概念] ← [[n1]] 標題n1：理由甲'))
 * // => true
 * rmSync(dir, { recursive: true, force: true })
 */
export async function projectNotes(deps, ids, o = {}) {
    const { stores, dirs, clock, domain } = deps
    const det = { projected: 0, changed: 0, failed: 0, gone: 0, manual: 0, failedSample: [], manualFiles: [] }
    if (!ids.length) return det
    const notes = o.notes || await stores.notes.select()
    const edges = o.edges || await stores.relations.select()
    const byId = new Map(notes.map((n) => [n.id, n]))
    const adj = buildAdjacency(edges)
    const titleOf = (id) => byId.get(id)?.title || ''
    const cfg = {
        rank: typeRankOf(domain),
        conflictType: domain.conflictType,
        manualDir: path.join(dirs.state, LEDGER_FILES.manual),
        stamp: clock.stamp8(),
    }
    const done = []
    let i = 0
    for (const id of ids) {
        i++
        const note = byId.get(id)
        if (!note) {
            det.gone++
            done.push(id)
            continue
        }
        const mine = [...(adj.get(id) || new Map()).values()]
        const r = projectNote(note, mine, titleOf, cfg)
        if (!r.ok) {
            det.failed++
            if (det.failedSample.length < 3) det.failedSample.push(id)
            continue
        }
        det.projected++
        if (r.changed) det.changed++
        if (r.manual) {
            det.manual++
            det.manualFiles.push(r.backup || id)
        }
        if (note.projHash !== r.projHash || note.relatedCount !== r.degree) {
            await stores.notes.patch(id, { projHash: r.projHash, relatedCount: r.degree })
            note.projHash = r.projHash
            note.relatedCount = r.degree
        }
        done.push(id)
        if (o.ledger && done.length >= 200) {
            o.ledger.remove(done.splice(0))
        }
        if (typeof o.onProgress === 'function' && i % 1000 === 0) o.onProgress(i, ids.length)
    }
    if (o.ledger && done.length) o.ledger.remove(done)
    for (const f of det.manualFiles) deps.log?.warn?.(`關聯投影手改另存：${f}（關聯章／衝突章與上次投影不同——兩章由邊庫產生，手加之關聯不會進邊庫；原檔已另存後覆寫）`)
    return det
}

export default { RELATE_SECTION_TITLES, renderRelationSections, sectionsHashOf, projectText, projectNote, projectNotes }
