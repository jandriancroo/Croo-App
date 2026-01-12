# Sales Projections & Pace Calculations

Simple guide to how CrooHQ calculates sales numbers.

---

## 📊 PROJECTIONS (Goals/Targets)

### Hourly Projection
**What it answers:** "How much should we sell this hour?"

**Formula:**
1. Look at the last 4 same day-of-week (e.g., last 4 Sundays)
2. Calculate what % of daily sales happened each hour
3. Blend with last year's same day hourly %
4. Apply that % to today's daily projection

**Example:** If 2-3pm is typically 8% of Sunday sales, and today's goal is $5,000 → Hourly projection = $400

---

### Daily Projection (Target EOD)
**What it answers:** "What's our sales goal for today?"

**Formula:**
```
(Last 4 Weeks Same Day Average + Last Year Same Day) ÷ 2
```

**Holiday Handling:**
- If today is a holiday → Use last year's same holiday
- If last year's same day was a holiday → Skip it, use week before

---

### Weekly Projection (Target EOW)
**What it answers:** "What's our sales goal for this week?"

**Formula:**
```
Sum of all 7 daily projections (Mon-Sun)
```

---

### Monthly Projection (Target EOM)
**What it answers:** "What's our sales goal for this month?"

**Formula:**
```
Sum of all daily projections for the month
```

---

## 🏃 PACE (Where We're Trending)

### Daily Pace (Today's Paced Finish)
**What it answers:** "Based on today so far, where will we end up?"

**Formula:**
```
Actual Sales So Far + Remaining Hours Projected
```

**Example:** 
- It's 2pm, we've sold $2,000
- Remaining hours (2pm-close) project $1,500
- Daily Pace = $3,500

---

### Weekly Pace
**What it answers:** "Based on this week so far, where will we end up?"

**Formula:**
```
Past Days Actual Sales + Today's Paced Finish + Future Days Projections
```

**Example (Wednesday):**
- Mon actual: $4,000
- Tue actual: $4,200
- Wed (today) paced finish: $3,800
- Thu-Sun projections: $18,000
- Weekly Pace = $30,000

**Last Day of Week:** Uses today's paced finish (actuals + remaining hourly projections)

---

### Monthly Pace
**What it answers:** "Based on this month so far, where will we end up?"

**Formula:**
```
Past Days Actual Sales + Today's Paced Finish + Future Days Projections
```

**Same logic as weekly**, just for the whole month.

---

## 🎯 DELTA (Ahead/Behind)

**Formula:**
```
Pace - Projection = Delta
```

- **Positive delta** = Ahead of goal ✅
- **Negative delta** = Behind goal ⚠️

---

## 📅 Holiday Logic

1. **Matching holidays:** Compare to last year's same holiday, not same calendar date
2. **Skip holidays:** When calculating averages, skip dates that were holidays
3. **Recurring holidays:** Thanksgiving, Christmas, etc. match by holiday name

---

## ⏰ Real-Time Updates

- **Hourly sales** update every sync (via QuBeyond integration)
- **Daily Pace** recalculates as new hourly data comes in
- **Weekly/Monthly Pace** update because they include today's daily pace
