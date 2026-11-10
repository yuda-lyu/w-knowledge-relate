# 回饋（w-knowledge-relate）

> 回饋只是紀錄與提案，不因此自行修改他套件、全域技能或全域設定（通報走全域設定 §5.2、§13）。一條一列：日期、類別、對象、內容、依據。

| 日期 | 類別 | 對象 | 內容 | 依據 |
|---|---|---|---|---|
| 2026-11-10 | 自有套件 | w-dispatch-ai | 被 `budgetMs` 封頂而逾時之嘗試，錯誤字樣與一般逾時相同（`TIMEOUT after Ns`），調度層仍立即寫條目冷卻、發 `group-exhausted`、健康層連敗 +1；其設計本意已把「預算用盡」視為呼叫端之時間、非該組故障（不發 `group-exhausted`），封頂逾時同性質，宜區分並歸為預算用盡。本套件 REL-20 讓主席失敗後之遞補在剩餘不足其逾時時亦送出，此情形頻率可能增加 | `w-dispatch-ai/src/dispatchAiFallback.mjs` 之 `effTimeout` 封頂處與條目冷卻處；`sgud/exp/experience_relate.md` §44 |
| 2026-11-10 | 自有套件 | w-knowledge-capture | 轉接層以呼叫端之 `shouldStop` 猜「被切斷之末家」（`skipped = errorType==='budget' \|\| 'aborted' \|\| stopNow()`），而呼叫端之 `shouldStop` 可能是進門用之開工門檻，歸類隨之偏（#128 之根源之一）；調度層區分封頂逾時後可不再靠 `shouldStop` 猜測。另「扣保留之 AI 呼叫」（進門判定＋鏈內續派門檻＋`budgetMs`）宜在抓取套件提供共用件，關聯與摘要兩套件改用，不各寫一份 | `w-knowledge-capture/src/core/ai/adapter.mjs` 之 `skipped` 判定處；本套件 `src/stages/relateAiCall.mjs` 之 `reservedCallOf` |
| 2026-11-10 | 自有套件 | w-dispatch-ai／w-knowledge-capture | 交調度層之 `budgetMs` 以 `castPintOr`（正整數）正規化，小數毫秒（如保留值或剩餘時間為小數）被靜默回退為 `null`＝不限預算，封頂失效；轉接層 `cap` 取最小後原樣轉交，兩處宜一致處理（取整或拒收並告警），不宜靜默放寬 | `w-dispatch-ai/src/dispatchAiFallback.mjs` 之 `castPintOr(get(opt,'budgetMs',null),null)` 與 `deadline` 建立處；`w-knowledge-capture/src/core/ai/adapter.mjs` 之 `budgetMs: Math.min(budgetFor(providers), cap)` |
| 2026-11-10 | 全域技能 | role-coder-for-test | 提議補一條：把同一規則集中到一個包裝、再套到 N 個呼叫點時，測試須能抓到「任一呼叫點改回舊寫法」——一則列舉全部呼叫點之接線案，或以變異逐一植入確認；本案提案版之 4 則測試只守到 5 處呼叫點中之 2 處，補接線案後 9 個變異全數被殺 | `sgud/exp/experience_relate.md` §44；`test/unit-relate-aicall.test.mjs`〈六類呼叫之接線〉 |
