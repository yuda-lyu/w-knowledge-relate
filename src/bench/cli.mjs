// cli.mjs — 關聯之 AI 能力評分之命令列(薄殼:直接執行時交 bench/relateBench 之 runRelateBenchCli;參數解析、評分、報表皆在該處)
//
// 用法:node src/bench/cli.mjs [--role <relate|reeval|conflict-check|edge-review|all>] [--models <id,…>|free] [--cases <題組 json>] [--vocab <詞彙 json> [--vocab-pick]]
//                          [--runs 2] [--out <目錄>] [--env <金鑰檔>] [--timeout <毫秒>] [--concurrency <n>] [--tz <IANA 時區>] [--board <評比表 csv>]
//   各選項之說明見 relateBench 之 RELATE_BENCH_USAGE(--help 印出);報表落 --out(預設 cwd 之 ./bench-out/)。
//
// 【被 import 時不執行】只在直接執行(node src/bench/cli.mjs …;判定取抓取套件之 isDirectRun,各命令列同一份)時跑;被 import 時只轉出
//   runRelateBenchCli(與 relateBench 同一實體),故可與其他公開模組一樣被載入檢查,不必列為例外。

import { isDirectRun } from '../core/capturePackage.mjs'
import { runRelateBenchCli } from './relateBench.mjs'

export { runRelateBenchCli }

if (isDirectRun(import.meta.url)) {
    runRelateBenchCli(process.argv.slice(2)).catch((e) => {
        console.error(`關聯 AI 能力評分失敗：${e?.message || e}\n（用法：node src/bench/cli.mjs --help）`)
        process.exitCode = 1
    })
}

export default runRelateBenchCli
