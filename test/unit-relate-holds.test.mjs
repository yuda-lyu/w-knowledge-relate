// unit-relate-holds.test.mjs — 關聯之待判(stores/relateHolds)與面向使用者之字樣、RS4 之排入(standards/edgeQueue 之 queueConflictCheck)、
//   單一來源之原始碼盤點
// 規格:①待判期限一律 RELATE_HOLD_DEADLINE_DAYS(30)天;RS5＝{ std, objectEdge, objectNote }
//   ②面向使用者之下一步、處置方式與日誌提示指本套件之處置 API(restoreEdge、restoreNote、requestRetry、waiveHold、reevalBaseline、projectAll、
//     pruneDangling)與其選項(opt.apply、opt.all、opt.reason、opt.by、opt.ruling、opt.withHolds),不指執行端之指令;外部巡檢所讀之字樣不變
//   ③queueConflictCheck:既有衝突邊須經 RS4 核對之單一入口(物件與標準取 RS4、期限依 RELATE_HOLD_DEADLINE_DAYS、已有未結者不重登)
//   ④原始碼(非測試、非評分):openStores 只在總組裝與主入口;字面 'RS5' 只在其定義;期限、待判之下一步、判定小組原因(含其字樣——取摘要套件之
//     PANEL_WHY_LABELS)、設定預設、「已關聯」之判定各一處(執行端之指令名與沿革之逐行掃描在 unit-relate-package ④)
// 執行:自套件根 node <mocha> test/unit-relate-holds.test.mjs(不寫檔、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memStore, sourceFilesOf } from './tools/captureForTest.mjs'
import { holdKey } from '../src/core/capturePackage.mjs'
import { RS4 } from '../src/stores/conflictCheckPolicy.mjs'
import { RS6 } from '../src/stores/edgeReviewPolicy.mjs'
import {
    RELATE_HOLD_DEADLINE_DAYS, relateHoldDeadlineOf, RS5, RELATE_API_HINT, RELATE_BASELINE_RULING_PREFIX, RELATE_HOLD_NEXT,
    escalatedHoldNextOf, quarantineHoldNextOf, stdRetiredHowOf,
} from '../src/stores/relateHolds.mjs'
import { queueConflictCheck } from '../src/standards/edgeQueue.mjs'

const ROOT = fileURLToPath(new URL('../src/', import.meta.url))
const AT = '2026-10-05T10:00:00+08:00'

/** 套件之原始碼(非測試、非評分;相對路徑以 / 分隔;走訪取抓取套件之 sourceFilesOf) */
const sourceFiles = () => sourceFilesOf(ROOT, { exclude: ['test', 'bench'] })
const textOf = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
/** 命中之行:[檔:行 內容] */
const hitsOf = (files, re) => files.flatMap((f) => textOf(f).split('\n').map((l, i) => [f, i + 1, l]).filter(([, , l]) => re.test(l)).map(([ff, n, l]) => `${ff}:${n} ${l.trim().slice(0, 100)}`))

describe('unit-relate-holds', function() {

    describe('① 期限與標準識別', function() {

        it('RELATE_HOLD_DEADLINE_DAYS＝30;relateHoldDeadlineOf＝登錄時刻＋30 天(UTC ISO);不可解析之時刻即拋', () => {
            assert.equal(RELATE_HOLD_DEADLINE_DAYS, 30)
            assert.equal(relateHoldDeadlineOf(AT), '2026-11-04T02:00:00.000Z')
            assert.throws(() => relateHoldDeadlineOf('不是時刻'), RangeError)
        })

        it('RS5＝{ std:\'RS5\', objectEdge:\'edge\', objectNote:\'note\' }(凍結);與 RS4／RS6 之物件種類同名', () => {
            assert.deepEqual(RS5, { std: 'RS5', objectEdge: 'edge', objectNote: 'note' })
            assert.ok(Object.isFrozen(RS5))
            assert.deepEqual([RS5.objectEdge, RS4.objectEdge, RS6.objectEdge], ['edge', 'edge', 'edge'])
        })
    })

    describe('② 面向使用者之字樣指 API', function() {

        it('下一步與提示逐字(固定者)', () => {
            assert.deepEqual(RELATE_HOLD_NEXT, {
                reevalEdge: '使用者判讀：要求重試（requestRetry：該篇本版本再評此邊）或豁免（waiveHold：保留，本版本不再評）',
                reevalNote: '使用者判讀：要求重試（requestRetry：該篇本版本再評未判之邊）或豁免（waiveHold：保留）',
                proposalUndetermined: '使用者判讀：要求重試（requestRetry：換席位或補材料後重判）或豁免（waiveHold：提案不落地）',
                conflictCheck: '下輪衝突核對兩席核對（relate.standards.conflictCheck.enabled 開啟時）',
                proposalPending: '下輪衝突核對',
                conflictCheckRetry: '下輪衝突核對重判',
                conflictCheckStock: '下輪衝突核對兩席核對：成立者之現行理由未達標準即以成立之票所附理由改寫，修不了即撤出（可還原）',
                typeSplit: '使用者判讀型別：要求重試（requestRetry：換席位重判）或豁免（waiveHold：維持現行型別）',
                edgeReviewRetry: '下輪既有邊覆核重判',
                edgeReviewStock: '既有邊覆核(RS6)開啟時優先重判:成立者須改寫理由使過納入閘,否則撤出(可還原)',
                edgeReviewTypeOffList: '既有邊覆核(RS6)重判型別:兩席成立之清單內型別過納入閘即改型;關聯成立而未得清單內型別 → 使用者;無關聯 → 撤出(可還原)',
                stockHistoryScript: '使用者判讀：沿革（history）中之理由有確定性修正做不到之字形，本套件無改寫沿革之途徑——豁免（waiveHold：保留沿革原樣；符合度掃描即記已豁免）；沿革已被他途改正者，存量處置套用時自動結案',
            })
            assert.deepEqual(RELATE_API_HINT, {
                pruneDangling: '確認後以 pruneDangling（opt.apply）清理',
                projectAll: '可用 projectAll（opt.all）全庫重投補回',
                migrate: '邊 id 非無序對身分之舊世代資料，須先遷移',
                reevalBaseline: '確認後以 reevalBaseline（opt.apply、opt.by、opt.ruling）重設基準',
                reevalBaselineRuling: 'reevalBaseline 之 opt.apply 須記裁示者與裁示內容（opt.by、opt.ruling）——記為評完而未判是使用者之裁示',
                withHolds: '確認仍要還原者給 opt.withHolds（照還原並登錄待判，由使用者修正）',
                restoreNote: '請以 restoreNote（重新收件：過標準）或 undoDeleteNote（撤銷刪除：原樣放回）還原該筆記（其邊一併還原）',
                deletionResume: '以 deleteNote（續刪）或 undoDeleteNote／restoreNote（續還原）續作完成',
                restoreEdge: '可 restoreEdge 還原',
                restoreEdgeReason: '可 restoreEdge 以 opt.reason（新理由）還原',
                newReason: '撤出時之理由本身不合標準者，可給 opt.reason（新理由）以新理由還原',
            })
            assert.equal(RELATE_BASELINE_RULING_PREFIX, 'reevalBaseline：')
            assert.ok(Object.isFrozen(RELATE_HOLD_NEXT) && Object.isFrozen(RELATE_API_HINT))
        })

        it('帶參數之下一步與處置方式:逾次改由使用者、隔離(RS4／RS6 各一句)、現行理由修不了而撤出', () => {
            assert.equal(escalatedHoldNextOf(3, '維持現值'), '逾 3 次未得判定，改由使用者：要求重試（requestRetry：換席重判）或豁免（waiveHold：維持現值）')
            assert.equal(quarantineHoldNextOf(RS4.std, 'e1'), '使用者判讀：確認為真衝突者以 restoreEdge（邊 e1，opt.apply）還原（即裁示為真衝突：本待判結案、記檢核，不再自動核對此值）；否則豁免（waiveHold：維持隔離）')
            assert.equal(quarantineHoldNextOf(RS6.std, 'e2'), '使用者判讀：確認關聯成立者以 restoreEdge（邊 e2，opt.apply）還原（即裁示關聯成立：本待判結案、記檢核，不再自動覆核此值）；否則豁免（waiveHold：維持撤出）')
            assert.equal(stdRetiredHowOf('RS2 佔位理由「x」', 'e3'), '現行理由未達標準（RS2 佔位理由「x」）且無可用之改寫理由（席位未附改寫，或所附理由亦未達標準），已撤出（std-retire；可 restoreEdge（邊 e3，opt.reason＝新理由、opt.apply）還原）')
        })

        it('全部字樣不含執行端之指令(notes／standards 工具、子命令名、命令列旗標、openStores)', () => {
            const all = [...Object.values(RELATE_HOLD_NEXT), ...Object.values(RELATE_API_HINT), escalatedHoldNextOf(2, 'x'), quarantineHoldNextOf(RS4.std, 'e'), quarantineHoldNextOf(RS6.std, 'e'), stdRetiredHowOf('w', 'e')]
            const CLI = /notes 工具|standards (retry|waive)|restore-edge|reeval-baseline|project --all|--with-holds|--apply|--reason|--by=|--ruling|openStores|<登錄鍵>/
            assert.deepEqual(all.filter((s) => CLI.test(s)), [])
        })
    })

    describe('③ queueConflictCheck(既有衝突邊須經 RS4 核對之單一入口)', function() {

        it('登錄:物件與標準取 RS4、負責者預設 pipeline、期限依 relateHoldDeadlineOf、下一步預設 RELATE_HOLD_NEXT.conflictCheck、ctx 含兩端;已有未結者不重登(不累加 tries);已結案者重開', async () => {
            const holds = memStore([])
            const o = { edgeId: 'e1', from: 'a', to: 'b', reason: '還原帶回之衝突邊尚未經衝突核對（RS4）', ctx: { restoredFrom: 'std-retire' }, at: AT }
            assert.equal(await queueConflictCheck(holds, o), 'queued')
            const h = await holds.get(holdKey(RS4.objectEdge, 'e1', RS4.std))
            assert.deepEqual([h.object, h.std, h.owner, h.status, h.deadline, h.next, h.reason, h.ctx, h.tries], [RS4.objectEdge, RS4.std, 'pipeline', 'open', relateHoldDeadlineOf(AT), RELATE_HOLD_NEXT.conflictCheck, o.reason, { from: 'a', to: 'b', restoredFrom: 'std-retire' }, 0])
            assert.equal(await queueConflictCheck(holds, { ...o, reason: '再次' }), 'exists')
            assert.deepEqual([(await holds.get(h.id)).tries, (await holds.get(h.id)).reason], [0, o.reason], '未結者不重登')
            await holds.replace({ ...(await holds.get(h.id)), status: 'resolved' })
            assert.equal(await queueConflictCheck(holds, { ...o, next: '自訂下一步', owner: 'user' }), 'queued', '已結案 → 重開')
            const h2 = await holds.get(h.id)
            assert.deepEqual([h2.status, h2.owner, h2.next, h2.history.length], ['open', 'user', '自訂下一步', 1])
        })

        it('形狀不合即拋(邊 id、兩端、原因須為非空字串)', async () => {
            const holds = memStore([])
            for (const k of ['edgeId', 'from', 'to', 'reason']) {
                await assert.rejects(() => queueConflictCheck(holds, { edgeId: 'e', from: 'a', to: 'b', reason: 'r', at: AT, [k]: '' }), { message: `queueConflictCheck 需要 ${k}（非空字串）` })
            }
            assert.equal((await holds.select()).length, 0)
        })
    })

    describe('④ 原始碼之盤點(非測試、非評分)', function() {
        const files = sourceFiles()

        it('盤點範圍:各層之原始碼皆在(防範圍誤縮)', () => {
            for (const f of ['relateObject.mjs', 'logContract.mjs', 'stages/relateStage.mjs', 'stages/reevalSegment.mjs', 'stages/conflictCheckSegment.mjs', 'stages/edgeReviewSegment.mjs', 'stages/projectStage.mjs', 'stages/relateAiCall.mjs', 'stages/relateChain.mjs', 'stages/relateMaintain.mjs', 'ops/noteOps.mjs', 'standards/edgeQueue.mjs', 'stores/relateHolds.mjs', 'domain/relateDomain.mjs', 'core/relateSettings.mjs']) assert.ok(files.includes(f), f)
            assert.ok(files.length >= 30, `掃描量過少：${files.length}`)
        })

        it('openStores 只在本套件之總組裝與主入口(其自有 API);其餘模組出現即指執行端之件(執行端之指令名與沿革之逐行掃描在 unit-relate-package ④)', () => {
            // openStores 是本套件總組裝之自有 API(createKnowledgeRelate 之回傳;主入口之說明可引用)
            const OWN_ASSEMBLY = ['createKnowledgeRelate.mjs', 'WKnowledgeRelate.mjs']
            assert.ok(files.filter((f) => OWN_ASSEMBLY.includes(f)).length === 2, '前提:兩檔在盤點範圍')
            assert.deepEqual(hitsOf(files.filter((f) => !OWN_ASSEMBLY.includes(f)), /openStores/), [])
        })

        it('字面 \'RS5\' 只在其定義(stores/relateHolds)與判定小組之顯示標籤(core/relateSettings 之 PANEL_DEFS);其餘一律取 RS5 常數', () => {
            assert.deepEqual(hitsOf(files, /'RS5'/).map((x) => x.split(':')[0]).sort(), ['core/relateSettings.mjs', 'stores/relateHolds.mjs'])
        })

        it('單一來源:待判期限只在 relateHoldDeadlineOf;待判之下一步不寫字面(RELATE_HOLD_NEXT 與帶參數之函數);判定小組之原因不寫字面(PANEL_WHY);讀處不以 ?? 重寫設定之預設(RELATE_DEFAULT);「已關聯」只在 isRelated', () => {
            assert.deepEqual(hitsOf(files.filter((f) => f !== 'stores/relateHolds.mjs'), /\b30 \* 86_?400_?000\b|\bHOLD_DAYS\b|deadline: new Date\(/), [], '期限')
            assert.deepEqual(hitsOf(files.filter((f) => f !== 'stores/relateHolds.mjs'), /\bnext: ['"`]|\bnext \|\| ['"`]|\? o\.next : ['"`]/), [], '待判之下一步')
            assert.deepEqual(hitsOf(files, /why === '(missing|unsure|disagree|same-provider)'|why: '(missing|unsure)'/), [], '判定小組之原因')
            // 未成立原因之字樣一律取摘要套件之字樣表 PANEL_WHY_LABELS(摘要、關聯、提煉同用),不寫字面
            assert.deepEqual(hitsOf(files, /['`（:](有一席不確定|兩席不一致|有席位回覆材料不足|各席裁決不一致|一致之兩票為同一供應者|缺票：|缺票（|有席位不確定)/), [], '判定小組未成立原因之字樣')
            assert.deepEqual(hitsOf(files.filter((f) => f.startsWith('stages/')), /\?\? ?(\d|false\b|true\b)/).filter((x) => !/relateRotation\?\.page \?\? 1/.test(x)), [], '設定之預設(游標之頁 1 為記錄之缺省,非設定)')
            assert.deepEqual(hitsOf(files.filter((f) => f !== 'stores/relatedNotes.mjs'), /![\w.?]*relatedAt\b|relatedAt\s*&&|\?\.relatedAt\)|=> \w+\??\.relatedAt\)/), [], '已關聯之判定')
        })
    })
})
