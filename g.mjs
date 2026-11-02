import fs from 'fs'
import WKnowledgeRelate from './src/WKnowledgeRelate.mjs'


let { createKnowledgeRelate } = WKnowledgeRelate


let test = async () => {
    let ms = []

    //workDir, 知識庫根目錄(唯一必填): db/log/state/knowledge/tmp 等皆由此展開, 筆記 md 位於 knowledge/notes, 關聯總覽寫入 knowledge/relations
    let workDir = './_test_knowledge_relate'
    fs.rmSync(workDir, { recursive: true, force: true })
    let notesDir = `${workDir}/knowledge/notes`
    fs.mkdirSync(notesDir, { recursive: true })

    //notes, 模擬摘要套件交出之筆記(記錄與 md), 實務上由 w-knowledge-summarize 寫入同一個 workDir; 記錄之 relatedAt 為空代表尚未關聯
    let landNote = (id, title, concepts, summary) => {
        let file = `${notesDir}/${id}.md`
        let md = [
            '---',
            `title: "${title}"`,
            `slug: "${id}"`,
            `concepts: [${concepts.map((c) => `"${c}"`).join(', ')}]`,
            'type: "note"',
            '---',
            '',
            `# ${title}`,
            '',
            '## 一句話重點',
            '',
            summary,
            '',
        ].join('\n')
        fs.writeFileSync(file, md, 'utf8')
        return { id, title, category: '方法與技術', concepts, summary, file, createdAt: '2026-09-01T00:00:00+08:00', relatedAt: '', extractedAt: '' }
    }
    let notes = [
        landNote('accretion-disk', '黑洞吸積盤之輻射機制', ['黑洞', '吸積盤', 'X射線'], '吸積盤氣體因摩擦加熱，並以 X 射線輻射出重力位能。'),
        landNote('black-hole-spin', '以鐵譜線輪廓量測黑洞自旋', ['黑洞', '自旋', 'X射線'], '由 X 射線光譜中鐵譜線的輪廓，可推估吸積盤內緣位置與黑洞自旋。'),
        landNote('exoplanet-spectrum', '系外行星大氣之穿越光譜', ['系外行星', '光譜分析'], '凌星時恆星光線穿過行星大氣，由吸收光譜推估大氣成分。'),
    ]

    //aiAdapter, AI 調度層替身(cfg.aiAdapter 為正當擴充口): 依提示詞之角色作答, 離線可跑; 這裡只有關聯建立器: 同為黑洞主題之兩篇互選為「延伸深化」, 其餘不選
    let calls = { relate: 0 }
    let plan = { 'accretion-disk': 'black-hole-spin', 'black-hole-spin': 'accretion-disk' }
    let answerOf = (prompt) => {
        if (!/的關聯建立器。/.test(prompt)) return []
        calls.relate++
        return prompt.split(/^--- 第/m).slice(1).map((blk) => {
            let head = /^(\d+)篇（待建立關聯）---\n標題：(.*)$/m.exec(blk)
            let id = (notes.find((n) => n.title === head[2]) || {}).id
            let slugs = [...blk.matchAll(/^ {2}- slug: (\S+)｜/gm)].map((m) => m[1])
            let to = plan[id]
            let relations = slugs.includes(to) ? [{ to, type: '延伸深化', reason: '同樣以吸積盤的 X 射線光譜為依據，後者進一步說明如何由鐵譜線量測黑洞自旋' }] : []
            return { index: Number(head[1]), relations }
        })
    }
    let aiAdapter = {
        callJson: async (prompt, check, opt) => {
            let data = answerOf(prompt)
            let ok = typeof check !== 'function' || check(data) === true
            return { ok, data: ok ? data : null, error: ok ? '' : '替身形狀不合', providerId: ok ? String(opt?.spec?.use || 'stub') : '', attempts: 1, skipped: false }
        },
        drainStats: () => '無呼叫',
        aiUsageToday: () => ({ today: '', used: 0, byKey: {} }),
    }

    //flow, 總組裝: 內建設定/詞彙/提示詞/關聯型別/LMDB/鎖/日誌/執行摘要走預設, 只置換 AI 調度層
    let silent = { info: () => {}, warn: () => {}, error: () => {} }
    let flow = createKnowledgeRelate({
        workDir,
        data: {
            vocab: { domain: '天文學' }, //主題範圍(選填), 提示詞之領域句據此限定, 未給即不限主題
        },
        aiAdapter,
        scheduleLimitMin: 60, //排程執行上限(分鐘), 整輪時間預算與鎖陳舊期限由此推導
        afterRun: false, //無收尾鉤子
        logFactory: () => silent, //靜音日誌(預設每輪寫 log/<day>/<stamp>-run.log)
    })

    //stores, 寫入筆記記錄(實務上由摘要套件寫入, 此處直接插入作為輸入)
    let stores = flow.openStores()
    await stores.notes.insertNew(notes)
    await flow.closeStores(stores)

    //run, 一輪: 關聯 → 投影 → 總覽
    let r = await flow.run()
    ms.push({ round: `ok[${r.ok}], ` + r.stages.map((s) => `${s.name}[${s.status}]`).join(', ') })
    for (let s of r.stages) {
        ms.push({ [s.name]: s.result.summary })
    }

    //detail, 關聯段內之三個子階段: 關聯(新邊寫入邊庫)→ 投影(依邊庫重寫兩端筆記 md)→ 總覽(重寫 index.md 與 graph.json)
    let detail = r.stages[0].result.detail
    ms.push({ relate: `處理 ${detail.relate.stats.in}、新邊 ${detail.relate.stats.out}（AI ${detail.relate.stats.aiCalls} 次）` })
    ms.push({ project: `投影 ${detail.project.detail.projected}、改寫 ${detail.project.detail.changed}` })
    ms.push({ relationIndex: fs.readdirSync(`${workDir}/knowledge/relations`).sort() })

    //stores, 讀回結果(邊庫為真理, md 之「關聯」章為投影)
    stores = flow.openStores()
    let es = await stores.relations.select()
    ms.push({ edges: es.map((e) => `${e.from}→${e.to}｜${e.type}`).sort() })
    let ns = await stores.notes.select()
    ms.push({ related: ns.map((n) => `${n.id}｜${n.relatedAt ? '已關聯' : '未關聯'}`).sort() })
    await flow.closeStores(stores)
    let md = fs.readFileSync(`${notesDir}/accretion-disk.md`, 'utf8')
    ms.push({ mdSection: md.split('\n').filter((l) => l.startsWith('## ') || l.startsWith('- [')) })
    ms.push({ calls })

    //clear
    fs.rmSync(workDir, { recursive: true, force: true })

    console.log('ms', ms)
    return ms
}
await test()
    .catch((err) => {
        console.log(err)
    })
// => ms [
//   { round: 'ok[true], 關聯[ok]' },
//   { '關聯': '處理 3、關聯 1 條、衝突 0 組（AI 1 次）' },
//   { relate: '處理 3、新邊 1（AI 1 次）' },
//   { project: '投影 2、改寫 2' },
//   { relationIndex: [ 'graph.json', 'index.md' ] },
//   { edges: [ 'accretion-disk→black-hole-spin｜延伸深化' ] },
//   {
//     related: [
//       'accretion-disk｜已關聯',
//       'black-hole-spin｜已關聯',
//       'exoplanet-spectrum｜已關聯'
//     ]
//   },
//   {
//     mdSection: [
//       '## 一句話重點',
//       '## 關聯',
//       '- [延伸深化] → [[black-hole-spin]] 以鐵譜線輪廓量測黑洞自旋：同樣以吸積盤的 X 射線光譜為依據，後者進一步說明如何由鐵譜線量測黑洞自旋'
//     ]
//   },
//   { calls: { relate: 1 } }
// ]
