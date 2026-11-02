// unit-relate-entry.test.mjs — 入口契約:具名匯出與預設匯出為同一組成員、全部公開模組之匯出皆掛入入口(同名即同一實作)、無名稱衝突、
//   不轉出抓取與摘要套件之件、關鍵積木存在
// 規則(出自 WKnowledgeRelate 檔頭):
//   ①公開模組各列一次,具名匯出與預設物件由同一組命名空間合成,必然同一組名稱
//   ②兩個公開模組匯出同名而不同實體時載入即拋(export * 會靜默剔除該名,以具名匯入取用時才爆)
//   ③不列入者:兩個單一匯入點 core/capturePackage.mjs(抓取埠)、core/summarizePackage.mjs(摘要埠)——不是本套件之公開模組;
//     抓取與摘要之件(含待判之處置 API)自其套件取用
// 名稱之全集由各公開模組之命名空間推導(不手寫全部名稱:他模組新增之匯出自然掛入);關鍵積木之抽查只列既有之名。
// 執行:自套件根 node <mocha> test/unit-relate-entry.test.mjs
// 【以本檔位置定根,不用 cwd】本測試會 import(＝執行)根下每一支 .mjs,套件根須與 cwd 無關

import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import WKnowledgeRelate, * as NS from '../src/WKnowledgeRelate.mjs'
import * as CapturePort from '../src/core/capturePackage.mjs'
import * as SummarizePort from '../src/core/summarizePackage.mjs'
import { sourceFilesOf } from './tools/captureForTest.mjs'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 不是公開模組:兩個單一匯入點(轉出抓取／摘要套件之件)
const NOT_PUBLIC = new Set(['core/capturePackage.mjs', 'core/summarizePackage.mjs'])

// 入口中與抓取套件之件同一實體之名:關聯之詞彙表模組轉出抓取套件之知識庫稱呼函數(詞彙之 kbLabel 鍵屬各套件共用)
const CAPTURE_SAME_ALLOWED = Object.freeze({ kbLabelOf: 'kbLabelOf' })

// 入口中與摘要套件之件同一實體之名:關聯之 ai 段即摘要套件之 ai 段(以本套件之名別名轉出同一物件,不另寫)
const SUMMARIZE_SAME_ALLOWED = Object.freeze({ RELATE_AI_DEFAULT: 'SUMMARIZE_AI_DEFAULT', RELATE_AI_SCHEMA: 'SUMMARIZE_AI_SCHEMA', RELATE_SECTION_TITLES: 'PROJECTION_SECTION_TITLES' })

/** 套件 src/ 下之公開模組(.mjs;相對於 src;走訪取抓取套件之 sourceFilesOf;不含入口與兩個匯入點) */
const libraryFiles = () => sourceFilesOf(path.join(PKG, 'src')).filter((f) => f !== 'WKnowledgeRelate.mjs' && !NOT_PUBLIC.has(f))

/**
 * 入口中與某埠之件同一實體之名(入口名 → 埠名)
 *
 * @param {Object} port 輸入埠之命名空間
 * @returns {Object} 回傳 { 入口名: 埠名 }
 */
const sameEntitiesWith = (port) => {
    const byValue = new Map()
    for (const [k, v] of Object.entries(port)) if ((typeof v === 'object' && v !== null) || typeof v === 'function') byValue.set(v, k)
    return Object.fromEntries(Object.entries(WKnowledgeRelate).filter(([, v]) => byValue.has(v)).map(([k, v]) => [k, byValue.get(v)]))
}

describe('unit-relate-entry', function() {

    this.timeout(60_000)

    it('具名匯出與預設匯出為同一組名稱、同一實體;預設物件不含 default 鍵', () => {
        const named = Object.keys(NS).filter((k) => k !== 'default').sort()
        const dflt = Object.keys(WKnowledgeRelate).sort()
        assert.deepEqual(named, dflt, '兩種取用方式之成員須完全相同')
        for (const k of named) assert.equal(NS[k], WKnowledgeRelate[k], `${k}:具名與預設須為同一實體`)
        assert.equal('default' in WKnowledgeRelate, false)
        assert.ok(named.length > 150, `入口之名過少:${named.length}`)
    })

    it('入口成員皆有定義(無 undefined 成員)', () => {
        for (const [k, v] of Object.entries(WKnowledgeRelate)) assert.notEqual(v, undefined, k)
    })

    it('走訪涵蓋全部公開模組(各層目錄皆有模組、關鍵檔皆在):走訪不得空轉,否則下列匯出檢查恆過', () => {
        const files = libraryFiles()
        for (const f of ['createKnowledgeRelate.mjs', 'relateObject.mjs', 'relateRuntime.mjs', 'logContract.mjs', 'core/relateSettings.mjs', 'core/vocab/relateVocab.mjs', 'core/stores/checks.mjs',
            'stages/relateStage.mjs', 'stages/relateChain.mjs', 'stages/relateMaintain.mjs', 'stages/relateQueueSegment.mjs', 'stages/projectStage.mjs', 'stages/relationIndexStage.mjs',
            'stages/reevalSegment.mjs', 'stages/conflictCheckSegment.mjs', 'stages/edgeReviewSegment.mjs', 'domain/relateDomain.mjs',
            'stores/edgeStore.mjs', 'stores/candidates.mjs', 'stores/relatedNotes.mjs', 'stores/relateHolds.mjs', 'standards/edgeStandards.mjs', 'standards/registry.mjs', 'standards/audit.mjs', 'standards/stockFix.mjs', 'standards/edgeQueue.mjs',
            'ops/noteOps.mjs', 'ops/projectOps.mjs', 'bench/relateBench.mjs', 'bench/cli.mjs']) {
            assert.ok(files.includes(f), `走訪缺 ${f}`)
        }
        for (const d of ['stages', 'stores', 'ops', 'standards', 'domain', 'core', 'bench']) assert.ok(files.some((f) => f.startsWith(`${d}/`)), `走訪缺目錄 ${d}/`)
        assert.ok(files.every((f) => !f.startsWith('test/') && !f.includes('node_modules')))
        for (const f of NOT_PUBLIC) assert.ok(!files.includes(f), `${f} 不列入`)
    })

    it('全部公開模組之具名匯出皆掛入入口且為同一實體(新增模組 export 而未掛入口即失敗)', async () => {
        const missing = []
        for (const f of libraryFiles()) {
            const mod = await import(pathToFileURL(path.join(PKG, 'src', f)).href)
            const own = Object.keys(mod).filter((k) => k !== 'default')
            assert.ok(own.length > 0, `${f} 無任何具名匯出(公開模組須有具名積木)`)
            for (const k of own) if (WKnowledgeRelate[k] !== mod[k]) missing.push(`${f}:${k}`)
        }
        assert.deepEqual(missing, [], '未掛入入口(或同名而不同實體)之具名匯出')
    })

    it('名稱無衝突:不同公開模組匯出同名時須為同一實體(獨立走訪重驗,不依賴載入期之檢查);入口之成員恰為各公開模組具名匯出之聯集', async () => {
        const owner = new Map()
        const conflicts = []
        for (const f of libraryFiles()) {
            const mod = await import(pathToFileURL(path.join(PKG, 'src', f)).href)
            for (const [k, v] of Object.entries(mod)) {
                if (k === 'default') continue
                const prev = owner.get(k)
                if (prev && prev.v !== v) conflicts.push(`${k}:${prev.f}／${f}`)
                if (!prev) owner.set(k, { f, v })
            }
        }
        assert.deepEqual(conflicts, [])
        assert.deepEqual([...owner.keys()].sort(), Object.keys(WKnowledgeRelate).sort(), '入口之成員恰為各公開模組具名匯出之聯集(無遺漏、無憑空名稱)')
    })

    it('不轉出抓取與摘要套件之件:入口中與兩埠之件同一實體者只有具名之例外(詞彙表之知識庫稱呼函數、ai 段之別名);兩埠本身不是公開模組', () => {
        assert.deepEqual(sameEntitiesWith(CapturePort), CAPTURE_SAME_ALLOWED)
        assert.deepEqual(sameEntitiesWith(SummarizePort), SUMMARIZE_SAME_ALLOWED)
        // 抽查:兩套件之總組裝、核心件、筆記 md 之讀寫、待判之處置 API 皆不在入口(自其套件取用)
        for (const k of ['createKnowledgeCapture', 'createKnowledgeSummarize', 'createAiAdapter', 'createRoundRunner', 'stdReport', 'readMd', 'writeMd',
            'listHolds', 'overdueHolds', 'requestRetry', 'waiveHold', 'putHold', 'resolveHold', 'holdKey', 'SUMMARIZE_AI_DEFAULT', 'SUMMARIZE_CTX_FLAGS']) {
            assert.equal(k in WKnowledgeRelate, false, k)
        }
    })

    it('關鍵積木存在且型別正確:總組裝、物件、執行期件、子階段與各段、設定、詞彙、domain、邊庫與投影、檢定標準(含登記、存量掃描與處置)、維運件、AI 能力評分、日誌契約', () => {
        const FUNCS = [
            'createKnowledgeRelate', 'createRelateObject', 'relateSummaryOf', 'createRelateRuntime', 'resolveRelateData', 'relateScanOf',
            'stageRelate', 'stageRelateProject', 'stageRelationIndex', 'mwBuildEdges', 'mwMarkDirty', 'mwPersistEdges', 'mwQueueReverse', 'mwMarkRelated', 'mwProjectDirty', 'mwRebuildRelationIndex',
            'mwReevalVerdict', 'mwReevalAgree', 'mwReevalApply', 'mwReevalMarkReviewed', 'runReevalSegment', 'runConflictCheckSegment', 'runEdgeReviewSegment', 'relateAiCallOf',
            'resolveRelateSettings', 'relateSeatsOf', 'relatePanelsOf', 'relateFeatureProblems', 'relateWarningsOf', 'relateCapacityOf', 'callTimeoutMsOf',
            'resolveRelateVocab', 'pickRelateVocab', 'relateGuideDefaultOf', 'createRelateDomain', 'relateDomainNeedsOf',
            'makeEdge', 'edgeId', 'mergeEdge', 'persistEdge', 'projectNote', 'projectNotes', 'rebuildRelationIndex', 'isRelated', 'relatePendingOf', 'retireEdge', 'retiredEdgesOf',
            'readEdgeAudit', 'openDeletions', 'appendConflictEvent', 'readConflictEvents',
            'checkEdge', 'gateEdgeProposal', 'normalizeEdgeProposal', 'auditRelateStandards', 'planEdgeStockFix', 'applyEdgeStockFix', 'verifyEdgeStockChain', 'rollbackEdgeStockFix', 'readEdgeStockLedger',
            'deleteNote', 'undoDeleteNote', 'restoreNote', 'pruneDangling', 'projectAll', 'reevalBaseline', 'reevalRequeue', 'restoreEdge', 'revertEdgeRevision', 'projectAffected', 'neighborsOf', 'queueConflictCheck', 'queueEdgeReview', 'stockSourceResolvedOf',
            'reevalPromptItemOf', 'createMaterialReader', 'aiStandardRowOf', 'createSideReader', 'createCheckHasher',
            'archiveFilesOf', 'readArchive', 'deletionHalfStatesOf', 'deletionStatusOf', 'domainTypeRenamerOf',
            'checkKey', 'needsCheck', 'recordCheck',
            'runRelateBench', 'planRelateBench', 'runRelateBenchCli', 'relateBenchRoleOf',
        ]
        for (const k of FUNCS) assert.equal(typeof WKnowledgeRelate[k], 'function', k)
        const ARRAYS = ['CFG_KEYS', 'DATA_KEYS', 'PROMPT_KEYS', 'COLLECTION_KEYS', 'RELATE_STAGE_KEYS', 'RELATE_TAP_STAGE_KEYS', 'RELATE_STORE_KEYS', 'RELATE_DATA_KEYS', 'RELATE_DOMAIN_KEYS',
            'RELATE_LOG_KNOWN', 'RELATE_LOG_MUST_SEE', 'RELATE_VOCAB_KEYS', 'RELATE_VOCAB_OWN_KEYS', 'CHECK_STATES', 'RELATE_STANDARDS', 'RELATE_AUDITED_STANDARD_IDS', 'RELATE_AI_STANDARD_IDS', 'EDGE_STANDARDS', 'EDGE_FIX_STDS',
            'RETIRE_REASONS', 'RELATE_BENCH_ROLES', 'RELATE_BENCH_MODELS', 'RELATE_FEATURES']
        for (const k of ARRAYS) assert.ok(Array.isArray(WKnowledgeRelate[k]) && WKnowledgeRelate[k].length > 0, k)
        const OBJECTS = ['RELATE_REPORT_KEYS', 'RELATE_LOG_PARSE', 'RELATE_CTX_FLAGS', 'RELATE_PROMPT_SIGS', 'RELATE_DIRS', 'RELATE_DEFAULT', 'RELATE_SCHEMA', 'RELATE_AI_DEFAULT', 'RELATE_AI_SCHEMA',
            'RELATE_VOCAB_DEFAULT', 'RELATE_GUIDE_FIELDS', 'RELATE_SEAT_LABELS', 'RELATE_SECTION_TITLES', 'LEDGER_FILES', 'DELETION_FILES', 'RS4', 'RS5', 'RS6', 'RELATE_HOLD_NEXT', 'RELATE_API_HINT']
        for (const k of OBJECTS) assert.equal(typeof WKnowledgeRelate[k], 'object', k)
        // 執行期件之提示詞覆寫表即 domain 之同一實體(組裝者一處取齊)
        assert.equal(WKnowledgeRelate.RELATE_PROMPT_SIGS, NS.RELATE_PROMPT_SIGS)
    })
})
