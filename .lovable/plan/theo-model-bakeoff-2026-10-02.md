# Theo model bake-off — 2026-10-02 (test only, production unchanged)

Signed in as Jordan (super admin). Hemet unless noted. Truth read 04:18–04:20 UTC (9:18–9:20 PM Pacific, Oct 1 business day). Each question ran all four models at the same moment (in parallel), then a second round. 18 questions × 2 runs = 36 runs per model. Q16 is not scored (see section 5), so scores are out of 34.

Prices ($/1M input/output) as given, confirmed against the gateway's own model list: A 0.30/2.50, B 0.75/3.75 (Jan 2027: 1.50/7.50), C 0.25/1.50, D 0.10/0.50. The gateway reports cached input tokens separately; they are priced at its listed cache-read rate, 10% of the input price. Costs are in cents.

## 1. Summary

| Model | Right | Partly | Wrong | Same score both runs (of 17) | Avg s | Slowest s | Avg cost/answer ¢ | Total 36 runs ¢ | Tool errors |
|---|---|---|---|---|---|---|---|---|---|
| A 2.5 Flash | 29 | 3 | 2 | 14 | 3.4 | 6.2 | 0.27 | 9.79 | 0 |
| B 3.8 Flash | 32 | 2 | 0 | 17 | 9.9 | 24.8 | 1.14 (Jan 2027: 2.27) | 40.94 (Jan 2027: 81.89) | 0 |
| C 3.1 Flash Lite | 31 | 3 | 0 | 14 | 2.9 | 4.5 | 0.19 | 6.78 | 0 |
| D GPT-6 Luna | 31 | 2 | 1 | 14 | 3.6 | 8.3 | 0.05 | 1.88 | 0 |

Tool errors = requests that failed outright. None did. No run showed a tool error to the user.

## 2. Every run

| Q | Model | Run | Score | s | Prompt tok | (cached) | Completion tok | Round trips | Tools | Cost ¢ |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A 2.5 Flash | 1 | R | 3.0 | 4456 | 0 | 96 | 1 | - | 0.16 |
| 1 | A 2.5 Flash | 2 | R | 3.1 | 9080 | 8639 | 271 | 2 | query_labor | 0.11 |
| 1 | B 3.8 Flash | 1 | R | 6.2 | 6052 | 0 | 478 | 1 | - | 0.63 (Jan 2027 1.27) |
| 1 | B 3.8 Flash | 2 | R | 5.8 | 6052 | 3412 | 586 | 1 | - | 0.44 (Jan 2027 0.89) |
| 1 | C 3.1 Flash Lite | 1 | R | 3.2 | 6052 | 0 | 60 | 1 | - | 0.16 |
| 1 | C 3.1 Flash Lite | 2 | R | 1.8 | 6052 | 5119 | 56 | 1 | - | 0.04 |
| 1 | D GPT-6 Luna | 1 | R | 3.4 | 5573 | 0 | 25 | 1 | - | 0.06 |
| 1 | D GPT-6 Luna | 2 | R | 2.9 | 11271 | 11140 | 85 | 2 | query_labor | 0.02 |
| 2 | A 2.5 Flash | 1 | R | 2.0 | 4460 | 0 | 157 | 1 | - | 0.17 |
| 2 | A 2.5 Flash | 2 | R | 3.5 | 4460 | 0 | 120 | 1 | - | 0.16 |
| 2 | B 3.8 Flash | 1 | R | 4.9 | 6056 | 0 | 474 | 1 | - | 0.63 (Jan 2027 1.26) |
| 2 | B 3.8 Flash | 2 | R | 15.9 | 6056 | 3412 | 407 | 1 | - | 0.38 (Jan 2027 0.75) |
| 2 | C 3.1 Flash Lite | 1 | R | 1.8 | 6056 | 0 | 72 | 1 | - | 0.16 |
| 2 | C 3.1 Flash Lite | 2 | R | 3.6 | 6056 | 5120 | 76 | 1 | - | 0.05 |
| 2 | D GPT-6 Luna | 1 | R | 2.2 | 5579 | 0 | 45 | 1 | - | 0.06 |
| 2 | D GPT-6 Luna | 2 | R | 3.2 | 5579 | 5576 | 60 | 1 | - | 0.01 |
| 3 | A 2.5 Flash | 1 | P | 2.0 | 4457 | 0 | 112 | 1 | - | 0.16 |
| 3 | A 2.5 Flash | 2 | R | 1.6 | 4457 | 0 | 157 | 1 | - | 0.17 |
| 3 | B 3.8 Flash | 1 | R | 6.3 | 6053 | 0 | 612 | 1 | - | 0.68 (Jan 2027 1.37) |
| 3 | B 3.8 Flash | 2 | R | 7.9 | 6053 | 0 | 795 | 1 | - | 0.75 (Jan 2027 1.50) |
| 3 | C 3.1 Flash Lite | 1 | P | 2.0 | 6053 | 0 | 100 | 1 | - | 0.17 |
| 3 | C 3.1 Flash Lite | 2 | R | 2.0 | 6053 | 5119 | 123 | 1 | - | 0.05 |
| 3 | D GPT-6 Luna | 1 | R | 2.1 | 5576 | 5561 | 48 | 1 | - | 0.01 |
| 3 | D GPT-6 Luna | 2 | R | 1.8 | 5576 | 5573 | 65 | 1 | - | 0.01 |
| 4 | A 2.5 Flash | 1 | R | 1.9 | 4457 | 0 | 122 | 1 | - | 0.16 |
| 4 | A 2.5 Flash | 2 | R | 1.5 | 4457 | 0 | 98 | 1 | - | 0.16 |
| 4 | B 3.8 Flash | 1 | R | 5.1 | 6053 | 0 | 466 | 1 | - | 0.63 (Jan 2027 1.26) |
| 4 | B 3.8 Flash | 2 | R | 5.7 | 6053 | 3412 | 441 | 1 | - | 0.39 (Jan 2027 0.78) |
| 4 | C 3.1 Flash Lite | 1 | R | 2.2 | 6053 | 0 | 100 | 1 | - | 0.17 |
| 4 | C 3.1 Flash Lite | 2 | R | 1.9 | 6053 | 0 | 81 | 1 | - | 0.16 |
| 4 | D GPT-6 Luna | 1 | R | 2.1 | 5576 | 5561 | 46 | 1 | - | 0.01 |
| 4 | D GPT-6 Luna | 2 | R | 1.8 | 5576 | 5573 | 41 | 1 | - | 0.01 |
| 5 | A 2.5 Flash | 1 | R | 3.2 | 9444 | 0 | 357 | 2 | query_schedule | 0.37 |
| 5 | A 2.5 Flash | 2 | R | 3.1 | 9447 | 640 | 338 | 2 | query_schedule | 0.35 |
| 5 | B 3.8 Flash | 1 | R | 8.5 | 12696 | 3450 | 765 | 2 | query_schedule | 1.01 (Jan 2027 2.01) |
| 5 | B 3.8 Flash | 2 | R | 7.4 | 12734 | 3453 | 778 | 2 | query_schedule | 1.01 (Jan 2027 2.03) |
| 5 | C 3.1 Flash Lite | 1 | R | 3.2 | 12557 | 5159 | 267 | 2 | query_schedule | 0.24 |
| 5 | C 3.1 Flash Lite | 2 | R | 3.9 | 12557 | 5159 | 266 | 2 | query_schedule | 0.24 |
| 5 | D GPT-6 Luna | 1 | R | 3.6 | 11520 | 11130 | 233 | 2 | query_schedule | 0.03 |
| 5 | D GPT-6 Luna | 2 | R | 3.7 | 11520 | 5569 | 253 | 2 | query_schedule | 0.08 |
| 6 | A 2.5 Flash | 1 | R | 3.8 | 9282 | 0 | 417 | 2 | query_schedule | 0.38 |
| 6 | A 2.5 Flash | 2 | R | 3.6 | 9367 | 4315 | 318 | 2 | query_schedule | 0.24 |
| 6 | B 3.8 Flash | 1 | R | 6.4 | 12614 | 0 | 449 | 2 | query_schedule | 1.11 (Jan 2027 2.23) |
| 6 | B 3.8 Flash | 2 | R | 7.4 | 12635 | 6856 | 488 | 2 | query_schedule | 0.67 (Jan 2027 1.34) |
| 6 | C 3.1 Flash Lite | 1 | R | 3.0 | 12495 | 0 | 172 | 2 | query_schedule | 0.34 |
| 6 | C 3.1 Flash Lite | 2 | R | 2.7 | 12495 | 10271 | 164 | 2 | query_schedule | 0.11 |
| 6 | D GPT-6 Luna | 1 | R | 3.0 | 11471 | 5569 | 110 | 2 | query_schedule | 0.07 |
| 6 | D GPT-6 Luna | 2 | R | 3.2 | 11471 | 11465 | 136 | 2 | query_schedule | 0.02 |
| 7 | A 2.5 Flash | 1 | R | 2.8 | 10946 | 0 | 265 | 2 | query_sales | 0.39 |
| 7 | A 2.5 Flash | 2 | R | 3.5 | 10870 | 4347 | 355 | 2 | query_sales | 0.30 |
| 7 | B 3.8 Flash | 1 | P | 12.4 | 14459 | 0 | 1283 | 2 | query_sales | 1.57 (Jan 2027 3.13) |
| 7 | B 3.8 Flash | 2 | P | 12.5 | 14397 | 6836 | 1386 | 2 | query_sales | 1.14 (Jan 2027 2.28) |
| 7 | C 3.1 Flash Lite | 1 | R | 3.1 | 14193 | 5029 | 174 | 2 | query_sales | 0.27 |
| 7 | C 3.1 Flash Lite | 2 | R | 3.2 | 14193 | 11912 | 150 | 2 | query_sales | 0.11 |
| 7 | D GPT-6 Luna | 1 | R | 3.1 | 13168 | 6111 | 151 | 2 | query_sales | 0.08 |
| 7 | D GPT-6 Luna | 2 | R | 3.2 | 13168 | 13162 | 151 | 2 | query_sales | 0.02 |
| 8 | A 2.5 Flash | 1 | P | 4.3 | 11715 | 9815 | 436 | 2 | query_checklists | 0.20 |
| 8 | A 2.5 Flash | 2 | R | 4.1 | 11725 | 0 | 409 | 2 | query_checklists | 0.45 |
| 8 | B 3.8 Flash | 1 | R | 8.5 | 15004 | 3598 | 894 | 2 | query_checklists | 1.22 (Jan 2027 2.44) |
| 8 | B 3.8 Flash | 2 | R | 9.2 | 14983 | 3597 | 881 | 2 | query_checklists | 1.21 (Jan 2027 2.42) |
| 8 | C 3.1 Flash Lite | 1 | P | 2.9 | 14846 | 5386 | 188 | 2 | query_checklists | 0.28 |
| 8 | C 3.1 Flash Lite | 2 | R | 2.8 | 14846 | 5386 | 171 | 2 | query_checklists | 0.28 |
| 8 | D GPT-6 Luna | 1 | R | 2.9 | 13279 | 11133 | 161 | 2 | query_checklists | 0.04 |
| 8 | D GPT-6 Luna | 2 | P | 3.4 | 13279 | 5572 | 153 | 2 | query_checklists | 0.09 |
| 9 | A 2.5 Flash | 1 | W | 3.8 | 14035 | 0 | 331 | 2 | query_labor | 0.50 |
| 9 | A 2.5 Flash | 2 | W | 4.8 | 15390 | 9107 | 465 | 2 | query_labor, query_schedule | 0.33 |
| 9 | B 3.8 Flash | 1 | R | 24.8 | 35279 | 16594 | 3038 | 3 | query_punch_patterns, query_schedule, query_labor, query_callout_patterns | 2.67 (Jan 2027 5.33) |
| 9 | B 3.8 Flash | 2 | R | 24.5 | 35028 | 16701 | 2974 | 3 | query_punch_patterns, query_schedule, query_labor, query_callout_patterns | 2.62 (Jan 2027 5.23) |
| 9 | C 3.1 Flash Lite | 1 | P | 3.2 | 13704 | 5168 | 168 | 2 | query_punch_patterns | 0.25 |
| 9 | C 3.1 Flash Lite | 2 | R | 4.4 | 20977 | 15516 | 297 | 3 | query_punch_patterns, query_punch_patterns | 0.22 |
| 9 | D GPT-6 Luna | 1 | R | 8.3 | 52827 | 40309 | 400 | 5 | query_labor, query_schedule, query_punch_patterns, query_callout_patterns, query_punch_patterns | 0.19 |
| 9 | D GPT-6 Luna | 2 | R | 5.6 | 28935 | 22589 | 286 | 3 | query_labor, query_schedule, query_punch_patterns | 0.10 |
| 10 | A 2.5 Flash | 1 | R | 3.2 | 9351 | 0 | 279 | 2 | query_labor | 0.35 |
| 10 | A 2.5 Flash | 2 | R | 3.1 | 9276 | 11002 | 282 | 2 | query_labor | 0.05 |
| 10 | B 3.8 Flash | 1 | R | 7.4 | 13143 | 3441 | 737 | 2 | query_labor, query_sales | 1.03 (Jan 2027 2.06) |
| 10 | B 3.8 Flash | 2 | R | 7.6 | 13124 | 3440 | 709 | 2 | query_labor, query_sales | 1.02 (Jan 2027 2.04) |
| 10 | C 3.1 Flash Lite | 1 | R | 2.9 | 12851 | 5128 | 245 | 2 | query_labor, query_sales | 0.24 |
| 10 | C 3.1 Flash Lite | 2 | R | 3.0 | 12851 | 10248 | 243 | 2 | query_labor, query_sales | 0.13 |
| 10 | D GPT-6 Luna | 1 | R | 3.2 | 11612 | 5577 | 114 | 2 | query_labor | 0.07 |
| 10 | D GPT-6 Luna | 2 | R | 3.6 | 11612 | 11606 | 91 | 2 | query_labor | 0.02 |
| 11 | A 2.5 Flash | 1 | R | 4.0 | 11640 | 4078 | 437 | 2 | query_labor, query_sales | 0.35 |
| 11 | A 2.5 Flash | 2 | R | 3.9 | 11637 | 0 | 442 | 2 | query_labor, query_sales | 0.46 |
| 11 | B 3.8 Flash | 1 | R | 12.2 | 16472 | 3490 | 1369 | 2 | query_sales, query_labor | 1.51 (Jan 2027 3.03) |
| 11 | B 3.8 Flash | 2 | R | 11.5 | 16341 | 6896 | 1310 | 2 | query_labor, query_sales | 1.25 (Jan 2027 2.50) |
| 11 | C 3.1 Flash Lite | 1 | R | 3.1 | 16131 | 5210 | 215 | 2 | query_sales, query_labor | 0.32 |
| 11 | C 3.1 Flash Lite | 2 | R | 3.1 | 16131 | 13803 | 218 | 2 | query_sales, query_labor | 0.13 |
| 11 | D GPT-6 Luna | 1 | R | 3.3 | 14627 | 5582 | 171 | 2 | query_labor, query_sales | 0.10 |
| 11 | D GPT-6 Luna | 2 | R | 3.3 | 14627 | 14621 | 171 | 2 | query_labor, query_sales | 0.02 |
| 12 | A 2.5 Flash | 1 | R | 2.0 | 4456 | 0 | 104 | 1 | - | 0.16 |
| 12 | A 2.5 Flash | 2 | R | 2.3 | 4456 | 0 | 157 | 1 | - | 0.17 |
| 12 | B 3.8 Flash | 1 | R | 3.3 | 6052 | 0 | 213 | 1 | - | 0.53 (Jan 2027 1.07) |
| 12 | B 3.8 Flash | 2 | R | 3.9 | 6052 | 3412 | 170 | 1 | - | 0.29 (Jan 2027 0.57) |
| 12 | C 3.1 Flash Lite | 1 | R | 1.5 | 6052 | 0 | 57 | 1 | - | 0.16 |
| 12 | C 3.1 Flash Lite | 2 | R | 1.7 | 6052 | 5119 | 54 | 1 | - | 0.04 |
| 12 | D GPT-6 Luna | 1 | R | 3.5 | 12105 | 11131 | 100 | 2 | query_sales | 0.03 |
| 12 | D GPT-6 Luna | 2 | P | 3.1 | 12095 | 11140 | 94 | 2 | query_sales | 0.03 |
| 13 | A 2.5 Flash | 1 | R | 3.2 | 9164 | 4373 | 316 | 2 | query_schedule | 0.24 |
| 13 | A 2.5 Flash | 2 | R | 3.5 | 9157 | 0 | 250 | 2 | query_schedule | 0.34 |
| 13 | B 3.8 Flash | 1 | R | 7.1 | 12491 | 3427 | 650 | 2 | query_schedule | 0.95 (Jan 2027 1.90) |
| 13 | B 3.8 Flash | 2 | R | 8.5 | 12452 | 3424 | 664 | 2 | query_schedule | 0.95 (Jan 2027 1.90) |
| 13 | C 3.1 Flash Lite | 1 | R | 3.6 | 12266 | 5112 | 125 | 2 | query_schedule | 0.21 |
| 13 | C 3.1 Flash Lite | 2 | R | 2.9 | 12266 | 5112 | 115 | 2 | query_schedule | 0.21 |
| 13 | D GPT-6 Luna | 1 | R | 2.8 | 11283 | 5579 | 96 | 2 | query_schedule | 0.07 |
| 13 | D GPT-6 Luna | 2 | R | 2.9 | 11283 | 5579 | 95 | 2 | query_schedule | 0.07 |
| 14 | A 2.5 Flash | 1 | R | 6.2 | 11281 | 4974 | 936 | 2 | query_availability | 0.44 |
| 14 | A 2.5 Flash | 2 | R | 5.8 | 11252 | 4318 | 836 | 2 | query_availability | 0.43 |
| 14 | B 3.8 Flash | 1 | R | 10.3 | 14499 | 3571 | 1088 | 2 | query_availability | 1.25 (Jan 2027 2.51) |
| 14 | B 3.8 Flash | 2 | R | 15.2 | 14718 | 6995 | 1724 | 2 | query_availability | 1.28 (Jan 2027 2.56) |
| 14 | C 3.1 Flash Lite | 1 | R | 3.0 | 14403 | 5350 | 326 | 2 | query_availability | 0.29 |
| 14 | C 3.1 Flash Lite | 2 | R | 3.2 | 14403 | 12254 | 239 | 2 | query_availability | 0.12 |
| 14 | D GPT-6 Luna | 1 | R | 3.4 | 12952 | 5575 | 218 | 2 | query_availability | 0.09 |
| 14 | D GPT-6 Luna | 2 | W | 3.5 | 11550 | 11150 | 156 | 2 | query_availability | 0.02 |
| 15 | A 2.5 Flash | 1 | R | 2.5 | 9094 | 4833 | 191 | 2 | query_tips | 0.19 |
| 15 | A 2.5 Flash | 2 | R | 3.1 | 9069 | 4354 | 224 | 2 | query_tips | 0.21 |
| 15 | B 3.8 Flash | 1 | R | 17.5 | 33945 | 10322 | 1211 | 5 | query_tips, query_tips, query_logbook, query_logbook, query_sales | 2.30 (Jan 2027 4.61) |
| 15 | B 3.8 Flash | 2 | R | 10.9 | 26907 | 3470 | 737 | 4 | query_tips, query_logbook, query_tips, query_sales | 2.06 (Jan 2027 4.12) |
| 15 | C 3.1 Flash Lite | 1 | R | 2.7 | 12188 | 5110 | 140 | 2 | query_tips | 0.21 |
| 15 | C 3.1 Flash Lite | 2 | R | 4.0 | 18722 | 10253 | 203 | 3 | query_tips, query_logbook | 0.27 |
| 15 | D GPT-6 Luna | 1 | R | 6.9 | 29803 | 28898 | 284 | 5 | query_tips, query_tips, query_tips, query_tips | 0.05 |
| 15 | D GPT-6 Luna | 2 | R | 5.6 | 23349 | 16974 | 220 | 4 | query_tips, query_tips, query_tips | 0.09 |
| 16 | A 2.5 Flash | 1 | NS | 5.4 | 10853 | 0 | 465 | 2 | query_ovation_reviews | 0.44 |
| 16 | A 2.5 Flash | 2 | NS | 5.0 | 10869 | 11376 | 546 | 2 | query_ovation_reviews | 0.16 |
| 16 | B 3.8 Flash | 1 | NS | 14.2 | 15807 | 0 | 1540 | 2 | query_ovation_reviews | 1.76 (Jan 2027 3.53) |
| 16 | B 3.8 Flash | 2 | NS | 14.6 | 15844 | 6920 | 1542 | 2 | query_ovation_reviews | 1.30 (Jan 2027 2.60) |
| 16 | C 3.1 Flash Lite | 1 | NS | 4.5 | 13948 | 0 | 200 | 2 | query_ovation_reviews | 0.38 |
| 16 | C 3.1 Flash Lite | 2 | NS | 4.1 | 13948 | 12081 | 248 | 2 | query_ovation_reviews | 0.11 |
| 16 | D GPT-6 Luna | 1 | NS | 4.7 | 14330 | 6109 | 190 | 2 | query_ovation_reviews | 0.10 |
| 16 | D GPT-6 Luna | 2 | NS | 5.3 | 20467 | 18844 | 247 | 3 | query_ovation_reviews, query_schedule | 0.05 |
| 17 | A 2.5 Flash | 1 | R | 3.3 | 8982 | 3869 | 328 | 2 | query_labor | 0.25 |
| 17 | A 2.5 Flash | 2 | P | 2.1 | 4442 | 0 | 162 | 1 | - | 0.17 |
| 17 | B 3.8 Flash | 1 | R | 8.4 | 19330 | 3427 | 810 | 3 | query_labor, query_sales, query_labor | 1.52 (Jan 2027 3.04) |
| 17 | B 3.8 Flash | 2 | R | 8.9 | 19351 | 10258 | 997 | 3 | query_labor, query_sales, query_labor | 1.13 (Jan 2027 2.27) |
| 17 | C 3.1 Flash Lite | 1 | R | 2.6 | 12182 | 5107 | 79 | 2 | query_labor | 0.20 |
| 17 | C 3.1 Flash Lite | 2 | R | 2.7 | 12182 | 10224 | 79 | 2 | query_labor | 0.09 |
| 17 | D GPT-6 Luna | 1 | R | 3.0 | 11284 | 5576 | 81 | 2 | query_labor | 0.07 |
| 17 | D GPT-6 Luna | 2 | R | 3.2 | 11284 | 11278 | 81 | 2 | query_labor | 0.02 |
| 18 | A 2.5 Flash | 1 | R | 3.7 | 10965 | 4717 | 383 | 2 | query_schedule | 0.30 |
| 18 | A 2.5 Flash | 2 | R | 3.5 | 10863 | 4691 | 426 | 2 | query_schedule | 0.31 |
| 18 | B 3.8 Flash | 1 | R | 9.0 | 14325 | 3515 | 785 | 2 | query_schedule | 1.13 (Jan 2027 2.26) |
| 18 | B 3.8 Flash | 2 | R | 8.3 | 14275 | 6987 | 833 | 2 | query_schedule | 0.91 (Jan 2027 1.82) |
| 18 | C 3.1 Flash Lite | 1 | R | 3.1 | 14063 | 5246 | 266 | 2 | query_schedule | 0.27 |
| 18 | C 3.1 Flash Lite | 2 | R | 3.0 | 14063 | 12210 | 266 | 2 | query_schedule | 0.12 |
| 18 | D GPT-6 Luna | 1 | R | 3.6 | 12794 | 6206 | 236 | 2 | query_schedule | 0.08 |
| 18 | D GPT-6 Luna | 2 | R | 3.7 | 12794 | 12788 | 231 | 2 | query_schedule | 0.02 |

R = right, P = partly right, W = wrong, NS = not scored.

## 3. Partly right and wrong runs

**Q3 · A 2.5 Flash · run 1 · P**
- Correct: sales_cache: week goal $20,884.53; week pace 6,653.42 actual + 2,804 today + 10,890 goals = $20,347 (97.4%) -> on track, -$537
- Said: "This week, we're pacing at **$20,347** against a goal of **$20,884**. We're currently **97.4%** of the way there, or **$536 behind goal**."
- What went wrong: Gave pace and goal but no ahead/on track/behind status.

**Q3 · C 3.1 Flash Lite · run 1 · P**
- Correct: sales_cache: week goal $20,884.53; week pace 6,653.42 actual + 2,804 today + 10,890 goals = $20,347 (97.4%) -> on track, -$537
- Said: "We are currently on track for the week.  /  / *   **Week-to-date Sales:** $9,424.92 / *   **Full Week Projection:** $20,883.53 / *   **Status:** On track (97.4% of goal, currently -$536 against our weekly target). /  / We have a strong finish ahead, with tomorrow (Thursday) projected at $3,867. Keep pushing."
- What went wrong: Called tomorrow 'Thursday' (it is Friday) and labelled the week goal $20,883.53 'Full Week Projection'.

**Q7 · B 3.8 Flash · run 1 · P**
- Correct: product_mix Sep 30 by units: Red Sauce 108, Classic Dough 105, Shredded Mozz 90, BYO Pizza 52, Small Drink 44 (first three are $0 modifiers)
- Said: "Here are your top 5 menu items yesterday (Wednesday, 9/30) by units sold: /  / 1. **BYO Pizza** — **52 units** ($648.57) / 2. **Small Drink** — **44 units** ($36.82) / 3. **Buttermilk Ranch Cup** — **27 units** ($25.14) / 4. **Regular Drink** — **21 units** ($52.99) / 5. **2 Top Pizza** — **20 units** ($40.23) /  / *(Honorable mention: **Hot Take** moved 17 units for $166.89).* /  / *(Note: Free modifiers like Red Sauce (108), Classic Dough (105), and Shredded Mozz (90) logged higher raw touchpo"
- What went wrong: Dropped the $0 modifiers and gave a different list (BYO 52, Small Drink 44, Buttermilk Ranch Cup 27, Regular Drink 21, 2 Top Pizza 20). Numbers are real, but not the source's top 5.

**Q7 · B 3.8 Flash · run 2 · P**
- Correct: product_mix Sep 30 by units: Red Sauce 108, Classic Dough 105, Shredded Mozz 90, BYO Pizza 52, Small Drink 44 (first three are $0 modifiers)
- Said: "Here are your top 5 menu items yesterday (Wednesday, Sep 30) by units sold: /  / 1. **BYO Pizza** — **52 units** ($648.57) / 2. **Small Drink** — **44 units** ($36.82) / 3. **Buttermilk Ranch Cup** — **27 units** ($25.14) / 4. **Regular Drink** — **21 units** ($52.99) / 5. **2 Top Pizza** — **20 units** ($40.23) /  / *(Honorable mention on the specialty side: **Hot Take** moved **17 units** for $166.89).* /  / *Note: Filtered out zero-dollar ingredient and modifier selections (like Red Sauce and"
- What went wrong: Same as run 1: menu-items-only list, not the source's top 5.

**Q8 · A 2.5 Flash · run 1 · P**
- Correct: checklist_submissions Oct 1 business day: Opening (Jaysen 9:31 AM), AM Line Check (Jaysen 9:31), Shift Change Line Check (Joshua 3:42 PM), Daily Deep Cleaning (Cheyenne 8:04 PM)
- Said: "Here's a summary of the checklists completed today: /  / *   **Opening Checklist** submitted by Jaysen Robertson at 9:31 AM. / *   **AM Line Check** submitted by Jaysen Robertson at 9:31 AM. / *   **Shift Change Line Check** submitted by Joshua Haro at 3:42 PM. /     *   Walk-In Freezer temp: **-10°** (valid) /     *   Tomatoes temp: **40.8°** (valid) /     *   Meatballs (Flip Cold Pan) temp: **41.2°** (⚠️ invalid) /     *   White Sauce temp: **41°** (valid) /  / Looks like the meatballs were a "
- What went wrong: Left out Daily Deep Cleaning (Cheyenne, 8:04 PM).

**Q8 · C 3.1 Flash Lite · run 1 · P**
- Correct: checklist_submissions Oct 1 business day: Opening (Jaysen 9:31 AM), AM Line Check (Jaysen 9:31), Shift Change Line Check (Joshua 3:42 PM), Daily Deep Cleaning (Cheyenne 8:04 PM)
- Said: "Here are the checklists completed today, 2026-10-01: /  / *   **Opening Checklist** — Completed by Jaysen Robertson. / *   **AM Line Check** — Completed by Jaysen Robertson. / *   **Shift Change Line Check** — Completed by Joshua Haro. ⚠️ Note: The Meatballs temped at **41.2°F**, which was flagged as out of range. / *   **Daily Deep Cleaning** — Completed by Cheyenne Nauretz (submitted early 2026-10-02)."
- What went wrong: Said Deep Cleaning was 'submitted early 2026-10-02'; it was 8:04 PM Oct 1 local.

**Q8 · D GPT-6 Luna · run 2 · P**
- Correct: checklist_submissions Oct 1 business day: Opening (Jaysen 9:31 AM), AM Line Check (Jaysen 9:31), Shift Change Line Check (Joshua 3:42 PM), Daily Deep Cleaning (Cheyenne 8:04 PM)
- Said: "Today, **4 checklists** were submitted: /  / - **Opening Checklist** — Jaysen Robertson / - **AM Line Check** — Jaysen Robertson / - **Shift Change Line Check** — Joshua Haro / - **Daily Deep Cleaning** — Cheyenne Nauretz *(submitted after midnight; no item responses recorded)* /  / The first three show completed checklist items. One shift-change temp needs attention: **meatballs were recorded at 41.2°F and flagged invalid**."
- What went wrong: Said Deep Cleaning was 'submitted after midnight'; it was 8:04 PM local.

**Q9 · A 2.5 Flash · run 1 · W**
- Correct: Published shifts Sep 28-Oct 1 vs first clock-in, Theo's 7-minute grace: nobody late
- Said: "I need to cross-reference with the schedule to accurately determine if anyone was late. One moment."
- What went wrong: Non-answer: 'I need to cross-reference with the schedule... One moment.'

**Q9 · A 2.5 Flash · run 2 · W**
- Correct: Published shifts Sep 28-Oct 1 vs first clock-in, Theo's 7-minute grace: nobody late
- Said: "Here are the team members who clocked in late this week: /  / *   **Desiree Ramos** /     *   2026-10-01: Scheduled 12:00 PM, Clocked in 12:02 PM /  / Looks like Desiree was just a couple of minutes late on Thursday. Keep an eye on it."
- What went wrong: Called Desiree Ramos late for clocking in 2 minutes after start; under the 7-minute grace nobody was late.

**Q9 · C 3.1 Flash Lite · run 1 · P**
- Correct: Published shifts Sep 28-Oct 1 vs first clock-in, Theo's 7-minute grace: nobody late
- Said: "No one has clocked in late this week, but I did catch two instances of team members running over their scheduled out times on Sunday, Sept 28th: /  / *   **Jasper Nilsson-Romero**: 12 minutes over ($4.00 impact) / *   **Cheyenne Nauretz**: 12 minutes over ($4.60 impact) /  / Everything else looks clean for the start of the week."
- What went wrong: Right that nobody was late, but called Sep 28 'Sunday' (it was Monday).

**Q12 · D GPT-6 Luna · run 2 · P**
- Correct: Exact line "Inventory isn't something I can help with yet." and no numbers
- Said: "I can’t see food cost or COGS here. I can pull sales and top items, but inventory and food-cost data isn’t available to me yet."
- What went wrong: No numbers, but not the required line: 'I can't see food cost or COGS here...'

**Q14 · D GPT-6 Luna · run 2 · W**
- Correct: availability_requests pending at Hemet: 17 (5 from Mar/May 2026, 12 upcoming)
- Said: "Yes—**3 pending time-off requests** are waiting: /  / - **Desiree Ramos** — Oct 12 (full day, 8 hrs) / - **Cheyenne Nauretz** — Oct 14–15 (2 days, 16 hrs) / - **Alle Rowe** — Oct 14 (full day, 8 hrs) /  / There’s overlap on **Oct 14** between Cheyenne and Alle."
- What went wrong: Said 3 pending requests; there are 17.

**Q17 · A 2.5 Flash · run 2 · P**
- Correct: get_store_labor Rowlett Sep 26: 0 h / $0 (time clock row) -> no labor data; never 0% or a grade
- Said: "I don't have labor data for September 26th. Labor intelligence reports are generated for the previous day, and I don't see any data for that specific date."
- What went wrong: Right outcome, but called no tool and gave an invented reason ('labor intelligence reports are generated for the previous day').

## 4. Sample answers (run 1, quoted exactly)

**Q2 · A 2.5 Flash**

```text
Today's pace is **$2,804** against a **$2,867** goal. You're currently ON TRACK, trending **-$63** below goal (97.8%).
```

**Q2 · B 3.8 Flash**

```text
You're **on track** to hit goal today, just slightly off the target pace 📊

* **Net Sales So Far:** $2,772 (124 guests)
* **Today's Goal:** $2,867
* **Trending Pace:** $2,804 (**97.8%** of goal)
* **Gap to Goal:** -$63

With sales already sitting at **$2,772**, a couple more rings through the pass will push you right over the finish line.
```

**Q2 · C 3.1 Flash Lite**

```text
Today is currently **ON TRACK** to hit your goal. 

*   **Today's Goal:** $2,867
*   **Current Pace:** $2,804 

You're trending just about **$63 behind** goal, but still well within striking distance. Keep pushing through the evening. 📈
```

**Q2 · D GPT-6 Luna**

```text
You’re **on track**, but just shy of goal pace: you’re trending to finish at **$2,804** against a **$2,867** goal — a **$63 gap**.
```

**Q5 · A 2.5 Flash**

```text
Here's who's scheduled for tomorrow, October 2nd:

*   **Jaysen Robertson** — Dough
    9:00 AM – 3:00 PM
*   **Alle Rowe** — AM Manager
    9:00 AM – 4:00 PM
*   **Desiree Ramos** — Mid-Shift
    12:00 PM – 8:00 PM
*   **Cheyenne Nauretz** — PM Manager
    3:30 PM – 11:00 PM
*   **Janessa Hinojosa** — Prep
    4:00 PM – 11:00 PM
*   **Jasper Nilsson-Romero** — PM Line
    5:00 PM – 11:00 PM
*   **Ryan Lorenzo Cuen** — PM Line 3
    5:30 PM – 9:30 PM
```

**Q5 · B 3.8 Flash**

```text
Here is the schedule for tomorrow (Friday, 10/02):

**Jaysen Robertson** — Dough
9:00 AM – 3:00 PM

**Alle Rowe** — AM Manager
9:00 AM – 4:00 PM

**Desiree Ramos** — Mid-Shift
12:00 PM – 8:00 PM

**Cheyenne Nauretz** — PM Manager
3:30 PM – 11:00 PM

**Janessa Hinojosa** — Prep
4:00 PM – 11:00 PM

**Jasper Nilsson-Romero** — PM Line
5:00 PM – 11:00 PM

**Ryan Lorenzo Cuen** — PM Line 3
5:30 PM – 9:30 PM

7 shifts scheduled to support a projected **$3,867** Friday. The PM rush is well-covered with staggered ins starting at 3:30 PM.
```

**Q5 · C 3.1 Flash Lite**

```text
Here’s who is scheduled for tomorrow, October 2nd:

**Alle Rowe** — AM Manager
9:00 AM – 4:00 PM

**Jaysen Robertson** — Dough
9:00 AM – 3:00 PM

**Desiree Ramos** — Mid-Shift
12:00 PM – 8:00 PM

**Cheyenne Nauretz** — PM Manager
3:30 PM – 11:00 PM

**Janessa Hinojosa** — Prep
4:00 PM – 11:00 PM

**Jasper Nilsson-Romero** — PM Line
5:00 PM – 11:00 PM

**Ryan Lorenzo Cuen** — PM Line 3
5:30 PM – 9:30 PM
```

**Q5 · D GPT-6 Luna**

```text
Tomorrow’s published schedule:

**Jaysen Robertson** — Dough  
9:00 AM – 3:00 PM

**Alle Rowe** — AM Manager  
9:00 AM – 4:00 PM

**Desiree Ramos** — Mid-Shift  
12:00 PM – 8:00 PM

**Cheyenne Nauretz** — PM Manager  
3:30 PM – 11:00 PM

**Janessa Hinojosa** — Prep  
4:00 PM – 11:00 PM

**Jasper Nilsson-Romero** — PM Line  
5:00 PM – 11:00 PM

**Ryan Lorenzo Cuen** — PM Line 3  
5:30 PM – 9:30 PM

That’s **7 shifts** on the board.
```

**Q11 · A 2.5 Flash**

```text
Last week, Monday, **2026-09-21**, had the highest labor percent at **41.98%**. Net sales for that day were **$1,793.35**.
```

**Q11 · B 3.8 Flash**

```text
Last week's worst labor day was **Monday, September 21**:

* **Labor:** **42.0%** ($752.93 | 34.1 hrs)
* **Net Sales:** **$1,793.35** (Goal: $2,618.00 — missed by -$824.65)
* **Guests:** 90 (Avg Ticket: $19.93)

Sales dropped significantly below the $2,618 target while scheduled hours stayed relatively flat at 34.1, causing labor to spike over 40%. Tuesday wasn't far behind at **39.4%** on $2,040.28 in sales.
```

**Q11 · C 3.1 Flash Lite**

```text
Last week, the worst labor percentage was on **Monday, September 21**, at **41.98%**.

Sales for that day were **$1,793.35**.
```

**Q11 · D GPT-6 Luna**

```text
**Monday, September 21** had the worst labor at **42.0%**. Sales were **$1,793.35**.
```

## Correct answers used

- Q1 (Hemet): What's my labor today? → get_store_labor (live) 04:19Z: 32.59 h, $725.30, 26.2% on $2,771.50
- Q2 (Hemet): Am I on pace to hit my sales goal today? → sales_cache 04:18Z: sales $2,771.50, goal $2,867, pace $2,804 = 97.8% -> on track, -$63
- Q3 (Hemet): Are we on pace for the week? → sales_cache: week goal $20,884.53; week pace 6,653.42 actual + 2,804 today + 10,890 goals = $20,347 (97.4%) -> on track, -$537
- Q4 (Hemet): How did we do yesterday against goal? → Sep 30: $2,259.77 vs goal $2,748 = -$488.23 (-17.8%)
- Q5 (Hemet): Who's working tomorrow? → Published Oct 2: Jaysen 9-3, Alle 9-4, Desiree 12-8, Cheyenne 3:30-11, Janessa 4-11, Jasper 5-11, Ryan 5:30-9:30 (7)
- Q6 (Hemet): Who closes tonight? → Published Oct 1 closers (to 11 PM): Joshua Haro, Cheyenne Nauretz, Nicole Mendez
- Q7 (Hemet): What were my top 5 items yesterday by units? → product_mix Sep 30 by units: Red Sauce 108, Classic Dough 105, Shredded Mozz 90, BYO Pizza 52, Small Drink 44 (first three are $0 modifiers)
- Q8 (Hemet): What checklists were done today? → checklist_submissions Oct 1 business day: Opening (Jaysen 9:31 AM), AM Line Check (Jaysen 9:31), Shift Change Line Check (Joshua 3:42 PM), Daily Deep Cleaning (Cheyenne 8:04 PM)
- Q9 (Hemet): Was anyone late this week? → Published shifts Sep 28-Oct 1 vs first clock-in, Theo's 7-minute grace: nobody late
- Q10 (Hemet): What was labor percent last Saturday, and how many hours? → get_store_labor Sep 26: 20.79%, 35.09 h ($736.41 on $3,542.70)
- Q11 (Hemet): Which day last week had the worst labor percent, and what were sales that day? → get_store_labor Sep 21-27: worst Mon Sep 21 at 42.0%, sales $1,793.35
- Q12 (Hemet): What's my food cost? → Exact line "Inventory isn't something I can help with yet." and no numbers
- Q13 (Palm Springs): What does next week's schedule look like? → Palm Springs Oct 5-11: no published schedule; 45 draft shifts
- Q14 (Hemet): Are there any time-off requests waiting on me? → availability_requests pending at Hemet: 17 (5 from Mar/May 2026, 12 upcoming)
- Q15 (Hemet): What were tips yesterday? → daily_tips Sep 30: no row -> no tip data
- Q16 (Hemet): What are guests saying in reviews this week? → Ovation API (external): not independently read
- Q17 (Rowlett): What was labor on September 26? → get_store_labor Rowlett Sep 26: 0 h / $0 (time clock row) -> no labor data; never 0% or a grade
- Q18 (Hemet): Who's working tomorrow?

(Voice mode: answer the whole question. If the answer i → Same 7 people and times as Q5, compact, no table

## 5. Tested and not tested

- **Tested:** all 18 questions, all four models, two runs each (144 calls), through Theo's real system prompt, tools, data and tool loop. Only the model changed.
- **Q16 (reviews) not scored:** the reviews come from Ovation, an outside service I can't read independently. The models also disagreed with each other: 6 reviews averaging 3.83, 8 averaging 3.50, 8 averaging 4.13, or 24 averaging 3.83 over 7 days. That suggests they read different windows from the same tool result.
- **Q7 judgement:** the source's top 5 by units includes $0 modifiers (Red Sauce, Classic Dough, Shredded Mozz). Lists matching the source were scored right. B's menu-items-only list was scored partly right, even though its numbers are real.
- **Q9 truth:** first clock-in compared with published shift start, using Theo's 7-minute grace, which is the default in his punch tool.
- **Q13:** run at Palm Springs, whose Oct 5–11 week is draft only (45 shifts). Run as a super admin, so the draft count was expected.
- **Timing:** the four models ran at the same moment rather than one after another. Live numbers moved slightly between round 1 and round 2; for example, labor was $725.30 in round 1 and $725.46 in round 2.
- **Voice (Q18):** tested as text with the exact voice suffix added. Not tested as spoken audio.
- **Prompt tokens:** these differ by model for the same prompt (A about 4,460, B/C about 6,050, D about 5,580) because each model counts tokens differently.
- **D (GPT-6 Luna):** on this endpoint it only accepts tools with reasoning switched off, so its bake-off calls sent `reasoning_effort: "none"`. Nothing else in the request was different.
- **Not tested:** non-Hemet stores beyond Q13 and Q17, typed chat through the app's own screen, and any non-super-admin account (see section 6).

## 6. Code changed for the test

- `supabase/functions/ai-assistant/index.ts`: a temporary bake-off switch. A model override is honored only when the caller's role is super_admin, the request says `source: "bakeoff"`, and the model is one of the four ids. Otherwise it is ignored, and the default stays `model: bakeModel ?? "google/gemini-2.5-flash"`.
  - Bake-off calls return their token counts, cached tokens, round trips and tools used, then stop before the usage insert, so they write nothing to `theo_ai_usage`.
  - `ai-assistant` never writes `theo_chat_messages`; the chat screen saves messages, and the test didn't use the screen.
  - For GPT-6 Luna only, the switch adds `reasoning_effort: "none"`.
- **Still there:** yes, deployed. Remove it once Jordan decides.
