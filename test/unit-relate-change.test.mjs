// unit-relate-change.test.mjs — 關聯要點 3「知識變更 → 調整關聯」之接線:摘要套件之筆記同步(偵測端)把 md 之標題、概念、一句話重點之變更
//   同步回記錄並寫 knowledgeChangedAt(跨工作之契約欄位)→ 本套件之關聯段使該篇重入正向池(只增不刪)、鄰居之關聯章重投新標題
// 【偵測端屬摘要套件】同步雜湊、首見回填、往返穩定、不誤觸發、真 LMDB 之陣列寫回、mtime 水位與 md 讀不到之計數由 摘要套件 w-knowledge-summarize
//   test/unit-summarize-sync、unit-summarize-stores 驗(2026-10-07 摘要切換 GEN-12;摘要之件經 core/summarizePackage 取得)
// 規格出處:規則帳本 REL-07(及摘要套件之內容同步 SUM-13)
// 執行:自套件根 node <mocha> test/unit-relate-change.test.mjs(暫存 test/_tmp/relate-change-<pid>,測完即刪;不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { memStore, recLog, withCheck, removeRoots } from './tools/captureForTest.mjs'
import { tmpRoot } from './tools/relateTestKit.mjs'
import { resolveRelateSettings } from '../src/core/relateSettings.mjs'
import { readMd, writeMd } from '../src/core/summarizePackage.mjs'
import { buildNote, createSummarizeDomain, syncNotes, bagCtx } from './tools/summarizeForTest.mjs'
import { createRelateDomain } from '../src/domain/relateDomain.mjs'
import { stageRelate } from '../src/stages/relateStage.mjs'
import { stageRelateProject } from '../src/stages/projectStage.mjs'
import { makeEdge } from '../src/stores/edgeStore.mjs'

let TMP = ''
let tick = 0
const clock = { iso8: () => `2026-10-04T10:00:${String(tick++ % 60).padStart(2, '0')}+08:00`, stamp8: () => '20261004100000' }
const DOMAIN = createSummarizeDomain({})
const DOC = { id: 'd1', title: '原文', sourceName: '來源', url: 'https://example.com/a', publishedAt: '2026-01-01' }
let seq = 0

/**
 * 以正式組裝(buildNote → writeMd)建筆記,回傳 { record, deps, log }
 * @param {Array} items 輸入摘要項目
 * @returns {Object} 回傳環境
 */
function env(items) {
    const dir = `${TMP}/e${++seq}`
    const recs = items.map((k, i) => {
        const b = buildNote({ k, doc: { ...DOC, id: `d${i}` }, domain: DOMAIN, notesDir: `${dir}/notes`, nowIso: '2026-10-01T00:00:00+08:00' })
        writeMd(b.file, b.front, b.body)
        return { ...b.record, relatedAt: '2026-10-02T00:00:00+08:00' }
    })
    const notes = memStore(recs)
    const log = recLog()
    return { notes, log, deps: { stores: { notes }, dirs: { state: `${dir}/state` }, clock, log }, dir }
}
const later = (file, sec = 5) => {
    const t = new Date(Date.now() + sec * 1000)
    fs.utimesSync(file, t, t)
}

describe('unit-relate-change', function() {

    before(() => {
        TMP = tmpRoot('relate-change')
    })
    after(() => removeRoots([TMP]))

    // 2026-10-07 摘要切換(盤查 C change:165 之改寫):偵測端之行為由 摘要套件 w-knowledge-summarize unit-summarize-sync「首見回填不觸發…」「改標題／概念換位／改一句話重點…」
    //   等驗;本案驗跨工作之契約——摘要套件之 syncNotes(經匯入點)寫入之記錄欄位(title／concepts／summary＋knowledgeChangedAt)由本套件之關聯段讀取
    it('接到關聯段:摘要套件之筆記同步寫回記錄並寫 knowledgeChangedAt → 該篇重入正向池(候選含新概念之筆記、只增不刪),鄰居之關聯章顯示新標題', async () => {
        const e = env([
            { title: '甲', concepts: ['動量'], summary: '舊', key_points: ['k'] },
            { title: '乙', concepts: ['動量'], summary: '乙', key_points: ['k'] },
            { title: '丙', concepts: ['價值'], summary: '丙', key_points: ['k'] },
        ])
        const r0 = await syncNotes(e.deps)
        assert.deepEqual([r0.backfilled, r0.changed], [3, 0], '首見只回填(不觸發關聯重判)')
        const [a, b, c] = await e.notes.select()
        const relations = memStore([makeEdge({ from: b.id, to: a.id, type: '前置概念', reason: '既有', nowIso: '2026-10-02T00:00:00+08:00' })])
        const md = readMd(a.file)
        writeMd(a.file, { ...md.front, title: '甲（價值版）', concepts: ['價值', '動量'] }, md.body)
        later(a.file)
        const r1 = await syncNotes(e.deps)
        assert.deepEqual([r1.changed, r1.changedIds], [1, [a.id]])
        // 跨工作之契約欄位:同步後之記錄(關聯段之提示詞與候選讀之)與內容變更時刻(關聯段據以重入正向池)
        const a1 = await e.notes.get(a.id)
        assert.deepEqual([a1.title, a1.concepts, !!a1.knowledgeChangedAt], ['甲（價值版）', ['價值', '動量'], true])
        const prompts = []
        const ctx = bagCtx({ stores: { notes: e.notes, relations }, settings: resolveRelateSettings({ ai: { parallel: 1 }, relate: { rounds: 1, notesPerCall: 6, candidatesPerNote: 5, ai: { use: 'x' } } }), ai: null, clock, dirs: { state: e.deps.dirs.state }, domains: { relate: createRelateDomain({}) } }, e.log)
        const r = await stageRelate({ callAI: withCheck(async (p) => {
            prompts.push(p)
            return { ok: true, data: [{ index: 1, relations: [{ to: c.id, type: '同類方法', reason: '改寫後與丙同屬價值因子之選股方法' }] }], error: '', skipped: false, attempts: 1, preview: '' }
        }) }).run(ctx)
        await stageRelateProject().run(ctx)
        assert.deepEqual([r.detail.targets, r.detail.reTargets, r.detail.edges, r.detail.changedSeen], [1, 1, 1, 1], JSON.stringify(r.detail))
        assert.match(prompts[0], /標題：甲（價值版）/, 'prompt 讀到同步後之記錄')
        assert.ok(prompts[0].includes(`slug: ${c.id}`), '新概念之筆記成為候選')
        assert.equal((await relations.select()).length, 2, '既有邊保留、新增一條')
        assert.match(readMd(b.file).body, new RegExp(`→ \\[\\[${a.id}\\]\\] 甲（價值版）：既有`), '鄰居之關聯章顯示新標題')
    })
})
