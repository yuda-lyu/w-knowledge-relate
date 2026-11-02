// relationIndexStage.mjs — 關聯物件子階段 relationIndex:關聯總覽之重建(index.md 限量導覽＋graph.json 機器可讀全量)
//
// 【何時重建】本輪邊有新增／改變／刪除(ctx 旗標 RELATE_CTX_FLAGS.edgesChanged)、本輪有筆記重標(摘要套件之 ctx 旗標 SUMMARIZE_CTX_FLAGS.tagChanged;
//   總覽之節點帶類別)、或持久旗標待重建(關聯狀態檔 indexDirty:內容變更、刪除 op 等管線外或無新邊之事件)時重寫;皆無則不動檔案。成功後清旗標。
// 【限量導覽】index.md 只列連結數前 N 篇(RELATE_INDEX_TOP_N;cfg.indexTopN 可改)——給人看的入口每輪全量重寫,不限量會在一個月內長到不可讀之
//   10MB 級;完整關聯圖在 graph.json。兩檔皆原子寫(中途被砍不留半份);frontmatter 走摘要套件之 renderFrontmatter(與筆記同一序列化)。

import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { renderFrontmatter, SUMMARIZE_CTX_FLAGS } from '../core/summarizePackage.mjs'
import { writeFileAtomic } from '../core/capturePackage.mjs'
import { defineMw, applyTaps, makeMsg, runChainOverMsgs, stdReport, stageFields } from '../core/capturePackage.mjs'
import { RELATE_INDEX_TITLE } from '../core/relateSettings.mjs'
import { RELATE_CTX_FLAGS } from '../logContract.mjs'
import { indexDirtyOf, createRelateState, LEDGER_FILES } from '../stores/relateLedgers.mjs'

/** 關聯總覽 index.md 之預設顯示篇數(依連結數降冪;rebuildRelationIndex 之 cfg.indexTopN 未給時) */
export const RELATE_INDEX_TOP_N = 40

/**
 * 重建關聯總覽：index.md（限量導覽）＋ graph.json（機器可讀全量）;輸出目錄不在即建,兩檔皆原子寫(中途被砍不留半份)
 *
 * @param {Object} stores 輸入集合物件，需含 relations、notes(皆須有 select 方法)
 * @param {Object} cfg 輸入設定物件，需含 dir(輸出目錄字串)
 * @param {String} cfg.dir 輸入輸出目錄路徑字串(不存在即建)
 * @param {String} [cfg.nowIso] 輸入現在時刻 ISO 字串，寫入 frontmatter 之 updated
 * @param {Integer} [cfg.indexTopN=RELATE_INDEX_TOP_N] 輸入 index.md 顯示筆數上限(依連結數降冪)
 * @param {String} [cfg.indexTitle=RELATE_INDEX_TITLE] 輸入標題
 * @returns {Promise} 回傳 Promise，resolve 無回傳值(副作用為寫入 index.md 與 graph.json)
 * @throws {Error} cfg 非物件或 cfg.dir 非有效字串時拋出；stores.relations／stores.notes 缺 select 方法時拋出
 * @example
 * let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let stores = {
 *     notes: { select: async () => [{ id: 'a', title: '甲', category: 'c', concepts: ['p'] }, { id: 'b', title: '乙', category: 'c', concepts: [] }] },
 *     relations: { select: async () => [{ id: 'e1', from: 'a', to: 'b', type: '互補搭配', reason: '兩篇共用同一組指標' }] },
 * }
 * await rebuildRelationIndex(stores, { dir, nowIso: '2026-11-02T00:00:00+08:00', indexTopN: 1 })
 * let graph = JSON.parse(fs.readFileSync(path.join(dir, 'graph.json'), 'utf8'))
 * let heads = fs.readFileSync(path.join(dir, 'index.md'), 'utf8').split('\n').filter((l) => l.startsWith('## '))
 * console.log(fs.readdirSync(dir).sort(), graph.nodes.length, graph.edges.length, heads)
 * fs.rmSync(dir, { recursive: true, force: true })
 * // => [ 'graph.json', 'index.md' ] 2 1 [ '## 甲' ]
 */
export async function rebuildRelationIndex(stores, cfg) {

    //check
    if (!isobj(cfg) || !isestr(cfg.dir)) {
        throw new Error('rebuildRelationIndex 需要 cfg.dir（輸出目錄）')
    }
    if (!isobj(stores) || !isfun(stores.relations?.select) || !isfun(stores.notes?.select)) {
        throw new Error('rebuildRelationIndex 需要 stores.relations 與 stores.notes（皆需 select 方法）')
    }

    const edges = await stores.relations.select()
    const notes = await stores.notes.select()
    const titleOf = new Map(notes.map((n) => [n.id, n.title]))
    const byFrom = new Map()
    const byTo = new Map()
    for (const e of edges) {
        if (!byFrom.has(e.from)) byFrom.set(e.from, [])
        byFrom.get(e.from).push(e)
        if (!byTo.has(e.to)) byTo.set(e.to, [])
        byTo.get(e.to).push(e)
    }
    const allIds = [...new Set([...byFrom.keys(), ...byTo.keys()])]
    // 索引限量：給人看的入口每輪全量重寫，不限量會在一個月內長到不可讀的 10MB 級
    const topN = cfg.indexTopN ?? RELATE_INDEX_TOP_N
    const degree = (id) => (byFrom.get(id)?.length || 0) + (byTo.get(id)?.length || 0)
    const shown = allIds.slice().sort((a, b) => degree(b) - degree(a) || String(a).localeCompare(String(b))).slice(0, topN)

    const title = cfg.indexTitle || RELATE_INDEX_TITLE
    // frontmatter 走摘要套件之 renderFrontmatter(與筆記同一序列化):手寫 `title: "${title}"` 遇標題含雙引號即產出解析不回去的檔頭
    const lines = [renderFrontmatter({ title, type: 'relation-index', updated: cfg.nowIso, edges: edges.length, nodes: allIds.length, shown: shown.length }), '',
        `# ${title}`, '',
        `共 ${edges.length} 條關聯，涵蓋 ${allIds.length} 篇筆記。本檔為導覽摘要（連結數前 ${shown.length} 篇）；`,
        '完整關聯圖見 `graph.json`，個別筆記的關聯見各 md 檔末章節。', '']
    for (const id of shown) {
        lines.push(`## ${titleOf.get(id) || id}`, '', `- 檔案：[[${id}]]`)
        for (const e of byFrom.get(id) || []) lines.push(`- [${e.type}] → [[${e.to}]] ${titleOf.get(e.to) || ''}：${e.reason}`)
        for (const e of byTo.get(id) || []) lines.push(`- [${e.type}] ← [[${e.from}]] ${titleOf.get(e.from) || ''}：${e.reason}`)
        lines.push('')
    }
    writeFileAtomic(path.join(cfg.dir, 'index.md'), lines.join('\n'))
    writeFileAtomic(path.join(cfg.dir, 'graph.json'), JSON.stringify({
        updatedAt: cfg.nowIso,
        nodes: notes.map((n) => ({ id: n.id, title: n.title, category: n.category, concepts: n.concepts || [] })),
        edges: edges.map((e) => ({ from: e.from, to: e.to, type: e.type, reason: e.reason })),
    }, null, 2))
}

/**
 * 錨點:rebuild(關聯總覽重建:hook 錨點 relate.relationIndex.rebuild)
 *
 * 不讀 msg.data(以 maintenance 空訊息觸發);不寫 msg.data(重建 dirs.relations 下之 index.md／graph.json);不短路(恆呼叫 next)
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {Integer} [opt.indexTopN] 輸入 index.md 顯示筆數上限，傳給 rebuildRelationIndex
 * @param {String} [opt.indexTitle] 輸入標題，未給則用 settings.relationIndexTitle
 * @returns {Object} 回傳 defineMw 產物
 * @example
 * let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let stores = {
 *     notes: { select: async () => [{ id: 'a', title: '甲' }, { id: 'b', title: '乙' }] },
 *     relations: { select: async () => [{ id: 'e1', from: 'a', to: 'b', type: '互補搭配', reason: '兩篇共用同一組指標' }] },
 * }
 * let ctx = { deps: { stores, clock: { iso8: () => '2026-11-02T00:00:00+08:00' }, dirs: { relations: dir }, settings: { relationIndexTitle: '關聯總覽' } } }
 * let mw = mwRebuildRelationIndex({ indexTopN: 5 })
 * let msg = { topic: 'maintenance', data: {}, meta: {}, stats: {} }
 * let out = await mw.handle(msg, ctx, (m) => m)
 * console.log(mw.name, out === msg, fs.readdirSync(dir).sort(), fs.readFileSync(path.join(dir, 'index.md'), 'utf8').split('\n').find((l) => l.startsWith('# ')))
 * fs.rmSync(dir, { recursive: true, force: true })
 * // => rebuild true [ 'graph.json', 'index.md' ] # 關聯總覽
 */
export const mwRebuildRelationIndex = (opt = {}) => {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    return defineMw({
        name: 'rebuild',
        handle: async (msg, ctx, next) => {
            const { stores, clock, dirs } = ctx.deps
            await rebuildRelationIndex(stores, { dir: dirs.relations, nowIso: clock.iso8(), indexTopN: opt.indexTopN, indexTitle: opt.indexTitle || ctx.deps.settings.relationIndexTitle })
            return next(msg)
        },
    })
}

/**
 * 關聯總覽重建子階段(hook 錨點:relate.relationIndex.rebuild;重建之時機見檔頭【何時重建】)
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {Array} [opt.chain] 輸入自組動作鏈(defineMw 產物陣列)，未給則以 tap 組裝預設鏈
 * @param {Object} [opt.tap] 輸入認名掛載規格(applyTaps 之 taps)
 * @param {Integer} [opt.indexTopN] 輸入 index.md 顯示筆數上限
 * @param {String} [opt.indexTitle] 輸入標題
 * @returns {Object} 回傳 stage 物件 { name, when, run }
 * @example
 * let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'))
 * let bag = new Map()
 * let ctx = {
 *     deps: {
 *         stores: { notes: { select: async () => [{ id: 'a', title: '甲' }] }, relations: { select: async () => [] } },
 *         clock: { iso8: () => '2026-11-02T00:00:00+08:00' },
 *         dirs: { relations: dir, state: dir },
 *         settings: { relationIndexTitle: '關聯總覽' },
 *     },
 *     get: (k, fallback) => (bag.has(k) ? bag.get(k) : fallback),
 *     set: (k, v) => bag.set(k, v),
 * }
 * let stage = stageRelationIndex()
 * console.log(stage.name, stage.when(ctx))
 * bag.set(RELATE_CTX_FLAGS.edgesChanged, 1)
 * console.log(stage.when(ctx))
 * let r = await stage.run(ctx)
 * console.log(r.ok, r.stats, fs.readdirSync(dir).sort())
 * fs.rmSync(dir, { recursive: true, force: true })
 * // => relationIndex false
 * // => true
 * // => true { in: 1, out: 1, skip: 0, fail: 0, aiCalls: 0 } [ 'graph.json', 'index.md' ]
 */
export function stageRelationIndex(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const chain = opt.chain || applyTaps([mwRebuildRelationIndex(opt)], opt.tap, { chainName: 'relate.relationIndex' })
    return {
        // 預設只在邊或標籤有變、或索引記為髒時重建;opt.when 給了即取代(stageFields 透傳)
        when: (ctx) => ctx.get(RELATE_CTX_FLAGS.edgesChanged, 0) > 0 || ctx.get(SUMMARIZE_CTX_FLAGS.tagChanged, 0) > 0 || (isestr(ctx.deps?.dirs?.state) && indexDirtyOf(ctx.deps.dirs.state)),
        ...stageFields(opt, { name: 'relationIndex' }),
        run: async (ctx) => {
            const r = await runChainOverMsgs({ chain, ctx, msgs: [makeMsg('maintenance', {})], chainName: 'relate.relationIndex' })
            if (r.fails === 0 && isestr(ctx.deps?.dirs?.state) && indexDirtyOf(ctx.deps.dirs.state)) {
                createRelateState(path.join(ctx.deps.dirs.state, LEDGER_FILES.state)).set({ indexDirty: false })
            }
            return stdReport({ ok: r.fails === 0, stats: { in: 1, out: 1, fail: r.fails } })
        },
    }
}

export default { RELATE_INDEX_TOP_N, rebuildRelationIndex, mwRebuildRelationIndex, stageRelationIndex }
