// unit-relate-standards.test.mjs — 邊之確定性檢定標準(standards/edgeStandards 之純函數;新進閘與符合度掃描共用之判定):
//   RS1(結構)、RS2(理由形式)、RS3(正體;[[連結]] 與網址不檢)、RS8(數字紮根)各之合格／不合格／未能判定,與資訊項 edgeInfoOf
//   (history 條目與句界截短不算邊本身之違反)
// 規則:每條標準之合格、不合格、未能判定(與不適用)各至少一案;納入閘(standards/edgeGate)與存量修正(standards/stockFix 之 edgeFixOf)對連結之處置與判定同一規則;
//   現行理由須改寫才能合格者(reasonRewriteProblemsOf):正規化後只判現行理由之 RS2／RS3／RS8 之不合格(正體可修者、沿革、RS1、材料不可得者不列),
//   既有邊覆核與衝突核對共用此一函數(不另手寫)
// 執行:自套件根 node <mocha> test/unit-relate-standards.test.mjs(純函數與原始碼盤點,不寫檔、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { withoutForeignSpans } from '../src/core/capturePackage.mjs'
import { scriptProblems, toTwKeepLinks } from './tools/captureForTest.mjs'
import { checkEdge, reasonFormProblem, edgeInfoOf } from '../src/standards/edgeStandards.mjs'
import { gateEdgeProposal, normalizeEdgeProposal, reasonRewriteProblemsOf, REASON_REWRITE_STDS, checkPromptItemOf } from '../src/standards/edgeGate.mjs'
import { edgeFixOf } from '../src/standards/stockFix.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const RELATION_TYPES = ['互補搭配', '衝突或反例']
const by = (rs, std) => rs.find((r) => r.std === std)

describe('unit-relate-standards', function() {

    describe('邊(standards/edgeStandards)', function() {

        const E = (o = {}) => ({ id: 'e1', from: 'a', to: 'b', type: '互補搭配', reason: '兩篇皆以十二減一月動量建構組合並扣除交易成本', ...o })
        const ctx = { relationTypes: RELATION_TYPES, vague: ['都與交易有關', '同屬量化交易'], hasNote: (id) => ['a', 'b'].includes(id), materialOf: (id) => ({ a: '回看 12 個月', b: '成本 0.15%' }[id] ?? null) }

        it('合格邊:RS1～RS3、RS8 皆合格', () => {
            for (const r of checkEdge(E(), ctx)) assert.equal(r.status, 'pass', `${r.std}：${r.detail}`)
        })

        it('RS1:端點不存在、自指、清單外型別 → 不合格', () => {
            assert.equal(by(checkEdge(E({ to: 'zz' }), ctx), 'RS1').status, 'violation')
            assert.equal(by(checkEdge(E({ to: 'a' }), ctx), 'RS1').status, 'violation')
            assert.match(by(checkEdge(E({ type: '互補搴配' }), ctx), 'RS1').detail, /不在清單/)
        })

        it('RS2:佔位字、只有空泛片語、去標點後不足 10 字 → 不合格;具體之長理由含空泛片語不誤殺', () => {
            assert.match(reasonFormProblem('placeholder'), /佔位/)
            assert.match(reasonFormProblem('...'), /佔位/)
            assert.match(reasonFormProblem('都與交易有關', ctx.vague), /只剩 0 字/)
            assert.match(reasonFormProblem('該篇同侯共跳步前誤'), /只剩 9 字/)
            assert.equal(reasonFormProblem('同屬量化交易且兩篇皆以十二減一月動量建構組合', ctx.vague), '')
        })

        it('RS3:理由或 history 之簡體 → 不合格', () => {
            assert.equal(by(checkEdge(E({ reason: '两篇都用动量因子建构组合并扣除成本' }), ctx), 'RS3').status, 'violation')
            assert.match(by(checkEdge(E({ history: [{ reason: '旧理由之后续' }] }), ctx), 'RS3').detail, /history\[0\]/)
        })

        it('RS3 v2:[[連結]] 與網址不檢(與 SS3／ES3／CS12 同一規則);納入閘與存量修正皆不轉連結、只轉其餘違規處', () => {
            const linked = '兩篇皆以十二減一月動量建構組合，見 [[动量因子-简体slug]] 與 https://x.com/数据'
            assert.equal(by(checkEdge(E({ reason: linked }), ctx), 'RS3').status, 'pass')
            assert.equal(by(checkEdge(E({ history: [{ reason: `舊理由，見 [[旧-slug]]` }] }), ctx), 'RS3').status, 'pass')
            const g = gateEdgeProposal(E({ reason: '两篇都以动量建构组合，见 [[动量因子-简体slug]]' }), ctx)
            assert.equal(g.ok, true, g.reasons?.join('；'))
            assert.equal(g.edge.reason, '兩篇都以動量建構組合，見 [[动量因子-简体slug]]')
            const f = edgeFixOf(E({ reason: '两篇之后续见 [[旧-slug]]', history: [{ from: 'a', to: 'b', type: '互補搭配', reason: '见 https://x.com/数据', createdAt: '' }] }))
            assert.equal(f.edge.reason, '兩篇之後續見 [[旧-slug]]')
            assert.equal(f.edge.history[0].reason, '見 https://x.com/数据')
            assert.equal(edgeFixOf(E({ reason: linked })), null, '只有連結內之簡體者無須修正')
        })

        it('RS8:兩端皆無之數字 → 不合格;端點材料不可得 → 未能判定;理由無數字 → 合格(不取材料)', () => {
            assert.equal(by(checkEdge(E({ reason: '兩篇皆以 12 個月回看期建構動量組合' }), ctx), 'RS8').status, 'pass')
            assert.equal(by(checkEdge(E({ reason: '兩篇皆以 24 個月回看期建構動量組合' }), ctx), 'RS8').status, 'violation')
            assert.equal(by(checkEdge(E({ to: 'c', reason: '兩篇皆以 12 個月回看期建構動量組合' }), { ...ctx, hasNote: () => true }), 'RS8').status, 'undetermined')
            let called = 0
            by(checkEdge(E(), { ...ctx, materialOf: () => { called++; return '' } }), 'RS8')
            assert.equal(called, 0)
        })

        it('資訊項 edgeInfoOf(不算邊本身之違反;審查 A-B12、B-M16、A-B21):history 條目之 RS1 型別／RS2 形式／RS8 數字(材料可得者)、理由之句界截短;邊本身之判定不受 history 之 RS1／RS2／RS8 影響', () => {
            const e = E({ reasonCut: 236, history: [{ from: 'b', to: 'a', type: '舊型別', reason: '同上', createdAt: 'x' }, { from: 'a', to: 'b', type: '互補搭配', reason: '兩篇皆以 24 個月回看期建構動量組合', createdAt: 'y' }] })
            const info = edgeInfoOf(e, ctx)
            assert.deepEqual(info.map((x) => [x.std, x.kind]), [['RS1', 'history'], ['RS2', 'history'], ['RS8', 'history'], ['RS2', 'cut']])
            assert.match(info[0].detail, /^history\[0\] 型別「舊型別」不在清單$/)
            assert.match(info[2].detail, /^history\[1\] 兩端皆無之數字：24/)
            assert.match(info[3].detail, /^理由於句界截短（原 236 字）$/)
            for (const s of ['RS1', 'RS2', 'RS8']) assert.equal(by(checkEdge(e, ctx), s).status, 'pass', `${s}:history 只計資訊`)
            // RS8 能判者:材料不可得 → 不計;理由無數字 → 不取材料
            assert.deepEqual(edgeInfoOf(e, { ...ctx, materialOf: () => null }).map((x) => x.std), ['RS1', 'RS2', 'RS2'])
            let called = 0
            edgeInfoOf(E({ history: [{ type: '互補搭配', reason: '兩篇皆以十二減一月動量建構組合' }] }), { ...ctx, materialOf: () => { called++; return '' } })
            assert.equal(called, 0)
            assert.deepEqual(edgeInfoOf(E(), ctx), [])
        })
    })

    describe('現行理由須改寫才能合格者(standards/edgeGate 之 reasonRewriteProblemsOf)', function() {

        const D = createRelateDomain({})
        const T = '互補搭配'
        const mat = { a: '週期 12 個月', b: '樣本 340 顆' }
        const ctx = { resolveType: D.resolveType, relationTypes: D.relationTypes, vague: D.vagueReasons, hasNote: (id) => id in mat, materialOf: (id) => (id in mat ? mat[id] : null) }
        const E = (reason, o = {}) => ({ id: 'e', from: 'a', to: 'b', type: T, reason, ...o })
        // 兩段(既有邊覆核、衝突核對)原手寫之式(收斂前;RS2／RS8 之字串須與之逐字同)
        const legacy = (edge, c) => checkEdge(normalizeEdgeProposal(edge, { resolveType: c.resolveType }).edge, c).filter((r) => (r.std === 'RS2' || r.std === 'RS8') && r.status === 'violation').map((r) => `${r.std} ${r.detail}`)

        it('RS2／RS3／RS8 依序回「<標準> <說明>」;RS2／RS8 之字串與兩段原手寫之式逐字同;未給 materialOf 不判 RS8;RS1 與材料不可得之未能判定不列;標準清單凍結', () => {
            assert.deepEqual([...REASON_REWRITE_STDS], ['RS2', 'RS3', 'RS8'])
            assert.ok(Object.isFrozen(REASON_REWRITE_STDS))
            const samples = [
                E('placeholder'), // RS2 佔位
                E('都與某主題有關'), // RS2 只有空泛片語
                E('週期 37 天'), // RS2 過短＋RS8 兩端皆無之數字
                E('兩篇皆以 12 個月週期與 340 顆樣本比較軌道'), // 合格(數字見於兩端)
                E('兩篇皆以 99 個月週期比較軌道之量測方法'), // RS8
                E('兩篇皆以 12 個月週期比較軌道之量測方法', { to: 'gone' }), // RS1 端點不存在 → 不列;RS8 材料不可得 → 未能判定,不列
                E('兩篇皆以近日點距離之量測方法比較軌道', { type: '不在清單之型' }), // RS1 → 不列
                E('两篇都讨论轨道之量测方法与误差'), // 正體可修 → 不列
                E(`兩篇皆以近日點距離之量測方法比較軌道。${'乙'.repeat(220)}`), // 逾長於句界截短後合格
            ]
            for (const e of samples) assert.deepEqual(reasonRewriteProblemsOf(e, ctx), legacy(e, ctx), e.reason.slice(0, 20))
            assert.deepEqual(reasonRewriteProblemsOf(E('週期 37 天'), ctx), ['RS2 去空泛片語與標點後只剩 5 字（須 ≥10）', 'RS8 兩端皆無之數字：37 天'], '依標準之序')
            assert.deepEqual(reasonRewriteProblemsOf(E('週期 37 天'), { ...ctx, materialOf: undefined }), ['RS2 去空泛片語與標點後只剩 5 字（須 ≥10）'], '未給 materialOf 不判 RS8')
            assert.deepEqual(reasonRewriteProblemsOf(E('兩篇皆以 12 個月週期比較軌道之量測方法', { to: 'gone' }), ctx), [])
            assert.deepEqual([reasonRewriteProblemsOf(E('placeholder')), reasonRewriteProblemsOf(null, ctx)], [['RS2 佔位理由「placeholder」'], ['RS2 佔位理由「」']], 'ctx 可缺、邊非物件照判')
        })

        it('正體:確定性可修者不列(掃描之 RS3 仍判落庫原值不合格——分工);只有沿革有字形問題者不列(改寫理由修不了沿革);[[連結]] 與網址內不計', () => {
            const fixable = E('两篇都讨论轨道之量测方法与误差')
            assert.equal(checkEdge(fixable, ctx).find((r) => r.std === 'RS3').status, 'violation', '掃描判原值:不合格')
            assert.deepEqual(reasonRewriteProblemsOf(fixable, ctx), [], '可確定性修正 → 不須改寫')
            const hist = E('兩篇皆以近日點距離之量測方法比較軌道', { history: [{ from: 'b', to: 'a', type: T, reason: '旧理由之后续', createdAt: 'x' }] })
            assert.match(checkEdge(hist, ctx).find((r) => r.std === 'RS3').detail, /^history\[0\]/)
            assert.deepEqual(reasonRewriteProblemsOf(hist, ctx), [], '只有沿革 → 不列')
            assert.deepEqual(reasonRewriteProblemsOf(E('兩篇皆以近日點量測方法比較，見 [[旧-slug]] 與 https://x.test/数据'), ctx), [])
        })

        it('「列 RS3 ⇔ 經同一正規化後現行理由仍有字形問題」之定義(以真實字形驗);現行字表下無「正規化後仍不合格」之實例(簡體專用字、同形字誤用、誤用詞之單字、夾字、兩兩相鄰、連結與網址之交界之全量搜尋皆無)——此類之去處以存量處置與兩段之共用流程(RS2／RS8 同一條)承接', () => {
            const reasons = ['两篇都讨论轨道之量测方法与误差', '由于观测之后续，准确度不足', '兩篇之后與由于之說明皆需修正', '据此判斷之价格與几何', '之后由于数据', '皇后與茶几之敘述與量測']
            for (const r of reasons) {
                const residual = scriptProblems(withoutForeignSpans(toTwKeepLinks(r))).count > 0
                assert.equal(reasonRewriteProblemsOf(E(r), ctx).some((p) => p.startsWith('RS3 ')), residual, r)
                assert.equal(residual, false, `${r}:現行字表可確定性修正`)
            }
        })

        it('既有邊覆核與衝突核對共用本函數:兩段之原始碼皆呼叫 reasonRewriteProblemsOf,且無 RS2／RS8 之手寫篩選(同一規則不寫兩份)', () => {
            const dir = path.join(PKG, 'src', 'stages')
            const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs'))
            const src = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]))
            for (const f of ['edgeReviewSegment.mjs', 'conflictCheckSegment.mjs']) assert.match(src[f], /reasonRewriteProblemsOf\(x\.edge, stockCtx\)/, f)
            assert.deepEqual(files.filter((f) => /r\.std === 'RS2' \|\| r\.std === 'RS8'/.test(src[f])), [])
        })

        it('核對類提示詞之項 checkPromptItemOf:問題以「；」接、單行至多 120 字附 reasonProblem;無問題不附此鍵;只取邊之 type 與 reason;兩段之 promptItem 與評分之項皆經之(同一形式不寫兩份)', () => {
            const item = { index: 3, a: { note: 'A' }, b: { note: 'B' }, edge: { type: T, reason: '週期 37 天', from: 'a', to: 'b', extra: 1 } }
            const bad = reasonRewriteProblemsOf(item.edge, ctx)
            assert.deepEqual(checkPromptItemOf(item, bad), { index: 3, a: { note: 'A' }, b: { note: 'B' }, edge: { type: T, reason: '週期 37 天', reasonProblem: 'RS2 去空泛片語與標點後只剩 5 字（須 ≥10）；RS8 兩端皆無之數字：37 天' } })
            assert.deepEqual(checkPromptItemOf(item, []).edge, { type: T, reason: '週期 37 天' }, '無問題不附 reasonProblem')
            assert.deepEqual(checkPromptItemOf(item).edge, { type: T, reason: '週期 37 天' }, '未給問題視為無')
            assert.equal(checkPromptItemOf(item, ['x'.repeat(300)]).edge.reasonProblem, `${'x'.repeat(120)}...`, '單行截至 120 字(抓取套件之 oneline)')
            const dir = path.join(PKG, 'src', 'stages')
            for (const f of ['edgeReviewSegment.mjs', 'conflictCheckSegment.mjs']) assert.match(fs.readFileSync(path.join(dir, f), 'utf8'), /const promptItem = \(x\) => checkPromptItemOf\(x, x\.bad\)/, f)
            assert.match(fs.readFileSync(path.join(PKG, 'src', 'bench', 'relateBench.mjs'), 'utf8'), /pairCheckItemOf\(c\.input, k, domain\)/, '評分之項經同一形式(項編號由核心給)')
        })
    })
})
