// unit-relate-prompts.test.mjs — 關聯 domain 之提示詞覆寫(opt.prompts:relate、reeval、conflictCheck、edgeReview)
// 規格:①覆寫函數收原參數＋末參數 ctx { kbLabel, domain, vocab, defaultPrompt },defaultPrompt＝內建提示詞函數(包裝後逐字等於內建)
//   ②建構期驗形狀:opt.prompts 非物件、不認得之鍵、值非函數即拋(訊息形式同摘要套件之 domain 工廠;函數形式見 RELATE_PROMPT_SIGS);
//     undefined／null 之值＝用內建 ③呼叫期:覆寫之回傳非非空字串即拋 ④輸出之驗證與 AI 所見之區塊(seenTextOf;RS8 之新進材料)不隨覆寫改變
//   ⑤只覆寫一支者,其餘三支逐字為內建
// 執行:自套件根 node <mocha> test/unit-relate-prompts.test.mjs(純函數,不寫檔、不呼叫 AI)

import assert from 'node:assert/strict'
import { createRelateDomain, RELATE_PROMPT_SIGS } from '../src/domain/relateDomain.mjs'
import { msgOf } from './tools/captureForTest.mjs'

const V = { domain: '天文學', relationTypes: ['前提', '延伸', '衝突', '補充'], conflictType: '衝突', fallbackType: '補充' }
const T = { id: 't-11111111', title: '目標', category: 'c', concepts: ['光度'], summary: '目標之重點' }
const CAND = { id: 'c-22222222', title: '候選', category: 'c', concepts: ['光度'], summary: '候選之重點' }
const CMAP = new Map([[T.id, [CAND]]])
const RE_ITEMS = [{ target: T, summary: '目標之一句話重點', neighbors: [{ note: CAND, edge: { type: '延伸', reason: '目標延伸候選之光度量測方法' } }] }]
const CK_ITEMS = [{ index: 1, a: { note: T, extra: { summary: '甲之重點' } }, b: { note: CAND, extra: { summary: '乙之重點' } }, edge: { type: '衝突', reason: '甲說亮、乙說暗' } }]
const ER_ITEMS = [{ index: 1, a: { note: T, extra: {} }, b: { note: CAND, extra: {} }, edge: { type: '延伸', reason: '目標延伸候選之光度量測方法' } }]

/** 各鍵:對應之 domain 方法與其固定輸入 */
const SPECS = {
    relate: { call: (d) => d.buildPrompt([T], CMAP), args: [[T], CMAP] },
    reeval: { call: (d) => d.buildReevalPrompt(RE_ITEMS), args: [RE_ITEMS] },
    conflictCheck: { call: (d) => d.buildConflictCheckPrompt(CK_ITEMS), args: [CK_ITEMS] },
    edgeReview: { call: (d) => d.buildEdgeReviewPrompt(ER_ITEMS), args: [ER_ITEMS] },
}

describe('unit-relate-prompts', function() {

    it('RELATE_PROMPT_SIGS:四鍵與覆寫函數之形式(凍結;抓取套件之 SIGS 形狀 { params, returns? },回傳皆為預設之提示詞字串)', () => {
        assert.deepEqual(RELATE_PROMPT_SIGS, { relate: { params: '(targets, candidateMap, ctx)' }, reeval: { params: '(items, ctx)' }, conflictCheck: { params: '(items, ctx)' }, edgeReview: { params: '(items, ctx)' } })
        assert.ok(Object.isFrozen(RELATE_PROMPT_SIGS) && Object.values(RELATE_PROMPT_SIGS).every((v) => Object.isFrozen(v)))
        assert.deepEqual(Object.keys(SPECS), Object.keys(RELATE_PROMPT_SIGS))
    })

    it('覆寫函數收原參數＋末參數 ctx { kbLabel, domain, vocab, defaultPrompt };回傳即為提示詞;只覆寫一支者其餘三支逐字為內建', () => {
        const plain = createRelateDomain({ vocab: V })
        for (const [key, s] of Object.entries(SPECS)) {
            const seen = []
            const d = createRelateDomain({ vocab: V, prompts: { [key]: (...a) => {
                seen.push(a)
                return `自訂-${key}`
            } } })
            assert.equal(s.call(d), `自訂-${key}`, key)
            assert.equal(seen.length, 1)
            const a = seen[0]
            assert.equal(a.length, s.args.length + 1, `${key}:原參數＋ctx`)
            assert.deepEqual(a.slice(0, -1), s.args, key)
            const ctx = a.at(-1)
            assert.deepEqual([ctx.kbLabel, ctx.domain, ctx.vocab.relationTypes, typeof ctx.defaultPrompt], ['「天文學」知識庫', '天文學', V.relationTypes, 'function'], key)
            for (const [k2, s2] of Object.entries(SPECS)) if (k2 !== key) assert.equal(s2.call(d), s2.call(plain), `覆寫 ${key} 不影響 ${k2}`)
        }
    })

    it('defaultPrompt 為內建提示詞函數:包裝後逐字等於內建、可加前後文', () => {
        for (const [key, s] of Object.entries(SPECS)) {
            const builtin = s.call(createRelateDomain({ vocab: V }))
            const wrap = createRelateDomain({ vocab: V, prompts: { [key]: (...a) => a.at(-1).defaultPrompt(...a.slice(0, -1)) } })
            assert.equal(s.call(wrap), builtin, key)
            const deco = createRelateDomain({ vocab: V, prompts: { [key]: (...a) => `前言\n${a.at(-1).defaultPrompt(...a.slice(0, -1))}\n附註` } })
            assert.equal(s.call(deco), `前言\n${builtin}\n附註`, key)
        }
    })

    it('呼叫期:覆寫之回傳非非空字串即拋;非陣列之輸入以 [] 交覆寫函數(與內建同一正規化)', () => {
        for (const [key, s] of Object.entries(SPECS)) {
            for (const bad of ['', '   ', 123, undefined, null, {}]) {
                assert.equal(msgOf(() => s.call(createRelateDomain({ prompts: { [key]: () => bad } }))), `opt.prompts.${key} 須回傳非空字串`, `${key}=${JSON.stringify(bad)}`)
            }
        }
        const got = []
        const d = createRelateDomain({ prompts: { relate: (targets, cmap) => {
            got.push([targets, cmap instanceof Map])
            return 'x'
        }, reeval: (items) => {
            got.push([items])
            return 'y'
        } } })
        d.buildPrompt('x', 'y')
        d.buildReevalPrompt(null)
        assert.deepEqual(got, [[[], true], [[]]])
    })

    it('建構期:值非函數 → 拋(附函數形式「(參數) => 回傳」,與 cfg 層同形;SIGS 為覆寫形式之唯一來源);opt.prompts 非物件 → 拋;不認得之鍵 → 拋並列可用鍵;undefined／null 值 → 用內建;詞彙不合先於提示詞拋', () => {
        for (const [key, s] of Object.entries(SPECS)) {
            for (const bad of ['x', 1, {}, [], true]) assert.equal(msgOf(() => createRelateDomain({ prompts: { [key]: bad } })), `createRelateDomain 之 opt.prompts.${key} 須為函數 ${RELATE_PROMPT_SIGS[key].params} => 提示詞字串`, `${key}=${JSON.stringify(bad)}`)
            for (const v of [undefined, null]) assert.equal(s.call(createRelateDomain({ prompts: { [key]: v } })), s.call(createRelateDomain({})), `${key}=${v}`)
        }
        assert.equal(msgOf(() => createRelateDomain({ prompts: 'x' })), 'createRelateDomain 之 opt.prompts 須為物件 { relate, reeval, conflictCheck, edgeReview }（各為覆寫提示詞之函數）')
        assert.equal(msgOf(() => createRelateDomain({ prompts: [() => 'x'] })), 'createRelateDomain 之 opt.prompts 須為物件 { relate, reeval, conflictCheck, edgeReview }（各為覆寫提示詞之函數）')
        assert.equal(msgOf(() => createRelateDomain({ prompts: { summarize: () => 'x', forward: () => 'y' } })), 'createRelateDomain 之 opt.prompts 含不認得之鍵：summarize、forward（可用：relate、reeval、conflictCheck、edgeReview）')
        assert.doesNotThrow(() => createRelateDomain({ prompts: null }))
        assert.match(msgOf(() => createRelateDomain({ vocab: { categories: ['x'] }, prompts: 'x' })), /^vocab 含不認得之鍵：categories/, '詞彙先驗')
    })

    it('輸出驗證之依據與 AI 所見之區塊不隨覆寫改變:型別解析、空泛片語、型別角色、衝突型之名、seenTextOf 逐字同內建;domain 之成員不變', () => {
        const plain = createRelateDomain({ vocab: V })
        const custom = createRelateDomain({ vocab: V, prompts: { relate: () => 'p', reeval: () => 'r', conflictCheck: () => 'c', edgeReview: () => 'e' } })
        assert.deepEqual(Object.keys(custom), Object.keys(plain))
        for (const k of ['relationTypes', 'conflictType', 'fallbackType', 'relationTypeRenames', 'relationTypeRoles', 'conflictTypeNames', 'vagueReasons']) assert.deepEqual(custom[k], plain[k], k)
        for (const raw of ['延伸', ' 衝突 ', '不在清單', '']) assert.equal(custom.resolveType(raw), plain.resolveType(raw), raw)
        for (const role of ['target', 'candidate', 'reevalTarget', 'reevalNeighbor', 'checkSide']) {
            const extra = { summary: '全文重點', edge: { type: '延伸', reason: '理由' }, keyPoints: ['要點'] }
            assert.equal(custom.seenTextOf(T, role, extra), plain.seenTextOf(T, role, extra), role)
        }
    })
})
