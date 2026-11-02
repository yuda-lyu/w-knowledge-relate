// unit-relate-log-contract.test.mjs — 關聯之日誌與報告契約(logContract):外部巡檢判讀關聯段之字樣、正則與 run.json 之 report 鍵,
//   須對得上本套件實際產出之日誌與 report
// 規則(出自 logContract 檔頭):
//   ①RELATE_LOG_KNOWN／RELATE_LOG_MUST_SEE 之每一條皆須在本套件之實際日誌(WARN／ERROR 行)出現;已知字樣命中之行除非另含必看字樣,否則不列;
//     必看字樣為純文字、行內含已知字樣亦須見;「關聯投影：N 篇 md 讀不到」歸已知(有 report 鍵之專屬判準;重評開啟須 holds 集合,「未開 holds」已無發出者)
//   ②不收無發出者之字樣(關聯之批次不給套用前覆核,故不收批次機制之覆核字樣〔AI_BATCH_REVIEW_LOG_KNOWN〕、不列「套用前覆核中止」);
//     字樣為關聯專屬者、摘要套件批次機制之 AI_BATCH_* 與抓取套件核心件之 CORE_LOG_* 之聯集
//   ③RELATE_LOG_PARSE 之正則解析實際日誌檔之段落完成行,所得數字＝該輪 report 之 detail／stats
//   ④RELATE_REPORT_KEYS:階段名、子階段鍵、統計鍵與實際 report 一致;各子階段 detail 之鍵集＝實際 report(含各條件路徑:世代不符、筆記不足、
//     重評、衝突核對、既有邊覆核〔含完成期限〕、輪巡、反向、投影之略過)之聯集——實際 report 不得有未列之鍵,列了之鍵亦須在某一實際 report 出現
// 執行:自套件根 node <mocha> test/unit-relate-log-contract.test.mjs(暫存 test/_tmp/relate-log-contract-<pid>,測完即刪;真 LMDB、AI 為替身或
//   指向無人監聽之埠 8861,不連外網)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { recLog, memStore, acquireLock, lexSource, sleep, sourceFilesOf } from './tools/captureForTest.mjs'
import { bagCtx } from './tools/summarizeForTest.mjs'
import {
    PKG_ROOT, DEAD_PORT, CLOCK, logsOf, tmpRoot, removeRoots, resetConceptFold, landNote, scriptedAi, relateAnswer, STUB_REASON, buildTestRelate, seedNotes, subReport, fileLogFactory,
} from './tools/relateTestKit.mjs'
import { defineMw, CORE_LOG_KNOWN, CORE_LOG_MUST_SEE } from '../src/core/capturePackage.mjs'
import { AI_BATCH_LOG_KNOWN, AI_BATCH_LOG_MUST_SEE } from '../src/core/summarizePackage.mjs'
import { resolveRelateSettings } from '../src/core/relateSettings.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { makeEdge } from '../src/stores/edgeStore.mjs'
import { LEDGER_FILES } from '../src/stores/relateLedgers.mjs'
import { createRelateObject } from '../src/relateObject.mjs'
import { RELATE_LOG_KNOWN, RELATE_LOG_MUST_SEE, RELATE_LOG_PARSE, RELATE_REPORT_KEYS, RELATE_CTX_FLAGS } from '../src/logContract.mjs'

const KNOWN = new RegExp(RELATE_LOG_KNOWN.join('|'))
const MUST_SEE = new RegExp(RELATE_LOG_MUST_SEE.join('|'))
const DEAD_BASE = `http://127.0.0.1:${DEAD_PORT}/v1`
const DOMAIN = createRelateDomain({})
const [T0, T1] = DOMAIN.relationTypes.filter((t) => t !== DOMAIN.conflictType)
const C = DOMAIN.conflictType
const OLD = '2026-01-05T00:00:00+08:00'
const RELATED = '2026-01-02T00:00:00+08:00'
const V = '2026-02-01T00:00:00+08:00'

describe('unit-relate-log-contract', function() {

    this.timeout(180_000)

    let root = ''
    let seq = 0
    const dirOf = (name) => `${root}/${name}-${++seq}`
    /** 各情境之實際產出:{ 名: { lines:Array(全部輪之日誌行), reps:Array(run 之 report) } } */
    const runs = {}

    /**
     * 筆記(摘要套件之組裝;同一概念使彼此互為候選)
     *
     * @param {String} dir 輸入情境之 workDir
     * @param {Array} specs 輸入 [[doc, title, record?]]
     * @returns {Array} 回傳筆記記錄
     */
    const notesOf = (dir, specs) => specs.map(([doc, title, record]) => landNote(`${dir}/knowledge/notes`, { doc, title, concepts: ['觀測方法', '誤差修正'], ...(record ? { record } : {}) }))

    /**
     * 跑一個情境(總組裝;每輪一個記錄型日誌):寫入筆記與邊 → 可選之前置 → run
     *
     * @param {String} name 輸入情境名
     * @param {Object} o 輸入 { cfg:cfg 覆寫, notes:(dir) => Array, edges:(notes) => Array, prepare:async (flow, dir, notes) => 任意值, times:執行輪數(預設 1) }
     * @returns {Promise} 回傳 Promise
     */
    const scenario = async (name, o = {}) => {
        const dir = dirOf(name)
        const lg = logsOf()
        const { flow } = buildTestRelate(dir, { logFactory: lg.factory, ...(o.cfg || {}) })
        const notes = o.notes ? o.notes(dir) : []
        await seedNotes(flow, notes, o.edges ? o.edges(notes) : [])
        if (o.prepare) await o.prepare(flow, dir, notes)
        const reps = []
        for (let i = 0; i < (o.times || 1); i++) reps.push(await flow.run())
        runs[name] = { lines: lg.lines(), reps }
    }
    const two = (dir) => notesOf(dir, [['a', '恆星視差之量測'], ['b', '視差誤差之修正']])
    const pairAi = (type = T0) => scriptedAi((role, p, o, items) => (role === 'relate' ? relateAnswer(items, { 恆星視差之量測: [{ to: '視差誤差之修正', type }] }) : undefined))
    const dead = { id: 't:dead', kind: 'api-openai-compat', baseURL: DEAD_BASE, model: 'm' }

    before(async () => {
        root = tmpRoot('relate-log-contract')
        // ── 已知字樣 ──
        // 批次 AI 失敗(調度層失敗;記 relateTries 排隊尾)
        await scenario('batchFail', { cfg: { aiAdapter: scriptedAi(() => 'fail') }, notes: two })
        // 批次例外(覆寫之提示詞不合契約:組提示詞即拋)
        await scenario('batchThrow', { cfg: { prompts: { relate: () => '' } }, notes: two })
        // 時間預算守門(第一批耗盡整輪預算 → 第二批輪起不再開工)
        await scenario('budget', {
            cfg: { deadlineMs: 600, ai: { parallel: 1 }, relate: { rounds: 2, notesPerCall: 1 }, aiAdapter: scriptedAi(async () => {
                await sleep(800)
                return undefined
            }) },
            notes: two,
        })
        // 執行鎖持有中略過本輪
        let held = null
        await scenario('locked', {
            cfg: { lock: undefined },
            prepare: async (flow) => {
                held = acquireLock(flow.info().lockFile, { staleMs: 3_600_000 })
                assert.equal(held.ok, true, '前提:測試先取得執行鎖')
            },
        })
        held.release()
        assert.equal(runs.locked.reps[0].lockSkipped, true)
        // 調度層事件:健康降序、免費池額度(內建調度層;條目指向無人監聽之埠)
        await scenario('health', { cfg: { aiAdapter: undefined, ai: { extraProviders: [dead], healthStreak: 1 }, relate: { ai: { use: 't:dead' }, rounds: 1 } }, notes: two })
        const ocLog = `${root}/opencode.log`
        fs.writeFileSync(ocLog, `timestamp=${new Date().toISOString()} level=ERROR providerID=opencode modelID=mimo-v2.6-flash-free error.error="AI_APICallError: Rate limit exceeded. Please try again later."\n`, 'utf8')
        await scenario('pool', { cfg: { aiAdapter: undefined, ai: { extraProviders: [dead], pools: { oc: { log: ocLog, resetUtcHour: 0 } } }, relate: { ai: { use: 't:dead' }, rounds: 1 } }, notes: two })
        // 重評逾次未評完 → 已登錄待判(RS5)
        await scenario('reevalGaveUp', {
            cfg: { relate: { reeval: { perRun: 1, ai: { second: { use: 'stub:b' } } } } },
            notes: (dir) => notesOf(dir, [['a', '恆星視差之量測', { relatedAt: RELATED, knowledgeChangedAt: V, relatedChangeAt: V, reevalTries: 3 }], ['b', '視差誤差之修正', { relatedAt: RELATED }]]),
            edges: ([a, b]) => [makeEdge({ from: a.id, to: b.id, type: T0, reason: STUB_REASON, nowIso: OLD })],
        })
        // 投影之 md 讀不到(留帳、下輪補投)
        await scenario('projectMdMissing', { cfg: { aiAdapter: pairAi() }, notes: two, prepare: async (flow, dir, [a]) => fs.rmSync(a.file) })
        // ── 必看字樣 ──
        // 逐項鏈異常(動作鏈之環拋錯)
        const boom = defineMw({ name: 'boom', handle: async () => {
            throw new Error('寫入層壞了')
        } })
        await scenario('chainFail', { cfg: { stageOpts: { relate: { tap: { persistEdges: { before: [boom] } } } } }, notes: two })
        // 本機網路不通(注入之網路判斷器確認不通;內建調度層)
        await scenario('netDown', {
            cfg: { aiAdapter: undefined, netGuard: { check: async () => ({ up: false }), confirmDown: async () => true, isDown: () => true, describe: () => '' }, ai: { extraProviders: [dead] }, relate: { ai: { use: 't:dead' } } },
            notes: two,
        })
        // 邊庫世代不符(邊 id 不是無序對雜湊;本段與投影不寫)
        await scenario('genMismatch', { notes: two, edges: ([a, b]) => [{ ...makeEdge({ from: a.id, to: b.id, type: T0, reason: STUB_REASON, nowIso: OLD }), id: 'not-an-unordered-hash' }] })
        // 懸空邊(端點不在筆記庫、亦無刪除紀錄)
        await scenario('dangling', { notes: two, edges: ([a]) => [makeEdge({ from: a.id, to: '不在之筆記-0a1b2c3d', type: T0, reason: STUB_REASON, nowIso: OLD })] })
        // 帳檔損壞(已隔離,以空帳續跑)
        await scenario('ledgerCorrupt', {
            notes: two,
            prepare: async (flow) => {
                const st = flow.info().dirs.state
                fs.mkdirSync(st, { recursive: true })
                fs.writeFileSync(path.join(st, LEDGER_FILES.dirty), '{ 壞掉之帳', 'utf8')
            },
        })
        // 投影手改另存(記錄之 projHash 與 md 現況不符)
        await scenario('manual', { cfg: { aiAdapter: pairAi() }, notes: (dir) => notesOf(dir, [['a', '恆星視差之量測', { projHash: '上次投影之雜湊' }], ['b', '視差誤差之修正']]) })
        // 型別不在現行清單
        await scenario('typeOffList', { notes: two, edges: ([a, b]) => [makeEdge({ from: a.id, to: b.id, type: '已退役之型別', reason: STUB_REASON, nowIso: OLD })] })
        // 刪除或還原停在中途(墓碑在而記錄在)
        await scenario('halfState', {
            notes: two,
            prepare: async (flow, dir, [a]) => {
                const st = flow.info().dirs.state
                fs.mkdirSync(st, { recursive: true })
                fs.writeFileSync(path.join(st, LEDGER_FILES.tombstones), JSON.stringify({ ids: { [a.id]: { at: OLD, reason: '測試刪除' } } }), 'utf8')
            },
        })
        // 重評守門(待重評篇數逾門檻)
        await scenario('reevalGuard', {
            cfg: { relate: { reeval: { perRun: 1, guard: 1, ai: { second: { use: 'stub:b' } } } } },
            notes: (dir) => notesOf(dir, [['a', '恆星視差之量測', { relatedAt: RELATED, knowledgeChangedAt: V, relatedChangeAt: V }], ['b', '視差誤差之修正', { relatedAt: RELATED, knowledgeChangedAt: V, relatedChangeAt: V }]]),
        })
        // ── report 之條件路徑 ──
        // 筆記不足 2 篇
        await scenario('fewNotes', { notes: (dir) => notesOf(dir, [['a', '恆星視差之量測']]) })
        // 全部選配段開啟:反向、輪巡、重評、衝突核對(存量)、既有邊覆核(存量、完成期限);新筆記之正向
        await scenario('allFeatures', {
            cfg: {
                relate: {
                    ai: { use: 'stub:p' },
                    reverse: { perRun: 2 },
                    rotation: { perRun: 2 },
                    reeval: { perRun: 2, ai: { second: { use: 'stub:q' } } },
                    standards: { ai: { first: { use: 'stub:f1' }, second: { use: 'stub:f2' } }, conflictCheck: { enabled: true, perRun: 5 }, edgeReview: { enabled: true, perRun: 5, deadline: '2027-12-31' } },
                },
            },
            notes: (dir) => notesOf(dir, [
                ['a', '新加入之筆記'],
                ['b', '既有筆記乙', { relatedAt: RELATED }],
                ['c', '既有筆記丙', { relatedAt: RELATED }],
                ['d', '既有筆記丁', { relatedAt: RELATED }],
                ['e', '內容已更新之筆記', { relatedAt: RELATED, knowledgeChangedAt: V, relatedChangeAt: V }],
            ]),
            edges: ([, b, c, d, e]) => [
                makeEdge({ from: b.id, to: c.id, type: T1, reason: STUB_REASON, nowIso: OLD }),
                makeEdge({ from: c.id, to: d.id, type: C, reason: '丙說誤差可忽略；丁說誤差主導量測結果', nowIso: OLD }),
                makeEdge({ from: e.id, to: b.id, type: T0, reason: STUB_REASON, nowIso: OLD }),
            ],
        })
        // ── 直接執行之情境(總組裝恆開 holds 集合、寫入層不會故障:以子階段之依賴模擬)──
        // 批次例外之落帳失敗(寫入層故障:組提示詞拋錯、其落帳又因寫入失敗而拋)
        {
            const dir = dirOf('writeFail')
            const recs = notesOf(dir, [['a', '恆星視差之量測'], ['b', '視差誤差之修正']])
            const notes = memStore(recs)
            notes.patch = async () => {
                throw new Error('寫入層壞了')
            }
            const log = recLog()
            const domain = { ...DOMAIN, buildPrompt: () => {
                throw new Error('提示詞壞了')
            } }
            const ctx = bagCtx({ stores: { notes, relations: memStore([]), holds: memStore([]) }, settings: resolveRelateSettings({ ai: { parallel: 1 }, relate: { rounds: 1 } }), ai: null, clock: CLOCK, dirs: { state: `${dir}/state`, relations: `${dir}/relations` }, domains: { relate: domain } }, log)
            await createRelateObject({ callAI: async () => assert.fail('不應呼叫 AI') }).run(ctx)
            runs.writeFail = { lines: log.lines, reps: [] }
        }
    })

    after(() => {
        resetConceptFold()
        removeRoots([root])
    })

    /** 全部情境之 WARN／ERROR 行(外部巡檢之未知警告取自此二級) */
    const alertLines = () => Object.values(runs).flatMap((r) => r.lines || []).filter((l) => /^(WARN|ERROR) /.test(l))

    // ══════════════════════════ 字樣 ══════════════════════════
    describe('已知與必看字樣', function() {

        it('字樣之全集(外部巡檢之判讀對象;改動須同步巡檢):關聯專屬者＋摘要套件批次機制之 AI_BATCH_*(不含套用前覆核)＋抓取套件核心件之 CORE_LOG_* 之聯集——已知 10 條、必看 10 條;皆為可編譯之正則、必看為純文字;皆凍結、不重複(重評開啟須 holds 集合,「未開 holds」之字樣已無發出者)', () => {
            assert.deepEqual([...RELATE_LOG_KNOWN], [
                '次未評完（尚有 \\d+ 條未判），已登錄待判（RS5）', '關聯投影：\\d+ 篇 md 讀不到',
                ...AI_BATCH_LOG_KNOWN, ...CORE_LOG_KNOWN,
            ])
            assert.deepEqual([...RELATE_LOG_MUST_SEE], ['逐項鏈異常', '關聯邊庫世代不符', '關聯懸空邊', '關聯帳檔損壞', '關聯投影手改另存', '關聯型別不在現行清單', '關聯重評守門', '關聯刪除或還原未完成', ...AI_BATCH_LOG_MUST_SEE, ...CORE_LOG_MUST_SEE])
            assert.deepEqual([RELATE_LOG_KNOWN.length, RELATE_LOG_MUST_SEE.length, new Set(RELATE_LOG_KNOWN).size, new Set(RELATE_LOG_MUST_SEE).size], [10, 10, 10, 10])
            for (const p of [...RELATE_LOG_KNOWN, ...RELATE_LOG_MUST_SEE]) assert.doesNotThrow(() => new RegExp(p), p)
            for (const p of RELATE_LOG_MUST_SEE) assert.ok(!/[\\^$.*+?()[\]{}|]/.test(p), `必看字樣不含正則語法:${p}`)
            for (const re of Object.values(RELATE_LOG_PARSE)) assert.ok(re instanceof RegExp)
            assert.ok([RELATE_LOG_KNOWN, RELATE_LOG_MUST_SEE, RELATE_LOG_PARSE, RELATE_REPORT_KEYS, RELATE_REPORT_KEYS.detail, RELATE_CTX_FLAGS].every(Object.isFrozen))
            assert.deepEqual(RELATE_CTX_FLAGS, { edgesChanged: 'relateEdges', blocked: 'relateBlocked' })
        })

        it('①已知字樣:每一條皆命中實際日誌之 WARN 行(由情境之真實執行產出)', () => {
            const lines = alertLines()
            const miss = RELATE_LOG_KNOWN.filter((p) => !lines.some((l) => new RegExp(p).test(l)))
            assert.deepEqual(miss, [], `未在實際日誌出現之已知字樣(情境未涵蓋或字樣已改):\n${lines.join('\n')}`)
        })

        it('①必看字樣:每一條皆命中實際日誌之 WARN／ERROR 行;行首為已知字樣者(批次 AI 失敗＋本機網路不通、批次異常＋落帳失敗)仍須見', () => {
            const lines = alertLines()
            const miss = RELATE_LOG_MUST_SEE.filter((p) => !lines.some((l) => l.includes(p)))
            assert.deepEqual(miss, [], `未在實際日誌出現之必看字樣:\n${lines.join('\n')}`)
            const net = lines.find((l) => l.includes('本機網路不通'))
            assert.ok(KNOWN.test(net) && MUST_SEE.test(net), `斷網之行之行首為已知之「批次 AI 失敗」,仍須見:${net}`)
        })

        it('實際日誌之代表行逐字:批次失敗、批次例外、時間預算守門、略過本輪、調度層事件、重評逾次、投影讀不到、鏈異常、世代不符、懸空、帳檔損壞、手改另存、型別清單外、重評守門、刪除或還原未完成、落帳失敗', () => {
            const has = (name, re) => assert.ok(runs[name].lines.some((l) => re.test(l)), `${name}:\n${runs[name].lines.join('\n')}`)
            has('batchFail', /^WARN 批次 AI 失敗（stub 失敗，試 1 次）→ $/)
            has('batchThrow', /^WARN 批次異常：opt\.prompts\.relate 須回傳非空字串$/)
            has('budget', /^WARN 批次：逾時間預算，第 2\/2 輪起不再開工（未取件者留佇列）$/)
            has('locked', /^WARN 管道\[知識關聯\] 略過本輪：/)
            has('health', /^WARN 供應商健康：t:dead 連續 1 次 \S+ 失敗（.*），降序冷卻$/)
            has('pool', /^WARN 供應商額度：oc:opencode\/mimo-v2\.6-flash-free 自 /)
            has('reevalGaveUp', /^WARN 關聯重評：恆星視差之量測-[0-9a-f]{8} 逾 3 次未評完（尚有 1 條未判），已登錄待判（RS5）$/)
            has('projectMdMissing', /^WARN 關聯投影：1 篇 md 讀不到（例 恆星視差之量測-[0-9a-f]{8}），留待下輪補投$/)
            has('chainFail', /^WARN 關聯：逐項鏈異常\[恆星視差之量測-[0-9a-f]{8}\]：.*寫入層壞了/)
            has('netDown', /^WARN 批次 AI 失敗（本機網路不通（不計此次之失敗）：/)
            has('genMismatch', /^ERROR 關聯邊庫世代不符：1 條邊之 id 不是無序對雜湊（sha1\(min\|max\)）——本輪關聯段與投影不寫入；/)
            has('dangling', /^WARN 關聯懸空邊 1 條（端點不在筆記庫、亦無刪除紀錄）：未自動刪除——確認後以 pruneDangling（opt\.apply）清理$/)
            has('ledgerCorrupt', /^WARN 關聯帳檔損壞：relate-dirty\.json（.*），已隔離為 relate-dirty\.json\.corrupt-\d+；以空帳續跑——可用 projectAll（opt\.all）全庫重投補回$/)
            has('manual', /^WARN 關聯投影手改另存：.*恆星視差之量測-[0-9a-f]{8}-\d+\.md（關聯章／衝突章與上次投影不同/)
            has('typeOffList', /^WARN 關聯型別不在現行清單：「已退役之型別」1 條——既有邊不自動改寫/)
            has('reevalGuard', /^WARN 關聯重評守門：待重評 2 篇逾 1 篇（批次改寫？），本輪不開工——確認後以 reevalBaseline（opt\.apply、opt\.by、opt\.ruling）重設基準$/)
            has('halfState', /^WARN 關聯刪除或還原未完成：恆星視差之量測-[0-9a-f]{8}（墓碑在而記錄在）——以 deleteNote（續刪）或 undoDeleteNote／restoreNote（續還原）續作完成$/)
            has('writeFail', /^WARN 批次異常：提示詞壞了$/)
            has('writeFail', /^WARN 批次異常之落帳失敗：寫入層壞了$/)
            has('batchFail', /^WARN 啟動期檢核：未給 scheduleLimitMin 亦未給 deadlineMs/)
        })

        it('②不收無發出者之字樣:「套用前覆核中止」不列(關聯之批次不給套用前覆核——原始碼無 reviewItems);實際日誌亦不含之', () => {
            assert.ok(!RELATE_LOG_KNOWN.some((p) => /套用前覆核/.test(p)))
            const files = sourceFilesOf(path.join(PKG_ROOT, 'src'))
            assert.ok(files.length >= 40, `掃描量過少:${files.length}`)
            assert.deepEqual(files.filter((f) => /\breviewItems\b/.test(lexSource(fs.readFileSync(path.join(PKG_ROOT, 'src', f), 'utf8')).skeleton)), [])
            assert.deepEqual(alertLines().filter((l) => /套用前覆核中止/.test(l)), [])
        })
    })

    // ══════════════════════════ 正則 ══════════════════════════
    describe('逐輪數字之正則(RELATE_LOG_PARSE)', function() {

        it('③真實日誌檔(抓取套件之日誌器)之段落完成行解析所得＝report 之 detail／stats(處理、關聯、衝突、AI 次數)', async () => {
            const dir = dirOf('parse')
            let flow = null
            ;({ flow } = buildTestRelate(dir, { aiAdapter: pairAi(C), logFactory: fileLogFactory(() => flow) }))
            await seedNotes(flow, two(dir))
            const rep = await flow.run()
            const text = fs.readFileSync(rep.summaryFile.replace(/-run\.json$/, '-run.log'), 'utf8')
            const num = (re) => {
                const m = text.match(re)
                return m ? Number(m[1]) : null
            }
            const rl = subReport(rep, '關聯', 'relate')
            const parsed = Object.fromEntries(Object.entries(RELATE_LOG_PARSE).map(([k, re]) => [k, num(re)]))
            assert.deepEqual(parsed, { targets: rl.detail.targets, edges: rl.detail.edges, conflicts: rl.detail.conflicts, aiCalls: rl.stats.aiCalls }, text.split('\n').filter((l) => /關聯 完成/.test(l)).join('\n'))
            assert.deepEqual([parsed.targets, parsed.edges, parsed.conflicts, parsed.aiCalls], [2, 1, 1, 1])
            // 固定格式之附加段不影響解析(句尾附段;AI 次數取第一個)
            const line = '[2026-10-09T01:00:00+08:00] INFO  步驟3 關聯 完成：處理 4、關聯 5 條、衝突 2 組（AI 3 次）｜重判 1 篇｜衝突核對 2 條（成立 1、改理由 0、非衝突 1、無關聯 0、理由修不了而撤出 0、判不了 0）（1.2s）'
            assert.deepEqual(Object.values(RELATE_LOG_PARSE).map((re) => Number(line.match(re)[1])), [4, 5, 2, 3])
        })
    })

    // ══════════════════════════ report 鍵 ══════════════════════════
    describe('report 之鍵(RELATE_REPORT_KEYS)', function() {

        /** 全部情境之關聯段 report(未取得鎖者無) */
        const stageReports = () => Object.values(runs).flatMap((r) => r.reps || []).map((rep) => (rep.stages || []).find((s) => s.name === RELATE_REPORT_KEYS.stage)).filter(Boolean)

        it('④階段名與子階段鍵:實際 report 之段名即 stage(＝關聯物件之預設名)、子階段依序為 subStages 之前綴(總覽未執行者不在);統計鍵即 stats', () => {
            assert.equal(RELATE_REPORT_KEYS.stage, createRelateObject().name)
            const reps = stageReports()
            assert.ok(reps.length >= 15, `情境之 report 過少:${reps.length}`)
            const seenSubs = new Set()
            for (const st of reps) {
                const subs = Object.keys(st.result.detail)
                assert.deepEqual(subs, RELATE_REPORT_KEYS.subStages.slice(0, subs.length), JSON.stringify(subs))
                for (const s of subs) seenSubs.add(s)
                assert.deepEqual(Object.keys(st.result.stats).sort(), [...RELATE_REPORT_KEYS.stats].sort())
                for (const sub of subs) assert.deepEqual(Object.keys(st.result.detail[sub].stats).sort(), [...RELATE_REPORT_KEYS.stats].sort(), sub)
            }
            assert.deepEqual([...seenSubs], [...RELATE_REPORT_KEYS.subStages], '三個子階段皆在某一 report 出現')
        })

        it('④各子階段 detail 之鍵集＝實際 report(各條件路徑:世代不符、筆記不足、全部選配段〔重評、衝突核對、既有邊覆核含完成期限、輪巡、反向〕、投影之略過、總覽)之聯集:無未列之鍵、無未出現之鍵', () => {
            const seen = Object.fromEntries(RELATE_REPORT_KEYS.subStages.map((k) => [k, new Set()]))
            for (const st of stageReports()) {
                for (const sub of RELATE_REPORT_KEYS.subStages) for (const k of Object.keys(st.result.detail[sub]?.detail || {})) seen[sub].add(k)
            }
            for (const sub of RELATE_REPORT_KEYS.subStages) {
                const declared = [...RELATE_REPORT_KEYS.detail[sub]].sort()
                assert.deepEqual([...seen[sub]].filter((k) => !declared.includes(k)).sort(), [], `${sub} 之實際 report 有未列之鍵`)
                assert.deepEqual(declared.filter((k) => !seen[sub].has(k)), [], `${sub} 列了而未在實際 report 出現之鍵(情境未涵蓋或鍵已改)`)
            }
            for (const k of ['rs4Aborted', 'rs6Aborted', 'rs4HoldsNoSecond', 'rs6Deadline', 'genMismatch', 'reevalReproposed']) assert.ok(seen.relate.has(k), `條件鍵 ${k} 有情境涵蓋`)
        })

        it('④巡檢所讀之鍵於實際執行時皆在:關聯之 targets／edges／conflicts／pending／reTargets／reverse*／retired／dangling／genMismatch,開啟時之 reeval*／rs4Total／rs4Done／rs6Total／rs6Done／rs6Checked／rs6Deadline;投影之 failed／backlog／manual', () => {
            const base = subReport(runs.batchFail.reps[0], '關聯', 'relate').detail
            for (const k of ['targets', 'edges', 'conflicts', 'pending', 'reTargets', 'reverseTargets', 'reverseEdges', 'reversePending', 'reverseDeferred', 'retired', 'dangling', 'relateCapDropped']) assert.ok(k in base, `relate.${k}`)
            assert.ok('genMismatch' in subReport(runs.genMismatch.reps[0], '關聯', 'relate').detail)
            const all = subReport(runs.allFeatures.reps[0], '關聯', 'relate').detail
            for (const k of ['reevalPending', 'reevalTargets', 'reevalPages', 'reevalChanged', 'reevalRetired', 'reevalCandidates', 'reevalDisagree', 'reevalSameProvider', 'reevalGaveUp', 'reevalBlocked', 'reevalDeferred', 'reevalMdMissing', 'reevalUnsure', 'reevalThird', 'reevalHolds', 'reevalHoldsResolved', 'reevalHoldsStale', 'reevalRetried', 'reevalReproposed', 'rs6Total', 'rs6Done', 'rs6Checked', 'rs6Deadline', 'rs4Total', 'rs4Done']) assert.ok(k in all, `relate.${k}`)
            assert.equal(all.rs6Deadline, '2027-12-31')
            const pj = subReport(runs.projectMdMissing.reps[0], '關聯', 'project').detail
            for (const k of ['failed', 'backlog', 'manual']) assert.ok(k in pj, `project.${k}`)
            assert.deepEqual(subReport(runs.genMismatch.reps[0], '關聯', 'project').detail, { blocked: true }, '世代不符:投影略過')
        })
    })

    // ══════════════════════════ 已知與必看之交疊 ══════════════════════════
    describe('已知與必看之交疊', function() {

        it('巡檢之判準(列出＝非已知或為必看):常態之失敗、守門與 I11 之兩句不列;行首為已知字樣而含必看字樣者(斷網之批次失敗、批次例外之落帳失敗)、邊庫完整性與手改、鏈異常、重評守門仍列', () => {
            const visible = (l) => !KNOWN.test(l) || MUST_SEE.test(l)
            const pick = (name, re) => runs[name].lines.find((l) => re.test(l))
            for (const [name, re] of [['batchFail', /^WARN 批次 AI 失敗（stub/], ['budget', /逾時間預算/], ['health', /供應商健康/], ['reevalGaveUp', /次未評完/], ['projectMdMissing', /^WARN 關聯投影：1 篇 md 讀不到/]]) {
                const l = pick(name, re)
                assert.ok(l, `${name}:${runs[name].lines.join('\n')}`)
                assert.equal(visible(l), false, `常態不列:${l}`)
            }
            for (const [name, re] of [['writeFail', /^WARN 批次異常之落帳失敗/], ['netDown', /本機網路不通/], ['chainFail', /逐項鏈異常/], ['genMismatch', /關聯邊庫世代不符/], ['dangling', /關聯懸空邊/], ['ledgerCorrupt', /關聯帳檔損壞/], ['manual', /關聯投影手改另存/], ['typeOffList', /關聯型別不在現行清單/], ['reevalGuard', /關聯重評守門/], ['halfState', /關聯刪除或還原未完成/]]) {
                const l = pick(name, re)
                assert.ok(l, name)
                assert.equal(visible(l), true, `須見:${l}`)
            }
            assert.ok(KNOWN.test(pick('writeFail', /^WARN 批次異常之落帳失敗/)), '前提:落帳失敗之行首為已知之「批次異常」')
        })
    })
})
