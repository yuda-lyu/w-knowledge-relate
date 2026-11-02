// unit-relate-projection.test.mjs — 關聯要點 2:投影(兩端皆由邊庫重算、含入邊、行序、冪等逐位元組、寫前比對、清重複章、
//   無邊即移除、CRLF、手改另存、純計算與寫檔同一結果;DB 衝突對＝md conflicts)與關聯之持久帳(缺檔／壞檔分流)
// 規格出處:規則帳本 REL-04、REL-05
// 執行:自套件根 node <mocha> test/unit-relate-projection.test.mjs(暫存 test/_tmp/relate-proj-<pid>,測完即刪)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { readMd, writeMd, mdText, sectionOf } from '../src/core/summarizePackage.mjs'
import { readJsonlRows } from '../src/core/capturePackage.mjs'
import { genClockTZ, recLog, removeRoots } from './tools/captureForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { makeEdge, typeRankOf } from '../src/stores/edgeStore.mjs'
import { renderRelationSections, projectNote, projectText, sectionsHashOf, RELATE_SECTION_TITLES } from '../src/stores/noteProjection.mjs'
// 摘要套件之非內容章表(跨套件之契約)經測試專用之橋接取得
import { NON_CONTENT_SECTIONS } from './tools/summarizeForTest.mjs'
import { loadLedgerJson, createDirtyLedger, createReverseLedger, createRelateState, createTombstones, indexDirtyOf, appendAudit, readAuditRows, openRelateLedgers, ledgerCorruptTextOf, LEDGER_FILES } from '../src/stores/relateLedgers.mjs'

let TMP = ''
const VOCAB ={ relationTypes: ['前置概念', '延伸深化', '互補搭配', '衝突或反例', '實作範例'], conflictType: '衝突或反例', fallbackType: '互補搭配' }
const cfg = { rank: typeRankOf(VOCAB), conflictType: VOCAB.conflictType }
const TITLES = { n1: '筆記一', n2: '筆記二', n3: '筆記三', n4: '筆記四' }
const titleOf = (id) => TITLES[id] || ''
const E = (from, to, type, at, reason = `${from}→${to}`) => makeEdge({ from, to, type, reason, nowIso: at })
const note = (id, extra = {}) => {
    const file = `${TMP}/${id}.md`
    writeMd(file, { title: TITLES[id], slug: id, type: 'note', ...(extra.front || {}) }, extra.body || `# ${TITLES[id]}\n\n## 核心知識\n\n- 要點`)
    return { id, file }
}

describe('unit-relate-projection', function() {

    before(() => {
        TMP = tmpRoot('relate-proj')
    })
    after(() => removeRoots([TMP]))

    it('renderRelationSections:含入邊(←)與出邊(→);衝突在前→型別序→新到舊;⚠ 行式不變;related／conflicts 排序;related_at＝邊之最新時刻', () => {
        const edges = [
            E('n1', 'n2', '互補搭配', '2026-10-01'),
            E('n3', 'n1', '前置概念', '2026-10-02'),
            E('n4', 'n1', '衝突或反例', '2026-09-01', 'n4 說 X、n1 說 Y'),
            E('n1', 'n3x', '前置概念', '2026-10-03'),
        ]
        const r = renderRelationSections('n1', edges, titleOf, cfg)
        assert.deepEqual(r.relLines, [
            '- [衝突或反例] ← [[n4]] 筆記四：n4 說 X、n1 說 Y',
            '- [前置概念] → [[n3x]] ：n1→n3x',
            '- [前置概念] ← [[n3]] 筆記三：n3→n1',
            '- [互補搭配] → [[n2]] 筆記二：n1→n2',
        ])
        assert.deepEqual(r.conflictLines, ['- 與 [[n4]] 筆記四：n4 說 X、n1 說 Y'])
        assert.deepEqual([r.related, r.conflicts, r.relatedAt], [['n2', 'n3', 'n3x', 'n4'], ['n4'], '2026-10-03'])
    })

    it('projectNote:兩章與 frontmatter 由邊重算;第二次投影不寫檔且逐位元組相同;清除重複章;無邊即移除兩章與三鍵;回傳度數與兩章雜湊', () => {
        const n = note('n1', {
            front: { related: ['舊殘留'], related_at: '2020-01-01', conflicts: ['舊衝突'] },
            body: '# 筆記一\n\n## 核心知識\n\n- 要點\n\n## ⚠ 衝突與反例\n\n- 與 [[舊衝突]] 舊：x\n\n## 關聯\n\n- [互補搭配] [[舊]] 舊：y\n\n## 關聯\n\n- 重複章',
        })
        const edges = [E('n2', 'n1', '衝突或反例', '2026-10-02', '理由'), E('n1', 'n3', '前置概念', '2026-10-01')]
        const r1 = projectNote(n, edges, titleOf, cfg)
        const t1 = fs.readFileSync(n.file, 'utf8')
        assert.deepEqual([r1.ok, r1.changed, r1.degree, r1.manual], [true, true, 2, false])
        const md = readMd(n.file)
        assert.equal(r1.projHash, sectionsHashOf(md.body), '回傳之 projHash＝寫出後兩章之雜湊')
        assert.deepEqual([md.front.related, md.front.conflicts, md.front.related_at], [['n2', 'n3'], ['n2'], '2026-10-02'])
        assert.equal((md.body.match(/^## 關聯$/gm) || []).length, 1, '重複章已清')
        assert.match(md.body, /## 核心知識\n\n- 要點\n\n## 關聯\n\n- \[衝突或反例\] ← \[\[n2\]\] 筆記二：理由\n- \[前置概念\] → \[\[n3\]\] 筆記三：n1→n3\n\n## ⚠ 衝突與反例\n\n- 與 \[\[n2\]\] 筆記二：理由\s*$/)
        assert.ok(!md.body.includes('舊'), '舊投影殘留全清')
        const r2 = projectNote({ ...n, projHash: r1.projHash }, edges, titleOf, cfg)
        assert.deepEqual([r2.ok, r2.changed, r2.manual, fs.readFileSync(n.file, 'utf8') === t1], [true, false, false, true], '冪等:不寫檔、逐位元組相同')
        projectNote(n, [], titleOf, cfg)
        const md0 = readMd(n.file)
        assert.deepEqual([md0.front.related, md0.front.conflicts, md0.front.related_at, /## 關聯|## ⚠/.test(md0.body)], [undefined, undefined, undefined, false])
        assert.deepEqual(projectNote({ id: 'x', file: `${TMP}/none.md` }, edges, titleOf, cfg), { ok: false, changed: false }, 'md 讀不到回 ok:false')
    })

    it('projectText(純計算)與 projectNote(寫檔)同一結果:全文逐位元組相同、changed 一致', () => {
        const n = note('n2')
        const edges = [E('n2', 'n1', '延伸深化', '2026-10-05'), E('n4', 'n2', '衝突或反例', '2026-10-06', '衝突理由')]
        const p = projectText(readMd(n.file), 'n2', edges, titleOf, cfg)
        const r = projectNote(n, edges, titleOf, cfg)
        assert.deepEqual([p.changed, r.changed, fs.readFileSync(n.file, 'utf8') === p.text, p.projHash === r.projHash], [true, true, true, true])
        assert.equal(projectText(readMd(n.file), 'n2', edges, titleOf, cfg).changed, false)
    })

    it('CRLF(git core.autocrlf):章名行帶 \\r 仍找得到;投影清掉舊章、不重複追加;寫出統一為 LF', () => {
        assert.ok(sectionOf('前言\r\n\r\n## 關聯\r\n\r\n- x\r\n', '關聯'), 'sectionOf 容 CRLF 章名行')
        const file = `${TMP}/crlf.md`
        fs.writeFileSync(file, '---\r\ntitle: "CRLF"\r\nrelated: ["舊"]\r\n---\r\n\r\n# CRLF\r\n\r\n## 核心知識\r\n\r\n- 要點\r\n\r\n## 關聯\r\n\r\n- [互補搭配] → [[舊]] 舊：y\r\n\r\n## ⚠ 衝突與反例\r\n\r\n- 與 [[舊]] 舊：x\r\n', 'utf8')
        const r = projectNote({ id: 'crlf', file }, [E('crlf', 'n1', '前置概念', '2026-10-01')], titleOf, cfg)
        const text = fs.readFileSync(file, 'utf8')
        assert.deepEqual([r.ok, r.changed, text.includes('\r'), (text.match(/^## 關聯$/gm) || []).length, text.includes('舊'), /## ⚠/.test(text)], [true, true, false, 1, false, false])
        assert.match(text, /## 核心知識\n\n- 要點\n\n## 關聯\n\n- \[前置概念\] → \[\[n1\]\] 筆記一：crlf→n1\n$/)
    })

    it('手改偵測:兩章與上次投影之雜湊不同 → 另存原檔再覆寫(manual、backup);無上次雜湊者不判手改', () => {
        const n = note('n3')
        const edges = [E('n3', 'n1', '前置概念', '2026-10-01')]
        const r1 = projectNote(n, edges, titleOf, cfg)
        const md = readMd(n.file)
        writeMd(n.file, md.front, `${md.body}\n- [互補搭配] → [[手加]] 手加：使用者自己加的一行`)
        const manualDir = `${TMP}/state/${LEDGER_FILES.manual}`
        const r2 = projectNote({ ...n, projHash: r1.projHash }, edges, titleOf, { ...cfg, manualDir, stamp: '20261004120000' })
        assert.deepEqual([r2.manual, r2.changed, fs.existsSync(r2.backup), path.basename(r2.backup)], [true, true, true, 'n3-20261004120000.md'])
        assert.ok(fs.readFileSync(r2.backup, 'utf8').includes('使用者自己加的一行'), '另存檔保有手改內容')
        assert.ok(!fs.readFileSync(n.file, 'utf8').includes('手加'), '覆寫後回到邊庫之投影')
        assert.equal(r2.projHash, r1.projHash)
        writeMd(n.file, md.front, `${md.body}\n- 再改`)
        assert.equal(projectNote(n, edges, titleOf, { ...cfg, manualDir }).manual, false, '記錄無 projHash(首次)不判手改')
    })

    it('手改偵測:記錄之 projHash 過時而覆寫不改變兩章(他處改了 md 之其他部分,如摘要之存量處置回退)→ 不判手改、不另存', () => {
        const n = note('n4')
        const edges = [E('n4', 'n1', '前置概念', '2026-10-01')]
        projectNote(n, edges, titleOf, cfg)
        const manualDir = `${TMP}/state/${LEDGER_FILES.manual}-stale`
        const r1 = projectNote({ ...n, projHash: '上次投影之雜湊' }, edges, titleOf, { ...cfg, manualDir, stamp: '20261004120001' })
        assert.deepEqual([r1.manual, r1.changed, r1.backup, fs.existsSync(manualDir)], [false, false, '', false], '兩章已等於投影')
        const md = readMd(n.file)
        writeMd(n.file, md.front, md.body.replace('- 要點', '- 要點(回退後)'))
        const r2 = projectNote({ ...n, projHash: '上次投影之雜湊' }, edges, titleOf, { ...cfg, manualDir, stamp: '20261004120002' })
        assert.deepEqual([r2.manual, r2.changed, fs.existsSync(manualDir)], [false, false, false], '內容章改動、兩章不變')
        assert.ok(fs.readFileSync(n.file, 'utf8').includes('要點(回退後)'), '投影不動內容章')
    })

    it('兩端對稱:同一組邊投影兩端後,y ∈ x.related ⇔ x ∈ y.related;DB 衝突對＝md conflicts 對', () => {
        const ns = ['n1', 'n2', 'n3', 'n4'].map((id) => note(id))
        const edges = [E('n1', 'n2', '互補搭配', '2026-10-01'), E('n3', 'n2', '衝突或反例', '2026-10-02'), E('n4', 'n1', '延伸深化', '2026-10-03')]
        for (const n of ns) projectNote(n, edges.filter((e) => e.from === n.id || e.to === n.id), titleOf, cfg)
        const front = Object.fromEntries(ns.map((n) => [n.id, readMd(n.file).front]))
        for (const x of Object.keys(front)) for (const y of front[x].related || []) assert.ok((front[y].related || []).includes(x), `${x}→${y} 對稱`)
        const mdConf = new Set(Object.entries(front).flatMap(([x, f]) => (f.conflicts || []).map((y) => [x, y].sort().join('|'))))
        assert.deepEqual([...mdConf], ['n2|n3'])
    })

    it('待投影帳:add／remove 即時落檔、重載後相同;清空即刪檔;壞檔隔離為 .corrupt-<時戳> 並告警、以空帳續行(不當空帳覆蓋)', () => {
        const dir = `${TMP}/state`
        const f = `${dir}/${LEDGER_FILES.dirty}`
        fs.mkdirSync(dir, { recursive: true })
        const a = createDirtyLedger(f)
        a.add(['n2', 'n1', 'n2'])
        assert.deepEqual(createDirtyLedger(f).ids(), ['n1', 'n2'], '重載後相同(去重、排序)')
        a.remove(['n1'])
        assert.deepEqual(createDirtyLedger(f).ids(), ['n2'])
        a.remove(['n2'])
        assert.equal(fs.existsSync(f), false, '清空即刪檔')
        fs.writeFileSync(f, '{壞', 'utf8')
        const warn = []
        const b = createDirtyLedger(f, { stamp: 'S1', onCorrupt: (i) => warn.push(i) })
        assert.deepEqual([b.size(), warn.length, fs.existsSync(`${f}.corrupt-S1`), fs.existsSync(f)], [0, 1, true, false])
        assert.equal(fs.readFileSync(`${f}.corrupt-S1`, 'utf8'), '{壞', '壞檔原樣保留')
    })

    it('持久檔語意(D15):錯形狀＝壞檔(隔離、告警附結構問題);隔離失敗不假稱成功(movedTo null、quarantineError;壞檔仍在原位);墓碑為關鍵帳,壞而無法隔離即拒寫;開帳之告警字樣只一份(log 預設:已隔離／隔離失敗兩形)', () => {
        const dir = `${TMP}/state3`
        fs.mkdirSync(dir, { recursive: true })
        // 錯形狀:可解析但結構不對 → 與解析失敗同一處置(隔離＋告警),告警之原因為結構問題
        const f = `${dir}/${LEDGER_FILES.dirty}`
        fs.writeFileSync(f, '{"ids":"n1"}', 'utf8')
        const warn = []
        const a = createDirtyLedger(f, { stamp: 'S2', onCorrupt: (i) => warn.push(i) })
        assert.deepEqual([a.size(), fs.existsSync(`${f}.corrupt-S2`), fs.existsSync(f), warn[0].error, warn[0].movedTo], [0, true, false, '結構應為 { ids:[筆記 id] }', `${f}.corrupt-S2`])
        // 隔離失敗:隔離檔名被同名目錄佔住 → rename 失敗;非關鍵帳如實回報(movedTo null、quarantineError)、以空帳續行,壞檔仍在原位
        fs.writeFileSync(f, '{壞', 'utf8')
        fs.mkdirSync(`${f}.corrupt-S3`, { recursive: true })
        const warn2 = []
        const b = createDirtyLedger(f, { stamp: 'S3', onCorrupt: (i) => warn2.push(i) })
        assert.deepEqual([b.size(), warn2.length, warn2[0].movedTo, typeof warn2[0].quarantineError, fs.readFileSync(f, 'utf8')], [0, 1, null, 'string', '{壞'])
        assert.ok(warn2[0].quarantineError.length > 0, '隔離失敗之原因')
        // 墓碑為關鍵帳:壞而無法隔離即拒寫(不以空帳續行——否則已刪之筆記會被重新收件)
        const t = `${dir}/${LEDGER_FILES.tombstones}`
        fs.writeFileSync(t, '{"ids":[]}', 'utf8')
        fs.mkdirSync(`${t}.corrupt-S4`, { recursive: true })
        assert.throws(() => createTombstones(t, { stamp: 'S4' }), /^Error: 關聯帳檔損壞且無法隔離（relate-tombstones\.json：結構應為 \{ ids:\{ 筆記 id:時刻 \} \}；隔離失敗：.+）——拒寫$/)
        assert.equal(fs.readFileSync(t, 'utf8'), '{"ids":[]}', '拒寫後壞檔原樣')
        // 唯讀讀法(quarantine:false;預演、掃描、預覽、驗證與下游套件之純讀入口):壞檔不改名、不拋(關鍵帳亦然),只回報 { movedTo:null, readOnly:true }
        const warn3 = []
        assert.equal(loadLedgerJson(t, { quarantine: false, critical: true, shape: (d) => (d && typeof d.ids === 'object' && !Array.isArray(d.ids) ? '' : '錯'), onCorrupt: (i) => warn3.push(i) }), null)
        assert.deepEqual([warn3.length, warn3[0].movedTo, warn3[0].readOnly, warn3[0].error, fs.readFileSync(t, 'utf8')], [1, null, true, '錯', '{"ids":[]}'])
        assert.deepEqual(loadLedgerJson(`${dir}/none.json`, { quarantine: false, onCorrupt: (i) => warn3.push(i) }), null, '缺檔仍為 null 且不回報')
        assert.equal(warn3.length, 1)
        fs.rmSync(t, { force: true })
        // 開帳之告警字樣(ledgerCorruptTextOf;給 log 而未給 onCorrupt 者用之):已隔離附隔離檔名;隔離失敗明寫原因與壞檔仍在原位
        const log = recLog()
        const lines = log.lines
        openRelateLedgers(dir, { stamp: 'S3', log }) // 隔離檔名仍被目錄佔住 → 隔離失敗之形
        assert.equal(lines.length, 1, lines.join('\n'))
        assert.match(lines[0], /^WARN 關聯帳檔損壞：relate-dirty\.json（.+），隔離失敗：.+（壞檔仍在原位，下次寫入會覆寫——請先手動移走）；以空帳續跑——可用 projectAll（opt\.all）全庫重投補回$/)
        fs.rmSync(`${f}.corrupt-S3`, { recursive: true, force: true })
        openRelateLedgers(dir, { stamp: 'S6', log })
        assert.match(lines[1], /^WARN 關聯帳檔損壞：relate-dirty\.json（.+），已隔離為 relate-dirty\.json\.corrupt-S6；以空帳續跑——可用 projectAll（opt\.all）全庫重投補回$/)
        assert.equal(ledgerCorruptTextOf({ file: '/s/relate-dirty.json', movedTo: '/s/relate-dirty.json.corrupt-1', error: 'Unexpected token' }), '關聯帳檔損壞：relate-dirty.json（Unexpected token），已隔離為 relate-dirty.json.corrupt-1；以空帳續跑——可用 projectAll（opt.all）全庫重投補回')
        // 給 onCorrupt 者從之(不另 warn);皆無即靜默
        fs.writeFileSync(f, '{壞', 'utf8')
        const seen = []
        openRelateLedgers(dir, { stamp: 'S7', log, onCorrupt: (i) => seen.push(i.file) })
        assert.deepEqual([seen.length, lines.length], [1, 2])
        fs.writeFileSync(f, '{壞', 'utf8')
        openRelateLedgers(dir, { stamp: 'S8' })
        assert.equal(fs.existsSync(`${f}.corrupt-S8`), true, '無告警管道仍隔離')
        // 稽核帳之讀法為 JSONL 共用件:尾端半行續寫不黏行、壞行略過
        const r = `${dir}/${LEDGER_FILES.retired}`
        fs.writeFileSync(r, '{"reason":"r0","edge":{"id":"e0"}}\n{"reason":"半', 'utf8')
        appendAudit(r, { reason: 'r1', edge: { id: 'e1' } })
        assert.deepEqual(readAuditRows(r).map((x) => x.reason), ['r0', 'r1'])
        assert.equal(fs.readFileSync(r, 'utf8').split('\n').length, 4, '半行、新列各自一行')
    })

    it('反向待處理帳、狀態、墓碑、稽核:去重、bump 只增 tries、條件移除;indexDirty 旗標;墓碑增刪;稽核逐行 append', () => {
        const dir = `${TMP}/state2`
        const L = openRelateLedgers(dir)
        L.reverse.add([{ o: 'o1', n: 'n1', score: 21, at: 't1' }, { o: 'o1', n: 'n1', score: 99, at: 't2' }, { o: 'o2', n: 'n1', score: 10, at: 't1' }])
        L.reverse.bump([{ o: 'o1', n: 'n1' }])
        const re = createReverseLedger(`${dir}/${LEDGER_FILES.reverse}`)
        assert.deepEqual(re.pairs().map((p) => [p.o, p.n, p.score, p.tries]), [['o1', 'n1', 21, 1], ['o2', 'n1', 10, 0]], '同一對只留首筆;bump 只增 tries')
        re.remove((p) => p.o === 'o1')
        assert.deepEqual(createReverseLedger(`${dir}/${LEDGER_FILES.reverse}`).pairs().map((p) => p.o), ['o2'])
        assert.equal(indexDirtyOf(dir), false)
        L.state.set({ indexDirty: true })
        assert.deepEqual([indexDirtyOf(dir), createRelateState(`${dir}/${LEDGER_FILES.state}`).get()], [true, { indexDirty: true }])
        L.tombstones.add('gone-1', 't9')
        assert.deepEqual([createTombstones(`${dir}/${LEDGER_FILES.tombstones}`).has('gone-1'), L.tombstones.at('gone-1')], [true, 't9'])
        L.tombstones.remove('gone-1')
        assert.equal(fs.existsSync(`${dir}/${LEDGER_FILES.tombstones}`), false)
        appendAudit(L.files.retired, { at: 't', reason: 'r1', edge: { id: 'e1' } })
        appendAudit(L.files.retired, { at: 't', reason: 'r2', edge: { id: 'e2' } })
        assert.deepEqual(readJsonlRows(L.files.retired).map((x) => x.reason), ['r1', 'r2'])
        assert.equal(mdText({}, 'x'), '---\n---\n\nx\n')
    })

    // ── 章節順序不定時之正確性(舊檔之章序可為衝突章在前、關聯章含舊行) ──
    it('舊檔章序(衝突章在前):投影後兩章固定為「關聯 → ⚠」、各一、舊行清除;入邊之衝突亦列;frontmatter conflicts 由邊重算', () => {
        const clock = genClockTZ('Asia/Taipei')
        const file = `${TMP}/note-b.md`
        writeMd(file, { title: 'B', slug: 'b-22222222', conflicts: ['c-33333333'] }, '# B\n\n內文\n\n## ⚠ 衝突與反例\n\n- 與 [[c-33333333]] C 標題：甲說X乙說Y\n\n## 關聯\n\n- [衝突或反例] [[d-44444444]] T：舊行')
        const n = { id: 'b-22222222', file, title: 'B' }
        const at = clock.iso8()
        const edges = [
            makeEdge({ from: 'b-22222222', to: 'c-33333333', type: '衝突或反例', reason: '甲說X乙說Y', nowIso: at }),
            makeEdge({ from: 'd-44444444', to: 'b-22222222', type: '衝突或反例', reason: '丙說P丁說Q', nowIso: at }),
            makeEdge({ from: 'b-22222222', to: 'e-55555555', type: '互補搭配', reason: 'r2', nowIso: at }),
        ]
        projectNote(n, edges, (id) => ({ 'c-33333333': 'C 標題', 'd-44444444': 'D 標題' })[id] || 'T', { rank: typeRankOf(createRelateDomain({})), conflictType: '衝突或反例' })
        const md = readMd(file)
        assert.ok(md.body.indexOf('## 關聯') < md.body.indexOf('## ⚠ 衝突與反例'), '投影後章序固定:關聯在前、⚠ 在後')
        assert.equal((md.body.match(/^## (關聯|⚠ 衝突與反例)$/gm) || []).length, 2, '兩章各一')
        const conf = sectionOf(md.body, '⚠ 衝突與反例')
        assert.ok(conf.text.includes('[[d-44444444]]') && conf.text.includes('[[c-33333333]]'), '入邊之衝突亦列')
        assert.doesNotMatch(md.body, /舊行/)
        assert.deepEqual(md.front.conflicts, ['c-33333333', 'd-44444444'])
    })

    it('章名為跨套件之契約:RELATE_SECTION_TITLES 之兩章名皆在摘要套件之非內容章表(內容章與數字紮根之材料不含投影章);投影只寫此二名、不受 cfg 改名', () => {
        assert.deepEqual(RELATE_SECTION_TITLES, { relations: '關聯', conflicts: '⚠ 衝突與反例' })
        assert.ok(Object.isFrozen(RELATE_SECTION_TITLES))
        for (const t of Object.values(RELATE_SECTION_TITLES)) assert.ok(NON_CONTENT_SECTIONS.includes(t), `摘要套件之非內容章表須含「${t}」`)
        const md = { front: { title: 'T' }, body: '# T\n\n## 核心知識\n\n- 要點' }
        const edges = [E('x', 'n1', '衝突或反例', '2026-10-01', '甲說X乙說Y')]
        const p = projectText(md, 'x', edges, titleOf, { ...cfg, sectionTitle: '別名章', conflictSectionTitle: '別名衝突章' })
        assert.deepEqual([...p.body.matchAll(/^## (.+)$/gm)].map((m) => m[1]), ['核心知識', RELATE_SECTION_TITLES.relations, RELATE_SECTION_TITLES.conflicts], '章名不可經 cfg 更換')
        assert.equal(p.projHash, sectionsHashOf(p.body))
    })

    // ── 型別檢查:每條檢查一個無效輸入案例＋一個有效輸入行為不變之案例 ──
    it('projectNote:note 非物件或無 file 字串 → {ok:false};edges 非陣列、titleOf 非函數、cfg 非物件皆回退為預設,不拋錯', () => {
        assert.deepEqual(projectNote({}, [], () => '', {}), { ok: false, changed: false })
        assert.deepEqual(projectNote(null, [], () => '', {}), { ok: false, changed: false })
        assert.deepEqual(projectNote({ file: 123 }, [], () => '', {}), { ok: false, changed: false }, 'file 非字串視為無 file')
        const file = `${TMP}/note-proj-invalid.md`
        writeMd(file, { title: 'T' }, '# T\n\n內文')
        const r = projectNote({ id: 't-1', file }, 'not-array', 'not-fun', 'not-object')
        assert.deepEqual([r.ok, r.changed], [true, false], 'edges 非陣列視為 []:無邊、原檔無投影 → 不寫')
        assert.doesNotMatch(readMd(file).body, /## 關聯/)
    })

    it('projectNote／renderRelationSections:有效輸入(邊與 titleOf)行為不變——出邊 → 列於關聯章、frontmatter related', () => {
        const file = `${TMP}/note-proj-valid.md`
        writeMd(file, { title: 'T2' }, '# T2\n\n內文')
        const r = projectNote({ id: 't-2', file }, [{ from: 't-2', to: 'other-1', type: '互補搭配', reason: 'r', createdAt: '2026-01-01' }], (slug) => `標題-${slug}`, {})
        assert.deepEqual([r.ok, r.changed, r.degree], [true, true, 1])
        const md = readMd(file)
        assert.match(md.body, /## 關聯\n\n- \[互補搭配\] → \[\[other-1\]\] 標題-other-1：r/)
        assert.deepEqual([md.front.related, md.front.related_at], [['other-1'], '2026-01-01'])
        assert.deepEqual(renderRelationSections('x', 'not-array', null, null).relLines, [])
    })
})
