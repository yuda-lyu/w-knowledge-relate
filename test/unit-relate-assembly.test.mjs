// unit-relate-assembly.test.mjs — 總組裝 createKnowledgeRelate 與執行期件 createRelateRuntime 之嚴格性與接線
// 規則(出自 createKnowledgeRelate 與 relateRuntime 檔頭):
//   ①設定錯誤一律啟動期拋錯,不靜默沿用預設:cfg 之未知鍵、各鍵之形狀、設定兩段(ai／relate)與總覽標題、資料、提示詞、domain、子階段(含重評鏈之錨點)、
//     啟用之功能所需之 domain 成員與判定小組席位、AI 席位皆於建構期驗;訊息點名錯誤之鍵並列可用鍵;CFG_KEYS 與實際讀取者一致
//   ②形狀錯誤之訊息不被席位檢核搶先;給了卻無效之執行期數值鍵(排程上限、時間預算、鎖陳舊期限)視同未給並以啟動期警告指名
//   ③生效之 domain 只有一份:cfg.prompts 覆寫內建者之提示詞、cfg.domains 整組置換(兩者給在同一 domain 即拋);每輪 deps.domains 即 info().domains;
//     他總組裝以 createRelateRuntime 取同一組件(opt.vocab／opt.domains;cfg.domains 含他工作之鍵而 opt.domains 給 {} 不拋)
//   ④以之為出處之下游產物集合為選用(cfg.cores);本機網路判斷為選用(cfg.netGuard 給判斷器才交調度層,斷網時整鏈皆敗記 skipped、不記 tries)
//   ⑤零設定(僅 workDir＋AI 替身)即可跑一輪:邊入邊庫、兩端 md 之關聯章、<workDir>/knowledge/relations 之總覽
//   ⑥AI 調度層:建構選項開失敗預覽與條目固有之 prompt 長度預篩、不開截斷放行(關聯之呼叫點逐次給);席位檢核取 relateSeatsOf;
//     判定小組同家警告;調度層事件(健康／額度／能力)寫入當輪日誌(注入調度層者不接)
//   ⑦選配段之保留時間經 cfg.stageOpts.relate.reserveMs 生效;每輪依賴只放可列舉之普通屬性;info() 之共同欄;符合度掃描(relate.standards.scanEachRun)
//     之計數＝同庫直接掃描之值(standards/audit 之 relateScanOf＋抓取套件之 standardsCountsOf)
// 執行:自套件根 node <mocha> test/unit-relate-assembly.test.mjs(暫存 test/_tmp/relate-assembly-<pid>,測完即刪;真 LMDB、AI 為替身、
//   本機假 REST(固定埠 8862)或指向無人監聽之埠 8861,不連外網)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import W from 'w-data-pipeline/src/WDataPipeline.mjs'
import WOrmLmdb from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import { createKnowledgeRelate, CFG_KEYS, DATA_KEYS, PROMPT_KEYS, COLLECTION_KEYS } from '../src/createKnowledgeRelate.mjs'
import {
    createRelateRuntime, resolveRelateData, RELATE_STORE_KEYS, RELATE_DATA_KEYS, RELATE_DIRS, RELATE_DOMAIN_KEYS, RELATE_PROMPT_SIGS,
} from '../src/relateRuntime.mjs'
import { RELATE_TAP_STAGE_KEYS } from '../src/relateObject.mjs'
import { resolveRelateSettings, relateSeatsOf } from '../src/core/relateSettings.mjs'
import { pickRelateVocab } from '../src/core/vocab/relateVocab.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { makeEdge } from '../src/stores/edgeStore.mjs'
import { deleteNote } from '../src/ops/noteOps.mjs'
import { auditRelateStandards, relateScanOf, RELATE_AUDITED_STANDARD_IDS, RELATE_SCAN_OBJECT } from '../src/standards/audit.mjs'
import { stdReport, defineMw, putHold, standardsCountsOf } from '../src/core/capturePackage.mjs'
import { setConceptFold, conceptFoldsOf, normalizeConcept, RUNTIME_CFG_KEYS } from './tools/captureForTest.mjs'
import { readMd } from '../src/core/summarizePackage.mjs'
import { expandDirs, lexSource, msgOf, startServer, recLog, assertSubStagesOk } from './tools/captureForTest.mjs'
import { queueConflictCheck } from '../src/standards/edgeQueue.mjs'
import { RS4 } from '../src/stores/conflictCheckPolicy.mjs'
import { RS6 } from '../src/stores/edgeReviewPolicy.mjs'
import {
    PKG_ROOT, DEAD_PORT, FIXED_CLOCK, silentLog, logsOf, tmpRoot, removeRoots, landNote, itemsOf, STUB_REASON, scriptedAi, relateAnswer, buildTestRelate, withStores, seedNotes,
    subReport, findFiles, readJsonFile,
} from './tools/relateTestKit.mjs'

const MIN = 60_000
const DEAD_BASE = `http://127.0.0.1:${DEAD_PORT}/v1` // 無人監聽:連線即被拒
const REST_PORT = 8862 // 本機假 REST(固定埠;本檔專屬)
const REST_BASE = `http://127.0.0.1:${REST_PORT}/v1`
const stubAi = scriptedAi(() => {
    throw new Error('本案不應呼叫 AI')
})
const DOMAIN = createRelateDomain({})
const T0 = DOMAIN.relationTypes.find((t) => t !== DOMAIN.conflictType)

/**
 * 從錯誤訊息「（可用：a、b、c）」取出系統自己列出之可用鍵(鍵集由系統推導,不手列)
 *
 * @param {Function} fn 輸入會拋含「可用：」訊息之函數
 * @returns {Array} 回傳可用鍵陣列
 */
const availableKeysOf = (fn) => {
    let m = ''
    try {
        fn()
    }
    catch (e) {
        m = String(e.message)
    }
    const hit = /（可用：([^）]+)）/.exec(m)
    assert.ok(hit, `訊息須列出可用鍵:${m}`)
    return hit[1].split('、')
}

// ── cfg 逐鍵之錯值(皆須拋錯並點名該鍵)、寬容鍵(無效值僅警告)、有效值(須被接受) ──
const MORE_WRONG = (extra) => ['x', 5, [], ...extra]
const SEATS = { first: { use: 'stub:f1' }, second: { use: 'stub:f2' } }
const STRICT = {
    workDir: { wrong: [5, '', {}, [], null], name: /需要 workDir/, valid: ['C:/x/y'] },
    name: { wrong: [5, '', {}, [], true, false], name: /cfg\.name 須為非空字串/, valid: ['自訂管線名'] },
    dirs: { wrong: MORE_WRONG([{ zzz: 'a' }, { db: 5 }, { relations: '' }]), name: /cfg\.dirs/, valid: [{}, { relations: 'D:/vault/relations' }] },
    timeZone: { wrong: [5, '', {}, 'Nowhere/City'], name: /cfg\.timeZone/, valid: ['UTC', 'Asia/Taipei'] },
    clock: { wrong: [{}, 'x', 5], name: /cfg\.clock/, valid: [FIXED_CLOCK] },
    lang: { wrong: [5, '', {}, [], true, '!!', 'zh_TW'], name: /cfg\.lang/, valid: ['zh-TW', 'en', 'ja'] },
    data: { wrong: MORE_WRONG([{ zzz: 1 }, { vocab: 5 }, { vocab: 'x' }, { seedSources: [] }]), name: /cfg\.data/, valid: [{}, { vocab: { domain: '天文學' } }] },
    prompts: { wrong: MORE_WRONG([{ zzz: 1 }, { relate: 'x' }, { triage: () => 'p' }]), name: /cfg\.prompts/, valid: [{}, { relate: () => 'p' }] },
    domains: { wrong: MORE_WRONG([{ zzz: {} }, { relate: 5 }, { relate: {} }, { summarize: {} }]), name: /cfg\.domains/, valid: [{}, { relate: createRelateDomain({}) }] },
    conceptFold: { wrong: ['x', 5, {}], name: /cfg\.conceptFold/, valid: [true, false, (t) => t] },
    ai: { wrong: MORE_WRONG([{ zzz: 1 }, { providerPick: [] }, { parallel: 0 }, { timeoutMs: 0 }]), name: /settings\.ai/, valid: [{}, { parallel: 2 }] },
    relate: { wrong: MORE_WRONG([{ zzz: 1 }, { rounds: 'x' }, { reeval: { apply: 'x' } }, { standards: { edgeReview: { deadline: '明年' } } }]), name: /settings\.relate/, valid: [{}, { rounds: 3 }] },
    relationIndexTitle: { wrong: [5, '', '  ', {}, [], null], name: /settings\.relationIndexTitle/, valid: ['我的關聯總覽'] },
    scheduleLimitMin: { warn: ['abc', -1, 0, {}, [], true], valid: [55, '65'] },
    deadlineMs: { warn: ['abc', -1, 0, {}, [], true], valid: [600_000] },
    lockStaleMs: { warn: ['abc', -1, 0, {}, [], true], valid: [3_600_000] },
    lock: { wrong: [5, {}, []], name: /cfg\.lock/, valid: [false, true, 'x/run.lock'] },
    envFile: { wrong: [5, {}, [], true], name: /cfg\.envFile/, valid: ['sec/.env'] },
    aiWorkspace: { wrong: [5, {}, [], true], name: /cfg\.aiWorkspace/, valid: ['x/ws'] },
    aiAdapter: { wrong: [{}, 5, 'x', [], false, 0], name: /cfg\.aiAdapter/, valid: [stubAi] },
    // 內建調度層之建構選項(抓取套件 buildAiAdapter 驗鍵集;注入 aiAdapter 時亦驗)
    aiOptions: { wrong: ['x', 5, [], true, { zzz: 1 }], name: /cfg\.aiOptions/, valid: [{}, { exes: {} }] },
    stages: { wrong: [[], 'x', 5, {}, [{ name: 'a' }]], name: /cfg\.stages/, valid: [[{ name: 'a', run: async () => ({}) }]] },
    stageOpts: { wrong: MORE_WRONG([{ zzz: {} }, { relate: 5 }, { reeval: 'x' }, { reeval: { perRun: 1 } }]), name: /cfg\.stageOpts|opt\.reeval/, valid: [{}, { relate: {} }, { reeval: { tap: {} } }, { project: {} }] },
    lmdb: { wrong: MORE_WRONG([{ zzz: 1 }, { WOrm: {} }, { path: '' }, { db: 5 }, { cls: 'x' }]), name: /cfg\.lmdb/, valid: [{}, { db: 'other' }] },
    cores: { wrong: [5, {}, [], 0], name: /cfg\.cores/, valid: [true, false, 'myCores'] },
    logFactory: { wrong: [5, 'x', {}, [], 0, false], name: /cfg\.logFactory/, valid: [() => recLog()] },
    afterRun: { wrong: [5, true, 'x', {}, [], 0], name: /cfg\.afterRun/, valid: [false, () => ({})] },
    netGuard: { wrong: ['x', 5, [], false, 0, true], name: /cfg\.netGuard/, valid: [null, { check: async () => ({ up: true }) }] },
}

// ── 本機假 REST(OpenAI 相容;共用之 startServer):依 model 選情境 ──
/**
 * 假 REST 之回應(startServer 之 sceneOf;未列之情境一律 plain):plain＝純文字(非 JSON)、trunc＝陣列截斷(finish_reason=length);
 *   rel＝依提示詞中本批之目標逐項作答(皆不選),最後一項截在半途(finish_reason=length)——REST 截斷之部分接受
 *
 * @param {String} scene 輸入情境(model 名,去延遲尾碼)
 * @param {String} prompt 輸入提示詞(最後一則訊息)
 * @returns {Object} 回傳 { content, fr }
 */
function sceneOf(scene, prompt) {
    if (scene === 'trunc') return { fr: 'length', content: '[{"index":1,"v":"a"},{"index":2,"v":"b' }
    if (scene === 'rel') {
        const full = itemsOf(prompt).map((t) => JSON.stringify({ index: t.index, relations: [] }))
        const last = full.pop() || ''
        return { fr: 'length', content: `[${[...full, last.slice(0, Math.floor(last.length / 2))].join(',')}` }
    }
    return { fr: 'stop', content: '好的，這是純文字回覆，不是 JSON。' }
}

describe('unit-relate-assembly', function() {

    this.timeout(120_000)

    let root = ''
    let srv = null
    before(async () => {
        root = tmpRoot('relate-assembly')
        srv = await startServer({ port: REST_PORT, sceneOf })
    })
    after(async () => {
        setConceptFold(null) // 概念折疊為模組級單例,不留給同 worker 之他檔
        await srv?.close()
        removeRoots([root])
    })

    let seq = 0
    const dirOf = (name = 'c') => `${root}/${name}-${++seq}`
    // 預設組裝:替身 AI、不上鎖、靜音日誌;extra 逐鍵覆寫
    const build = (extra = {}) => createKnowledgeRelate({ workDir: dirOf(), aiAdapter: stubAi, lock: false, logFactory: () => silentLog, ...extra })
    /** 兩篇共享概念之筆記(摘要套件之組裝) */
    const twoNotes = (wd, o = {}) => [
        landNote(`${wd}/knowledge/notes`, { doc: 'a', title: '恆星視差之量測', concepts: ['視差', '觀測誤差'], ...(o.a || {}) }),
        landNote(`${wd}/knowledge/notes`, { doc: 'b', title: '視差誤差之修正', concepts: ['視差', '觀測誤差'], ...(o.b || {}) }),
    ]

    // ══════════════════════════ ① cfg 逐鍵嚴格性 ══════════════════════════
    describe('cfg 逐鍵嚴格性(CFG_KEYS 全部鍵 × 錯值／寬容／有效值)', function() {

        it('案例表之鍵集等於 CFG_KEYS(新增 cfg 鍵而未補嚴格性案例即失敗);每個鍵至少有錯值或寬容案例與有效值案例', () => {
            assert.deepEqual(Object.keys(STRICT).sort(), [...CFG_KEYS].sort())
            for (const [k, s] of Object.entries(STRICT)) {
                assert.ok((s.wrong?.length || 0) + (s.warn?.length || 0) > 0, `${k} 缺錯值案例`)
                assert.ok(s.valid?.length > 0, `${k} 缺有效值案例`)
            }
        })

        for (const key of CFG_KEYS) {
            it(`${key}:${STRICT[key]?.wrong ? '錯值一律拋錯並點名該鍵' : '無效值視同未給並以啟動期警告指名(不拋)'};有效值被接受`, () => {
                const s = STRICT[key]
                for (const bad of s.wrong || []) {
                    const m = msgOf(() => build({ [key]: bad }))
                    assert.notEqual(m, null, `${key}=${JSON.stringify(bad)} 應於建構期拋錯(不得靜默接受)`)
                    assert.match(m, s.name, `${key}=${JSON.stringify(bad)}:${m}`)
                }
                for (const bad of s.warn || []) {
                    const flow = build({ [key]: bad })
                    assert.ok(flow.info().startupWarnings.some((w) => w.startsWith(`cfg.${key} 無效（收到 `) && w.endsWith('視同未給')), `${key}=${JSON.stringify(bad)} 應有指名警告:${flow.info().startupWarnings.join('｜')}`)
                }
                for (const ok of s.valid) {
                    assert.doesNotThrow(() => build({ [key]: ok }), `${key}=${typeof ok} 為有效值`)
                }
            })
        }

        it('cfg 非物件視為 {} 後由 workDir 檢查拋錯;不認得之鍵拋錯並列出全部可用鍵(即 CFG_KEYS);近似拼寫與他工作之鍵亦不接受', () => {
            for (const bad of [null, undefined, 5, 'x', []]) assert.throws(() => createKnowledgeRelate(bad), /createKnowledgeRelate 需要 workDir/)
            assert.equal(msgOf(() => build({ aiAdapte: stubAi })), `cfg 含不認得之鍵：aiAdapte（可用：${CFG_KEYS.join('、')}）`)
            assert.deepEqual(availableKeysOf(() => build({ zzz: 1 })), [...CFG_KEYS])
            for (const k of ['summarize', 'capture', 'extract', 'dedup', 'consumedOf', 'reserveMs', 'indexTitle']) assert.match(msgOf(() => build({ [k]: {} })), new RegExp(`cfg 含不認得之鍵：${k}`), k)
        })

        it('CFG_KEYS 與實際讀取者一致:本套件之讀取者(總組裝、執行期件、設定解析)所讀之 cfg 鍵＋交抓取套件 resolveRuntime 之鍵(其 runtimeCfgOf 逐鍵讀出 RUNTIME_CFG_KEYS)恰為 CFG_KEYS(以去註解與字串之骨架比對)', () => {
            const readers = ['createKnowledgeRelate.mjs', 'relateRuntime.mjs', 'core/relateSettings.mjs']
            const read = new Set()
            for (const f of readers) {
                for (const m of lexSource(fs.readFileSync(`${PKG_ROOT}/src/${f}`, 'utf8')).skeleton.matchAll(/\bcfg\??\.([A-Za-z_]\w*)/g)) read.add(m[1])
            }
            // 交抓取套件之執行期解析只收逐鍵讀出之值(抓取套件之 runtimeCfgOf):未列於 RUNTIME_CFG_KEYS 之 cfg 鍵影響不到時間預算與路徑
            const src = lexSource(fs.readFileSync(`${PKG_ROOT}/src/createKnowledgeRelate.mjs`, 'utf8')).skeleton
            assert.match(src, /resolveRuntime\(runtimeCfgOf\(cfg\)/)
            assert.doesNotMatch(src, /resolveRuntime\(cfg\b/)
            for (const k of RUNTIME_CFG_KEYS) read.add(k)
            assert.deepEqual([...read].filter((k) => !CFG_KEYS.includes(k)).sort(), [], '程式讀取之 cfg 鍵須皆列入 CFG_KEYS')
            assert.deepEqual(CFG_KEYS.filter((k) => !read.has(k)).sort(), [], 'CFG_KEYS 內不得有無人讀取之鍵')
        })
    })

    // ══════════════════════════ cfg 子鍵 ══════════════════════════
    describe('cfg 子鍵嚴格性(鍵集取自系統自己列出之可用鍵)', function() {

        it('cfg.data:只認 vocab(DATA_KEYS＝RELATE_DATA_KEYS);詞彙之未知鍵拋錯(他段之詞彙表須以 pickRelateVocab 取子集);info().data.vocab 為原給、info().vocab 為已解析', () => {
            assert.equal(DATA_KEYS, RELATE_DATA_KEYS)
            assert.deepEqual(availableKeysOf(() => build({ data: { zzz: 1 } })), ['vocab'])
            for (const bad of [5, 'x', [], false, 0]) assert.throws(() => build({ data: { vocab: bad } }), /cfg\.data\.vocab 須為物件/, `vocab=${JSON.stringify(bad)}`)
            assert.throws(() => build({ data: { vocab: { kbLable: 'x' } } }), /vocab 含不認得之鍵：kbLable/)
            const shared = { domain: '天文學', categories: ['觀測'], relationTypes: ['前提', '延伸', '衝突', '補充'], conflictType: '衝突', fallbackType: '補充', guide: { summarize: { target: '天文知識' }, relate: { vagueReason: '都屬天文學' } } }
            assert.throws(() => build({ data: { vocab: shared } }), /vocab 含不認得之鍵：categories/)
            const info = build({ data: { vocab: pickRelateVocab(shared) } }).info()
            assert.deepEqual([info.vocab.domain, info.vocab.conflictType, info.vocab.guide.relate.vagueReason], ['天文學', '衝突', '都屬天文學'])
            assert.deepEqual(info.data, { vocab: pickRelateVocab(shared) }, 'data.vocab 為安裝方原給之覆寫')
            assert.deepEqual(resolveRelateData(undefined), { vocab: null })
            assert.throws(() => resolveRelateData('x'), /cfg\.data 須為物件 \{ vocab \}/)
        })

        it('cfg.prompts:PROMPT_KEYS 各鍵給非函數即拋;函數被內建 domain 採用(收原參數＋ctx { kbLabel, domain, vocab, defaultPrompt });回傳非空字串之外者於組提示詞時拋', () => {
            assert.deepEqual([...PROMPT_KEYS], ['relate', 'reeval', 'conflictCheck', 'edgeReview'])
            assert.deepEqual([...PROMPT_KEYS], Object.keys(RELATE_PROMPT_SIGS))
            assert.deepEqual(availableKeysOf(() => build({ prompts: { zzz: 1 } })), [...PROMPT_KEYS])
            for (const k of PROMPT_KEYS) for (const bad of [5, 'x', {}, [], false, 0]) assert.throws(() => build({ prompts: { [k]: bad } }), new RegExp(`cfg\\.prompts\\.${k} 須為函數`), `prompts.${k}=${JSON.stringify(bad)}`)
            const seen = {}
            const wrap = (k) => (...args) => {
                seen[k] = args
                const ctx = args[args.length - 1]
                return `${k}｜${ctx.kbLabel}｜${ctx.defaultPrompt(...args.slice(0, -1)).length > 0}`
            }
            const d = build({ data: { vocab: { domain: '天文學' } }, prompts: Object.fromEntries(PROMPT_KEYS.map((k) => [k, wrap(k)])) }).info().domains.relate
            assert.equal(d.buildPrompt([], new Map()), 'relate｜「天文學」知識庫｜true')
            assert.equal(d.buildReevalPrompt([]), 'reeval｜「天文學」知識庫｜true')
            assert.equal(d.buildConflictCheckPrompt([]), 'conflictCheck｜「天文學」知識庫｜true')
            assert.equal(d.buildEdgeReviewPrompt([]), 'edgeReview｜「天文學」知識庫｜true')
            const { defaultPrompt, ...ctx } = seen.relate.at(-1)
            assert.deepEqual(Object.keys(ctx).sort(), ['domain', 'kbLabel', 'vocab'])
            assert.equal(typeof defaultPrompt, 'function')
            for (const bad of ['', '  ', 5, null]) assert.throws(() => build({ prompts: { relate: () => bad } }).info().domains.relate.buildPrompt([], new Map()), /須回傳非空字串/, `回傳 ${JSON.stringify(bad)}`)
        })

        it('cfg.domains:注入者原樣生效(info().domains 即之);不認得之鍵、非物件、缺成員、型別定義不合皆拋;選填成員(重評／衝突核對／既有邊覆核之提示詞)在功能關閉時可缺', () => {
            assert.deepEqual(availableKeysOf(() => build({ domains: { zzz: {} } })), ['relate'])
            assert.throws(() => build({ domains: 'x' }), /cfg\.domains 須為物件 \{ relate\? \}/)
            assert.throws(() => build({ domains: { relate: 5 } }), /cfg\.domains\.relate 須為 domain 物件/)
            const full = createRelateDomain({})
            const { buildPrompt: _bp, ...noPrompt } = full
            assert.throws(() => build({ domains: { relate: noPrompt } }), /cfg\.domains\.relate 缺成員「buildPrompt」（須具備內建 domain 之全部成員；建議以 createRelateDomain\(\{ vocab \}\) 之產物展開後覆寫）/)
            const { relationTypes: _rt, ...noTypes } = full
            assert.throws(() => build({ domains: { relate: noTypes } }), /cfg\.domains\.relate 缺成員「relationTypes」/)
            for (const [bad, re] of [
                [{ ...full, relationTypes: [] }, /relationTypes 須為非空字串陣列/],
                [{ ...full, conflictType: '不在清單' }, /conflictType「不在清單」不在 relationTypes/],
                [{ ...full, fallbackType: '不在清單' }, /fallbackType「不在清單」不在 relationTypes/],
                [{ ...full, conflictTypeNames: [] }, /conflictTypeNames 須為含 conflictType 之陣列/],
                [{ ...full, vagueReasons: 'x' }, /vagueReasons 須為字串陣列/],
                [{ ...full, relationTypeRoles: null }, /relationTypeRoles 須為物件/],
            ]) assert.match(msgOf(() => build({ domains: { relate: bad } })), new RegExp(`^cfg\\.domains\\.relate 不合：.*${re.source}.*（建議以 createRelateDomain\\(\\{ vocab \\}\\) 之產物展開後覆寫）$`), re.source)
            const { buildReevalPrompt: _r, buildConflictCheckPrompt: _c, buildEdgeReviewPrompt: _e, ...minimal } = full
            const flow = build({ domains: { relate: minimal } })
            assert.equal(flow.info().domains.relate, minimal, '注入者原樣生效')
        })

        it('啟用之功能缺 domain 成員或判定小組席位 → 建構期拋錯(不等到該段第一次執行;功能表 RELATE_FEATURES 之單一判定,訊息為其格式;同一小組之功能一句列出需要所缺之席之開啟者)', () => {
            const { buildReevalPrompt: _r, buildConflictCheckPrompt: _c, buildEdgeReviewPrompt: _e, ...minimal } = createRelateDomain({})
            const S2 = { ai: SEATS }
            assert.equal(msgOf(() => build({ domains: { relate: minimal }, relate: { reeval: { perRun: 1 } } })), '關聯重評(relate.reeval.perRun > 0)已啟用,但 cfg.domains.relate 缺 buildReevalPrompt')
            assert.equal(msgOf(() => build({ domains: { relate: minimal }, relate: { standards: { ...S2, conflictCheck: { enabled: true } } } })), '衝突核對(relate.standards.conflictCheck.enabled)已啟用,但 cfg.domains.relate 缺 buildConflictCheckPrompt')
            assert.equal(msgOf(() => build({ relate: { standards: { conflictCheck: { enabled: true } } } })), '衝突核對(relate.standards.conflictCheck.enabled)已啟用,但缺席位 settings.relate.standards.ai.first')
            assert.equal(msgOf(() => build({ domains: { relate: minimal }, relate: { standards: { ...S2, edgeReview: { enabled: true } } } })), '既有邊覆核(relate.standards.edgeReview.enabled)已啟用,但 cfg.domains.relate 缺 buildEdgeReviewPrompt')
            assert.equal(msgOf(() => build({ relate: { standards: { edgeReview: { enabled: true } } } })), '既有邊覆核(relate.standards.edgeReview.enabled)已啟用,但缺席位 settings.relate.standards.ai.first、settings.relate.standards.ai.second')
            assert.equal(msgOf(() => build({ relate: { standards: { ai: { first: SEATS.first }, edgeReview: { enabled: true } } } })), '既有邊覆核(relate.standards.edgeReview.enabled)已啟用,但缺席位 settings.relate.standards.ai.second')
            assert.equal(msgOf(() => build({ relate: { standards: { conflictCheck: { enabled: true }, edgeReview: { enabled: true } } } })), '衝突核對(relate.standards.conflictCheck.enabled)、既有邊覆核(relate.standards.edgeReview.enabled)已啟用,但缺席位 settings.relate.standards.ai.first、settings.relate.standards.ai.second', '共用小組:一句')
            assert.equal(msgOf(() => build({ relate: { standards: { ai: { first: SEATS.first }, conflictCheck: { enabled: true }, edgeReview: { enabled: true } } } })), '既有邊覆核(relate.standards.edgeReview.enabled)已啟用,但缺席位 settings.relate.standards.ai.second', '只列需要所缺之席者')
            assert.equal(msgOf(() => build({ domains: { relate: minimal }, relate: { reeval: { perRun: 1 }, standards: { conflictCheck: { enabled: true } } } })), [
                '衝突核對(relate.standards.conflictCheck.enabled)已啟用,但缺席位 settings.relate.standards.ai.first',
                '關聯重評(relate.reeval.perRun > 0)已啟用,但 cfg.domains.relate 缺 buildReevalPrompt',
                '衝突核對(relate.standards.conflictCheck.enabled)已啟用,但 cfg.domains.relate 缺 buildConflictCheckPrompt',
            ].join('；'), '多項一次列全(席位在前、成員在後)')
            // 功能關閉時缺之不拋;開啟且齊備亦不拋
            assert.doesNotThrow(() => build({ domains: { relate: minimal } }))
            assert.doesNotThrow(() => build({ relate: { reeval: { perRun: 1 }, standards: { ...S2, conflictCheck: { enabled: true }, edgeReview: { enabled: true } } } }))
            assert.doesNotThrow(() => build({ relate: { standards: { ai: { first: SEATS.first }, conflictCheck: { enabled: true } } } }), '衝突核對之新衝突以提案席為另一票:只須 first')
        })

        it('cfg.prompts 與 cfg.domains 給在同一 domain 即拋(注入者整組置換內建者,提示詞覆寫會靜默失效)', () => {
            const rd = createRelateDomain({})
            for (const k of PROMPT_KEYS) {
                assert.match(msgOf(() => build({ prompts: { [k]: () => 'p' }, domains: { relate: rd } })), new RegExp(`^cfg\\.prompts\\.${k} 與 cfg\\.domains\\.relate 擇一`), k)
            }
            assert.equal(build({ prompts: { relate: () => 'P' } }).info().domains.relate.buildPrompt([], new Map()), 'P')
        })

        it('cfg.dirs:可用鍵即抓取套件之基本目錄＋關聯之 relations;relations 預設 <workDir>/knowledge/relations 且不隨 knowledge 之覆寫移動;各鍵給非字串或空字串即拋', () => {
            const keys = Object.keys(expandDirs('c:/x', {}, RELATE_DIRS))
            assert.deepEqual(availableKeysOf(() => build({ dirs: { zzz: 'a' } })), keys)
            assert.deepEqual(keys, ['db', 'log', 'tmp', 'state', 'knowledge', 'relations'])
            for (const k of keys) for (const bad of [5, '', {}, [], false, 0]) assert.throws(() => build({ dirs: { [k]: bad } }), new RegExp(`cfg\\.dirs\\.${k} 須為非空路徑字串`), `dirs.${k}=${JSON.stringify(bad)}`)
            const wd = dirOf('dirs')
            const info = (dirs) => createKnowledgeRelate({ workDir: wd, aiAdapter: stubAi, lock: false, ...(dirs ? { dirs } : {}) }).info().dirs
            assert.equal(info().relations, `${wd}/knowledge/relations`)
            assert.deepEqual(info({ knowledge: 'D:/vault/k' }), { ...expandDirs(wd), knowledge: 'D:/vault/k', relations: `${wd}/knowledge/relations` }, 'relations 不隨 knowledge 之覆寫移動')
            assert.equal(info({ relations: 'D:/vault/relations' }).relations, 'D:/vault/relations')
        })

        it('cfg.lmdb.cls:可用鍵即 COLLECTION_KEYS(關聯之集合＋cores);預設集合名即對外名(與摘要共用一庫時不必遷移);有效值逐鍵改集合名', () => {
            assert.deepEqual([...COLLECTION_KEYS], [...RELATE_STORE_KEYS, 'cores'])
            assert.deepEqual([...RELATE_STORE_KEYS], ['notes', 'relations', 'holds', 'checks'])
            assert.deepEqual(availableKeysOf(() => build({ lmdb: { cls: { zzz: 'x' } } })), [...COLLECTION_KEYS])
            const dflt = build().info().lmdb
            assert.deepEqual(dflt.cls, Object.fromEntries(COLLECTION_KEYS.map((k) => [k, k])))
            assert.equal(dflt.db, 'knowledge')
            for (const k of COLLECTION_KEYS) assert.equal(build({ lmdb: { cls: { [k]: `my_${k}` } } }).info().lmdb.cls[k], `my_${k}`, k)
        })

        it('cfg.stageOpts:可用鍵即 RELATE_TAP_STAGE_KEYS(含重評鏈 reeval);各鍵給非物件即拋;各鍵之 tap 對不存在之錨點即拋、對既有之錨點可掛;cfg.stages 與 cfg.stageOpts 擇一', () => {
            assert.deepEqual(availableKeysOf(() => build({ stageOpts: { zzz: {} } })), [...RELATE_TAP_STAGE_KEYS])
            const a = defineMw({ name: 'a', handle: (m, c, n) => n(m) })
            const ANCHOR = { relate: 'persistEdges', reeval: 'verdict', project: 'project', relationIndex: 'rebuild' }
            assert.deepEqual(Object.keys(ANCHOR), [...RELATE_TAP_STAGE_KEYS])
            for (const k of RELATE_TAP_STAGE_KEYS) {
                for (const bad of [5, 'x', [], false, 0]) assert.throws(() => build({ stageOpts: { [k]: bad } }), new RegExp(`cfg\\.stageOpts\\.${k} 須為物件`))
                assert.doesNotThrow(() => build({ stageOpts: { [k]: {} } }), k)
                assert.throws(() => build({ stageOpts: { [k]: { tap: { nope: { after: [a] } } } } }), /無錨點「nope」/, k)
                assert.doesNotThrow(() => build({ stageOpts: { [k]: { tap: { [ANCHOR[k]]: { after: [a] } } } } }), `${k}.${ANCHOR[k]}`)
            }
            const st = [{ name: 'a', run: async () => stdReport() }]
            assert.throws(() => build({ stages: st, stageOpts: {} }), /cfg\.stages（整組自訂子階段）與 cfg\.stageOpts（內建子階段之 opt）擇一/)
            assert.throws(() => build({ stages: [{ name: 'a', run: () => {} }, { name: 'a', run: () => {} }] }), /cfg\.stages 有重複之子階段名：a/)
        })

        it('設定兩段(ai／relate)與總覽標題之子鍵嚴格性由設定解析承擔:總組裝對各組之錯誤原樣拋出(完整路徑可辨)', () => {
            assert.throws(() => build({ relate: { reverse: { perRn: 1 } } }), /settings\.relate\.reverse 含不認得之鍵：perRn（可用：perRun、ai）/)
            assert.throws(() => build({ relate: { notesPerCall: '6' } }), /settings\.relate\.notesPerCall 須為正整數/)
            assert.throws(() => build({ relate: { ai: { use: 'x', fallbak: [] } } }), /settings\.relate\.ai 須為席位物件.*含不認得之鍵：fallbak/)
            assert.throws(() => build({ ai: { providerPick: ['stub:a'] } }), /settings\.ai 含不認得之鍵：providerPick/, '關聯恆以席位呼叫 AI,不收供應商池之設定')
            assert.equal(build({ relationIndexTitle: '星空關聯總覽' }).info().settings.relationIndexTitle, '星空關聯總覽')
        })
    })

    // ══════════════════════════ ② 檢核順序 ══════════════════════════
    describe('檢核順序與跨鍵關係', function() {

        it('形狀錯誤之訊息不被席位檢核搶先:同時有 cfg 形狀錯與無法解析之席位 → 報形狀錯', () => {
            const seatBad = { relate: { ai: { use: 'oc:opencode/no-such-model-free' } } }
            assert.throws(() => createKnowledgeRelate({ workDir: dirOf(), lock: false, ...seatBad }), /AI 席位於啟動期檢核失敗/, '前提:單獨之席位錯誤確實拋出')
            for (const [name, extra, re] of [
                ['cores 型別錯', { cores: 5 }, /cfg\.cores 須為/],
                ['stages 與 stageOpts 並給', { stages: [{ name: 'a', run: () => {} }], stageOpts: {} }, /擇一/],
                ['data 形狀錯', { data: 'x' }, /cfg\.data 須為物件/],
                ['domains 缺成員', { domains: { relate: {} } }, /cfg\.domains\.relate 缺成員/],
                ['logFactory 型別錯', { logFactory: 5 }, /cfg\.logFactory/],
                ['netGuard 型別錯', { netGuard: 'x' }, /cfg\.netGuard/],
                ['lmdb 形狀錯', { lmdb: 'x' }, /cfg\.lmdb/],
                ['lock 型別錯', { lock: 5 }, /cfg\.lock/],
            ]) {
                assert.throws(() => createKnowledgeRelate({ workDir: dirOf(), ...seatBad, ...extra }), re, name)
            }
        })

        it('設定(ai／relate／總覽標題)之錯誤先於其他 cfg 鍵之形狀錯(同時錯時先報 settings)', () => {
            assert.throws(() => build({ data: 'x', relate: 'x' }), /settings\.relate 須為物件/)
        })

        it('概念折疊接線(與抓取套件同一單例):未給用內建繁簡折疊;false 明確清除先前實例注入之折疊;函數即自訂;詞彙表之概念別名一併生效', () => {
            build()
            assert.equal(normalizeConcept('視差'), normalizeConcept('视差'))
            build({ conceptFold: false })
            assert.notEqual(normalizeConcept('視差'), normalizeConcept('视差'), 'false 須明確清除')
            build({ conceptFold: (t) => t.toUpperCase() })
            assert.equal(normalizeConcept('abc'), 'ABC')
            build({ data: { vocab: { conceptAliases: { 星系: '銀河' } } } })
            assert.equal(normalizeConcept('星系'), normalizeConcept('銀河'))
        })
    })

    // ══════════════════════════ ③ 執行期件 ══════════════════════════
    describe('createRelateRuntime(總組裝共用之關聯執行期件)', function() {

        const S0 = resolveRelateSettings({})

        it('回傳之件:資料(原給)、已解析之詞彙、折疊、生效之 domain;settings 不含 relate 即拋;domain 之成員與內建工廠之產物同一組(他總組裝自建者逐一對應)', () => {
            const rt = createRelateRuntime({ data: { vocab: { domain: '天文學' } } }, S0)
            assert.deepEqual(Object.keys(rt).sort(), ['data', 'domains', 'folds', 'locale', 'vocab'])
            assert.deepEqual(Object.keys(rt.domains), [...RELATE_DOMAIN_KEYS])
            assert.deepEqual([rt.vocab.domain, rt.data.vocab], ['天文學', { domain: '天文學' }])
            assert.deepEqual(Object.keys(rt.domains.relate), Object.keys(createRelateDomain({})), 'domain 之成員同內建工廠之產物')
            assert.deepEqual(Object.keys(rt.folds), Object.keys(conceptFoldsOf(undefined)), '折疊與抓取套件之 conceptFoldsOf 同形')
            assert.equal(rt.domains.relate.buildPrompt([], new Map()).startsWith('你是「天文學」知識庫的'), true)
            assert.throws(() => createRelateRuntime({}, {}), /需要解析後之 settings\(含 relate\)/)
            assert.throws(() => createRelateRuntime({}, { ai: S0.ai }), /需要解析後之 settings/)
        })

        it('opt.vocab(他總組裝交之子集)優先於 cfg.data.vocab;domain 之注入只經 opt.domains(不讀 cfg.domains);opt.prompts 與 cfg 層同一驗證(鍵即 RELATE_PROMPT_SIGS、值須為函數)', () => {
            const rt = createRelateRuntime({ data: { vocab: { domain: '天文學' } } }, S0, { vocab: { domain: '地質學' } })
            assert.equal(rt.vocab.domain, '地質學')
            const rd = createRelateDomain({ vocab: { domain: '海洋學' } })
            const rt2 = createRelateRuntime({ domains: { relate: createRelateDomain({}) } }, S0, { domains: { relate: rd } })
            assert.equal(rt2.domains.relate, rd)
            assert.throws(() => createRelateRuntime({}, S0, { prompts: { area: () => 'p' } }), /opt\.prompts 含不認得之鍵：area（可用：relate、reeval、conflictCheck、edgeReview）/)
            assert.equal(msgOf(() => createRelateRuntime({}, S0, { prompts: { reeval: 'x' } })), 'createRelateRuntime 之 opt.prompts.reeval 須為函數 (items, ctx) => 提示詞字串')
            assert.equal(createRelateRuntime({}, S0, { prompts: { reeval: () => 'R' } }).domains.relate.buildReevalPrompt([]), 'R')
        })

        it('他總組裝之接法:cfg.domains 含他工作之鍵不讀(執行期件只收 opt.domains;未給＝無注入);opt.domains 含他工作之鍵即拋(checkKeys 之格式);整份詞彙須先以 pickRelateVocab 取子集', () => {
            const cfg = { domains: { triage: {}, summarize: {}, extract: {}, area: {}, relate: undefined } }
            assert.doesNotThrow(() => createRelateRuntime(cfg, S0, { domains: {} }))
            assert.equal(typeof createRelateRuntime(cfg, S0, { domains: {} }).domains.relate.buildPrompt, 'function')
            assert.equal(typeof createRelateRuntime(cfg, S0).domains.relate.buildPrompt, 'function', '未給 opt.domains 不退用 cfg.domains')
            assert.match(msgOf(() => createRelateRuntime({}, S0, { domains: { triage: {} } })), /^cfg\.domains 含不認得之鍵：triage（可用：relate）$/)
            const whole = { domain: '天文學', categories: ['觀測'], guide: { summarize: {}, relate: { vagueReason: '同屬天文' } } }
            assert.throws(() => createRelateRuntime({}, S0, { vocab: whole }), /vocab 含不認得之鍵：categories/)
            assert.equal(createRelateRuntime({}, S0, { vocab: pickRelateVocab(whole) }).vocab.guide.relate.vagueReason, '同屬天文')
        })

        it('不讀網路判斷與去重身分(關聯不判網路、不登記文件);本機網路判斷屬總組裝之選用(cfg.netGuard)', () => {
            const rt = createRelateRuntime({ netGuard: 'x', dedup: 'x' }, S0)
            assert.deepEqual(Object.keys(rt).sort(), ['data', 'domains', 'folds', 'locale', 'vocab'])
        })

        it('符合度掃描之對外形狀(relateScanOf):標準列之 object 為 edges;AI 列 null 補 0、全零之列與整列 null 不列;每輪計數(抓取套件之 standardsCountsOf)＝標準之計數＋AI 列之未結待判數', () => {
            assert.equal(RELATE_SCAN_OBJECT, 'edges')
            const rep = {
                counts: { edges: 4 },
                standards: { RS2: { id: 'RS2', title: 't', kind: 'program', v: 1, module: 'relate', object: '邊之理由…', total: 4, pass: 3, violation: 1, undetermined: 0, na: 0, waived: 0, violations: [{ id: 'e', detail: 'd' }], undetermineds: [], waiveds: [], info: {}, infos: [] } },
                ai: {
                    RS4: { id: 'RS4', v: 1, checked: 2, pass: 1, violation: 1, undetermined: 0, na: 0, stale: 0, holdsOpen: null, holdsWaived: null },
                    RS5: { id: 'RS5', v: null, checked: null, pass: null, violation: null, undetermined: null, na: null, stale: null, holdsOpen: 3, holdsWaived: 0 },
                    RS6: { id: 'RS6', v: 1, checked: 0, pass: 0, violation: 0, undetermined: 0, na: 0, stale: 0, holdsOpen: 0, holdsWaived: 0 },
                },
            }
            const s = relateScanOf(rep)
            assert.deepEqual(s.counts, { edges: 4 })
            assert.deepEqual(Object.keys(s.standards.RS2), Object.keys(rep.standards.RS2), '標準列之欄序不變')
            assert.equal(s.standards.RS2.object, 'edges')
            assert.deepEqual(s.ai, {
                RS4: { checked: 2, pass: 1, violation: 1, undetermined: 0, na: 0, stale: 0, holdsOpen: 0, holdsWaived: 0, v: 1 },
                RS5: { checked: 0, pass: 0, violation: 0, undetermined: 0, na: 0, stale: 0, holdsOpen: 3, holdsWaived: 0, v: null },
            }, '全零之 RS6 不列')
            assert.deepEqual(relateScanOf({ ai: { RS4: null } }).ai, {}, '整列 null(來源集合皆未給)不列')
            assert.deepEqual(standardsCountsOf(s, { at: 't', ms: 7 }), { at: 't', ms: 7, counts: { RS2: { v: 1, total: 4, violation: 1, undetermined: 0, waived: 0 } }, ai: { RS4: { holdsOpen: 0 }, RS5: { holdsOpen: 3 } } })
        })
    })

    // ══════════════════════════ info() ══════════════════════════
    describe('info():生效值單一來源', function() {

        it('預設:鍵序(共同欄)、目錄(含 relations)、集合、鎖與金鑰檔路徑皆自 workDir 展開;注入調度層時無 AI 工作區;未給排程上限即預設預算並於啟動期警告;詞彙為預設', () => {
            const wd = dirOf('info')
            const info = createKnowledgeRelate({ workDir: wd, aiAdapter: stubAi }).info()
            assert.deepEqual(Object.keys(info), ['dirs', 'settings', 'clock', 'ai', 'domains', 'locale', 'lmdb', 'data', 'vocab', 'deadlineMs', 'lockStaleMs', 'startupWarnings', 'scheduleLimitMin', 'envFile', 'aiWorkspace', 'lockFile', 'collections'])
            assert.deepEqual(info.dirs, expandDirs(wd, {}, RELATE_DIRS))
            assert.deepEqual(info.collections, [...RELATE_STORE_KEYS])
            assert.equal(info.lockFile, path.resolve(`${wd}/tmp/run.lock`))
            assert.equal(info.envFile, path.resolve(`${wd}/.env`))
            assert.equal(info.aiWorkspace, null)
            assert.deepEqual([info.scheduleLimitMin, info.deadlineMs, info.lockStaleMs], [null, 50 * MIN, 60 * MIN])
            assert.equal(info.startupWarnings.length, 1)
            assert.match(info.startupWarnings[0], /^未給 scheduleLimitMin 亦未給 deadlineMs/)
            assert.deepEqual(info.data, { vocab: null })
            assert.deepEqual([info.vocab.domain, info.vocab.conflictType], ['', DOMAIN.conflictType])
            assert.deepEqual(Object.keys(info.domains), ['relate'])
            assert.deepEqual(Object.keys(info.settings), ['ai', 'relate', 'relationIndexTitle', 'capacity', 'warnings'])
            assert.equal(info.ai, stubAi)
        })

        it('執行期:排程上限推導預算與鎖陳舊期限;明給者優先;envFile 相對者以 workDir 為基準;lock 字串即鎖檔路徑、false 即無鎖;時鐘原樣採用或依時區建立', () => {
            const a = build({ scheduleLimitMin: 55 }).info()
            assert.deepEqual([a.scheduleLimitMin, a.deadlineMs, a.lockStaleMs, a.startupWarnings], [55, 49 * MIN, 60 * MIN, []])
            assert.equal(build({ deadlineMs: 20 * MIN }).info().deadlineMs, 20 * MIN)
            const wd = dirOf('paths')
            const rel = createKnowledgeRelate({ workDir: `${wd.replace(/\//g, '\\')}\\`, aiAdapter: stubAi, envFile: 'sec/.env', lock: `${wd}/x/my.lock` }).info()
            assert.deepEqual([rel.dirs.db, rel.envFile, rel.lockFile], [`${wd}/db`, path.resolve(`${wd}/sec/.env`), path.resolve(`${wd}/x/my.lock`)])
            assert.equal(build({ lock: false }).info().lockFile, null)
            assert.equal(build({ clock: FIXED_CLOCK }).info().clock, FIXED_CLOCK)
            assert.match(build({ timeZone: 'UTC' }).info().clock.iso8(), /\+00:00$/)
        })
    })

    // ══════════════════════════ 每輪依賴與執行 ══════════════════════════
    describe('每輪依賴(deps)與一輪執行', function() {

        it('deps 契約:{ stores, clock, dirs, data, vocab, locale, settings, ai, domains, promptFpOf } 皆為可列舉之普通屬性;同一輪各子階段取得同一份;deps.domains／vocab／settings／data 即 info() 之同一物件;stores 為 RELATE_STORE_KEYS', async () => {
            const sink = []
            const probe = (name) => ({ name, run: async (ctx) => {
                sink.push(ctx.deps)
                return stdReport()
            } })
            let viaAfter = null
            const flow = build({ stages: [probe('p1'), probe('p2')], afterRun: ({ deps }) => {
                viaAfter = deps
            } })
            const rep = await flow.run()
            assertSubStagesOk(rep, assert)
            const d = sink[0]
            assert.equal(d, sink[1], '同一輪各子階段之 deps 為同一份')
            // promptFpOf:邊之產出鏈之提示詞指紋(每輪一個快取實例;stores/edgeProvenance),為產出鏈新增之依賴
            assert.deepEqual(Object.keys(d).sort(), ['ai', 'clock', 'data', 'dirs', 'domains', 'locale', 'promptFpOf', 'settings', 'stores', 'vocab'])
            const desc = Object.getOwnPropertyDescriptors(viaAfter)
            for (const [k, dd] of Object.entries(desc)) assert.ok(dd.enumerable && 'value' in dd && !dd.get, `deps.${k} 須為可列舉之普通屬性`)
            assert.deepEqual(Object.keys(d.stores), [...RELATE_STORE_KEYS])
            const info = flow.info()
            assert.deepEqual([d.domains === info.domains, d.vocab === info.vocab, d.settings === info.settings, d.data === info.data, d.ai === info.ai, d.clock === info.clock], [true, true, true, true, true, true])
            assert.deepEqual(Object.keys(d.dirs), ['db', 'log', 'tmp', 'state', 'knowledge', 'relations'])
            await assert.rejects(() => d.stores.notes.get('x'), undefined, '執行結束後集合已關閉')
        })

        it('零設定(僅 workDir＋AI 替身)跑一輪:摘要交出之筆記經關聯落邊、兩端 md 寫入關聯章、<workDir>/knowledge/relations 之總覽;日誌、開工標記與執行摘要落 <workDir>/log;執行鎖已釋放', async () => {
            const wd = dirOf('zero')
            const ai = scriptedAi((role, p, o, items) => (role === 'relate' ? relateAnswer(items, { 恆星視差之量測: [{ to: '視差誤差之修正', type: T0 }] }) : undefined))
            const flow = createKnowledgeRelate({ workDir: wd, aiAdapter: ai })
            const [a, b] = twoNotes(wd)
            await seedNotes(flow, [a, b])
            const orig = console.log
            console.log = () => {} // 預設日誌同時輸出 stdout:測試中靜音
            let rep
            try {
                rep = await flow.run()
            }
            finally {
                console.log = orig
            }
            assertSubStagesOk(rep, assert)
            assert.deepEqual(ai.calls.map((c) => c.role), ['relate'])
            await withStores(flow, async (s) => {
                const edges = await s.relations.select()
                assert.deepEqual(edges.map((e) => [e.type, [e.from, e.to].sort().join('|')]), [[T0, [a.id, b.id].sort().join('|')]])
                for (const n of await s.notes.select()) assert.ok(n.relatedAt, `${n.id} 已關聯`)
            })
            const mdA = readMd(a.file)
            assert.deepEqual(mdA.front.related, [b.id])
            assert.match(mdA.body, new RegExp(`## 關聯\\n\\n- \\[${T0}\\] → \\[\\[${b.id}\\]\\] 視差誤差之修正：`))
            assert.deepEqual(fs.readdirSync(`${wd}/knowledge/relations`).sort(), ['graph.json', 'index.md'])
            assert.equal(findFiles(`${wd}/log`, '-run.log').length, 1)
            assert.equal(findFiles(`${wd}/log`, '-run.start.json').length, 1)
            const sum = readJsonFile(rep.summaryFile)
            assert.deepEqual([sum.name, sum.stages.map((s) => s.name), Object.keys(sum.stages[0].sub)], ['知識關聯', ['關聯'], ['relate', 'project', 'relationIndex']])
            assert.ok(!fs.existsSync(`${wd}/tmp/run.lock`), '執行鎖已釋放')
        })

        it('cfg.cores(選開之下游產物集合):預設不開;true 或集合名才開(唯讀);集合名與 lmdb.cls.cores 不一致即拋;開啟後維運 API(明示刪除之預演)列出以該篇為出處者', async () => {
            assert.deepEqual(build().info().collections, [...RELATE_STORE_KEYS])
            assert.deepEqual(build({ cores: true }).info().collections, [...RELATE_STORE_KEYS, 'cores'])
            assert.equal(build({ cores: 'myCores' }).info().lmdb.cls.cores, 'myCores')
            assert.throws(() => build({ cores: 'a', lmdb: { cls: { cores: 'b' } } }), /cfg\.cores（a）與 cfg\.lmdb\.cls\.cores（b）不一致：核心集合名擇一給/)
            assert.equal(build({ lmdb: { cls: { cores: 'c' } } }).info().collections.includes('cores'), false, '只給集合名而未開 cores 仍不開')
            const wd = dirOf('cores')
            const flow = createKnowledgeRelate({ workDir: wd, aiAdapter: stubAi, lock: false, cores: true })
            const [a, b] = twoNotes(wd)
            await seedNotes(flow, [a, b])
            const info = flow.info()
            const r = await withStores(flow, async (s) => {
                assert.deepEqual(Object.keys(s), [...RELATE_STORE_KEYS, 'cores'])
                await s.cores.insertNew([{ id: 'k1', noteIds: [a.id] }, { id: 'k2', noteIds: [b.id] }])
                return deleteNote({ stores: s, dirs: info.dirs, clock: info.clock, log: silentLog, domain: info.domains.relate }, a.id, { dryRun: true })
            })
            assert.deepEqual([r.dryRun, r.cores], [true, ['k1']])
        })

        it('cfg.stageOpts.relate.reserveMs 生效(選配段扣保留給後段之時間):保留大於剩餘 → 重評延後(INFO);函數形式每輪求值(收 ctx);保留 0 → 照常評', async () => {
            const V = '2026-02-01T00:00:00+08:00'
            const prep = async (flow, wd) => {
                const [a, b] = twoNotes(wd, { a: { record: { relatedAt: '2026-01-02T00:00:00+08:00', knowledgeChangedAt: V, relatedChangeAt: V } }, b: { record: { relatedAt: '2026-01-02T00:00:00+08:00' } } })
                await seedNotes(flow, [a, b], [makeEdge({ from: a.id, to: b.id, type: T0, reason: '兩篇皆討論視差量測之誤差來源與修正', nowIso: '2026-01-05T00:00:00+08:00' })])
            }
            const relate = { ai: { use: 'stub:a' }, reeval: { perRun: 1, ai: { second: { use: 'stub:b' } } } }
            const wd1 = dirOf('reserve')
            const lg = logsOf()
            const f1 = buildTestRelate(wd1, { relate, stageOpts: { relate: { reserveMs: 10 * 3_600_000 } }, logFactory: lg.factory }).flow
            await prep(f1, wd1)
            const d1 = subReport(await f1.run(), '關聯', 'relate').detail
            assert.deepEqual([d1.reevalPending, d1.reevalDeferred, d1.reevalCompleted], [1, true, 0])
            assert.ok(lg.lines().some((l) => /^INFO 關聯重評：扣保留時間後剩餘時間不足一次呼叫（300s），本輪延後（待重評 1 篇）$/.test(l)), lg.lines().join('\n'))
            const seen = []
            const wd2 = dirOf('reserve')
            const f2 = buildTestRelate(wd2, { relate, stageOpts: { relate: { reserveMs: (ctx) => {
                seen.push(typeof ctx.remainingMs)
                return 0
            } } } }).flow
            await prep(f2, wd2)
            const d2 = subReport(await f2.run(), '關聯', 'relate').detail
            assert.deepEqual([d2.reevalDeferred, d2.reevalCompleted, seen.includes('function')], [false, 1, true])
        })

        it('run.json:管線名「知識關聯」、唯一之段「關聯」、子階段之 report;AI 實績取自調度層之 drainStats;檔名為本輪時間戳', async () => {
            const { flow } = buildTestRelate(dirOf('runjson'), { clock: FIXED_CLOCK })
            const rep = await flow.run()
            const sum = readJsonFile(rep.summaryFile)
            assert.equal(sum.name, '知識關聯')
            assert.deepEqual(sum.stages.map((s) => [s.name, s.ok]), [['關聯', true]])
            assert.deepEqual(Object.keys(sum.stages[0].sub), ['relate', 'project'])
            assert.equal(sum.stages[0].summary, '處理 0、關聯 0 條、衝突 0 組（AI 0 次）')
            assert.deepEqual(sum.ai, { usageToday: {}, callStats: '無呼叫' })
            assert.equal(path.basename(rep.summaryFile), '20260102030405-run.json')
        })

        it('cfg.name 取代管線名(run.json 之 name);未給用內建名「知識關聯」', async () => {
            const { flow } = buildTestRelate(dirOf('pname'), { clock: FIXED_CLOCK, name: '自訂管線名' })
            assert.equal(readJsonFile((await flow.run()).summaryFile).name, '自訂管線名')
        })

        it('符合度掃描(relate.standards.scanEachRun):預設關 → 不掃、run.json 無 standards;開 → 管線後掃 RS1／RS2／RS3／RS8 與 AI 標準之待判,計數＝同庫直接掃描之值,日誌一行「符合度掃描（…）：違反 …」', async () => {
            const wd = dirOf('scan')
            const lg1 = logsOf()
            const first = buildTestRelate(wd, { logFactory: lg1.factory })
            const [a, b] = twoNotes(wd)
            await seedNotes(first.flow, [a, b], [makeEdge({ from: a.id, to: b.id, type: T0, reason: '都與某主題有關', nowIso: '2026-01-05T00:00:00+08:00' })])
            await withStores(first.flow, (s) => putHold(s.holds, { object: 'note', oid: a.id, std: 'RS5', reason: '測試', next: '測試', owner: 'user', deadline: '2026-12-31T00:00:00.000Z', ctx: {} }, '2026-01-05T00:00:00+08:00'))
            const r1 = await first.flow.run()
            assert.equal('standards' in readJsonFile(r1.summaryFile), false, '未開掃描:run.json 無 standards')
            assert.equal(lg1.lines().some((l) => l.includes('符合度掃描')), false)
            const lg2 = logsOf()
            const second = buildTestRelate(wd, { logFactory: lg2.factory, relate: { standards: { scanEachRun: true } } })
            const r2 = await second.flow.run()
            const st = readJsonFile(r2.summaryFile).standards
            assert.deepEqual(Object.keys(st.counts), [...RELATE_AUDITED_STANDARD_IDS])
            assert.deepEqual(Object.keys(st.counts), ['RS1', 'RS2', 'RS3', 'RS8'])
            let direct
            await withStores(second.flow, async (stores) => {
                direct = standardsCountsOf(relateScanOf(await auditRelateStandards({ stores, domain: second.flow.info().domains.relate }, { material: true })), { at: st.at, ms: st.ms })
            })
            assert.deepEqual(st, direct, '計數＝同庫直接掃描(同一形狀)')
            assert.deepEqual([st.counts.RS2.violation, st.counts.RS2.total], [1, 1])
            assert.deepEqual(st.ai, { RS5: { holdsOpen: 1 } }, '有待判之 AI 標準才列;全零者不列')
            assert.ok(Number.isInteger(st.ms) && st.ms >= 0 && typeof st.at === 'string' && st.at.length > 0)
            assert.equal(lg2.lines().filter((l) => /^INFO 符合度掃描（\d+\.\d+s）：違反 RS2 1$/.test(l)).length, 1, lg2.lines().join('\n'))
        })
    })

    // ══════════════════════════ ⑥ AI 調度層 ══════════════════════════
    describe('AI 調度層(席位、建構選項、斷網、事件日誌)', function() {

        it('席位檢核:注入之調度層有 validateSeats 者以 relateSeatsOf 檢核(建構期一次),其警告併入啟動期警告;內建調度層對無法解析之席位建構期拋錯;預設席位可解析', () => {
            const ai = scriptedAi(undefined, { validateSeats: true })
            const flow = build({ aiAdapter: ai, relate: { reverse: { ai: { use: 'stub:r' } } } })
            assert.deepEqual(ai.seatChecks, [relateSeatsOf(flow.info().settings)])
            assert.deepEqual(Object.keys(ai.seatChecks[0]), ['relate.ai', 'relate.reverse.ai'])
            assert.ok(build({ aiAdapter: { ...stubAi, validateSeats: () => ({ warnings: ['席位提示一'] }) } }).info().startupWarnings.includes('席位提示一'))
            assert.match(msgOf(() => createKnowledgeRelate({ workDir: dirOf(), lock: false, relate: { ai: { use: 'oc:opencode/no-such-model-free' } } })), /^AI 席位於啟動期檢核失敗（1 席）：relate\.ai → 席位引用了不可用的條目：oc:opencode\/no-such-model-free/)
            assert.doesNotThrow(() => createKnowledgeRelate({ workDir: dirOf(), lock: false }), '套件預設席位須可解析')
        })

        it('判定小組同家:已開啟之小組其兩席首選同家且無不同家之第三席 → 啟動期警告(每輪以「啟動期檢核：」記入日誌)', async () => {
            const same = { use: 'stub:x' }
            const lg = logsOf()
            const flow = build({ relate: { reeval: { perRun: 1, ai: { first: same, second: same } } }, logFactory: lg.factory, stages: [{ name: 's', run: async () => stdReport() }] })
            const w = flow.info().startupWarnings.find((x) => x.startsWith('關聯重評（relate.reeval.ai）'))
            assert.ok(w, flow.info().startupWarnings.join('｜'))
            await flow.run()
            assert.ok(lg.lines().includes(`WARN 啟動期檢核：${w}`))
        })

        it('建構選項:失敗預覽開(失敗形狀帶 preview＝模型回覆之前段)、截斷放行不在建構期開(直接呼叫遇 REST 截斷即失敗;逐次給 acceptTruncated 才部分接受)', async () => {
            const flow = createKnowledgeRelate({
                workDir: dirOf('rest'), lock: false,
                ai: { extraProviders: ['plain', 'trunc', 'rel'].map((m) => ({ id: `t:${m}`, kind: 'api-openai-compat', baseURL: REST_BASE, model: m })) },
                relate: { ai: { use: 't:plain' } },
            })
            const ai = flow.info().ai
            const p = await ai.callJson('請只回 JSON', (d) => Array.isArray(d), { spec: { use: 't:plain' } })
            assert.deepEqual([p.ok, p.preview], [false, '好的，這是純文字回覆，不是 JSON。'])
            const t0 = await ai.callJson('請只回 JSON', (d) => Array.isArray(d), { spec: { use: 't:trunc' } })
            assert.equal(t0.ok, false, '建構期未開截斷放行')
            assert.match(t0.error, /finish_reason=length/)
            const t1 = await ai.callJson('請只回 JSON', (d) => Array.isArray(d), { spec: { use: 't:trunc' }, acceptTruncated: true })
            assert.deepEqual([t1.ok, t1.truncated, t1.data], [true, true, [{ index: 1, v: 'a' }]])
        })

        it('建構選項:條目固有之 prompt 長度預篩開啟(capability)——席位之全鏈條目皆有上限者於啟動期警告;放不下之條目呼叫前剔除、不送出', async () => {
            const flow = createKnowledgeRelate({
                workDir: dirOf('cap'), lock: false,
                ai: { extraProviders: [{ id: 't:cap', kind: 'api-openai-compat', baseURL: DEAD_BASE, model: 'm', maxPromptChars: 10 }] },
                relate: { ai: { use: 't:cap' } },
            })
            assert.ok(flow.info().startupWarnings.some((w) => w.startsWith('relate.ai 之全鏈條目皆有 prompt 長度上限（t:cap≤10）')), flow.info().startupWarnings.join('｜'))
            const r = await flow.info().ai.callJson('q', () => true, { spec: { use: 't:cap' } })
            assert.deepEqual([r.ok, r.attempts], [false, 0])
            assert.match(r.error, /超過本席位全部條目之上限（t:cap≤10）/)
        })

        it('關聯之呼叫逐次截斷放行(經內建調度層之真實 REST 截斷):一批兩篇而最後一項截在半途 → 前段完整之項套用、未涵蓋者記 relateTries 留佇列', async () => {
            const wd = dirOf('rest-rel')
            const lg = logsOf()
            const flow = createKnowledgeRelate({
                workDir: wd, lock: false, logFactory: lg.factory,
                ai: { extraProviders: [{ id: 't:rel', kind: 'api-openai-compat', baseURL: REST_BASE, model: 'rel' }] },
                relate: { ai: { use: 't:rel' }, rounds: 1 },
            })
            const [a, b] = twoNotes(wd)
            await seedNotes(flow, [a, b])
            const d = subReport(await flow.run(), '關聯', 'relate').detail
            assert.deepEqual([d.targets, d.missed, d.failedBatches], [1, 1, 0], JSON.stringify(d))
            await withStores(flow, async (s) => {
                const rows = await s.notes.select()
                assert.deepEqual(rows.map((n) => [!!n.relatedAt, n.relateTries || 0]).sort(), [[false, 1], [true, 0]])
            })
            assert.ok(lg.lines().includes('INFO 批次：2 項中 1 項完整、1 項未涵蓋（留佇列下輪）'), lg.lines().join('\n'))
            assert.ok(srv.hits.some((h) => h.model === 'rel' && /--- 第2篇（待建立關聯）---/.test(h.prompt)), '兩篇同一批送出')
        })

        it('斷網不計:注入之 netGuard 確認不通 → 整鏈皆敗之呼叫記 skipped(批次中止),筆記之 relateTries 不變、WARN 含「本機網路不通」;未給 netGuard → 照常記 tries', async () => {
            const wire = (netGuard, wd, lg) => createKnowledgeRelate({
                workDir: wd, lock: false, logFactory: lg.factory, ...(netGuard ? { netGuard } : {}),
                ai: { extraProviders: [{ id: 't:dead', kind: 'api-openai-compat', baseURL: DEAD_BASE, model: 'm' }] },
                relate: { ai: { use: 't:dead' } },
            })
            let asked = 0
            const guard = { check: async () => ({ up: false, detail: [] }), confirmDown: async () => {
                asked++
                return true
            }, isDown: () => true, describe: () => '' }
            const lg = logsOf()
            const wd1 = dirOf('net-down')
            const down = wire(guard, wd1, lg)
            await seedNotes(down, twoNotes(wd1))
            const d = subReport(await down.run(), '關聯', 'relate').detail
            assert.deepEqual([d.aborted, d.failedBatches, asked], [true, 0, 1])
            await withStores(down, async (s) => assert.deepEqual((await s.notes.select()).map((n) => n.relateTries), [undefined, undefined], '斷網不記 tries'))
            assert.ok(lg.lines().some((l) => /^WARN 批次 AI 失敗（本機網路不通（不計此次之失敗）：/.test(l)), lg.lines().join('\n'))
            const lg2 = logsOf()
            const wd2 = dirOf('net-none')
            const plain = wire(null, wd2, lg2)
            await seedNotes(plain, twoNotes(wd2))
            await plain.run()
            await withStores(plain, async (s) => assert.deepEqual((await s.notes.select()).map((n) => n.relateTries), [1, 1], '未給判斷器:失敗照常記 tries'))
            assert.ok(!lg2.lines().some((l) => l.includes('本機網路不通')))
        })

        it('斷網不計(兩席段與重評;終審 R75):衝突核對(RS4 待判)、既有邊覆核(RS6 待判)與重評(內容變更之筆記)之席位皆指向死埠、netGuard 確認不通 → 兩段記 rs4Stopped／rs6Stopped、待判之 tries 不增、不記檢核紀錄、重評之筆記 reevalTries 不增、WARN 含「本機網路不通」', async () => {
            const dead = (id) => ({ id, kind: 'api-openai-compat', baseURL: DEAD_BASE, model: 'm' })
            const guard = { check: async () => ({ up: false, detail: [] }), confirmDown: async () => true, isDown: () => true, describe: () => '' }
            const RELATED_AT = '2026-01-02T00:00:00+08:00'
            const V = '2026-02-01T00:00:00+08:00'
            const lg = logsOf()
            const wd = dirOf('net-down-panels')
            const flow = createKnowledgeRelate({
                workDir: wd, lock: false, logFactory: lg.factory, netGuard: guard,
                ai: { extraProviders: [dead('t:dead'), dead('t:dead2'), dead('t:dead3')] },
                relate: {
                    ai: { use: 't:dead' },
                    reeval: { perRun: 2, ai: { second: { use: 't:dead2' } } },
                    standards: { conflictCheck: { enabled: true, perRun: 5 }, edgeReview: { enabled: true, perRun: 5 }, ai: { first: { use: 't:dead' }, second: { use: 't:dead2' }, third: { use: 't:dead3' } } },
                },
            })
            // 兩篇已關聯;a 內容變更(重評之對象);a–b 衝突邊登錄 RS4 待判;b–c 非衝突邊登錄 RS6 待判(存量 RS2)
            const [a, b] = twoNotes(wd, { a: { record: { relatedAt: RELATED_AT, knowledgeChangedAt: V, relatedChangeAt: V } }, b: { record: { relatedAt: RELATED_AT } } })
            const c = landNote(`${wd}/knowledge/notes`, { doc: 'c', title: '星等之定義', concepts: ['視差'], record: { relatedAt: RELATED_AT } })
            const eAB = makeEdge({ from: a.id, to: b.id, type: DOMAIN.conflictType, reason: '甲說視差誤差可修正；乙說視差誤差不可修正', nowIso: '2026-01-05T00:00:00+08:00' })
            const eBC = makeEdge({ from: b.id, to: c.id, type: T0, reason: 'placeholder', nowIso: '2026-01-05T00:00:00+08:00' })
            await seedNotes(flow, [a, b, c], [eAB, eBC])
            await withStores(flow, async (s) => {
                assert.equal(await queueConflictCheck(s.holds, { edgeId: eAB.id, from: eAB.from, to: eAB.to, reason: '測試：既有衝突邊交兩席核對', at: '2026-01-06T00:00:00+08:00' }), 'queued')
                await putHold(s.holds, { object: RS6.objectEdge, oid: eBC.id, std: RS6.std, reason: '測試：理由佔位', next: '測試', owner: 'pipeline', deadline: '2026-12-31T00:00:00.000Z', ctx: { from: eBC.from, to: eBC.to, type: eBC.type, stockStd: 'RS2' } }, '2026-01-06T00:00:00+08:00')
            })
            const d = subReport(await flow.run(), '關聯', 'relate').detail
            assert.deepEqual([d.rs4Stopped, d.rs6Stopped, d.rs4Holds, d.rs6Holds], [true, true, 1, 1], JSON.stringify(d))
            await withStores(flow, async (s) => {
                const holds = await s.holds.select()
                assert.deepEqual(holds.map((h) => [h.std, h.status, h.tries]).sort(), [[RS4.std, 'open', 0], [RS6.std, 'open', 0]], '待判原樣:不記 tries、不結案')
                assert.deepEqual(await s.checks.select(), [], '斷網不記檢核紀錄')
                assert.equal((await s.notes.get(a.id)).reevalTries, undefined, '重評之筆記不記 tries')
                assert.deepEqual((await s.relations.select()).map((e) => [e.id, e.type, e.reason]).sort(), [[eAB.id, eAB.type, eAB.reason], [eBC.id, eBC.type, eBC.reason]].sort(), '邊不動')
            })
            const net = lg.lines().filter((l) => l.includes('本機網路不通'))
            assert.ok(net.length >= 1, lg.lines().join('\n'))
            assert.ok(lg.lines().some((l) => /^INFO 衝突核對：額度或截止中止/.test(l)) && lg.lines().some((l) => /^INFO 既有邊覆核：額度或截止中止/.test(l)), lg.lines().join('\n'))
        })

        it('調度層事件寫入當輪日誌(內建調度層;條目指向無人監聽之埠):健康降序(ai.healthStreak 1)「供應商健康：」、免費池額度(ai.pools)「供應商額度：」、能力剔除(ai.providerLimits)「供應商能力：」各一行;注入之調度層不接', async () => {
            const dead = { id: 't:dead', kind: 'api-openai-compat', baseURL: DEAD_BASE, model: 'm' }
            const run = async (ai, relate, extra = {}) => {
                const lg = logsOf()
                const wd = dirOf('ev')
                const flow = createKnowledgeRelate({ workDir: wd, lock: false, clock: FIXED_CLOCK, logFactory: lg.factory, ai, relate: { rounds: 1, ...relate }, ...extra })
                await seedNotes(flow, twoNotes(wd))
                await flow.run()
                return lg.lines().filter((l) => l.startsWith('WARN 供應商'))
            }
            const h = await run({ extraProviders: [dead], healthStreak: 1 }, { ai: { use: 't:dead' } })
            assert.equal(h.length, 1, h.join('\n'))
            assert.match(h[0], /^WARN 供應商健康：t:dead 連續 1 次 \S+ 失敗（.*），降序冷卻$/)
            const ocLog = `${dirOf('oclog')}/opencode.log`
            fs.mkdirSync(path.dirname(ocLog), { recursive: true })
            fs.writeFileSync(ocLog, `timestamp=${new Date().toISOString()} level=ERROR providerID=opencode modelID=mimo-v2.6-flash-free error.error="AI_APICallError: Rate limit exceeded. Please try again later."\n`, 'utf8')
            const p = await run({ extraProviders: [dead], pools: { oc: { log: ocLog, resetUtcHour: 0 } } }, { ai: { use: 't:dead' } })
            assert.equal(p.length, 1, p.join('\n'))
            assert.match(p[0], /^WARN 供應商額度：oc:opencode\/mimo-v2\.6-flash-free 自 \d{2}:\d{2} 起 opencode 日誌回報當日額度用盡（1 筆，最近 \d{2}:\d{2}），本輪呼叫前降至鏈尾、照設定遞補，至每日重置（UTC 0 時）止$/)
            const c = await run({ extraProviders: [dead, { ...dead, id: 't:dead2' }], providerLimits: { 't:dead': 5 } }, { ai: { use: 't:dead', fallback: ['t:dead2'] } })
            assert.equal(c.length, 1, c.join('\n'))
            assert.match(c[0], /^WARN 供應商能力：t:dead 之 prompt 上限 5 字元，本輪有呼叫達 \d+ 字元而改由遞補承接（未 spawn）$/)
            const off = await run({ healthStreak: 1, pools: { oc: { log: ocLog } } }, {}, { aiAdapter: scriptedAi(() => 'fail') })
            assert.deepEqual(off, [], '注入之調度層屬注入方:不接事件')
        })

        it('關聯之調度層預設開健康降序(ai.healthStreak 3,同摘要之 ai 段):同一條目連續 3 次整鏈皆敗才降序', async () => {
            assert.equal(build().info().settings.ai.healthStreak, 3)
            const flow = createKnowledgeRelate({
                workDir: dirOf('streak'), lock: false,
                ai: { extraProviders: [{ id: 't:dead', kind: 'api-openai-compat', baseURL: DEAD_BASE, model: 'm' }] },
                relate: { ai: { use: 't:dead' } },
            })
            const ai = flow.info().ai
            assert.equal(ai.health.threshold, 3)
            for (let i = 0; i < 2; i++) await ai.callJson('q', () => true, { spec: { use: 't:dead' } })
            assert.equal(ai.health.snapshot().counts['t:dead']?.cooled || 0, 0, '2 次未達門檻')
            await ai.callJson('q', () => true, { spec: { use: 't:dead' } })
            assert.equal(ai.health.snapshot().counts['t:dead'].cooled, 1, '第 3 次整鏈皆敗即降序')
        })
    })

    // ══════════════════════════ 集合落點(真 LMDB) ══════════════════════════
    describe('集合之落點(真 LMDB)', function() {

        it('lmdb.cls 改名之集合:資料寫入自訂之集合名、預設名之集合為空', async () => {
            const wd = dirOf('cls')
            const flow = createKnowledgeRelate({ workDir: wd, aiAdapter: stubAi, lock: false, lmdb: { cls: { relations: 'myRelations' } } })
            await withStores(flow, async (st) => {
                await st.relations.insertNew([{ id: 'e1', from: 'a', to: 'b', type: T0, reason: STUB_REASON }])
            })
            const peek = async (cl) => {
                const c = W.openCollection({ WOrm: WOrmLmdb, path: `${wd}/db`, db: 'knowledge', cl })
                try {
                    return (await c.select()).map((r) => r.id)
                }
                finally {
                    await c.close()
                }
            }
            assert.deepEqual(await peek('myRelations'), ['e1'])
            assert.deepEqual(await peek('relations'), [], '預設名之邊庫不得有資料')
        })
    })
})
