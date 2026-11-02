// unit-relate-registry.test.mjs — 關聯檢定標準之全集(standards/registry)之欄位完整性與單一來源
// 規則(出自 standards/registry 檔頭):
//   ①每條標準一列定義(id、標題、對象、kind、版本、能證明／不能證明、執行處、是否掃描、掃描說明);全集為 RS1～RS6、RS8、RS9、RS10
//     (RS7 不列——刪除與撤出之可追溯為資料契約;型別改名之宣告併入 RS1,不另列);欄序固定、全集與各列凍結
//   ②執行處為「套件內檔案:函數」:檔存在、檔內宣告該名(讀檔＋正則)、且 import 後為函數;同一標準之寫入入口皆列(正向閘、反向與輪巡〔同一
//     逐項鏈〕、重評改寫、衝突核對改寫、既有邊覆核改寫、restoreEdge、restoreNote、存量處置、掃描)
//   ③版本單一來源:RS1／RS2／RS3／RS8 之 id、標題與版本取自 EDGE_STANDARDS;RS4、RS6 之 id 與版本取自其判定模組之識別;RS5 之 id 取自
//     stores/relateHolds,無版本(v 為 null);其餘為 1
//   ④scan 為 true 者＝RELATE_AUDITED_STANDARD_IDS(依全集之序)＝EDGE_STANDARDS 之 id;AI 標準＝RELATE_AI_STANDARD_IDS(RS4、RS5、RS6),
//     不掃、掃描說明載明列於 ai.<標準>;掃描報告之標題、kind、版本、對象取自全集
//   ⑤標題、對象、能證明／不能證明、掃描說明為中立措辭(不含特定產業領域之詞彙、不指他工作之名、不指執行端之指令或帳本代號);
//     RS2 之字數取 REASON_MIN_CHARS／REASON_MAX_CHARS(不另寫數字)
// 執行:自套件根 node <mocha> test/unit-relate-registry.test.mjs(只讀檔與 import,不寫檔、不連網)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { memStore, DOMAIN_TERM_RE } from './tools/captureForTest.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { EDGE_STANDARDS, REASON_MIN_CHARS } from '../src/standards/edgeStandards.mjs'
import { REASON_MAX_CHARS } from '../src/standards/edgeGate.mjs'
import { RS4 } from '../src/stores/conflictCheckPolicy.mjs'
import { RS6 } from '../src/stores/edgeReviewPolicy.mjs'
import { RS5 } from '../src/stores/relateHolds.mjs'
import { RELATE_STANDARDS, RELATE_UNGATED_WRITE_ENTRIES, RELATE_AUDITED_STANDARD_IDS, RELATE_AI_STANDARD_IDS } from '../src/standards/registry.mjs'
import { auditRelateStandards, RELATE_AUDITED_STANDARD_IDS as AUDITED_FROM_AUDIT } from '../src/standards/audit.mjs'

// 套件根(以本檔位置定,不依 cwd)
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IDS = ['RS1', 'RS2', 'RS3', 'RS4', 'RS5', 'RS6', 'RS8', 'RS9', 'RS10']
const KEY_ORDER = ['id', 'title', 'object', 'kind', 'v', 'proves', 'notProves', 'enforcedAt', 'scan', 'scanNote']
const TEXT_KEYS = ['title', 'object', 'proves', 'notProves', 'scanNote']
const byId = (id) => RELATE_STANDARDS.find((s) => s.id === id)
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// 檔案內宣告該名稱(函數宣告、const／let／var、或 export { … }):以讀檔＋正則驗
const declares = (src, name) => [
    new RegExp(`(^|\\n)\\s*(export\\s+)?(async\\s+)?function\\s*\\*?\\s*${esc(name)}\\s*\\(`),
    new RegExp(`(^|\\n)\\s*(export\\s+)?(const|let|var)\\s+${esc(name)}\\s*=`),
    new RegExp(`export\\s*\\{[^}]*\\b${esc(name)}\\b[^}]*\\}`),
].some((r) => r.test(src))
// 他工作之名(本套件之標準只談關聯;上下游以「筆記」「下游」稱之)
const OTHER_JOBS = /提煉|摘要|抓取/
// 執行端之指令、帳本代號、專案之路徑
const PROJECT_REFS = /\b(REL|STD|GEN|SUM|CAP|EXT|OPS)-\d|規則帳本|srcPack|CLI|standards (audit|waive|retry)|restore-edge|reeval-baseline|--[a-z]/

describe('unit-relate-registry', function() {

    it('全集為 RS1～RS6、RS8、RS9、RS10(依序、不重複);RS7 不存在(撤出);型別改名之宣告不另列(併入 RS1 之說明)', () => {
        assert.deepEqual(RELATE_STANDARDS.map((s) => s.id), IDS)
        assert.equal(new Set(RELATE_STANDARDS.map((s) => s.id)).size, IDS.length)
        assert.equal(byId('RS7'), undefined, 'RS7 不存在')
        assert.ok(RELATE_STANDARDS.every((s) => !s.id.includes('′')), '無 RS1′ 之列')
        assert.match(byId('RS1').proves, /relationTypeRenames/, 'RS1 之說明含型別改名之宣告')
        assert.ok(byId('RS1').enforcedAt.includes('stores/edgeStore.mjs:renameEdgeTypes'), 'RS1 之執行處含型別改名之機械改寫')
    })

    it('每條標準之欄位齊全且型別正確、欄序固定;全集與各列(含執行處)皆凍結', () => {
        assert.ok(Object.isFrozen(RELATE_STANDARDS))
        for (const s of RELATE_STANDARDS) {
            assert.ok(Object.isFrozen(s) && Object.isFrozen(s.enforcedAt), `${s.id} 凍結`)
            assert.deepEqual(Object.keys(s), KEY_ORDER, `${s.id} 欄序`)
            for (const k of ['id', ...TEXT_KEYS]) assert.ok(typeof s[k] === 'string' && s[k].trim().length > 0, `${s.id}.${k} 須為非空字串(能證明／不能證明與不掃之理由皆須寫明)`)
            assert.ok(['program', 'ai'].includes(s.kind), `${s.id}.kind=${s.kind}`)
            assert.ok(s.id === RS5.std ? s.v === null : Number.isInteger(s.v) && s.v > 0, `${s.id}.v=${s.v}`)
            assert.equal(typeof s.scan, 'boolean', `${s.id}.scan`)
            assert.ok(Array.isArray(s.enforcedAt) && s.enforcedAt.length > 0, `${s.id} 須有執行處`)
        }
        assert.throws(() => {
            RELATE_STANDARDS[0].title = 'x'
        }, TypeError, '凍結之列不可改')
        assert.throws(() => {
            RELATE_STANDARDS[0].enforcedAt.push('x')
        }, TypeError, '凍結之執行處不可改')
    })

    it('kind:RS4、RS5、RS6 為 AI 判定(判定小組＋題組);其餘為程式判定', () => {
        const kinds = Object.fromEntries(RELATE_STANDARDS.map((s) => [s.id, s.kind]))
        assert.deepEqual([kinds.RS4, kinds.RS5, kinds.RS6], ['ai', 'ai', 'ai'])
        for (const id of ['RS1', 'RS2', 'RS3', 'RS8', 'RS9', 'RS10']) assert.equal(kinds[id], 'program', id)
    })

    it('執行處:每條皆為「套件內檔案:函數」——檔存在、檔內宣告該名、import 後為函數;路徑相對套件根、不含 ..、不重複', async () => {
        let n = 0
        const mods = new Map()
        for (const s of RELATE_STANDARDS) {
            assert.equal(new Set(s.enforcedAt).size, s.enforcedAt.length, `${s.id} 執行處不重複`)
            for (const ref of s.enforcedAt) {
                n++
                const m = /^([A-Za-z0-9_./-]+\.mjs):([A-Za-z_$][\w$]*)$/.exec(ref)
                assert.ok(m, `${s.id} 執行處格式「檔案:函數」:${ref}`)
                const [, file, name] = m
                assert.ok(!file.split('/').includes('..') && !path.isAbsolute(file), `${ref} 須為相對套件 src/ 之路徑`)
                const abs = path.join(PKG, 'src', file)
                assert.ok(fs.existsSync(abs), `${s.id} 執行處之檔不存在:${ref}`)
                assert.ok(declares(fs.readFileSync(abs, 'utf8'), name), `${s.id} 執行處之名未宣告於檔內:${ref}`)
                if (!mods.has(abs)) mods.set(abs, await import(pathToFileURL(abs).href))
                assert.equal(typeof mods.get(abs)[name], 'function', `${s.id} 執行處 import 後須為函數:${ref}`)
            }
        }
        assert.ok(n >= RELATE_STANDARDS.length * 2, '走訪須真涵蓋各執行處')
        // 對照:宣告檢查須真能分辨有無(否則上列恆過)
        assert.equal(declares('function foo() {}', 'foo'), true)
        assert.equal(declares('export const foo = () => {}', 'foo'), true)
        assert.equal(declares('// function foo() {}', 'foo'), false, '註解中之宣告不算')
        assert.equal(declares('const x = 1', 'foo'), false)
    })

    it('不經納入閘之寫邊入口(撤銷與機械改寫;刻意——撤銷與重新收件是兩種契約):每列 { entry, kind, why },entry 為「套件內檔案:函數」(檔存在、宣告、import 後為函數);kind 只 undo／mechanical;凍結;撤銷入口不列於各標準之寫入入口(重新收件之 restoreNote、restoreEdge 照列)', async () => {
        assert.ok(Object.isFrozen(RELATE_UNGATED_WRITE_ENTRIES) && RELATE_UNGATED_WRITE_ENTRIES.every(Object.isFrozen))
        assert.deepEqual(RELATE_UNGATED_WRITE_ENTRIES.map((x) => [x.entry, x.kind]), [
            ['ops/noteOps.mjs:undoDeleteNote', 'undo'], ['standards/stockFix.mjs:rollbackEdgeStockFix', 'undo'], ['stores/edgeStore.mjs:domainTypeRenamerOf', 'mechanical'],
            ['stages/relateMaintain.mjs:maintainRelations', 'mechanical'],
        ])
        for (const x of RELATE_UNGATED_WRITE_ENTRIES) {
            assert.deepEqual(Object.keys(x), ['entry', 'kind', 'why'])
            assert.ok(typeof x.why === 'string' && x.why.trim().length > 0, x.entry)
            const [file, name] = x.entry.split(':')
            const abs = path.join(PKG, 'src', file)
            assert.ok(fs.existsSync(abs) && declares(fs.readFileSync(abs, 'utf8'), name), x.entry)
            assert.equal(typeof (await import(pathToFileURL(abs).href))[name], 'function', x.entry)
            for (const [k, re] of [['領域詞彙', DOMAIN_TERM_RE], ['他工作', OTHER_JOBS], ['執行端', PROJECT_REFS]]) assert.ok(!re.test(x.why), `${x.entry}〔${k}〕`)
        }
        for (const s of RELATE_STANDARDS) assert.ok(!s.enforcedAt.includes('ops/noteOps.mjs:undoDeleteNote'), `${s.id}:撤銷不列於寫入入口`)
        assert.ok(byId('RS1').enforcedAt.includes('ops/noteOps.mjs:restoreNote'), '重新收件照列')
    })

    it('執行處涵蓋各寫入入口:RS1／RS2／RS3／RS8 列判定、正向閘、反向與輪巡、重評改寫、衝突核對改寫、既有邊覆核改寫、restoreEdge、restoreNote、掃描;RS3 列存量修正、RS2／RS3／RS8 列存量交改寫(兩種去處)、兩段送審之判定與存量之豁免;RS1 列型別改名與懸空清理', () => {
        const ENTRIES = {
            '判定': 'standards/edgeStandards.mjs:checkEdge',
            '納入閘': 'standards/edgeGate.mjs:gateEdgeProposal',
            '正向閘': 'stages/relateChain.mjs:admitRelation',
            '逐項鏈': 'stages/relateChain.mjs:mwBuildEdges',
            '反向與輪巡': 'stages/relateStage.mjs:stageRelate',
            '重評改寫': 'stages/reevalSegment.mjs:mwReevalApply',
            '衝突核對改寫': 'stages/conflictCheckSegment.mjs:runConflictCheckSegment',
            '既有邊覆核改寫': 'stages/edgeReviewSegment.mjs:runEdgeReviewSegment',
            'restoreEdge': 'ops/noteOps.mjs:restoreEdge',
            'restoreNote': 'ops/noteOps.mjs:restoreNote',
            '改寫之逆': 'ops/noteOps.mjs:revertEdgeRevision',
            '掃描': 'standards/audit.mjs:auditRelateStandards',
        }
        for (const id of RELATE_AUDITED_STANDARD_IDS) {
            const at = byId(id).enforcedAt
            for (const [name, ref] of Object.entries(ENTRIES)) assert.ok(at.includes(ref), `${id} 須列${name}:${ref}`)
        }
        // 合併時浮上之 history 再驗(RS1／RS2／RS3;合併時無材料,RS8 不判)
        for (const id of ['RS1', 'RS2', 'RS3']) for (const ref of ['stages/relateChain.mjs:mwPersistEdges', 'stores/edgeStore.mjs:mergeEdge']) assert.ok(byId(id).enforcedAt.includes(ref), `${id}:${ref}`)
        assert.ok(!byId('RS8').enforcedAt.includes('stores/edgeStore.mjs:mergeEdge'), 'RS8 不在合併再驗')
        const STOCK = ['standards/stockFix.mjs:planEdgeStockFix', 'standards/stockFix.mjs:applyEdgeStockFix']
        for (const ref of [...STOCK, 'standards/stockFix.mjs:edgeFixOf']) assert.ok(byId('RS3').enforcedAt.includes(ref), `RS3:${ref}`)
        for (const id of ['RS2', 'RS8']) for (const ref of [...STOCK, 'standards/edgeQueue.mjs:queueEdgeReview', 'standards/edgeQueue.mjs:queueConflictCheck']) assert.ok(byId(id).enforcedAt.includes(ref), `${id}:${ref}`)
        // 須改寫理由之標準(REASON_REWRITE_STDS):兩段送審之判定、修不了之 RS3 交兩席(兩種去處)、存量之豁免
        for (const id of ['RS2', 'RS3', 'RS8']) for (const ref of ['standards/edgeGate.mjs:reasonRewriteProblemsOf', 'standards/edgeQueue.mjs:stockWaiverKeyOf', 'standards/edgeQueue.mjs:queueEdgeReview', 'standards/edgeQueue.mjs:queueConflictCheck']) assert.ok(byId(id).enforcedAt.includes(ref), `${id}:${ref}`)
        // RS1:改名之機械改寫、懸空之清理;清單外型別由維護登錄覆核待判(queueEdgeReview),其豁免經 stockWaiverKeyOf 為掃描所認;維護為公開之寫邊入口(P5 拆出後須列)
        for (const ref of ['stores/edgeStore.mjs:renameEdgeTypes', 'stages/relateMaintain.mjs:maintainRelations', 'ops/noteOps.mjs:pruneDangling', 'standards/edgeQueue.mjs:queueEdgeReview', 'standards/edgeQueue.mjs:stockWaiverKeyOf']) assert.ok(byId('RS1').enforcedAt.includes(ref), `RS1:${ref}`)
        // AI 標準:判定模組、段、提示詞(domain)、使用者裁示之還原與改寫之逆(revertEdgeRevision);RS9 為型別解析之各寫入點;RS10 為輪巡
        // RS4／RS6 之判定小組之逐頁執行(兩段同一份 stages/checkPanelPages)
        for (const ref of ['stages/conflictCheckSegment.mjs:runConflictCheckSegment', 'stages/checkPanelPages.mjs:runCheckPanelPages', 'stores/conflictCheckPolicy.mjs:rs4DecisionOf', 'domain/relateDomain.mjs:createRelateDomain', 'standards/edgeQueue.mjs:queueConflictCheck', 'ops/noteOps.mjs:restoreEdge', 'ops/noteOps.mjs:revertEdgeRevision', 'standards/stockFix.mjs:applyEdgeStockFix']) assert.ok(byId('RS4').enforcedAt.includes(ref), `RS4:${ref}`)
        for (const ref of ['stages/reevalSegment.mjs:runReevalSegment', 'stores/reevalPolicy.mjs:decideOf', 'ops/noteOps.mjs:reevalBaseline', 'ops/noteOps.mjs:revertEdgeRevision']) assert.ok(byId('RS5').enforcedAt.includes(ref), `RS5:${ref}`)
        for (const ref of ['stages/edgeReviewSegment.mjs:runEdgeReviewSegment', 'stages/checkPanelPages.mjs:runCheckPanelPages', 'stores/edgeReviewPolicy.mjs:rs6DecisionOf', 'standards/edgeQueue.mjs:queueEdgeReview', 'stages/relateMaintain.mjs:maintainRelations', 'ops/noteOps.mjs:restoreEdge', 'ops/noteOps.mjs:revertEdgeRevision', 'standards/stockFix.mjs:applyEdgeStockFix']) assert.ok(byId('RS6').enforcedAt.includes(ref), `RS6:${ref}`)
        for (const ref of ['domain/relateDomain.mjs:createRelateDomain', 'standards/edgeGate.mjs:normalizeEdgeProposal', 'stores/reevalPolicy.mjs:verdictsOf', 'stores/conflictCheckPolicy.mjs:checkVerdictOf', 'stores/edgeReviewPolicy.mjs:reviewVerdictOf', 'ops/noteOps.mjs:revertEdgeRevision']) assert.ok(byId('RS9').enforcedAt.includes(ref), `RS9:${ref}`)
        for (const ref of ['stores/rotationPolicy.mjs:rotationPageOf', 'stores/rotationPolicy.mjs:rotationQueueOf', 'stores/rotationPolicy.mjs:rotationProgressOf']) assert.ok(byId('RS10').enforcedAt.includes(ref), `RS10:${ref}`)
    })

    it('版本單一來源:RS1／RS2／RS3／RS8 之 id、標題與版本取自 EDGE_STANDARDS;RS4、RS6 之 id 與版本取自判定模組之識別;RS5 之 id 取自 relateHolds、版本 null;RS9、RS10 為 1', () => {
        for (const d of EDGE_STANDARDS) assert.deepEqual([byId(d.id)?.title, byId(d.id)?.v, byId(d.id)?.kind], [d.title, d.v, d.kind], d.id)
        assert.deepEqual([byId(RS4.std).v, byId(RS6.std).v, byId(RS5.std).v], [RS4.v, RS6.v, null])
        assert.deepEqual([byId('RS9').v, byId('RS10').v], [1, 1])
    })

    it('掃描旗標與掃描器一致:scan 為 true 者即 RELATE_AUDITED_STANDARD_IDS(依全集之序)＝EDGE_STANDARDS 之 id;AI 標準＝RELATE_AI_STANDARD_IDS,不掃、掃描說明載明列於 ai.<標準>;掃描報告之標題、kind、版本、對象取自全集', async () => {
        assert.deepEqual(RELATE_AUDITED_STANDARD_IDS, RELATE_STANDARDS.filter((s) => s.scan).map((s) => s.id))
        assert.deepEqual([...RELATE_AUDITED_STANDARD_IDS], EDGE_STANDARDS.map((s) => s.id))
        assert.equal(AUDITED_FROM_AUDIT, RELATE_AUDITED_STANDARD_IDS, '掃描模組轉出同一份')
        assert.ok(Object.isFrozen(RELATE_AUDITED_STANDARD_IDS) && Object.isFrozen(RELATE_AI_STANDARD_IDS))
        assert.deepEqual([...RELATE_AI_STANDARD_IDS], ['RS4', 'RS5', 'RS6'])
        for (const id of RELATE_AI_STANDARD_IDS) {
            const s = byId(id)
            assert.equal(s.scan, false, id)
            assert.match(s.scanNote, new RegExp(`ai\\.${id}\\b`), `${id} 之掃描說明`)
        }
        for (const id of ['RS9', 'RS10']) assert.match(byId(id).scanNote, /^未掃:/, `${id} 寫明不掃之理由`)
        const rep = await auditRelateStandards({ stores: { relations: memStore([]), notes: memStore([]), holds: memStore([]), checks: memStore([]) }, domain: createRelateDomain({}) })
        assert.deepEqual(Object.keys(rep.standards), [...RELATE_AUDITED_STANDARD_IDS])
        for (const [id, b] of Object.entries(rep.standards)) {
            const s = byId(id)
            assert.deepEqual([b.id, b.title, b.kind, b.v, b.object, b.module], [s.id, s.title, s.kind, s.v, s.object, 'relate'], id)
        }
        assert.deepEqual(Object.keys(rep.ai), [...RELATE_AI_STANDARD_IDS])
        for (const [id, a] of Object.entries(rep.ai)) {
            const s = byId(id)
            assert.deepEqual([a.id, a.title, a.kind, a.v, a.object, a.module], [s.id, s.title, s.kind, s.v, s.object, 'relate'], id)
        }
    })

    it('標題、對象、能證明／不能證明、掃描說明為中立措辭:不含特定產業領域之詞彙(中英)、不指他工作之名、不指執行端之指令或帳本代號;RS2 之字數取常數;規則自檢', () => {
        const bad = []
        for (const s of RELATE_STANDARDS) {
            for (const k of TEXT_KEYS) {
                for (const [name, re] of [['領域詞彙', DOMAIN_TERM_RE], ['他工作', OTHER_JOBS], ['執行端', PROJECT_REFS]]) if (re.test(s[k])) bad.push(`${s.id}.${k}〔${name}〕${s[k].slice(0, 60)}`)
            }
        }
        assert.deepEqual(bad, [])
        assert.ok(byId('RS2').proves.includes(`至少 ${REASON_MIN_CHARS} 字`) && byId('RS2').proves.includes(`逾 ${REASON_MAX_CHARS} 字`), 'RS2 之字數取常數')
        // 規則自檢:詞表真能抓到(中、英)
        assert.ok(DOMAIN_TERM_RE.test('理由提及回測之年化報酬'))
        assert.ok(DOMAIN_TERM_RE.test('a backtest of trading rules'))
        assert.ok(OTHER_JOBS.test('提煉之爭議處置') && PROJECT_REFS.test('見 STD-06') && PROJECT_REFS.test('restore-edge --apply'))
    })
})
