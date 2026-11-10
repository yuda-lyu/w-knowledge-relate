# w-knowledge-relate
A general-purpose pipeline for knowledge relations: building and extending relations between notes, adjusting them when knowledge changes or is deleted, and projecting them onto both ends.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-knowledge-relate.svg?style=flat)](https://npmjs.org/package/w-knowledge-relate) 
[![license](https://img.shields.io/npm/l/w-knowledge-relate.svg?style=flat)](https://npmjs.org/package/w-knowledge-relate) 
[![npm download](https://img.shields.io/npm/dt/w-knowledge-relate.svg)](https://npmjs.org/package/w-knowledge-relate) 
[![npm download](https://img.shields.io/npm/dm/w-knowledge-relate.svg)](https://npmjs.org/package/w-knowledge-relate) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-knowledge-relate.svg)](https://www.jsdelivr.com/package/npm/w-knowledge-relate)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-knowledge-relate/global.html).

## Installation

### Using npm(ES6 module):
```alias
npm i w-knowledge-relate
```

#### Example:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-knowledge-relate/blob/master/g.mjs)]
```alias
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
```

---

## 概述

通用知識關聯:在知識筆記之間建立、擴充與維護關聯——新筆記與既有筆記比對建立關聯(正向);新知識加入時讓舊筆記再比一次(反向、候選輪巡);筆記內容變更或刪除時調整既有關聯(重評、明示刪除與還原);並把邊庫投影回兩端筆記之 md,另產一份關聯總覽。

- **領域中立**:預設不綁任何主題。關聯型別清單、衝突型、型別之語意角色、知識庫稱呼、主題範圍、提示詞之領域句,全由使用方給。
- **逐層可覆寫**:設定、詞彙、提示詞、domain、子階段與動作鏈(含重評鏈)、AI 調度層、儲存皆有預設,使用方只給要改的部分。
- **自成一體**:本套件只 import 自己的檔案、`package.json` 所列套件,以及抓取套件與摘要套件(各經單一匯入點 `src/core/capturePackage.mjs`、`src/core/summarizePackage.mjs`);原始碼在 `src/`,下文所列檔案路徑(`core/…`、`stages/…`、`createKnowledgeRelate.mjs`、`bench/…` 等)皆相對 `src/`(測試輔助件在 `test/tools/`,隨 npm 包發布供下游取用)。

---

## 1. 一輪做什麼

`flow.run()` 依序跑三個子階段(`cfg.stageOpts` 之鍵;另 `reeval` 為關聯子階段內之重評鏈):

| 子階段 | 鍵 | 做什麼 | 呼叫 AI |
|---|---|---|---|
| 關聯 | `relate` | 開工前之維護(無 AI):邊庫世代檢核(邊 id 不是無序對雜湊者即本輪不寫)、型別改名之機械改寫、刪除紀錄內端點之殘留邊清理、內容變更之反應(本篇與鄰居待投影)。其後依序:**正向**(未關聯之筆記與內容變更之筆記,與共享概念之候選比對)→ **重評**(內容變更之筆記之既有邊逐條裁決;預設停用)→ **反向**(新筆記加入後,讓「若現在重判會把它排進前 K 名」之舊筆記再判一次;預設停用)→ **候選輪巡**(已關聯之筆記比對其候選清單之後段;預設停用)→ **既有邊覆核**(預設關)→ **衝突核對**(預設關) | 是(席位見 §8) |
| 投影 | `project` | 待投影之筆記依邊庫重算 md 之「關聯」「⚠ 衝突與反例」兩章與 frontmatter(冪等;內容不變不寫檔;兩章被手改〔與上次投影之雜湊不符〕且覆寫會改變兩章者先另存再覆寫) | 否 |
| 總覽 | `relationIndex` | 本輪邊有異動、同一管線內有重標、或總覽待重建時,重寫 `index.md`(依連結數之導覽)與 `graph.json`(全量節點與邊);皆無則不動檔 | 否 |

**邊庫為真理、md 為投影**:一對筆記至多一條邊(id＝兩端 id 排序後之雜湊,不分方向;`from` 為提出方)。md 兩章是邊庫之投影,手加之關聯行不會進邊庫。**刪除只走明示**:md 或記錄消失都不視為刪除(可能是暫時之檔案系統狀況或開錯集合),筆記之刪除與還原一律經維運 API(§12)。

### 與上下游之介面

| 方向 | 內容 |
|---|---|
| 摘要 → 本套件 | 筆記記錄(`notes`:`id`、`title`、`category`、`concepts`、`summary`、`file`、`createdAt`…)與筆記 md(摘要套件之版型);內容變更以記錄欄 `knowledgeChangedAt` 通知(摘要套件之內容同步寫入;本套件以「評估時記下之版本 `relatedChangeAt` ≠ `knowledgeChangedAt`」判待重判,不比時間先後);同一管線內之重標以 ctx 旗標 `notesTagChanged` 通知(總覽之節點帶類別,據以重建) |
| 本套件 → 筆記 | ①記錄之關聯端欄位:`relatedAt`(完成正向評估之時刻;零邊亦寫)、`relatedChangeAt`、`relatedPicks`、`relateTries`、`relateLastError`、`relateRotation`、`edgesReviewed`、`edgesReviewedChangeAt`、`reevalTries`、`reevalLastError`、`projHash`、`relatedCount`;②md 之「關聯」「⚠ 衝突與反例」兩章與 frontmatter `related`／`conflicts`／`related_at`——兩章為摘要套件之非內容章(`NON_CONTENT_SECTIONS`),寫入兩章不觸發其內容變更、亦不進數字紮根之材料 |
| 本套件 → 下游 | ①**邊**(`relations`):`{ id, from, to, type, reason, createdAt, updatedAt, history?, reasonCut? }`;②**md 兩章**之行式:關聯章 `- [型別] →／← [[slug]] 標題：理由`(→＝本篇提出、←＝對方提出;衝突在前 → 型別序 → 新到舊),⚠ 章 `- 與 [[slug]] 標題：理由`(只列衝突、不帶方向);章名為常數 `RELATE_SECTION_TITLES`(不開放更換);`related_at`＝該篇各邊之最新時刻;③**總覽** `index.md`(frontmatter `title`、`type:'relation-index'`、`updated`、`edges`、`nodes`、`shown`)與 `graph.json`(`{ updatedAt, nodes:[{ id, title, category, concepts }], edges:[{ from, to, type, reason }] }`);④**帳**(`dirs.state` 下):刪除紀錄、撤出稽核(各邊最後一筆以 `retiredEdgesOf` 取)、衝突撤銷／降級事件——檔名常數 `LEDGER_FILES`、`DELETION_FILES`、`EDGE_AUDIT_FILE`、`CONFLICT_EVENT_FILE`,讀法 `openDeletions`、`readEdgeAudit`、`readConflictEvents` |
| 下游 → 本套件 | 筆記記錄之 `extractedAt`(下游處理時刻;摘要套件之資料契約欄,由下游寫):本套件只讀,用於存量佇列之排序(觸及下游已處理者先)與計數(`conflictTouchExtracted`、`changedTouchExtracted`);下游判斷某條衝突邊非對立時,以 `queueConflictCheck` 交回衝突核對 |
| 變更之通知 | ctx 旗標(`RELATE_CTX_FLAGS`;**只在同一條管線內**有效):`relateEdges`＝本輪邊之實際異動數(新增、可見欄位改變、撤出;每筆寫入只計一次)、`relateBlocked`＝邊庫世代不符(本輪不寫、投影略過);跨套件一律以記錄欄與帳為準 |
| 已關聯之判定 | `isRelated(note)`(＝`relatedAt` 非空)、`relatePendingOf(notes)`(未關聯篇數);讀關聯者取這兩個函數,不另寫判準 |
| 執行摘要 | run.json 中段名「關聯」之段,其 `sub` 為 `relate`／`project`／`relationIndex` 之 report;鍵之全集見 `RELATE_REPORT_KEYS`(`logContract.mjs`) |
| 日誌 | 外部巡檢所需之字樣與正則:`RELATE_LOG_KNOWN`(已知常態)、`RELATE_LOG_MUST_SEE`(一律須見)、`RELATE_LOG_PARSE`(run.json 缺時之退路;依固定格式摘要);皆以實際日誌驗證 |
| 還原閘 | 還原筆記時,筆記本身之標準判定由呼叫端注入(`deps.noteGate`;摘要套件之 `createNoteRestoreGate({ stores, vocab, clock })` 之產物 `{ check({ record, md }), hold(record, results) }`);邊之還原經本套件之納入閘(§13) |

---

## 2. 安裝與執行環境

```
npm i w-knowledge-relate
```

依賴套件(`dependencies`,隨本套件一併安裝):w-knowledge-capture、w-knowledge-summarize、wsemi。

| 外部程式 | 用途 | 沒有時 |
|---|---|---|
| opencode CLI | 預設 AI 席位(免費模型,免金鑰) | 各段之 AI 呼叫失敗:正向記 tries(排隊尾、不丟)、選配段該輪無進度 |

金鑰(付費或 REST 供應商)放 `<workDir>/.env`(或 `cfg.envFile`),不寫在設定裡。與抓取、摘要套件共用同一個 LMDB(`<workDir>/db`,庫名 `knowledge`)時,集合名一致即可,不必遷移。

---

## 3. 快速開始

```js
import W from 'w-knowledge-relate/src/WKnowledgeRelate.mjs'

const flow = W.createKnowledgeRelate({
    workDir: 'd:/my-kb', //唯一必填(與摘要套件同一個 workDir:讀其 notes)
    data: {
        vocab: { kbLabel: '天文學知識庫', domain: '天文學' }, //皆選填;未給 domain 即不限主題
    },
    scheduleLimitMin: 60, //每輪時間上限(分),據以推導整輪預算與鎖之陳舊期限
})
const report = await flow.run()
console.log(report.ok, report.summaryFile) //總覽寫入 d:/my-kb/knowledge/relations
```

`createKnowledgeRelate` 回傳 `{ run, openStores, closeStores, info }`:`run` 跑一輪;`openStores`／`closeStores` 給維運工具開關集合;`info()` 揭露生效之目錄、設定、時鐘、AI 調度層、domain(與管線同一份)、資料與詞彙、時間預算、鎖與集合名。

**設定錯誤一律在建構期拋錯**:`cfg` 與設定(`ai`、`relate`)之不認得鍵、型別或值域不合、詞彙表不合規格、注入之 domain 缺成員或型別定義不合、提示詞與 domain 給在同一 domain、啟用之功能缺 domain 成員或判定小組席位、子階段之掛載對不上錨點、AI 席位引用不存在之條目 id、時區無效——都不會靜默改用預設。

---

## 4. 覆寫點一覽

| 層 | cfg 鍵 | 預設 |
|---|---|---|
| 路徑 | `workDir`(必填)、`dirs`(逐鍵:`db`、`log`、`tmp`、`state`、`knowledge`、`relations`) | `<workDir>/db` 等;總覽 `<workDir>/knowledge/relations`(不隨 `knowledge` 之覆寫移動);筆記 md 之位置取自記錄之 `file` |
| 管線名 | `name`(日誌之管道名與執行摘要 `run.json` 之 `name`;非空字串) | `'知識關聯'` |
| 時鐘 | `timeZone`(IANA 時區)、`clock`(整組置換) | `'Asia/Taipei'` |
| 語言 | `lang`(BCP 47 代碼;抓取套件之 `resolveLocale`):四支提示詞之理由語言句、邊標準 RS3 之適用(只有繁體中文有字形標準——其餘語言掃描逐邊列「不適用」、納入閘與存量處置不轉字形)、概念鍵之繁簡折疊(中文才折)。每輪依賴 `deps.locale` 與 `info().locale` 為解析後之語言設定;`createRelateDomain` 收 `opt.locale`;純函數(`checkEdge`、`gateEdgeProposal`、`edgeFixOf`…)收 `ctx.locale`,未給即正體 | `'zh-TW'` |
| 設定 | `ai`、`relate`、`relationIndexTitle`(見 §5) | `core/relateSettings.mjs` |
| 資料 | `data.vocab`(見 §6) | 中立之預設詞彙 |
| 提示詞 | `prompts.{relate,reeval,conflictCheck,edgeReview}`(見 §7) | 內建通用提示詞 |
| domain | `domains.relate`(整組置換;見 §7) | 內建工廠 `createRelateDomain` |
| 子階段 | `stageOpts.<鍵>`(`relate`、`reeval`〔重評鏈 `{ tap?, chain? }`〕、`project`、`relationIndex`;動作鏈之 `tap`;`relate.reserveMs`;契約欄位 `enabled:false` 停用、`when(ctx)` 條件執行,每個子階段皆收——停用者 report 為 `{ detail:{ disabled:true } }`;`relationIndex` 之 `when` 預設為「邊或標籤有變才重建」)或 `stages`(整組自訂,與 `stageOpts` 擇一) | 三個內建子階段 |
| AI | `aiAdapter`(整組置換)、`aiOptions`(內建調度層之建構選項:`providerPick`、`exes`、`persistStore`、`usageCounter`;抓取套件之 `AI_OPTIONS_KEYS`)、`envFile`、`aiWorkspace` | 內建調度層(抓取套件之 `createAiAdapter`) |
| 儲存 | `lmdb`:`WOrm`、`path`、`db`、`cls`(集合名);`cores` | w-orm-lmdb、`<workDir>/db`、`'knowledge'` |
| 時間與鎖 | `scheduleLimitMin`、`deadlineMs`、`lockStaleMs`、`lock` | 預算 50 分、鎖 `<dirs.tmp>/run.lock` |
| 其他 | `conceptFold`(概念鍵之繁簡折疊;與抓取、摘要套件同一單例)、`netGuard`(本機網路判斷;未給或 `null` 不判斷,見 §8)、`logFactory`、`afterRun`(收尾鉤子) | 內建 |

可用鍵之全集在 `createKnowledgeRelate.mjs` 之 `CFG_KEYS`、`DATA_KEYS`、`PROMPT_KEYS`、`COLLECTION_KEYS`。

**相對路徑之基準各鍵不同**:`envFile` 以 `workDir` 為基準;`lock`(字串)與 `aiWorkspace` 以執行時之 cwd 為基準。`info()` 回報的是解析後之絕對路徑。

**集合**:`notes`(讀筆記、寫關聯端欄位)、`relations`(邊)、`holds`(待判登錄;與摘要套件同一集合)、`checks`(衝突核對與既有邊覆核之檢核紀錄);`cfg.cores` 給 `true` 或集合名才唯讀加開 `cores`(下游以筆記為出處之產物;筆記之明示刪除列出以該篇為出處者,未開即空清單)。

---

## 5. 設定(`ai`／`relate`／`relationIndexTitle`)

**合併規則**:**組**(物件)逐鍵遞迴合併——給了的鍵取代預設、其餘沿用;**葉**(席位物件)整個取代、不逐層合併。完整鍵、型別與註解以 `core/relateSettings.mjs` 為準(`RELATE_DEFAULT`／`RELATE_SCHEMA`／`RELATE_AI_DEFAULT`／`RELATE_AI_SCHEMA`;合併與型別規則取自抓取套件,`ai` 段之定義即摘要套件之 `ai` 段)。

```js
createKnowledgeRelate({
    workDir,
    relate: {
        rounds: 4,                                              //只改所給之鍵
        reeval: { perRun: 10 },                                 //巢狀組逐層合併:其餘 reeval 鍵沿用預設
        ai: { use: 'oc:opencode/big-pickle' },                  //葉(席位)整個取代:不與預設之 fallback 合併
    },
    ai: { parallel: 2 },
    relationIndexTitle: '天文學關聯總覽',
})
```

| 組 | 鍵 | 預設 | 意義 |
|---|---|---|---|
| `relate` | `rounds`／`notesPerCall` | 2／6 | 關聯容量＝`rounds`×`ai.parallel`×`notesPerCall`(36 篇/輪) |
| | `candidatesPerNote` | 25 | 每篇給 AI 之候選數(依共享概念挑選;不足補同類別／最近筆記) |
| | `ai` | 見 §8 | 關聯席位(正向;反向、輪巡未另設即沿用) |
| `relate.reverse` | `perRun`／`ai` | 0／null | 反向段每輪至多幾個舊筆記目標(0＝停用)／席位(null＝沿用 `relate.ai`) |
| `relate.rotation` | `perRun` | 0 | 候選輪巡每輪至多幾篇(0＝停用;席位同反向段) |
| `relate.reeval` | `perRun`／`pagesPerRun`／`pageSize` | 0／24／10 | 重評每輪至多幾篇(0＝停用)／幾頁／每頁幾條邊 |
| | `apply` | false | 套用閘門:`false`(只記候選帳)｜`'additive'`(升為衝突、非衝突間改型、理由更新)｜`'all'`(另含撤銷與衝突降級) |
| | `maxTries`／`guard` | 3／20 | 同一篇逾次未評完即登錄待判／單輪待重評篇數逾此即不開工(確認後以 `reevalBaseline` 重設基準) |
| | `ai` | `{ first:null, second:null, third:null }` | 重評之判定小組(first 未設即 `relate.ai`、second 未設即 first) |
| `relate.standards.conflictCheck` | `enabled`／`perRun`／`pageSize`／`maxTries` | false／0／10／3 | 衝突核對(RS4):開啟時新衝突經兩席核對才寫入;並消化待判與存量衝突邊(每輪 `perRun` 條) |
| `relate.standards.edgeReview` | `enabled`／`perRun`／`pageSize`／`maxTries`／`deadline` | false／0／10／3／`''` | 既有邊覆核(RS6);`deadline` 為完成期限(ISO 日期,`''` 不設;給了即隨報告帶出) |
| `relate.standards` | `ai` | `{ first:null, second:null, third:null }` | 衝突核對與既有邊覆核共用之判定小組(開啟時 first、second 必填) |
| | `scanEachRun` | false | 每輪結束掃一次可確定性判定之標準(逐邊讀兩端筆記,大庫耗時) |
| `relate` | `graphProduced` | false | `graph.json` 之邊是否另帶產出鏈之純量摘要 `produced:{ stamp, stage, provider }`(預設不帶,`graph.json` 與無產出鏈時逐位元組相同;邊記錄恆帶產出鏈,見 §12〈邊之產出鏈〉) |
| `ai` | 抓取套件之 `AI_SCHEMA` 各鍵 | 同抓取套件 | `timeoutMs`、`maxRetries`、`cooldownMs`、`providerTimeouts`、`extraProviders`、`pools`、`providerLimits` |
| | `healthStreak`／`parallel` | 3／3 | 供應商健康降序之門檻／同時併發之 AI 呼叫數(同摘要套件之 `ai` 段) |
| `relationIndexTitle` | — | `'知識關聯總覽'` | 關聯總覽之標題(非空字串) |

**容量自洽(啟動期警告)**:本套件不知道筆記之進料;他總組裝以 `relateWarningsOf(settings, { inflow:{ max, desc } })` 取「進料 > 容量」之警告(推導值 `relateCapacityOf`、式之說明 `RELATE_CAPACITY_DESC`)。已開啟之判定小組,其任一投票組合之首兩票首選同家且無首選不同之第三席者,亦於啟動期警告(兩票恆為同一供應者,永遠判不成)。

**席位之形狀**:`{ use, fallback?, timeoutMs?, minAttemptMs?, budgetMs? }`——`use` 為條目 id、`fallback` 為條目 id 之陣列、數值鍵為正數(毫秒),其他鍵拋錯(規則取自抓取套件之 `seatProblem`)。

---

## 6. 資料(`cfg.data.vocab`)

`cfg.data` 只收 `vocab`。詞彙表**整鍵替換**(給 `relationTypes` 就整組換),唯 `guide` 逐欄回退預設;不認得之鍵拋錯。與他段共用一份詞彙表者,以 `pickRelateVocab(vocab)` 取本套件所讀之鍵(`guide` 只取 `relate` 段);本套件自有之鍵(型別定義所讀者)為 `RELATE_VOCAB_OWN_KEYS`,借用本套件詞彙鍵之下游以之取子集、不另抄。

| 鍵 | 預設 | 說明 |
|---|---|---|
| `domain`、`kbLabel` | `''` | 主題範圍(提示詞之範圍句;空＝不限)、知識庫稱呼(與抓取套件共用之鍵) |
| `conceptRenames`、`conceptAliases` | `{}` | 概念鍵之改名與別名(候選以共享概念挑選;與抓取套件同一折疊) |
| `relationTypes` | 7 種中立型別:前置概念、延伸深化、互補搭配、衝突或反例、實作範例、同類方法、共用資料或指標 | 關聯型別清單(提示詞之擇一清單;納入閘據以判清單外型別) |
| `conflictType`／`fallbackType` | `'衝突或反例'`／`'互補搭配'` | 衝突型(須在清單;型別序第一、衝突核對之對象)／型別序殿後者(須在清單;合併時最低序) |
| `relationTypeRenames` | `{}` | 型別改名之宣告 `{ 舊: 新 }`:舊名須已自清單移除,既有邊之現值與沿革由每輪維護機械改寫(id、`updatedAt` 不動);連續改名以對照鏈宣告;衝突型改名者,讀關聯之下游以 `domain.conflictTypeNames` 亦認得舊名 |
| `relationTypeAliases` | `{}` | 模型輸出之同義寫法之明文對映 `{ 別名: 型別 }`(不得與清單或改名表重疊);其餘清單外之型別**不納入**(程式不替模型斷言型別,不落後備型別) |
| `relationTypeRoles` | 依候選名自清單推導 | 型別之語意角色 `{ implementation, extension, sibling, complement: 型別 }`:既有邊覆核之型別改正封閉清單;未給之角色依 `RELATION_ROLE_NAMES` 之候選名取清單中第一個存在者,不存在即該角色從缺 |
| `guide.relate` | 中立句 | 提示詞之領域句五欄:`broadRelation`(泛泛關係之例)、`vagueReason`(空泛理由之例)——兩者亦為檢定標準 RS2 之空泛片語;`changeDrivers`(利弊隨何轉換);`implementationCase`、`extensionCase`(既有邊覆核之型別改正規則所指之「實作」「延伸」情形,須非空);欄位見 `RELATE_GUIDE_FIELDS` |

**改型別清單即令舊檢核作廢**:型別清單與角色之版本(`relationTypesVersionOf`)是衝突核對與既有邊覆核之檢核雜湊之成分——清單一改,已核之結果於下次輪到時重核。檢核雜湊另含兩端判定所讀之素材(核對席所見之區塊:一句話重點、核心知識、適用條件;`createCheckHasher`)——筆記之內容版本只隨標題／概念／一句話重點變,核心知識或適用條件改了亦須重核。

---

## 7. 提示詞(三層覆寫)

輸出契約(欄位、格式、驗證)與 AI 所見之區塊(`seenTextOf`;數字紮根之新進材料)固定;覆寫的是「怎麼問」。覆寫者須依輸出契約要求模型輸出,否則其輸出會被驗證擋下。

**「衝突」之定義四支提示詞同一組句子**(`CONFLICT_DEFINITION`,具名匯出):對同一個問題給出相反的結論、對同一參數給出互相矛盾的數值或方向、或兩者的適用條件互斥才是衝突;一方是另一方的特例、只是側重不同面向、或在不同條件下各自成立而條件並不互斥者不是衝突。提案之段(正向／反向／輪巡、重評)與核對之段(衝突核對 RS4、既有邊覆核 RS6)判準一致——提案寬於核對,提出之衝突即被核對撤回。覆寫提示詞者宜沿用此組句子,以免提案與核對再度分歧。

1. **`vocab.guide.relate` 逐欄**:填回自己調校過之領域句即可逐字重現自己的提示詞,輸出契約仍隨套件演進。
2. **`cfg.prompts` 整個提示詞函數**:收原參數＋末參數 `ctx:{ kbLabel, domain, vocab, defaultPrompt }`(`defaultPrompt` 為內建提示詞函數,可包裝而不必重寫;函數形式見 `RELATE_PROMPT_SIGS`):

   ```js
   createKnowledgeRelate({
       workDir,
       prompts: {
           relate: (targets, candidateMap, ctx) => `${ctx.defaultPrompt(targets, candidateMap)}\n（補充：…）`, //正向、反向、輪巡共用
           reeval: (items, ctx) => ctx.defaultPrompt(items),
           conflictCheck: (items, ctx) => ctx.defaultPrompt(items),
           edgeReview: (items, ctx) => ctx.defaultPrompt(items),
       },
   })
   ```
   回傳非空字串之外者於組提示詞時拋錯。
3. **`cfg.domains.relate` 整組 domain**:須具備內建 domain 之全部成員(建議以 `createRelateDomain({ vocab, prompts })` 之產物展開後覆寫):型別定義 `relationTypes`、`conflictType`、`fallbackType`、`relationTypeRenames`、`relationTypeRoles`、`conflictTypeNames`、`vagueReasons`(建構期驗其形狀與交叉一致),函數 `resolveType`、`seenTextOf`、`buildPrompt`。`buildReevalPrompt`、`buildConflictCheckPrompt`、`buildEdgeReviewPrompt` 為選填,缺之則對應功能不可開啟(開啟即建構期拋錯)。同一 domain 不可同時給 `cfg.prompts`(注入者整組置換內建者,提示詞覆寫會靜默失效——給了即拋)。

**生效之 domain 只有一份**:`info().domains.relate` 即每輪 `deps.domains.relate`;維運 API 之 `deps.domain` 與符合度掃描取同一份,即與管線同一套型別與判定。子階段之 `opt.domain` 仍可另給(屬自組)。

---

## 8. AI 調度

- **預設席位全為免費模型**:`relate.ai = { use: 'oc:opencode/mimo-v2.6-flash-free', fallback: ['oc:opencode/big-pickle'] }`;反向、輪巡未設即沿用;判定小組預設關閉。付費家請自行加在 `fallback` 尾端。免費模型之目錄會隨供應方變動,實際可用之條目以 `opencode models` 之輸出為準。
- 席位不在 `ai` 段:各段於 `callJson` 之 `callOpt.spec` 給(席位清單 `relateSeatsOf`、顯示名 `RELATE_SEAT_LABELS`;啟動期交調度層之 `validateSeats` 檢核,不可解析即拋)。判定小組之組成(重評 RS5;衝突核對／既有邊覆核 RS4／RS6——成員、必填、投票組合、是否開啟)以 `relatePanelsOf(settings)` 取,席位檢核工具與啟動期之同家警告同讀這一份。判定須兩票明確、相同且**實際成交之供應者不同**才成立;未成立而可成立者叫第三席。衝突核對之新衝突以提案席(正向／反向／輪巡段之實際成交者)＋first 投票;重評與既有邊覆核之升級提案以 first＋second 投票(提案席即核對首席,再投即同一供應者而判不成)。**中止不計、失敗計、陳舊不判**(三段同一規則):任一席(含第三席)回 `skipped`(額度用盡、整輪截止、斷網)→ 送審之項本輪不判、不記 tries(下輪再評;前兩席中止 → 其後之頁不核;第三席中止 → 三段其後之頁皆照以前兩席判而不再叫第三席,需第三席者同不判);呼叫失敗、未涵蓋、回覆不合格、兩票同一供應者、或共識之改寫(改型、升為衝突、重評之 change)不過納入閘 → 記 tries(重評為該篇之 `reevalTries`,衝突核對與既有邊覆核為待判之 tries,逾 `maxTries` 轉使用者;使用者負責之待判〔要求重試而又未得判定〕負責者與下一步不改,只記原因與 tries);互斥內回讀已變(陳舊)→ 本輪不判、不記已審、不記 tries。建議性改寫(衝突核對／既有邊覆核之一席 change 理由)不過閘 → 現行理由合格即保留記合格、不合格即撤出(可還原)。三段之開工門檻(整段延後、每頁開工前之守門)皆含第三席之首家逾時;第三席於前兩票之後才叫,其每次呼叫之進門門檻為該席首家之逾時(不以三席之最大值再擋一次)。判定小組之單頁執行(兩席並行、第二席項序依 `sha1(<前綴>|<邊 id>)` 逐項打亂而編號不變、第三席只送需要之項)取摘要套件之 `runPanelPage`(衝突核對、既有邊覆核以其 opt-in 參數給票組與兩層判定;`stages/checkPanelPages` 只剩分頁迴圈、時間守門與中止之收尾);重評之前兩席與第三席維持批次調度之結構。
- **六類呼叫點同一形狀、逐次截斷放行**:正向、反向、輪巡、重評(兩席＋第三席)、衝突核對(三席)、既有邊覆核(三席)之輸出皆為陣列,每次呼叫給 `acceptTruncated:true`——輸出被截斷時收前段完整項目,未涵蓋者留待下輪(部分接受)。建構期不開,故同一調度實例給多個工作共用時互不影響。
- **免費池額度**(`ai.pools`)、**健康降序**(`ai.healthStreak`,預設 3)、**能力預篩**(`ai.providerLimits`;內建調度層另計條目之固有上限——長提示詞〔數篇×數十候選〕於呼叫前避開放不下之條目):事件各以 WARN 一行寫入當輪日誌(「供應商額度：」「供應商健康：」「供應商能力：」;注入 `cfg.aiAdapter` 時不接)。
- **失敗預覽**:內建調度層之失敗形狀帶 `preview`(模型回覆之前段),批次失敗之 WARN 附之。
- **斷網不計(選用)**:`cfg.netGuard` 給本機網路判斷器(抓取套件之 `createNetGuard` 產物或同形之 `{ check, confirmDown, isDown, describe }`)時,整鏈皆敗之呼叫經其確認不通即回 `skipped`——該段中止、不記 tries。重評逾次即登錄待判、衝突核對與既有邊覆核逾次即轉使用者,斷網之失敗若照計,會把網路問題變成使用者之待判;本套件不內建探測(探測端點屬抓取之設定),未給或 `null` 不判斷。
- **整組置換**:`cfg.aiAdapter` 給一個具 `callJson(prompt, check, { spec, budgetMs?, shouldStop?, acceptTruncated? })` 之物件,回傳 `{ ok, data, error, providerId, attempts, skipped, preview?, truncated? }`;`validateSeats`、`drainStats`、`aiUsageToday` 選用。多工作共用調度狀態(冷卻、健康、用量)時,注入同一個實例。只換關聯段之呼叫者,給 `cfg.stageOpts.relate.callAI(prompt, check, { spec, seat, segment, shouldStop, budgetMs, acceptTruncated })`(六類呼叫同一形狀;`seat` 為 `proposer`／`first`／`second`／`third`)。扣保留之各段把呼叫交抓取套件之 `reservedAiCallOf` 包一層(本套件不另寫):其中 `budgetMs` 為扣保留後之剩餘(各次嘗試之逾時以之封頂)、`shouldStop` 為遞補鏈內(嘗試之間)是否續派之判停:以續派門檻〔`min(本次之進門門檻, 席位 minAttemptMs〔未給取 60 秒〕)`;正向段未保留時進門門檻為 0,故為 0;選配段不論有無保留皆以正的門檻計〕判且扣保留;進門時扣保留後不足本次之進門門檻者不送出(不呼叫 `callAI`)。本次之進門門檻＝段之開工門檻(抓取套件之 `captureCallMsOf`:席位 `timeoutMs` → `ai.providerTimeouts[席位之 use]` → `ai.extraProviders` 同 id 條目之 `timeoutMs` → `ai.timeoutMs` → 300000,判定小組三段取三席之最大);判定小組三段之第三席為該席首家之逾時。
- CLI 型條目讀取哪些檔由 CLI 決定(會讀工作目錄上層之指示檔);要量不受其影響之能力,把 `aiWorkspace` 放在沒有這些檔之目錄樹。

---

## 9. 組裝與依賴(deps)

**每輪依賴**(總組裝每輪開啟後交入;只放可列舉之普通屬性):`{ stores, clock, dirs, data, vocab, locale, settings, ai, domains, promptFpOf }`。套件子階段與自寫子階段同一條注入通道。`promptFpOf(評比角色 id)` 為邊之產出鏈之提示詞指紋(每輪一個快取實例;角色 `relate`／`reeval`／`conflict-check`／`edge-review`;算不出回 `null`),他總組裝驅動子階段者可不給(不給即邊之產出鏈無 `promptFp` 欄)。

**子階段之依賴契約(只讀)**——他總組裝以自己之每輪依賴驅動 `createRelateObject` 者,依此給即可:

```
{ stores:{ notes, relations, holds?, checks?, cores? }, clock, dirs:{ state, relations },
  settings:{ ai, relate, relationIndexTitle? }, ai, domains:{ relate }, reserveMs? }
```

- `data`、`vocab` 子階段不讀(總組裝另放,供他段與工具);`settings` 可另有他工作之段。
- `holds`／`checks`:衝突核對與既有邊覆核開啟時必備(缺即該段拋錯);重評缺 `holds` 時判不了之邊不登錄待判(WARN,下輪照常重評);其餘情形選用。`cores` 選用。
- ctx 旗標:寫 `RELATE_CTX_FLAGS`(`relateEdges`、`relateBlocked`),讀摘要套件之 `SUMMARIZE_CTX_FLAGS.tagChanged`(同一管線內之重標)。筆記記錄之 `extractedAt` 為摘要套件之資料契約欄(§1)。
- `reserveMs`:保留給同一輪後段之時間(毫秒數或 `(ctx) => 毫秒數`);子階段之 `opt.reserveMs` 未給時取之——本套件不讀他工作之設定。正向段與選配段皆扣之;皆未給為 0(正向段行為同未扣保留時)。

**維運 API 之依賴契約**(§12 之 op、投影、存量處置):

```
{ stores, dirs, clock, log?, domain, noteGate?, settings? }
```

- `domain` 為單數:生效之關聯 domain(`info().domains.relate`)。需 domain 之 op(`deleteNote` 非預演、`restoreNote`、`restoreEdge`、`pruneDangling` 之 apply、`projectAll`)缺 domain 即**於任何寫入前**拋。
- `noteGate`:`restoreNote` 之筆記標準閘(§1 還原閘;未注入 → WARN 並原樣還原,見 §17)。
- `settings`:取 `relate.standards.conflictCheck.enabled`——`restoreNote`／`restoreEdge` 未給 `opt.conflictCheck` 時據以決定帶回之衝突邊是否登錄衝突核對之待判(皆無則登錄)。

**他總組裝共用關聯件**:`createRelateRuntime(cfg, settings, { vocab?, prompts?, domains? })` → `{ data, vocab, folds, domains:{ relate } }`——資料與詞彙之解析、概念鍵之折疊、domain 之注入合併與缺成員檢核、啟用之功能所需之 domain 成員與判定小組席位之檢核,與本套件之總組裝同一份。整份詞彙表含他段之鍵、`cfg.domains` 含他工作之 domain 時:

```js
const rt = createRelateRuntime(cfg, settings, {
    vocab: pickRelateVocab(整份詞彙表),
    domains: <cfg.domains 中鍵在 RELATE_DOMAIN_KEYS 者> || {}, //須給 {}:未給即退回整份 cfg.domains(含他工作之鍵而拋)
})
```

其餘關聯件之取法:集合鍵 `RELATE_STORE_KEYS`、目錄 `RELATE_DIRS`、子階段與重評鏈之掛載鍵 `RELATE_TAP_STAGE_KEYS`、席位 `relateSeatsOf`、判定小組 `relatePanelsOf`、容量 `relateCapacityOf`、警告 `relateWarningsOf(settings, { inflow })`、符合度掃描 `auditRelateStandards`(結果之形狀 `relateScanOf`;計數摘要取抓取套件之 `standardsCountsOf`,與本套件之總組裝同一份)。

---

## 10. 擴充點

| 要做的事 | 作法 |
|---|---|
| 改某一環之行為 | `cfg.stageOpts.<relate|project|relationIndex>.tap`:動作鏈之錨點 before／after／replace(關聯:`buildEdges`、`markDirty`、`persistEdges`、`queueReverse`、`markRelated`——正向、反向、輪巡同一條鏈;投影:`project`;總覽:`rebuild`);重評鏈 `cfg.stageOpts.reeval.tap`(`verdict`、`agree`、`apply`、`markReviewed`)或 `cfg.stageOpts.reeval.chain` 整條置換。錨點對不上者建構期即拋 |
| 換掉整條管線 | `cfg.stages` 給 `[{ name, run(ctx) }]`(與 `stageOpts` 擇一);可用匯出之子階段工廠(`stageRelate`、`stageRelateProject`、`stageRelationIndex`)自組,依賴一律走 `ctx.deps` |
| 他總組裝共用關聯件 | `createRelateRuntime`(§9);物件 `createRelateObject(opt)`(子階段 opts 與總組裝之 `stageOpts` 同形) |
| 保留時間給後段 | `cfg.stageOpts.relate.reserveMs`(毫秒數或 `(ctx) => 毫秒數`):正向段與選配段(反向、輪巡、重評、既有邊覆核、衝突核對)扣保留後剩餘不足一次呼叫(席位首家之逾時,席位 `timeoutMs` 優先;判定小組取三席之最大)即不開工、每次呼叫以「剩餘−保留」封頂、遞補鏈內(主席失敗後之嘗試之間)以續派門檻〔席位 `minAttemptMs`,未給取 60 秒,不超過本次之進門門檻〕而非開工門檻判停(主席等滿逾時後,剩餘仍夠續派門檻者遞補照派;判定小組之第三席以該席首家之逾時判進門,見 §19);正向段每輪開工前亦判,不足即少做幾輪(開工前即不足 → 本輪延後,新筆記留在待處理池、report 記 `forwardDeferred`;容量鍵不縮)。他總組裝亦可於每輪依賴給 `deps.reserveMs`(同形) |
| 調整上限 | `cfg.stageOpts.relate.maxRelationsPerNote`(單篇至多取用之關聯數,預設 4,衝突優先保留;見 §17)、`cfg.stageOpts.relationIndex.indexTopN`(總覽顯示篇數,預設 40) |
| 換儲存 | `cfg.lmdb.WOrm` 給相容之 ORM 建構函數 |
| 收尾通知／巡檢 | `cfg.afterRun({ report, summaryFile, log, deps })`(管線之外、摘要之後;失敗只記 WARN) |

---

## 11. 執行輸出

| 檔案 | 內容 |
|---|---|
| `<log>/<日>/<時間戳>-run.start.json` | 開工標記(本輪上限之宣告);取鎖之前寫入 |
| `<log>/<日>/<時間戳>-run.log` | 本輪日誌 |
| `<log>/<日>/<時間戳>-run.json` | 結構化摘要(管線名預設「知識關聯」〔`cfg.name` 可覆寫〕、段「關聯」與三個子階段之 report、AI 實績;掃描開啟時另有 `standards`) |
| `<relations>/index.md`、`<relations>/graph.json` | 關聯總覽(`graph.json` 之邊預設只有 `from`／`to`／`type`／`reason`;`relate.graphProduced` 開啟時另帶 `produced:{ stamp, stage, provider }`) |
| 各筆記之 md | 「關聯」「⚠ 衝突與反例」兩章與 frontmatter |
| `<state>/relate-dirty.json`、`relate-reverse.json`、`relate-state.json` | 待投影、反向待處理對、總覽待重建 |
| `<state>/relate-tombstones.json`、`<state>/deleted-notes/` | 刪除紀錄(時刻＋理由)、封存(記錄、理由、其邊、md 副本) |
| `<state>/relate-retired.jsonl` | 撤出稽核(先記再刪;還原依此) |
| `<state>/relate-reeval.jsonl`、`relate-conflict-check.jsonl`、`relate-edge-review.jsonl` | 重評、衝突核對、既有邊覆核之裁決紀錄(各票含供應者) |
| `<state>/relate-conflict-events.jsonl` | 衝突撤銷／降級事件(下游讀) |
| `<state>/relate-manual/` | 被手改之兩章於覆寫前之另存 |
| `<state>/stock-fix.jsonl` | 存量處置帳(呼叫存量處置時才有;可與他工作之處置併為一本帳) |

帳檔壞了(JSON 解析失敗或結構不符——逐帳驗結構)會隔離為 `<檔>.corrupt-<時戳>`、告警「關聯帳檔損壞」並以空帳續跑;不會把壞檔當空帳而無聲覆蓋。隔離失敗(改名不成)不假稱成功:告警明寫「隔離失敗」與壞檔仍在原位;墓碑為關鍵帳,壞而無法隔離即拒寫(拋錯)。預演(`deleteNote` 之 `dryRun`、`restoreNote` 之 `dryRun`、`restoreEdge` 非 `apply`)一律唯讀直讀,不開帳、不隔離、不建檔。JSONL 帳(稽核、裁決紀錄、衝突事件)之讀寫為抓取套件之共用件:缺檔＝空、壞行(半行)略過、讀取本身失敗即拋、append 先補尾換行。

段之摘要為固定格式(對外契約;`relateSummaryOf`):`處理 N、關聯 N 條、衝突 N 組（AI N 次）`,其後依序附(>0 才附)重判、反向、刪除、投影失敗、重評、標準修正／未達標準、型別改名、衝突核對、輪巡、既有邊覆核等段;有子階段失敗或自訂子階段時改為通用摘要。

---

## 12. 維運 API

皆為具名匯出;依賴見 §9 之維運 API 契約。**寫入者由呼叫端負責取執行鎖(與管線互斥)、備份與同意**。

| 函數 | 寫入 | 做什麼 |
|---|---|---|
| `deleteNote(deps, slug, { reason, dryRun, project })` | 是(預演除外) | 明示刪除一篇筆記與其全部邊:墓碑(理由必填)→ 封存 → 鄰居待投影 → 撤邊(衝突事件、稽核先記再刪、刪後回驗)→ 刪記錄 → 刪 md → 清帳;中斷可重跑續完;回傳鄰居與以該篇為出處之下游產物 |
| `undoDeleteNote(deps, slug, { project })` | 是 | **撤銷**一次明示刪除(回退專用;與 `restoreNote` 為兩種契約):原樣放回記錄、md、兩端仍在之邊與封存之反向待處理對——不過納入閘、不過筆記標準、不登錄新待判;型別改名照詞彙表機械改寫;現值已在而不同之邊、md 已在而與封存副本不同者不覆寫(列 `edgesKept`／`mdConflict`);冪等可續作(含刪到一半之逆);寫 restored 稽核、先記後寫;回傳鄰居 |
| `deletionStatusOf(deps, slug)` | 否 | 一篇之刪除狀態(記錄、墓碑、封存、仍連到之邊數、md、`complete`;存量處置之連鎖斷言與維運查詢用) |
| `restoreNote(deps, slug, { dryRun, project, conflictCheck, withHolds })` | 是(預演除外) | **重新收件**:由封存還原記錄、md 與兩端仍在之邊;`dryRun` 純讀預演(列將還原、將拒絕之理由);可續作:筆記本身經 `deps.noteGate`(仍不合格者不還原,`withHolds` 明示接受則照還原並登錄待判;回傳之 `std` 帶確定性修正、待判之標準與 `contentChanged`／`titleChanged` 兩旗標——已被下游消化者任一為真即須請下游重設基準),邊經納入閘(不合格者列出不還原);帶回之衝突邊登錄衝突核對之待判(`conflictCheck:false` 或 `deps.settings` 之衝突核對未開者不登錄) |
| `restoreEdge(deps, id, { apply, reason, conflictCheck })` | apply 時 | 依稽核還原一條被撤出之邊(重評撤銷、標準撤銷、懸空清理、衝突核對／既有邊覆核之撤出與隔離;刪筆記之邊以 `restoreNote`):過納入閘;撤出時之理由不合標準者可給新理由(`reason`);還原兩席撤出或隔離之邊＝使用者對該標準之裁示 |
| `revertEdgeRevision(deps, id, { apply, conflictCheck, project })` | apply 時 | 撤回一條邊最後一筆由判定小組套用之改寫(重評帳 `applied`、核對帳 `reason`／`downgrade`、覆核帳 `reason`／`retype`／`upgrade`;三帳合併取最後一筆,為 `reverted` 者不可逆):現值須仍為該次改寫之結果、兩端皆在、改寫前之值過納入閘(不給新理由)才回復(`rewriteEdge`:AI 寫入之值入沿革、`updatedAt`＝現在、衝突降級寫事件帳);同一帳追加 `reverted`(`revertOf`＝該列 `at`)。撤回核對／覆核之改寫＝使用者對 RS4／RS6 之裁示(待判結案、檢核記合格 seats `user`;須 `checks`);撤回重評之改寫 → 該邊之 RS5 待判結案,回復之衝突型邊未經核對者登錄 RS4 待判。提案列(新衝突之落地,含升級交核對者)不在列——其帳列無改寫前之現值。邊之產出鏈隨之**撤銷**(回傳 `producedUndo:{ done, how, why? }`;預演亦帶;取法見下〈邊之產出鏈〉) |
| `pruneDangling(deps, { apply })` | apply 時 | 懸空邊(端點不在筆記庫)之清理:預設只列出(開錯集合時不致整批刪掉邊庫) |
| `projectAll(deps, { all })` | 是 | 全庫或待投影帳之投影(帳檔損壞後補回、全庫重投) |
| `reevalBaseline(deps, { apply, by, ruling })` | apply 時 | 重評之基準重設(單輪待重評篇數逾 `guard` 而不開工時):待重評之筆記記為已評完,須記裁示者與內容;該篇本版本之重評待判以同一裁示豁免 |
| `reevalRequeue(deps, { apply })` | apply 時 | 重評閘門開啟後:只記了候選之筆記清除評完標記,下輪以新鮮評估確認(關閘期間之候選不回溯套用) |
| `projectAffected(deps, ids, { ledgers, project })`、`neighborsOf(stores, ids)` | 是／否 | 記待投影＋總覽待重建＋當場投影;鄰居查詢 |
| `queueConflictCheck(holds, { edgeId, from, to, reason, at, ctx?, owner?, next? })` | 是 | 既有衝突邊登錄衝突核對之待判(下游判其非對立時交回;已有未結者不重登;`ctx.stockStd` 給了而使用者已就同一問題豁免者不重開) |
| `queueEdgeReview(holds, edge, { std, why, at, next? })` | 是 | 既有邊登錄既有邊覆核之待判(理由須重寫者;已有未結者不重登;使用者已就同一問題豁免者不重開) |
| `queueConflictProposal(holds, { from, to, reason, reasonCut?, proposer?, segment?, proposedAt?, at })` | 是 | 新衝突之提案於暫緩當下持久為 RS4 提案待判(衝突核對開啟時各段自動呼叫;已有未結者不重登;使用者已豁免而理由未變者不重提) |
| `edgesByProvenance(deps, { stamp?, stage?, provider?, seat?, since?, until?, history? })` | 否 | 依邊之產出鏈選邊(純讀;`deps`＝`{ stores:{ relations } }`),見下〈邊之產出鏈〉 |

**邊之產出鏈(produced;跨套件規格〈知識套件之產出鏈〉)**:邊記錄每次「新建、改型、判定小組改寫、標準修正」追加一筆產出者,記錄帶三欄——`produced`(最後一筆)、`producedHistory`(至多最近 50 筆,舊→新;超出捨最舊並於 `producedHistoryDropped` 累計)、`producedHistoryDropped`。一筆產出者:`{ v:1, stamp, stage, seat, provider, promptFp?, pkg, at }`(組出與檢核取抓取套件之 `makeProduced`／`appendProduced`):

| 欄 | 值 |
|---|---|
| `stamp` | 該輪之 14 碼 stamp(各段 `ctx.stamp`,同該輪 `run.json` 之 `stamp`);輪次外之維運件(`restoreEdge`、存量處置等)為 `null` |
| `stage` | `relate`(正向與輪巡)、`reverse`、`reeval`、`conflict-check`、`edge-review`、`standards-fix`(型別改名、存量處置、還原時之確定性修正) |
| `seat`／`provider` | 單一呼叫點(正向、反向、輪巡):`seat` 為設定路徑(`relate.ai`;反向與輪巡已設 `relate.reverse.ai` 者為之),`provider` 為該批呼叫結果之 `providerId`(**遞補時為遞補者**,不是席位之主席);判定小組改寫:為「被採用其改寫值之那一票」之席位(`first`／`second`／`third`)與供應者,與該段稽核列 `votes`(重評帳為 `verdicts`)之該票同名同值——多票皆合格取票序最前者;衝突核對之新提案原樣落地(keep)為提案席 `proposer`;不呼叫 AI 之寫入(`standards-fix`、使用者撤回)兩者同時為 `null`;`providerId` 為空字串(調度層未回成交者)者**不寫產出鏈**(不以占位字樣代之) |
| `promptFp` | 該角色(`relate`／`reeval`／`conflict-check`／`edge-review`)「內建題組＋現行詞彙」組出之提示詞之指紋(評比機制之 `planBench().promptFp`);不含 `cfg.prompts` 之覆寫、不是該次呼叫實際送出內容之指紋;算不出、不呼叫 AI、經 UMD(`dist`)取用而內建題組不隨包者省略 |
| `pkg`／`at` | 本套件之 `name@version`(由模組位置取得)／寫入時刻(本地時區 ISO,秒級) |

- **只在「新建」與「可見欄位(`from`／`to`／`type`／`reason`)改變」時追加**:跨輪再現之提案落敗而只入 `history`、重評判定保留等不改邊者不追加——否則依輪次撤回邊時會誤傷只是被再提案之舊邊。
- **舊邊不回填**:無 `produced` 之邊不出現在依產出鏈之選件結果;邊既有之 `createdAt`／`updatedAt` 不動、不另加 `at`(`produced.at` 即寫入時刻)。
- **還原類**:`undoDeleteNote`、`restoreNote`、`restoreEdge` 原樣放回者帶撤出前之產出鏈(不追加);經型別改名、納入閘確定性修正或使用者給新理由而邊值已變者,追加 `standards-fix`。存量處置之回退(`rollbackEdgeStockFix`)撤銷該次處置所留之產出鏈(回退不是新的產出)。`revertEdgeRevision`(撤回判定小組之改寫)同為**撤銷**:撤回後可見內容為改寫前之值,`produced` 即改寫前之那一筆、`producedHistory` 少該次改寫之一筆,不追加新紀錄(改寫前無產出鏈者三欄移除)。改寫前之產出鏈取自三段稽核之改寫列(`edge` 另帶改寫前之 `produced`／`producedHistory`／`producedHistoryDropped`,新增欄位);列無此欄(舊帳列)者由現行邊判——`produced` 為歷史末筆、階段＝該段、寫入時刻不晚於該列之 `at` 時退一筆(歷史只有一筆而無捨去者＝改寫前無產出鏈);判不了則不動、撤回照做,回傳 `producedUndo:{ done:false, how:'none', why }`(`why` 為 `history-mismatch`／`stage-mismatch`／`at-unverifiable`／`newer-than-row`／`history-dropped` 之一;歷史滿 50 筆後之改寫已捨去最舊一筆,退一筆時 `producedHistoryDropped` 不減)。
- **`edgesByProvenance(deps, query)`**:`query` 之 `stamp`(14 碼字串或 `null`)、`stage`(小寫連字號名)、`provider`／`seat`(非空字串或 `null`)全等,`since`／`until`(須帶 `Z` 或 `±hh:mm` 之時間字串;含端點、依時刻先後比對)比對 `produced.at`;條件皆為「且」;`history:true` 改比對 `producedHistory` 之任一筆(同一筆須同時滿足全部條件),回傳之 `produced` 為符合條件之最近一筆。回傳 `[{ edgeId, from, to, type, produced }]`(依 `produced.at`、同刻依 `edgeId`)。純讀、不新增寫入路徑;`deps` 無效、`query` 非一般物件、含未知之鍵或任一條件無效皆 reject(**不改用預設**——條件被當成未給會放寬成「全部有產出鏈之邊」,而選件之後接的是撤出)。
- **選件 → 撤出 → 重關聯**:使用端以 `edgesByProvenance` 選出某輪或某供應者所出之邊,逐條以 `retireEdge`(撤出理由 `'reprocess'` 已登錄,可由 `restoreEdge` 依稽核還原;稽核列之邊值帶產出鏈)撤出,兩端再投、重關聯;撤出流程與稽核格式不變。

**待判之處置屬抓取套件**:待判登錄(鍵 `<物件>:<id>:<標準>`;與抓取、摘要套件同一集合)之列表、逾期、要求重試、豁免——`listHolds`、`overdueHolds`、`requestRetry(holds, id, { at })`、`waiveHold(holds, id, { by, ruling, at })`——自抓取套件取用,本套件不轉出。本套件之待判字樣(原因與下一步)一律指本套件之 API 與選項,期限一律 `relateHoldDeadlineOf`。

---

## 13. 檢定標準

`RELATE_STANDARDS`(`standards/registry.mjs`)一條一列:對象與入口、判定類別、能證明／不能證明、執行處(`檔案:函數`,同一標準之各寫入入口皆列)、是否可存量掃描。程式判定之邊標準(RS1／RS2／RS3／RS8)之標題與版本取自 `EDGE_STANDARDS`(判定改變即升版);RS4、RS6 之版本取自其判定模組(檢核紀錄據以判重核)。

| id | 標準 | 類別 | 存量掃描 |
|---|---|---|---|
| RS1 | 結構:兩端存在、非自指、型別在清單(型別改名以詞彙表宣告、既有邊機械改寫) | 程式 | 是 |
| RS2 | 理由形式:非佔位字、去空泛片語與標點後 ≥10 字;逾長於句界截短並記原字數(截斷明示) | 程式 | 是 |
| RS3 | 正體:理由與沿革之理由無簡體專用字、同形誤用、誤用詞([[連結]] 與網址不計) | 程式 | 是 |
| RS4 | 衝突型之邊為真衝突且理由陳述雙方(兩席核對;預設關) | AI | 只計檢核紀錄與待判 |
| RS5 | 內容變更後之既有邊仍成立(兩席重評;預設停用) | AI | 只計待判 |
| RS6 | 內容未變之既有邊仍成立、型別正確、理由具體(兩席覆核;預設關) | AI | 只計檢核紀錄與待判 |
| RS8 | 理由之數字紮根:數字皆見於兩端之材料(新進＝模型所見之兩端區塊;還原與掃描＝兩端筆記之內容章＋原文標題;不可得 → 未能判定) | 程式 | 是 |
| RS9 | 清單外型別不落後備型別(改名表、別名表明文對映,否則不納入) | 程式 | 否(寫入當下判;落地之型別由 RS1 掃) |
| RS10 | 候選涵蓋之召回:已關聯之筆記間公平輪巡、進度可查(預設停用) | 程式 | 否(進度隨每輪報告) |

(RS7 不列為檢定標準:刪除與撤出之可追溯——理由必填、稽核先記再刪、可還原——是其資料契約,由單元測試釘住;新標準另取新號。)

- **新進即受標準**:正向／反向／輪巡之納入閘、合併時浮上之沿革、重評改寫、衝突核對改寫、既有邊覆核改寫、`restoreEdge`、`restoreNote` 與符合度掃描呼叫**同一判定**(`checkEdge`;型別清單與空泛片語取生效之 domain)——掃描之結果即現行標準下存量之真實違反數。未達標準之關聯逐條剔除、其餘照收;可確定性修正者(別名對映、簡體、逾長截短)修正後納入並計數。
- **存量掃描(唯讀)**:`auditRelateStandards({ stores, domain }, { only, material, materialOf, onNote, maxIds })` → 逐標準之總量、合格／不合格／未能判定／不適用／已豁免與完整 id,RS1／RS2／RS8 另有資訊項(沿革條目之違反、理由之句界截短;不算邊本身之違反);AI 標準(RS4／RS5／RS6)列已檢、四態、版本過時與待判之未結／已豁免(來源集合未給者為 `null`,不報為零;列之計法 `aiStandardRowOf`(`core/stores/checks.mjs`)與材料讀取器 `createMaterialReader`(三來源＋快取,材料之文字注入)為各工作之掃描同一份,下游經關聯埠取用)。**管線每輪掃描**:`relate.standards.scanEachRun: true`(預設關;大庫耗時)——管線之後、執行摘要之前掃,計數入 `run.json` 之 `standards`(本輪已逾時間預算者略過,失敗只留 WARN)。
- **存量處置**:`planEdgeStockFix(deps, { stds, ids, limit })`(預演,不寫)→ `applyEdgeStockFix(deps, plan, { at, ledgerFile, onEdgeFixed })`(逐條以現值重算再寫、處置帳逐筆記帳;RS3 為確定性修正——理由與沿革轉正體,id、型別、`updatedAt` 不動;RS2／RS8 須重寫理由,登錄待判交兩席改寫:非衝突型交既有邊覆核、衝突型交衝突核對)→ `verifyEdgeStockChain(deps, rows)`(套用後之連鎖斷言)→ `rollbackEdgeStockFix(deps, rows, { at, ledgerFile, onEdgeRolledBack, acceptCurrent })`(依帳逐列回退;他模組之列略過,呼叫端依帳之全域逆序交付;回退＝撤銷該次處置之效果:只動該次所改之單位〔理由、被修之沿革理由〕,其後被改動或邊已不在者報 `conflicts`、不覆寫、不復活,`acceptCurrent` 記取代列;覆核與待判只動同一登錄);`readEdgeStockLedger(file, { since, at, allowBad })` 讀帳(存量處置帳為抓取套件之帳協定,四工作與宿主同一本帳;遇無法解析之列即拒,`allowBad` 才略過;失敗之件逐件隔離、記 `{ id, object, error }`)。可處置之標準 `EDGE_FIX_STDS`。套用與回退回傳受影響之兩端,由呼叫端以 `projectAffected` 投影;不取鎖、不呼叫 AI。回傳之 `held`(新登錄之待判)、`resolved`(已不再違反而結案之待判)、`alreadyHeld`(已有未結、或使用者已就同一問題豁免者——不重開)、`stale`(現值已不須處置或邊已不在)分列。**已不再違反之結案**(各工作之存量待判件同一機制,抓取套件 `closeStockHold`／`reopenStockHold`／`stockHoldProblems`):本套件所登錄之使用者待判 `edge:<邊 id>:RS3` 而邊仍在、現值以 `checkEdge` 判 RS3 合格者,預演列 `resolvable`(受 `ids` 限、不受 `limit` 限)、套用結案並記結案列 `{ object:'hold-resolved', before:{ hold } }`、回退復原(仍為該次所結者)、連鎖斷言驗登錄在且已結案;邊不在、不適用、未能判定皆不結。
- **確定性修正做不到之 RS3**:套用時以現值重判——邊不在、已合格、或現值已可確定性修正(交下次預演)→ `stale`;現行理由正規化後仍不合格 → 依型別交兩席改寫(與 RS2／RS8 同一去處);只剩沿革之理由有問題 → 登錄使用者待判 `edge:<邊 id>:RS3`(下一步 `RELATE_HOLD_NEXT.stockHistoryScript`:改寫現行理由修不了沿革,由使用者豁免)。掃描唯讀、不會結案,故修不了者一律交給能完成處置之負責者。
- **須改寫理由才能合格之違反**:`reasonRewriteProblemsOf(edge, ctx)`(`REASON_REWRITE_STDS`＝RS2／RS3／RS8)先做確定性正規化(正體可修者不算)、只判現行理由——衝突核對與既有邊覆核送審時對此類項要求 change 改寫(判 keep 不記合格;keep 決策下無改寫之票,修不了即撤出——可以 `restoreEdge` 之 `opt.reason` 還原)。符合度掃描則判落庫原值(不正規化),兩者分工不同。送審之項一律經 `checkPromptItemOf(item, problems)`(附註 `reasonProblem`:問題以「；」接、單行 120 字);無筆記 md 之題組(評分、安裝端之題組執行器)以 `pairCheckItemOf(input, index, domain)` 組項(材料以兩方於提示詞中之區塊代之)——提示詞之項只有一種形式。
- **使用者豁免**:待判之 `waiveHold(holds, id, { by, ruling })`(抓取套件;待判登錄為四工作同一機制);掃描把「不合格／未能判定而有豁免」計為已豁免並逐一列出——豁免是裁示,不是合格。既有違反經覆核待判處理者(存量之 RS2／RS3／RS8、關聯段維護登錄之清單外型別 RS1;待判之 `ctx.stockStd` 標來源),使用者豁免該待判即是對該邊該標準之裁示:`stockWaiverKeyOf` 單一判定,掃描記為該標準之已豁免、存量處置不重開(不同問題照登錄,前段之裁示留於待判之沿革);登錄件(`queueEdgeReview`、`queueConflictCheck`)內建此守門。
- **待判之生命週期(衝突核對與既有邊覆核同一規則)**:存量佇列不重排有未結待判(任何負責者)或豁免仍涵蓋現值(豁免時刻不早於邊時刻)之邊——待判自己負責其去向,使用者之裁示不被自動流程推翻,值變了才重提;過時待判不分負責者結案(提案:該對已成衝突邊、端點不在;既有邊:已撤出、已非本標準之型別、端點不在),隔離之待判除外(其問題「是否還原」仍成立);**入項前預檢**(`stockSourceResolvedOf`,不呼叫 AI):本輪會送兩席之待判(負責者 pipeline)而其來源標準(`ctx.stockStd`:存量之 RS2／RS3／RS8、維護之 RS1)之違反已不在——現值以 `checkEdge` 判合格——即結案(計 `rs4SourceResolved`／`rs6SourceResolved`)、不送兩席、不記檢核;未能判定(RS8 材料不可得)、仍違反、負責者 user 者照送;判不了者先登錄使用者待判、記檢核(未能判定),後隔離撤邊(先記後寫);新衝突之提案(含重評、既有邊覆核之升級)於暫緩當下即持久為 RS4 提案待判,同邊多提案依提案全序取最優;檢核雜湊含兩端判定所讀之素材(`createCheckHasher`)。

---

## 14. 免費 AI 能力評分(四角色;核心為抓取套件之 benchKit)

量的是本套件四類 AI 呼叫點在**正式提示詞與正式判準**下之判斷品質:提示詞以正式之 domain 組(衝突核對、既有邊覆核之項經 `pairCheckItemOf`——現行理由須改寫才能合格者依正式規則自動附註,題組不得自給)、逐案之類別以正式之判定函數算出(正向:納入閘＋逐項鏈之合併規則;重評:裁決驗證;衝突核對、既有邊覆核:票之驗證與型別改正之封閉清單;既有邊覆核之單票處置取 `rs6VoteActionOf`),逐次呼叫選項同正式(陣列輸出,`acceptTruncated:true`)。

| 角色(`--role`) | 對應標準 | 一頁 | 類別(應然) | 內建題組 |
|---|---|---|---|---|
| `relate` 正向關聯 | 納入閘(RS1／RS2／RS3／RS8／RS9) | 6 案(`relate.notesPerCall`) | match(邊與應然逐項相符)／mismatch | `src/bench/cases/relate-generic.json`(15 案) |
| `reeval` 重評 | RS5 | 10 案 | keep／change(衝突型)／change(非衝突型)／retire／unsure | `reeval-generic.json`(15 案) |
| `conflict-check` 衝突核對 | RS4 | 10 案(`pageSize`) | 同重評 | `conflict-check-generic.json`(15 案) |
| `edge-review` 既有邊覆核 | RS6 | 10 案(`pageSize`) | keep／reason／retype:<型別>／upgrade／retire／unsure | `edge-review-generic.json`(16 案) |

```
node src/bench/cli.mjs [--role <relate|reeval|conflict-check|edge-review|all>] [--models <id,…>|free] [--cases <題組 json>] [--vocab <詞彙 json> [--vocab-pick]] [--runs 2] [--out <目錄>] [--env <金鑰檔>] [--timeout <毫秒>] [--concurrency <n>] [--tz <IANA 時區>] [--board <評比表 csv>]
```

- **`--role all`**(預設):依序跑四角色,各用內建通用題組;前面角色已停測之模型(限流、連續失敗、條目不可用)不再於後續角色受測。各角色之參數、題組、詞彙與提示詞皆於任何呼叫之前備妥。多角色之命令列規則(`--role`、準備期、停測帶過)為抓取套件之 `defineBenchRoles`(各套件同一份)。
- **計分**:每案呼叫 `runs` 回,**各回之類別皆等於應然才算通過**(不以比率放行);保留題(每組 5 案)分列;合契約率、平均耗時、呼叫失敗只列資訊。題組領域中立、合成材料、無網址與文獻,各案附 `why`。
- **自己的題組與詞彙**:`--cases` 給與內建同形之題組、`--vocab` 給詞彙物件之 JSON(只收本套件之鍵,他鍵拋錯;與他段共用一份詞彙表者加 `--vocab-pick`——以 `pickRelateVocab` 取子集、子集寫入 `--out` 之 `relate-vocab-<時間戳>.json` 並以之評分)——即以自己的正式提示詞量自己的題組。題組之型別須在詞彙表內(於任何呼叫之前驗)。程式呼叫:`runRelateBench(role, { models, cases, runs, aiAdapter, vocab, ... })`、`planRelateBench(role, opt)`(只備題、不呼叫 AI)、`runRelateBenchCli(argv)`。
- **評比表 `模型評比.csv`**(套件根):`--board 模型評比.csv` 產生與更新,一角色一模型一列;本次覆蓋同角色同模型之舊列,**停測或有未呼叫回合者不寫**。CLI 型模型會讀 AI 工作目錄上層之指示檔(§8),**量通用能力時 `--out` 放在任何專案之外**。
- **與安裝端之指標分工**:本評分量的是「模型對合成題組之判斷是否等於題組釘住之應然」;安裝端若另以自己知識庫之凍結樣本算代理指標(例:以既有之邊為參考答案之重現率),其題目、判準與分母皆不同——兩者**不可互比、也不可互相取代**:換席位前以本評分驗判斷品質,代理指標只說明與既有庫之一致程度。
- **免費額度**:opencode 免費模型有每日額度(UTC 0 時重置);`--role all` 一次全量可能逾當日額度——撞額度之模型以逾時停測、該角色不寫入評比表,隔日以 `--role <角色> --models <id>` 補跑。分數會浮動(每案只跑 `runs` 回),據以換席位前宜重跑確認。
- **報表**:`<out>/<角色>-bench-<時間戳>` 之逐模型 CSV、逐案 CSV、Markdown、JSON;逐回進度 `.progress.jsonl`(中途被終止也留得下)。

---

## 15. 測試

在套件根執行(`package.json` 之 scripts 為 `test` 與 `deploy`):

```
npm test                                                        # mocha --parallel "test/*.test.mjs" --timeout 180000
node <mocha 路徑>/bin/mocha.js --timeout 180000 test/<檔名>      # 單檔
```

| 層 | 檔案 | 內容 |
|---|---|---|
| 設定與詞彙 | `unit-settings`、`unit-vocab` | 設定與詞彙之逐鍵檢核、免費席位、判定小組、容量與警告 |
| 邊與標準 | `unit-relate-{edges,standards,gate,projection}` | 無序對身分與提案全序合併、確定性標準之純函數、納入閘與撤出、投影 |
| 段與流程 | `unit-relate-{stage,change,delete,rotation,reeval,aicall,holds,conflictcheck,edgereview,checks}` | 關聯段之各段、內容變更與刪除之反應、輪巡、重評、AI 呼叫之形狀、待判與字樣、衝突核對、既有邊覆核、檢核紀錄(須否重檢、落帳、AI 標準之掃描列) |
| 提示詞 | `unit-relate-domain`、`unit-relate-prompts` | 四支提示詞 × 兩組詞彙之逐字契約(golden)、領域句之唯一落點、提示詞覆寫 |
| 檢定標準 | `unit-relate-{registry,audit,stockfix}` | 標準之登記(執行處之檔與函數存在、版本單一來源)、存量掃描(與新進閘同一判定、豁免、AI 標準)、存量處置(預演／套用／回驗／回退、處置帳) |
| 物件與組裝 | `unit-relate-object`、`unit-relate-assembly`、`unit-relate-entry`、`unit-relate-package` | 物件之子階段序列、錨點路由與固定格式摘要;總組裝與執行期件之逐鍵檢核、domain 與提示詞、啟用功能之檢核、網路判斷、席位與調度層事件、每輪掃描;入口匯出;**套件邊界、依賴、發布面(不設 `exports` 與 `files`、`.npmignore`、`LICENSE`)、`npm pack --dry-run` 之打包清單、範例 `g.mjs` 離線可執行且 README 含其全文、發布內容不帶宿主之痕跡、預設領域中立、舊名、沿革與面向使用者之字樣**(判準取抓取套件之 `test/tools/historyMarks`,四套件同一份;不以名指下游之工作) |
| 契約與流程 | `unit-relate-log-contract`、`unit-flow-relate`、`unit-relate-contract` | 日誌字樣、正則與 report 鍵對實際產出;真 LMDB 上兩輪之完整流程;下游可讀之產物格式、標準於各寫入入口同一判定、上游之變更通知與 ctx 旗標、兩份依賴契約 |
| 評分 | `unit-relate-bench`、`api-relate-bench-ai` | 評分角色與題組、命令列用法字串為實際可執行之路徑;真 AI(`WK_LIVE_AI=1` 才跑) |

- **固定埠**(≥8000、不隨機):8861 為無人監聽之埠(內建調度層之「整鏈皆敗」)、8862 為本機假 REST、8863 為扣保留之 AI 呼叫之接縫測試(`unit-relate-chain`)之本機假 REST;8864～8869 保留。
- **暫存**:各測試以 `test/tools/relateTestKit.mjs` 之 `tmpRoot(名)` 自建 `test/_tmp/<名>-<pid>`(以套件根定位;before 才建),測完 `removeRoots` 刪除並回驗。
- 測試中之 AI 一律為替身或本機假端點,不連外網、不燒額度;各段測試之手寫替身一律以 `withCheck` 包住(回覆經呼叫端之正式 check,不合即失敗——注入之 `callAI` 契約要求替身自驗)。
- **跨套件之介面以本套件一側之契約測試驗**:摘要套件之件(筆記組裝、內容同步、還原閘、非內容章之章名、子階段之 ctx `bagCtx`)經測試專用之橋接 `test/tools/summarizeForTest.mjs`、抓取套件之件(含共用測試件:日誌替身、暫存根、`deepMerge`、`parseCsv`、`withCheck`、原始檔走訪 `sourceFilesOf`、提示詞標準檔 `goldenDiffOf`、整輪斷言 `assertSubStagesOk`)經 `test/tools/captureForTest.mjs` 取得(套件程式碼不 import;兩橋接所轉出之每一名皆須被本套件 test/ 下至少一檔取用;尚無自動守門案,維護時人工盤點);領域中立掃描之詞表取抓取套件之 `test/tools/domainTerms.mjs`(經 `test/tools/captureForTest.mjs`;四套件同一份)。
- **題組檔之說明亦受沿革守門**:`src/bench/cases/*.json` 之頂層 `note` 與各案 `why`(說明文字)與原始碼同受 `unit-relate-package` ④ 之掃描(不得帶日期、改寫說明與帳本或審閱之代稱);材料 `input` 與應然 `expect` 為題材,不掃。

---

## 16. 收斂到特定主題與整合

套件預設不限主題;要專注某一領域,只給資料與設定,不改程式。以天文學知識庫為例:

```js
createKnowledgeRelate({
    workDir: 'd:/astro-kb',
    data: {
        vocab: {
            kbLabel: '天文學知識庫', domain: '天文學',
            relationTypes: ['觀測基礎', '理論延伸', '互補方法', '觀測矛盾', '儀器實作', '同類方法'],
            conflictType: '觀測矛盾', fallbackType: '互補方法',
            relationTypeRoles: { implementation: '儀器實作', extension: '理論延伸', sibling: '同類方法', complement: '互補方法' },
            guide: {
                relate: {
                    broadRelation: '同屬天文學', vagueReason: '都與天體有關',
                    changeDrivers: '隨觀測波段、儀器靈敏度與樣本天區轉換',
                    implementationCase: '一方是另一方之觀測方法的具體儀器實作或資料處理流程',
                },
            },
        },
    },
    relate: { rounds: 4 },
})
```

**整合進多工作之知識庫專案**(專案之設定檔頂層有 `ai`、`summarize`、`relate` 等段,各工作各佔一段)——對應如下:

| 專案端 | 本套件 |
|---|---|
| 設定檔之 `relate` 段 | 原樣給 `cfg.relate`(鍵與型別見 §5) |
| 設定檔之 `ai` 段 | 只挑 `RELATE_AI_SCHEMA` 之鍵給 `cfg.ai`——他工作之鍵(供應商池等)會被拒收 |
| 關聯總覽之標題 | `cfg.relationIndexTitle` |
| 共用之詞彙表(含他段之鍵) | `cfg.data.vocab = pickRelateVocab(詞彙表)`;要逐字重現既有之提示詞,把既有之領域措辭填回 `guide.relate`(含 `implementationCase`、`extensionCase`),型別角色以 `relationTypeRoles` 明給 |
| 同一輪後段之耗時工作 | `cfg.stageOpts.relate.reserveMs`(或其函數形式);他總組裝以自己之每輪依賴驅動本套件之物件者,於依賴給 `reserveMs` 一次即可 |
| 共用之 AI 調度狀態 | 建一個調度實例,以 `cfg.aiAdapter` 注入各工作(截斷放行為逐次給,共用不互相影響) |
| 共用一庫 | `lmdb.db`／`lmdb.cls` 對齊既有之庫名與集合名;既有庫有下游產物之集合者給 `cores: true` |
| 本機網路判斷 | 抓取套件之判斷器以 `cfg.netGuard` 注入(同一判斷器給各工作) |
| 筆記之還原 | 維運之 `restoreNote` 依賴給 `noteGate: createNoteRestoreGate({ stores, vocab, clock })`(摘要套件;`vocab` 為摘要套件解析之詞彙表) |
| 他總組裝共用關聯件 | `createRelateRuntime(cfg, settings, { vocab: pickRelateVocab(…), domains: … || {} })`(§9) |
| 讀關聯之下游 | 邊、md 兩章、總覽、帳之格式與讀法見 §1;衝突型之現名與舊名取 `domain.conflictTypeNames`、型別解析取 `domain.resolveType`、已關聯取 `isRelated` |

---

## 17. 已知限制

- **不做 AI 狀態落檔**:游標、冷卻、用量皆在行程內(排程每輪新行程;冷卻短於排程週期)。
- **內建提示詞與總覽版型為繁體中文**:`lang` 只換理由之語言句與字形政策,不翻譯提示詞本體(整份可經 `cfg.prompts` 覆寫);字形標準只有臺灣正體一種,其他語言之 RS3 列不適用。
- **輪巡之第一頁與正向之前 K 名對同分候選之排序方向不同**:尚未量測其影響;改序即改候選,量測後再議。
- **候選與總覽之同分排序依執行環境之語系規則(`localeCompare`)**:未觀察到跨機器差異;改為字碼序會改變同分之候選與總覽次序,量測後再議。
- **重評之 `reevalTargets` 於截頁時高估**:計數口徑,不影響任何判定。
- **一席回覆之重複編號**:重評取第一個結構完整之項(同批次調度之部分接受;一頁一篇、項為頁),衝突核對與既有邊覆核同編號矛盾者作廢為缺票、相同者取一(一項一邊)——刻意,各依其項之粒度。
- **判不了之邊**:衝突核對與既有邊覆核隔離撤出(「達標才得保留」之檢定),重評之邊不動(內容變更之反應);非衝突改正之封閉清單只在既有邊覆核;「現行理由須改寫」之附註只在衝突核對與既有邊覆核(重評由內容變更觸發,不合格之存量交 RS6／RS4)——皆刻意。
- **正向提示詞寫明「每篇最多選 4 個」**,而 `cfg.stageOpts.relate.maxRelationsPerNote` 可改上限:改上限者宜同時以 `cfg.prompts.relate` 調整提示詞(內建提示詞一改,其指紋與題組識別即變)。
- **摘要套件之章名(「核心知識」等)於摘要套件內多處手寫**:本套件以契約測試驗其讀法(衝突核對與既有邊覆核之材料)對摘要套件之版型產物有效。
- **衝突核對與既有邊覆核無動作鏈**(重評段有):兩段為分頁程序＋判定小組,客製以設定、提示詞與 domain 為之。
- **還原閘由呼叫端注入**:`restoreNote` 未給 `deps.noteGate` 即 WARN 並原樣還原(筆記本身未經筆記標準)。本套件之詞彙子集不含摘要之鍵,內建還原閘須另收摘要之詞彙而增介面,故不內建;整合時注入摘要套件之 `createNoteRestoreGate({ stores, vocab, clock })`(§16)。撤銷刪除(`undoDeleteNote`)與存量處置之回退原樣還原、不經筆記標準(回退＝撤銷該次處置)。
- **邊之產出鏈之取捨**:輪巡(規格未列)記為 `relate`;使用者之還原(規格未列)原樣放回者帶撤出前之產出鏈、確定性修正或使用者新理由者追加 `standards-fix`,撤回判定小組之改寫與存量處置之回退則撤銷該次所留之產出鏈、不追加(見 §12〈邊之產出鏈〉;撤回之舊帳列判不了改寫前之產出鏈者不動、回傳帶原因字樣,歷史滿 50 筆後退一筆時 `producedHistoryDropped` 不減);產出鏈之 `promptFp` 為「內建題組＋現行詞彙」之提示詞版本,不含 `cfg.prompts` 之覆寫;`promptFp` 之有無與歷史滿額輪替會使 `patch` 之合併回讀不符而走 `replace` 路徑落庫(同 `history` 變短之既有路徑,寫入後回讀驗)。
- **一次呼叫之估計(開工門檻、第三席之進門門檻)取席位之 `use`**(抓取套件之 `captureCallMsOf`):調度層之冷卻重排使實際首家可能不是席位之 `use`;同 id 之 `ai.extraProviders` 此處取第一筆(調度層之目錄展開取最後一筆);調度層內建條目表自帶之逾時(未列於設定者)此處看不到,以 `ai.timeoutMs` 計——要精準請於 `ai.providerTimeouts` 或席位 `timeoutMs` 明列。
- **非字串之沿革理由**:邊庫之沿革值皆為字串(本套件寫不出非字串);外部寫入之畸形資料若使 RS3 判定違反,確定性修正會略過而列為修不了 → 使用者待判(可豁免)。
- **模型回覆含多段 JSON**(如先回一段、自我更正後再回完整一段):調度層(抓取套件之 `pickJsonReply`)由後往前取第一段過 `check` 者,即取更正後之那段。各段之 `check` 皆驗到項目之形狀(至少一項帶整數 `index`;重評另須 `verdicts` 陣列),尾隨說明之小片段(如「見 [3]」)不會被取;注入之調度層(`cfg.aiAdapter`)須自行遵守同一判準。

## 18. 套件內部之層序(維護者)

`core` ← `stores` ← `standards` ← { `stages`, `ops` }:四層之檔只取同層或更低層,stages 與 ops 互不引用;`domain`、`bench` 為葉(四層不取之),入口、總組裝、物件、執行期件在根(四層不取之);根之 `logContract` 自身只取 stores,供 standards 以上取(stores 不取之)。`test/unit-relate-package` 以 import 掃描守門。各層放什麼:

| 層 | 放什麼 | 例 |
|---|---|---|
| `stores/` | 邊庫、帳、投影、候選(概念鍵、挑候選、slug 容錯)、筆記狀態機(已關聯／待重判／待重評)、判定之純函數與待判字樣 | `edgeStore`、`candidates`、`relatedNotes`、`noteProjection`(含批次投影 `projectNotes`)、`edgeCheckKit` |
| `standards/` | 邊標準、納入閘、登記、存量掃描與處置(含 RS3 之確定性修正 `edgeFixOf`)、交判定小組之排入(`edgeQueue`:`queueEdgeReview`／`queueConflictCheck`／`queueConflictProposal`、存量豁免鍵) | `edgeGate`、`stockFix`、`edgeQueue`、`audit` |
| `stages/` | 子階段與其段:`relateStage`(編排)、`relateChain`(納入閘與逐項動作鏈、項合格判準 `coveredItemOf`)、`relateMaintain`(開工前維護)、`relateQueueSegment`(反向／輪巡共用之執行器)、`relationIndexStage`、`projectStage`、三段(重評、衝突核對、既有邊覆核)與 `checkPanelPages` | |
| `ops/` | 維運 API(刪除／還原／撤銷、懸空清理、全庫投影、重評基準、被撤出之邊之還原、受影響者之投影) | `noteOps`、`projectOps` |

席位之「未設即沿用」只在 `core/relateSettings` 之 `relateSeatOf`(各段、判定小組之定義與席位檢核同讀);物件之階段名與子階段鍵即日誌契約 `RELATE_REPORT_KEYS`(同一實體)。

## 19. 升級注意(行為變更)

### Breaking changes:扣保留之 AI 呼叫改經抓取套件之包裝、判定小組第三席之逐次進門門檻

- **移除具名匯出 `reservedCallOf`、`chainStepMsOf`、`callTimeoutMsOf`(不留相容層)**:扣保留之 AI 呼叫(正向、反向、輪巡、重評、既有邊覆核、衝突核對;12 種段／席別)改經抓取套件之 `reservedAiCallOf`(進門判定、鏈內續派判停、`budgetMs` 與扣保留之剩餘取小),一次呼叫之估計改用抓取套件之 `captureCallMsOf`——本套件不再另有一份。自行引用上述三名者,改自 `w-knowledge-capture` 取 `reservedAiCallOf`(`reservedCallOf(ask, sub, firstMs)` → `reservedAiCallOf(ask, sub, { firstMs })`)、`aiChainStepMsOf`、`captureCallMsOf`。替換時之差異:①新包裝**不為 async**——進門不足回 resolve 之 Promise,否則原樣回傳 `ask` 之回傳值,`ask` 同步拋出即同步外傳(舊包裝一律回 Promise、同步拋出轉為 rejected),依賴 `.catch()` 收同步錯誤者須自行包 `async`;②呼叫端給之 `shouldStop` 與鏈內判停取「或」、`budgetMs` 與扣保留之剩餘取小(舊包裝一律覆寫這兩項),`startMs` 為新增之逐次進門門檻(不轉交);③建構時參數不合(`ask` 非函數、閘缺 `shouldStop`／`remainingMs`、`firstMs` 非非負有限數)同步拋出;④門檻之取值見下兩項。
- **段之開工門檻計入席位 `timeoutMs` 與 `ai.extraProviders` 條目自帶之逾時**:取值序為 席位 `timeoutMs` → `ai.providerTimeouts[席位之 use]` → `ai.extraProviders` 同 id 條目之 `timeoutMs` → `ai.timeoutMs` → 300000(修前只取 `ai.providerTimeouts`／`ai.timeoutMs`,與轉接層實際之首家逾時不符)。席位給了 `timeoutMs` 者,整段延後之判定、每頁／每輪開工前之守門與每次呼叫之進門門檻隨之改變(較短者較早開工;較長者較晚)。
- **判定小組三段之第三席以該席首家之逾時判進門**(使用端〔Gitea #132〕):第三席於前兩票之後才叫;修前每次呼叫仍以三席首家逾時之最大值判,頁開工時剩餘不足「開工門檻＋前兩席耗時」者前兩票已得而第三席不送出(送第三席之項整批留待下輪、前兩票作廢、日誌記「第三席額度或截止中止」)。現第三席之每次呼叫給 `startMs`＝`captureCallMsOf(settings, 第三席)`(與段之開工門檻取小、不轉交 AI 呼叫;鏈內續派門檻以之為上限);第一、二席不變。段之開工門檻(整段延後、每頁開工前之守門)仍取三席之最大值。關聯段之收尾可能晚一次第三席呼叫之耗時(各次嘗試之逾時仍由 `budgetMs` 封頂,不侵入保留)。
- **依賴升版帶來之歸類變更**(`w-knowledge-capture` 1.0.18 起,其 AI 調度層須 `w-dispatch-ai` 1.0.86 起):轉接層不再以呼叫端此刻之 `shouldStop` 把末家之真失敗改標中止——各家皆試過而真的失敗者照計失敗(retry、記 tries);被 `budgetMs` 封頂而整鏈預算確已用盡之嘗試(調度層記 `budget-cut`;判準與鏈首之例外見 `w-dispatch-ai` 之說明)不計失敗,結果歸中止(`skipped`)。下段「轉接層於失敗後仍以鏈內 `shouldStop` 判斷是否被截止切斷」一句自此不再成立。冷卻紀錄格式與持久連敗之變更見抓取套件 README〈Breaking changes〉(共用同一持久 store 之各套件須同次升版)。

### 前次:遞補鏈內改以續派門檻判停

- **扣保留之各段:遞補鏈內改以續派門檻判停**(使用端〔Gitea #128〕):正向、反向、輪巡、重評、既有邊覆核、衝突核對於有保留(或整輪有截止)時,原以「開工門檻」(各席首家單次逾時之最大值)同時判「要不要送出一次新的呼叫」與「同一次呼叫內、嘗試之間要不要續派遞補」——進門時扣保留之剩餘不足「開工門檻＋主席逾時」者,主席等滿自己的逾時後剩餘即低於開工門檻,遞補被中止(形同未設遞補)。現改為:進門仍以開工門檻判;鏈內(交 AI 調度層之 `shouldStop`)以**續派門檻**判且仍扣保留——`min(開工門檻, 席位 minAttemptMs〔未給或非正數取 60 秒〕)`,正向段未保留(開工門檻為 0)者為 0;各次嘗試之逾時由 `budgetMs`(＝進門當下之剩餘−保留)封頂,使遞補不致侵入保留。每頁／每輪開工前之守門不變。全鏈皆試過而真的失敗者照計失敗(retry、記 tries),被截止切斷者仍為中止;轉接層於失敗後仍以鏈內 `shouldStop` 判斷是否被截止切斷,故此刻剩餘已低於續派門檻者亦視為中止。不留相容開關。
- **進門不足時不再呼叫注入之 `callAI`**:扣保留後剩餘不足開工門檻時,包裝層直接回 `{ ok:false, error:'ABORTED', skipped:true, attempts:0 }`(與調度層進門即中止同義),不再呼叫 `cfg.stageOpts.relate.callAI`／調度層;轉接層之 AI 實績少記一筆 `(aborted)`。注入 `callAI` 之替身所見的 `shouldStop` 語意隨第一項改變(鏈內為續派門檻,不再是開工門檻)。
