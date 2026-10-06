# Shell's Shift Diary 💖

A cute little app for tracking shifts, hours and pay — so you never get underpaid.

**Open it:** https://sfxhewitt.github.io/shells-hours-calculator/

## What it does

- 💅 **Clock in / clock out** with a live timer, or add shifts by hand (overnight shifts work too)
- 💸 **Works out your pay** from your hourly rate, unpaid breaks and overtime/Sunday/bank-holiday multipliers
- 🗓️ **Weekly and pay-period totals** (weekly, fortnightly, 4-weekly or monthly)
- 🔍 **Payslip checker** — type in the hours and basic pay from your payslip and it tells you if you've been short-changed, and by how much
- 👑 **Minimum wage check** against the UK rates from April 2026
- 🌴 **Holiday earned** at 12.07% of hours worked
- ⬇️ **Download as a spreadsheet** (CSV) to show your manager, plus backup/restore
- 🌙 Pastel pink or midnight glam theme, works offline

## Putting it on your phone

Open the link above, then:
- **iPhone (Safari):** Share button → *Add to Home Screen*
- **Android (Chrome):** ⋮ menu → *Add to Home screen* / *Install app*

Your shifts are saved on your phone only (nothing is uploaded anywhere), so use **Settings → Download backup** every now and then.

## Development

It's plain HTML/CSS/JS — no build step. Run `npx http-server .` and open http://localhost:8080.
Pushing to `main` deploys to GitHub Pages via `.github/workflows/pages.yml`.
