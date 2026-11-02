// unit-relate-object.test.mjs — 關聯物件(relateObject):子階段與動作鏈之掛載、階段契約、子階段序列與隔離、平鋪 opts 之分派、固定格式摘要
// 規格:①RELATE_STAGE_KEYS＝子階段與物件 report 之鍵(relate、project、relationIndex);RELATE_TAP_STAGE_KEYS＝有動作鏈之鍵
//   (relate、reeval、project、relationIndex——由行為推導:對不存在之錨點於建立物件時即拋「無錨點」)
//   ②opt.reeval = { tap?, chain? }:轉為 relate 子階段之 reevalTap／reevalChain;其他鍵、非物件即拋;tap 與平鋪之 reevalTap、opt.relate.reevalTap
//     以 mergeTaps 合併(三處皆生效);整條置換只能給一處 ③插件經 opt.reeval.tap 掛於 verdict／agree／apply／markReviewed 四錨點,確實送達
//   ④物件＝子階段序列(relate → project → relationIndex;總覽只在本輪邊有異動、有重標或總覽待重建時執行),工廠零參數即可用;
//     階段契約欄位可覆寫,未給者不出現;物件預設 onError:'continue'(關聯失敗不阻斷同一管線之後段)
//   ⑤子階段失敗預設隔離(記於 report、續跑後續子階段、留 WARN),宣告 onError:'abort' 才中止整個物件
//   ⑥平鋪 opts 只給 relate 子階段(與 opt.relate 合併,opt.relate 優先;tap 以 mergeTaps 合併——同錨點雙方皆 replace 即拋);
//     opt.project／opt.relationIndex 透傳對應之子階段工廠
//   ⑦固定格式摘要(relateSummaryOf)為對外契約:第一段恆在,其餘段 >0 才附、依序附於句尾;有子階段失敗時一律改走通用摘要並列出失敗者;
//     部分失敗(stats.fail>0)句尾附「｜失敗 N」
// 執行:自套件根 node <mocha> test/unit-relate-object.test.mjs(暫存 test/_tmp/relate-obj-<pid>,測完即刪;不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { recLog, memStore, genClockTZ, msgOf, withCheck, removeRoots } from './tools/captureForTest.mjs'
import { bagCtx } from './tools/summarizeForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { defineMw, stdReport } from '../src/core/capturePackage.mjs'
import { writeMd, readMd } from '../src/core/summarizePackage.mjs'
import { resolveRelateSettings } from '../src/core/relateSettings.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { makeEdge } from '../src/stores/edgeStore.mjs'
import { createRelateObject, relateSummaryOf, RELATE_STAGE_KEYS, RELATE_TAP_STAGE_KEYS } from '../src/relateObject.mjs'

let TMP = ''
let seq = 0
const clock = genClockTZ('Asia/Taipei')
const DOMAIN = createRelateDomain({})
const T0 = DOMAIN.relationTypes.find((t) => t !== DOMAIN.conflictType)
const V = '2026-02-01T00:00:00+08:00'
/** 記錄型 mw:名為 rec-<tag>,被呼叫時記下 tag 與當下 msg.data 之鍵 */
const rec = (seen, tag) => defineMw({
    name: `rec-${tag}`,
    handle: async (msg, ctx, next) => {
        seen.push([tag, Object.keys(msg.data).filter((k) => k.startsWith('_')).sort()])
        return next(msg)
    },
})

/**
 * 重評環境:一篇內容變更且正向已評完此版本之筆記 n 與其兩條既有邊;重評開啟(兩席 stub:a／stub:b,皆判 keep)
 * @returns {Object} 回傳 { ctx, callAI }
 */
function env() {
    const dir = `${TMP}/e${++seq}`
    const mk = (id, extra = {}) => {
        const file = `${dir}/notes/${id}.md`
        writeMd(file, { title: `標題${id}`, slug: id }, `# 標題${id}\n\n## 一句話重點\n\n${id} 之重點\n\n## 核心知識\n\n- 要點`)
        return { id, title: `標題${id}`, category: 'c', summary: `${id} 之重點`, concepts: ['p'], createdAt: '2026-01-01', relatedAt: '2026-01-02T00:00:00+08:00', file, ...extra }
    }
    const notes = memStore([mk('n', { knowledgeChangedAt: V, relatedChangeAt: V }), mk('a'), mk('b')])
    const OLD = '2026-01-05T00:00:00+08:00'
    const relations = memStore([makeEdge({ from: 'n', to: 'a', type: T0, reason: 'n 與 a 共用同一組參數設定', nowIso: OLD }), makeEdge({ from: 'b', to: 'n', type: T0, reason: 'b 與 n 共用同一組參數設定', nowIso: OLD })])
    const deps = {
        stores: { notes, relations, holds: memStore([]) },
        settings: resolveRelateSettings({ ai: { parallel: 1 }, relate: { ai: { use: 'stub:a' }, reeval: { perRun: 2, ai: { second: { use: 'stub:b' } } } } }),
        ai: null,
        clock,
        dirs: { state: `${dir}/state`, relations: `${dir}/relations` },
        domains: { relate: DOMAIN },
    }
    const ctx = bagCtx(deps, recLog())
    fs.mkdirSync(ctx.deps.dirs.relations, { recursive: true })
    const callAI = withCheck(async (prompt, check, co) => {
        if (co?.segment !== 'reeval') return { ok: true, data: [], error: '', skipped: false, attempts: 1 }
        const slugs = [...prompt.matchAll(/^ {2}- slug: (\S+)｜/gm)].map((m) => m[1])
        return { ok: true, data: [{ index: 1, verdicts: slugs.map((s) => ({ to: s, verdict: 'keep' })) }], error: '', skipped: false, attempts: 1, providerId: co.seat === 'first' ? 'stub:a' : 'stub:b' }
    })
    return { ctx, callAI }
}

describe('unit-relate-object', function() {

    before(() => {
        TMP = tmpRoot('relate-obj')
    })
    after(() => removeRoots([TMP]))

    it('RELATE_STAGE_KEYS 依執行順序列出子階段(物件 report 之 detail 鍵);RELATE_TAP_STAGE_KEYS 另含重評鏈 reeval;皆凍結', () => {
        assert.deepEqual([...RELATE_STAGE_KEYS], ['relate', 'project', 'relationIndex'])
        assert.deepEqual([...RELATE_TAP_STAGE_KEYS], ['relate', 'reeval', 'project', 'relationIndex'])
        assert.ok(Object.isFrozen(RELATE_STAGE_KEYS) && Object.isFrozen(RELATE_TAP_STAGE_KEYS))
    })

    it('RELATE_TAP_STAGE_KEYS＝實際有動作鏈之鍵(由行為推導,不手列):各鍵之 tap 對不存在之錨點,建立物件時即拋「無錨點」(重評鏈亦於建構期驗)', () => {
        const tapped = []
        for (const k of RELATE_TAP_STAGE_KEYS) {
            const m = msgOf(() => createRelateObject({ [k]: { tap: { __noSuchAnchor: { after: [] } } } }))
            if (/無錨點「__noSuchAnchor」/.test(m)) tapped.push(k)
        }
        assert.deepEqual(tapped, [...RELATE_TAP_STAGE_KEYS])
        assert.match(msgOf(() => createRelateObject({ reeval: { tap: { __x: { after: [] } } } })), /鏈\[relate\.reeval\] 無錨點「__x」\(可用:verdict\/agree\/apply\/markReviewed\)/)
        assert.match(msgOf(() => createRelateObject({ relate: { reevalTap: { __y: { after: [] } } } })), /鏈\[relate\.reeval\] 無錨點「__y」/, '平鋪或 opt.relate 之 reevalTap 亦於建構期驗')
    })

    it('opt.reeval 之形狀:非物件或含 tap／chain 以外之鍵即拋;null／undefined＝未給;整條置換只能給一處;opt.stages 整組置換時不讀', () => {
        assert.equal(msgOf(() => createRelateObject({ reeval: 'x' })), 'createRelateObject 之 opt.reeval 須為物件 { tap, chain }')
        assert.equal(msgOf(() => createRelateObject({ reeval: [] })), 'createRelateObject 之 opt.reeval 須為物件 { tap, chain }')
        assert.equal(msgOf(() => createRelateObject({ reeval: { tap: {}, perRun: 2 } })), 'createRelateObject 之 opt.reeval 含不認得之鍵：perRun（可用：tap、chain）')
        assert.doesNotThrow(() => createRelateObject({ reeval: null }))
        assert.doesNotThrow(() => createRelateObject({ reeval: undefined }))
        assert.doesNotThrow(() => createRelateObject({ reeval: {} }))
        assert.equal(msgOf(() => createRelateObject({ reeval: { chain: [] }, relate: { reevalChain: [] } })), 'createRelateObject 之重評鏈整條置換(reevalChain、opt.relate.reevalChain、opt.reeval.chain)只能給一處')
        assert.doesNotThrow(() => createRelateObject({ stages: [], reeval: 'x' }), 'opt.stages 整組置換:內建子階段不建,opt.reeval 不讀')
    })

    it('插件經 opt.reeval.tap 掛於 verdict／agree／apply／markReviewed 四錨點,重評時依序送達(各錨點之產物可見);平鋪之 reevalTap 與 opt.relate.reevalTap 一併合併生效', async () => {
        const e = env()
        const seen = []
        const tap = {
            verdict: { after: [rec(seen, 'verdict')] },
            agree: { after: [rec(seen, 'agree')] },
            apply: { after: [rec(seen, 'apply')] },
            markReviewed: { after: [rec(seen, 'markReviewed')] },
        }
        const rep = await createRelateObject({ relate: { callAI: e.callAI, reevalTap: { verdict: { before: [rec(seen, 'relate.reevalTap')] } } }, reevalTap: { verdict: { before: [rec(seen, 'flat.reevalTap')] } }, reeval: { tap } }).run(e.ctx)
        assert.equal(rep.detail.relate.detail.reevalCompleted, 1, JSON.stringify(rep.detail.relate.detail))
        assert.deepEqual(seen.map((x) => x[0]), ['flat.reevalTap', 'relate.reevalTap', 'verdict', 'agree', 'apply', 'markReviewed'], '一頁一項:三處之掛載皆生效、四錨點依序送達')
        const keysOf = (tag) => seen.find((x) => x[0] === tag)[1]
        assert.ok(keysOf('verdict').includes('_va') && keysOf('verdict').includes('_vb'), 'verdict 之後可見兩評之裁決')
        assert.ok(keysOf('agree').includes('_results'), 'agree 之後可見判定結果')
        assert.ok(keysOf('apply').includes('_reviewed'), 'apply 之後可見本頁已審之邊')
    })

    it('opt.reeval.chain 整條置換重評鏈(轉為 reevalChain)', async () => {
        const e = env()
        const seen = []
        const only = defineMw({
            name: 'onlyStep',
            handle: async (msg, ctx, next) => {
                seen.push(msg.data.note.id)
                return next(msg)
            },
        })
        const rep = await createRelateObject({ relate: { callAI: e.callAI }, reeval: { chain: [only] } }).run(e.ctx)
        assert.deepEqual(seen, ['n'], '置換之鏈收到該頁')
        assert.equal(rep.detail.relate.detail.reevalCompleted, 0, '預設鏈未執行(不記評完)')
    })

    it('每個子階段皆收 enabled:false 與 when(ctx)(工廠以抓取套件之 stageFields 組契約欄位,runSubStages 據以略過):停用者 report 為 { disabled:true }、不執行(不呼叫 AI);when 不合者不入 report;relationIndex 之預設 when(邊或標籤有變才重建)可被 opt.when 取代', async () => {
        // 規則:抓取套件 captureObject.runSubStages 與 core/kernel.stageFields——cfg.stageOpts.<子階段>.enabled:false 對四套件之子階段一體適用
        const e = env()
        const never = async () => assert.fail('停用之子階段不得呼叫 AI')
        const r = await createRelateObject({ relate: { enabled: false, callAI: never }, project: { enabled: false }, relationIndex: { enabled: false } }).run(e.ctx)
        assert.deepEqual(Object.keys(r.detail), [...RELATE_STAGE_KEYS])
        assert.deepEqual(Object.values(r.detail).map((x) => x.detail), [{ disabled: true }, { disabled: true }, { disabled: true }])
        assert.equal(r.ok, true)
        const e2 = env()
        const w = await createRelateObject({ relate: { when: () => false, callAI: never }, project: { when: () => false }, relationIndex: { when: () => true } }).run(e2.ctx)
        assert.deepEqual(['relate' in w.detail, 'project' in w.detail, 'relationIndex' in w.detail], [false, false, true], 'when 不合者不入 report;opt.when 取代 relationIndex 之預設 when')
    })

    // ══════════════════════════ 工廠契約 ══════════════════════════
    describe('createRelateObject 工廠契約', function() {

        it('零參數即符合階段契約(name＋run),名「關聯」、失敗預設隔離(onError:continue)——關聯失敗不阻斷同一管線之後段', () => {
            const o = createRelateObject()
            assert.deepEqual([o.name, o.onError, typeof o.run], ['關聯', 'continue', 'function'])
        })

        it('opt 非物件(null/字串/數字/陣列)→ 視為{},回傳零參數之預設階段物件(不拋錯);階段契約欄位可覆寫(name/onError/when/timeoutMs/always),未給者不出現', () => {
            for (const bogus of [null, 'bogus', 42, [1, 2]]) {
                const o = createRelateObject(bogus)
                assert.deepEqual([o.name, o.onError], ['關聯', 'continue'], JSON.stringify(bogus))
            }
            const o = createRelateObject({ name: 'relate2', onError: 'abort', timeoutMs: 5000, when: () => false, always: true })
            assert.deepEqual([o.name, o.onError, o.timeoutMs, typeof o.when, o.always], ['relate2', 'abort', 5000, 'function', true])
            const bare = createRelateObject()
            assert.deepEqual(['when', 'timeoutMs', 'always'].map((k) => k in bare), [false, false, false])
        })
    })

    // ══════════════════════════ 子階段序列與隔離 ══════════════════════════
    describe('子階段序列與隔離', function() {

        /**
         * 預設子階段之環境:筆記(含 md)、邊庫、狀態與總覽目錄、設定、domain;AI 依目標標題回劇本
         * @param {Object} o 輸入 { notes:[{ id, concepts }], plan:{ 目標 id: [對象 id] } }
         * @returns {Object} 回傳 { ctx, callAI, dir, log, relations }
         */
        const plainEnv = (o = {}) => {
            const dir = `${TMP}/p${++seq}`
            const recs = (o.notes || []).map((n) => {
                const file = `${dir}/notes/${n.id}.md`
                writeMd(file, { title: `標題${n.id}`, slug: n.id }, `# 標題${n.id}\n\n## 一句話重點\n\n${n.id} 之重點\n\n## 核心知識\n\n- 要點`)
                return { id: n.id, title: `標題${n.id}`, category: 'c', summary: `${n.id} 之重點`, concepts: n.concepts || ['p'], createdAt: '2026-01-01', relatedAt: '', file }
            })
            const relations = memStore([])
            const log = recLog()
            const ctx = bagCtx({
                stores: { notes: memStore(recs), relations, holds: memStore([]) },
                settings: resolveRelateSettings({ ai: { parallel: 1 }, relate: { ai: { use: 'stub:a' } } }),
                ai: null,
                clock,
                dirs: { state: `${dir}/state`, relations: `${dir}/relations` },
                domains: { relate: DOMAIN },
            }, log)
            const callAI = withCheck(async (prompt) => {
                const data = [...prompt.matchAll(/^--- 第(\d+)篇（待建立關聯）---\n標題：標題(\S+)$/gm)]
                    .map((m) => ({ index: Number(m[1]), relations: ((o.plan || {})[m[2]] || []).map((to) => ({ to, type: T0, reason: `${m[2]} 與 ${to} 共用同一組參數設定之步驟` })) }))
                return { ok: true, data, error: '', skipped: false, attempts: 1, providerId: 'stub:a' }
            })
            return { ctx, callAI, dir, log, relations }
        }

        it('自寫子階段宣告 onError:abort → 物件外拋(可被管線隔離)', async () => {
            const obj = createRelateObject({ stages: [{ name: 'hard', onError: 'abort', run: async () => {
                throw new Error('硬炸')
            } }] })
            await assert.rejects(() => obj.run({ deps: {}, log: recLog() }), /硬炸/)
        })

        it('stages 整組換成自寫單元:單一子階段失敗被隔離、後續照跑、留 WARN;物件 report.ok 為 false;摘要走通用格式並列出失敗者', async () => {
            const trace = []
            const log = recLog()
            const obj = createRelateObject({
                stages: [
                    { name: 'o1', run: async () => {
                        trace.push('o1')
                        return stdReport({ stats: { in: 1, out: 1 } })
                    } },
                    { name: 'boom', run: async () => {
                        throw new Error('炸')
                    } },
                    { name: 'o2', run: async () => {
                        trace.push('o2')
                        return stdReport({ stats: { in: 2, out: 2 } })
                    } },
                ],
            })
            const r = await obj.run({ deps: {}, log })
            assert.deepEqual(trace, ['o1', 'o2'], 'boom 失敗後 o2 仍執行')
            assert.ok(log.lines.includes('WARN 子階段[boom] 失敗（續跑後續子階段）：炸'), log.lines.join('\n'))
            assert.deepEqual([r.ok, r.stats.in, r.stats.fail, Object.keys(r.detail)], [false, 3, 1, ['o1', 'boom', 'o2']])
            assert.equal(r.summary, '2/3 段完成（in 3、out 3、fail 1）｜失敗：boom')
        })

        it('預設子階段依序為 relate → project(→ relationIndex);筆記不足 2 篇之空輪全數成功、總覽不執行(無邊異動、無重標、未待重建)、固定格式摘要各計數為 0', async () => {
            const e = plainEnv({ notes: [{ id: 'a' }] })
            const r = await createRelateObject({ callAI: e.callAI }).run(e.ctx)
            assert.deepEqual(Object.keys(r.detail), ['relate', 'project'])
            assert.equal(r.ok, true, JSON.stringify(r.detail))
            assert.equal(r.summary, '處理 0、關聯 0 條、衝突 0 組（AI 0 次）')
            assert.equal(fs.existsSync(`${e.dir}/relations/index.md`), false)
        })

        it('有新邊之輪:三個子階段依序執行(總覽因本輪邊有異動而重建);平鋪之 callAI 交 relate 子階段;opt.relationIndex 透傳(標題)', async () => {
            const e = plainEnv({ notes: [{ id: 'a' }, { id: 'b' }], plan: { a: ['b'] } })
            const r = await createRelateObject({ callAI: e.callAI, relationIndex: { indexTitle: '自訂總覽' } }).run(e.ctx)
            assert.deepEqual(Object.keys(r.detail), ['relate', 'project', 'relationIndex'])
            assert.equal(r.ok, true, JSON.stringify(r.detail))
            assert.equal(r.summary, '處理 2、關聯 1 條、衝突 0 組（AI 1 次）')
            assert.equal(readMd(`${e.dir}/relations/index.md`).front.title, '自訂總覽')
            assert.deepEqual(r.detail.project.detail.projected, 2, '兩端投影')
        })

        it('平鋪 tap 與 opt.relate.tap 合併而非覆蓋:兩者同錨點之 before／after 皆生效;同錨點皆 replace 即拋;opt.project.tap 透傳投影子階段之鏈', async () => {
            const seen = []
            const mw = (name) => defineMw({ name, handle: async (m, c, n) => {
                seen.push(name)
                return n(m)
            } })
            const e = plainEnv({ notes: [{ id: 'a' }, { id: 'b' }], plan: { a: ['b'] } })
            await createRelateObject({
                callAI: e.callAI,
                tap: { persistEdges: { before: [mw('flat-before')] } }, // 平鋪
                relate: { tap: { persistEdges: { after: [mw('sub-after')] } } }, // 子階段之 tap
                project: { tap: { project: { after: [mw('project-after')] } } },
            }).run(e.ctx)
            assert.deepEqual(seen.filter((x) => x !== 'project-after'), ['flat-before', 'sub-after', 'flat-before', 'sub-after'], '每篇目標各經一次:平鋪之 before 與子階段之 after 皆生效')
            assert.ok(seen.includes('project-after'), '投影之 tap 送達')
            assert.throws(() => createRelateObject({ tap: { buildEdges: { replace: mw('x') } }, relate: { tap: { buildEdges: { replace: mw('y') } } } }), /relate\.relate 錨點\[buildEdges\] 之 replace 衝突/)
        })
    })

    // ══════════════════════════ 固定格式摘要 ══════════════════════════
    describe('固定格式摘要(relateSummaryOf)與通用摘要', function() {

        const r = (detail, stats = {}) => ({ ok: true, stats: { in: 0, out: 0, skip: 0, fail: 0, aiCalls: 0, ...stats }, detail })

        it('缺 relate 之 detail(或 reports 非物件)→ 回空字串,由通用摘要接手', () => {
            for (const bad of [undefined, null, 'x', 5, {}, { project: { detail: { failed: 1 } } }, { relate: { stats: {} } }]) assert.equal(relateSummaryOf(bad), '', JSON.stringify(bad))
        })

        it('第一段「處理 N、關聯 N 條、衝突 N 組（AI N 次）」恆在;各附加段只在其計數 >0 時附上,依序附於句尾(全開之全文逐字)', () => {
            const base = { targets: 3, edges: 2, conflicts: 1 }
            const zero = { relate: r({ ...base }, { aiCalls: 2 }), project: r({ failed: 0 }) }
            assert.equal(relateSummaryOf(zero), '處理 3、關聯 2 條、衝突 1 組（AI 2 次）')
            const cases = [
                [['relate', { reTargets: 1 }], '｜重判 1 篇'],
                [['relate', { reverseTargets: 2, reverseEdges: 3 }], '｜反向 2 篇 3 條'],
                [['relate', { retired: 4 }], '｜刪除 4 條'],
                [['project', { failed: 5 }], '｜投影失敗 5'],
                [['relate', { reevalPages: 1, reevalTargets: 2, reevalChanged: 1, reevalRetired: 1, reevalCandidates: 3 }], '｜重評 2 篇（改型 1、撤銷 1、候選 3）'],
                [['relate', { reevalPages: 0, reevalTargets: 2 }], ''],
                [['relate', { edgeStdFixed: 1 }], '｜標準修正 1、未達標準 0 條'],
                [['relate', { edgeStdRejected: 2 }], '｜標準修正 0、未達標準 2 條'],
                [['relate', { typeRenamed: 3 }], '｜型別改名 3 條'],
                [['relate', { rs4Checked: 6, rs4Kept: 1, rs4ReasonFixed: 1, rs4Downgraded: 1, rs4NotSplit: 1, rs4Retired: 1, rs4StdRetired: 0, rs4Undetermined: 1 }], '｜衝突核對 6 條（成立 1、改理由 1、非衝突 2、無關聯 1、理由修不了而撤出 0、判不了 1）'],
                [['relate', { rotationTargets: 2, rotationEdges: 1, rotationDone: 3, rotationTotal: 9 }], '｜輪巡 2 篇（新邊 1；用盡 3／9 篇）'],
                [['relate', { rotationExhausted: 1, rotationDone: 4, rotationTotal: 9 }], '｜輪巡 0 篇（新邊 0；用盡 4／9 篇）'],
                [['relate', { rs6Checked: 8, rs6Kept: 1, rs6ReasonFixed: 1, rs6Retyped: 1, rs6Upgraded: 1, rs6Retired: 1, rs6StdRetired: 1, rs6TypeSplit: 1, rs6Undetermined: 1, rs6Done: 8, rs6Total: 20 }], '｜既有邊覆核 8 條（成立 1、改理由 1、改型 1、升為衝突 1、無關聯 1、理由修不了而撤出 1、型別判不了 1、判不了 1；進度 8／20）'],
            ]
            for (const [[sub, d], tail] of cases) {
                const reps = JSON.parse(JSON.stringify(zero))
                Object.assign(reps[sub].detail, d)
                assert.equal(relateSummaryOf(reps), `處理 3、關聯 2 條、衝突 1 組（AI 2 次）${tail}`, `${sub}:${JSON.stringify(d)}`)
            }
            // 全開之全文與段序
            const all = JSON.parse(JSON.stringify(zero))
            for (const [[sub, d]] of cases) Object.assign(all[sub].detail, d)
            Object.assign(all.relate.detail, { reevalPages: 1 })
            assert.equal(relateSummaryOf(all), '處理 3、關聯 2 條、衝突 1 組（AI 2 次）｜重判 1 篇｜反向 2 篇 3 條｜刪除 4 條｜投影失敗 5｜重評 2 篇（改型 1、撤銷 1、候選 3）｜標準修正 1、未達標準 2 條｜型別改名 3 條｜衝突核對 6 條（成立 1、改理由 1、非衝突 2、無關聯 1、理由修不了而撤出 0、判不了 1）｜輪巡 2 篇（新邊 1；用盡 4／9 篇）｜既有邊覆核 8 條（成立 1、改理由 1、改型 1、升為衝突 1、無關聯 1、理由修不了而撤出 1、型別判不了 1、判不了 1；進度 8／20）')
            // 缺投影子階段(自組時)不附其段
            assert.equal(relateSummaryOf({ relate: zero.relate }), '處理 3、關聯 2 條、衝突 1 組（AI 2 次）')
        })

        it('物件摘要:全數成功用固定格式,部分失敗(stats.fail>0)句尾附「｜失敗 N」;有子階段失敗者一律通用摘要並列出失敗者,不印 undefined', async () => {
            const run = async (stages) => (await createRelateObject({ stages }).run({ deps: {}, log: recLog() })).summary
            const rel = { name: 'relate', run: async () => stdReport({ stats: { aiCalls: 1, fail: 2 }, detail: { targets: 2, edges: 1, conflicts: 0 } }) }
            assert.equal(await run([rel]), '處理 2、關聯 1 條、衝突 0 組（AI 1 次）｜失敗 2')
            const bad = await run([rel, { name: 'project', run: async () => stdReport({ ok: false, stats: { fail: 1 }, detail: { blocked: true } }) }])
            assert.equal(bad, '1/2 段完成（in 0、out 0、fail 3）｜失敗：project')
            assert.doesNotMatch(bad, /undefined/)
            assert.equal(await run([{ name: 'other', run: async () => stdReport({}) }]), '1/1 段完成（in 0、out 0、fail 0）', '無 relate 子階段 → 通用摘要')
        })
    })
})
