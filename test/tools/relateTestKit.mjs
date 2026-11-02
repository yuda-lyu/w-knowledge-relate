// relateTestKit.mjs — 關聯整合測試之共用件(不帶 .test. 中綴;只 import 套件內之檔案、兩個測試專用之橋接與 node_modules 套件)
//
// 【為何走總組裝】整合測試跑的是套件對外之總組裝 createKnowledgeRelate(設定、詞彙、domain、鎖、日誌、執行摘要皆為真實件;集合為真 LMDB),
//   只換兩件事:①workDir 換成 test/_tmp/<案名>-<pid>(LMDB、目錄、鎖檔與日誌皆落此,與他測試隔離)②AI 調度層換成腳本化替身(不發網路、
//   不燒額度)。本機網路判斷本套件預設即不做(cfg.netGuard 未給);斷網情境由測試明給判斷器。
// 【筆記即摘要套件交出之產物】landNote 由摘要套件之落筆記工廠(landNoteOf;其 test/tools/noteKit,經測試專用之橋接取用——關聯、提煉同一份)
//   實例化:以摘要套件之真實組裝(buildNote)寫 md 與記錄——關聯讀到的是摘要真實之版型與欄位(記錄之 relatedAt／extractedAt 初值為空、
//   md 之章名與行首標籤),不是測試自擬之形狀。
// 【位置無關之共用件取抓取套件】靜音與記錄型日誌、每輪日誌之工廠、落檔日誌、暫存根之工廠、概念折疊之還原、子階段 report、集合之開關、日誌目錄之檔、
//   讀 JSON、固定時鐘皆在抓取套件之 test/tools/testKit(四套件同一份;經測試專用之橋接取用)——本檔只轉出,並以本套件根實例化暫存根(PKG_ROOT、tmpRoot)。
// 【替身依提示詞之角色作答】關聯(正向、反向、輪巡同一支)、重評、衝突核對、既有邊覆核之提示詞首句各不相同(你是…的關聯建立器／
//   關聯覆核器／衝突核對器／既有關聯覆核器),替身據以判角色並解析出本批之項目,依測試給之劇本作答;回覆經呼叫端傳入之 check 驗證
//   (與生產同一驗證函數),不合即回失敗。providerId 取席位之 use(判定小組之兩票須不同供應者——測試之席位給不同之 use)。
//   替身之機制(呼叫紀錄、結果形狀、check、失敗／額度用盡、席位檢核)取抓取套件之 stubAdapter(四套件同一份),本檔只給角色表、本批之解析與預設作答。
// 【暫存】各測試自建專用資料夾(tmpRoot)、測完即刪(removeRoots;刪不掉者只警示)。

import { createKnowledgeRelate } from '../../src/createKnowledgeRelate.mjs'
import {
    genClockTZ, pkgRootOf, tmpRootsOf, silentLog, logsOf, fileLogFactory, removeRoots, resetConceptFold, subReport, withStores, findFiles, readJsonFile, FIXED_CLOCK,
    stubAdapter,
} from './captureForTest.mjs'
import { landNoteOf } from './summarizeForTest.mjs'

// 抓取套件之共用件(原樣轉出;silentLog、withStores 另為本檔之 buildTestRelate、seedNotes 所用)
export { silentLog, logsOf, fileLogFactory, removeRoots, resetConceptFold, subReport, withStores, findFiles, readJsonFile, FIXED_CLOCK }

/** 套件根(以本檔位置推導,與 cwd 無關;正斜線) */
export const PKG_ROOT = pkgRootOf(import.meta.url)

/** 專用暫存根(tmpRoot(name)＝套件內 test/_tmp/<name>-<pid>;已存在者清掉重建;帶 pid 使並行互不干擾;各測試檔自取互異之案名) */
export const { tmpRoot } = tmpRootsOf(PKG_ROOT)

/** 無人監聽之本機埠(本套件之固定埠 8861～8869 之一;連線即被拒):內建調度層之條目指向它即「整鏈皆敗」 */
export const DEAD_PORT = 8861

/** 真時鐘(Asia/Taipei;先後有意義之案用之) */
export const CLOCK = genClockTZ('Asia/Taipei')

/**
 * 摘要套件交出之筆記(落筆記工廠 landNoteOf 之預設實例:以其真實組裝 buildNote 寫 md 與組記錄;不入集合;記錄之 relatedAt 初值為空＝未關聯)
 *
 * @param {String} notesDir 輸入筆記 md 目錄
 * @param {Object} o 輸入 { doc:來源文件 id(決定 slug 之尾碼), title, concepts:Array, category?, summary?, keyPoints?:Array, conditions?:Array,
 *   k?:Object(摘要項目之其他欄位), nowIso?(建立時刻;未給取真時鐘), record?:Object(記錄之額外欄位,如 knowledgeChangedAt、relatedAt) }
 * @returns {Object} 回傳筆記記錄(id 即 slug;file 為 md 之路徑)
 */
export const landNote = landNoteOf()

/**
 * 提示詞之角色(依首句判):relate(正向／反向／輪巡)／reeval／conflictCheck／edgeReview;其餘 other
 *
 * @param {String} prompt 輸入提示詞
 * @returns {String} 回傳角色
 */
function roleOf(prompt) {
    const p = String(prompt || '')
    if (/的既有關聯覆核器。/.test(p)) return 'edgeReview'
    if (/的衝突核對器。/.test(p)) return 'conflictCheck'
    if (/的關聯覆核器。/.test(p)) return 'reeval'
    if (/的關聯建立器。/.test(p)) return 'relate'
    return 'other'
}

/**
 * 解析提示詞中本批之項目(依角色之版型)
 *
 * @param {String} prompt 輸入提示詞
 * @returns {Array} 回傳項目:relate＝[{ index, title, candidates:[{ slug, title }] }];reeval＝[{ index, title, neighbors:[{ slug, title, type }] }];
 *   conflictCheck／edgeReview＝[{ index, a(甲之標題), b(乙之標題), type(現行型別) }]
 */
export function itemsOf(prompt) {
    const p = String(prompt || '')
    const role = roleOf(p)
    if (role === 'relate') {
        return p.split(/^--- 第/m).slice(1).map((blk) => {
            const head = /^(\d+)篇（待建立關聯）---\n標題：(.*)$/m.exec(blk)
            if (!head) return null
            return { index: Number(head[1]), title: head[2], candidates: [...blk.matchAll(/^ {2}- slug: (\S+)｜標題: (.*?)｜/gm)].map((m) => ({ slug: m[1], title: m[2] })) }
        }).filter(Boolean)
    }
    if (role === 'reeval') {
        return p.split(/^--- 第/m).slice(1).map((blk) => {
            const head = /^(\d+)項（內容已更新之筆記）---\n標題：(.*)$/m.exec(blk)
            if (!head) return null
            return { index: Number(head[1]), title: head[2], neighbors: [...blk.matchAll(/^ {2}- slug: (\S+)｜標題: (.*?)｜.*｜現行型別: (.*?)｜/gm)].map((m) => ({ slug: m[1], title: m[2], type: m[3] })) }
        }).filter(Boolean)
    }
    if (role === 'conflictCheck' || role === 'edgeReview') {
        return p.split(/^--- 第/m).slice(1).map((blk) => {
            const head = /^(\d+)項 ---\n【甲】\n標題：(.*)$/m.exec(blk)
            if (!head) return null
            return { index: Number(head[1]), a: head[2], b: (/^【乙】\n標題：(.*)$/m.exec(blk) || [])[1] || '', type: ((/^現行型別：(.*?)(?:（|$)/m.exec(blk) || [])[1] || '').trim() }
        }).filter(Boolean)
    }
    return []
}

/** 預設之理由(具體、≥10 字、無數字;各角色之裁決驗證皆收) */
export const STUB_REASON = '兩篇皆討論同一組觀測方法之誤差來源與修正步驟'

/**
 * 各角色之預設作答:關聯皆不選(relations 空)、重評全判 keep、衝突核對與既有邊覆核全判 keep
 *
 * @param {String} role 輸入角色
 * @param {Array} items 輸入 itemsOf 之產物
 * @returns {Array} 回傳作答(JSON)
 */
function defaultAnswer(role, items) {
    if (role === 'relate') return items.map((t) => ({ index: t.index, relations: [] }))
    if (role === 'reeval') return items.map((t) => ({ index: t.index, verdicts: t.neighbors.map((n) => ({ to: n.slug, verdict: 'keep', reason: STUB_REASON })) }))
    if (role === 'conflictCheck' || role === 'edgeReview') return items.map((t) => ({ index: t.index, verdict: 'keep', reason: STUB_REASON }))
    return []
}

/**
 * 關聯之作答(依目標標題 → 候選標題):plan 未列之目標回空清單;候選標題不在其清單者略過(測試之前提錯誤由斷言揭露)
 *
 * @param {Array} items 輸入 itemsOf(關聯)之產物
 * @param {Object} plan 輸入 { 目標標題: [{ to:候選標題, type, reason? }] }
 * @returns {Array} 回傳作答
 */
export function relateAnswer(items, plan) {
    return items.map((t) => ({
        index: t.index,
        relations: (plan[t.title] || []).map((r) => {
            const c = t.candidates.find((x) => x.title === r.to)
            return c ? { to: c.slug, type: r.type, reason: r.reason || STUB_REASON } : null
        }).filter(Boolean),
    }))
}

/**
 * 依本套件提示詞之角色作答之 AI 替身(整組置換 cfg.aiAdapter):抓取套件之 stubAdapter＋本套件之角色表、項目解析與預設作答
 *
 * 劇本 script(role, prompt, callOpt, items) 回:作答之 JSON｜undefined(用預設作答)｜'fail'(失敗)｜'skip'(額度／時間用盡:skipped);
 * 拋錯視為失敗。回覆經呼叫端傳入之 check 驗證(回 true 才合格)。providerId 取席位之 use(未給席位者 'stub')
 *
 * @param {Function} [script] 輸入劇本
 * @param {Object} [opt={}] 輸入 { validateSeats:Boolean(具備 validateSeats;記錄於 seatChecks) }(交 stubAdapter)
 * @returns {Object} 回傳替身 { calls:Array({ role, prompt, spec, opt }), seatChecks:Array, callJson, drainStats, aiUsageToday, validateSeats? }
 */
export function scriptedAi(script, opt = {}) {
    const answer = async (prompt, callOpt, role) => {
        const items = itemsOf(prompt)
        const data = typeof script === 'function' ? await script(role, prompt, callOpt, items) : undefined
        return data === undefined ? defaultAnswer(role, items) : data
    }
    return stubAdapter(answer, { ...opt, roleOf })
}

/**
 * 以總組裝建立測試用之關聯流程
 *
 * overrides 之鍵即 cfg 之鍵(見 createKnowledgeRelate 之 CFG_KEYS),另有測試專用鍵 log(日誌物件,給了即取代靜音日誌;每輪共用同一個)。
 * 預設:afterRun false、鎖檔在 <root>/tmp/run.lock、AI 為預設作答之替身
 *
 * @param {String} root 輸入暫存根(tmpRoot 之產物或其子目錄)
 * @param {Object} [overrides={}] 輸入 cfg 覆寫
 * @returns {Object} 回傳 { flow, cfg, ai }：ai 為實際使用之 AI 調度層
 */
export function buildTestRelate(root, overrides = {}) {
    const { log, ...rest } = overrides
    const cfg = {
        workDir: root,
        afterRun: false,
        logFactory: () => log || silentLog,
        lock: `${root}/tmp/run.lock`,
        aiAdapter: scriptedAi(),
        ...rest,
    }
    return { flow: createKnowledgeRelate(cfg), cfg, ai: cfg.aiAdapter }
}

/**
 * 寫入筆記記錄(摘要套件交出者)與邊(選填)
 *
 * @param {Object} flow 輸入總組裝
 * @param {Array} notes 輸入筆記記錄陣列
 * @param {Array} [edges=[]] 輸入邊陣列
 * @returns {Promise} 回傳 Promise
 */
export async function seedNotes(flow, notes, edges = []) {
    await withStores(flow, async (s) => {
        if (notes.length) await s.notes.insertNew(notes)
        if (edges.length) await s.relations.insertNew(edges)
    })
}

export default {
    PKG_ROOT, DEAD_PORT, FIXED_CLOCK, CLOCK, silentLog, logsOf, fileLogFactory, tmpRoot, removeRoots, resetConceptFold, landNote, itemsOf, STUB_REASON,
    relateAnswer, scriptedAi, buildTestRelate, withStores, seedNotes, subReport, findFiles, readJsonFile,
}
