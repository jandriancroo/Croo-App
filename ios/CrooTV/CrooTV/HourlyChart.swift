import SwiftUI

/// Sales by hour: gray projected bars, white actual bars, orange stepped labor % line,
/// dashed teal labor goal line, sales dollars on the left and labor % on the right.
/// Same idea as the tall widget chart.
struct HourlyChart: View {
    let hours: [TVHourly]
    let laborGoal: Double?

    private func niceCeil(_ v: Double) -> Double {
        let raw = max(v, 1) / 4
        let mag = pow(10, floor(log10(raw)))
        for m in [1.0, 2.0, 2.5, 5.0, 10.0] where m * mag >= raw { return m * mag * 4 }
        return 10 * mag * 4
    }

    var body: some View {
        Canvas { ctx, size in
            guard !hours.isEmpty else { return }
            let leftPad: CGFloat = 76, rightPad: CGFloat = 70, topPad: CGFloat = 14, bottomPad: CGFloat = 40
            let plotW = size.width - leftPad - rightPad
            let plotH = size.height - topPad - bottomPad
            let n = CGFloat(hours.count)
            let slot = plotW / n
            let barW = min(slot * 0.7, 56)

            let salesMax = niceCeil(hours.map { max($0.sales ?? 0, $0.projected ?? 0) }.max() ?? 1)
            let laborVals = hours.compactMap { $0.laborPercent }.filter { $0 > 0 }
            let laborMax = niceCeil(max(laborVals.max() ?? 0, laborGoal ?? 0, 10))

            func ySales(_ v: Double) -> CGFloat { topPad + plotH * (1 - CGFloat(v / salesMax)) }
            func yLabor(_ v: Double) -> CGFloat { topPad + plotH * (1 - CGFloat(v / laborMax)) }

            // grid + both axes
            for i in 0...4 {
                let frac = Double(i) / 4
                let y = topPad + plotH * (1 - CGFloat(frac))
                var line = Path()
                line.move(to: CGPoint(x: leftPad, y: y))
                line.addLine(to: CGPoint(x: leftPad + plotW, y: y))
                ctx.stroke(line, with: .color(TVColor.grid), lineWidth: 1.5)
                ctx.draw(Text(TVFormat.axisMoney(salesMax * frac)).font(.system(size: 20, weight: .semibold)).foregroundColor(TVColor.muted),
                         at: CGPoint(x: leftPad - 10, y: y), anchor: .trailing)
                ctx.draw(Text(String(format: "%.0f%%", laborMax * frac)).font(.system(size: 20, weight: .semibold)).foregroundColor(TVColor.orange),
                         at: CGPoint(x: leftPad + plotW + 10, y: y), anchor: .leading)
            }

            let nowHour = Calendar.current.component(.hour, from: Date())

            // bars
            for (i, h) in hours.enumerated() {
                let cx = leftPad + slot * (CGFloat(i) + 0.5)
                let x = cx - barW / 2
                if let p = h.projected, p > 0 {
                    let y = ySales(p)
                    ctx.fill(Path(roundedRect: CGRect(x: x, y: y, width: barW, height: topPad + plotH - y), cornerRadius: 6), with: .color(TVColor.bar))
                }
                if let s = h.sales, s > 0 {
                    let y = ySales(s)
                    let opacity = (h.hour ?? -1) == nowHour ? 0.7 : 1.0
                    ctx.fill(Path(roundedRect: CGRect(x: x, y: y, width: barW, height: topPad + plotH - y), cornerRadius: 6), with: .color(Color.white.opacity(opacity)))
                }
                if let hr = h.hour {
                    ctx.draw(Text(TVFormat.hourLabel(hr)).font(.system(size: 20, weight: hr == nowHour ? .heavy : .semibold))
                                .foregroundColor(hr == nowHour ? .white : TVColor.muted),
                             at: CGPoint(x: cx, y: size.height - 16), anchor: .center)
                }
            }

            // goal line
            if let g = laborGoal, g > 0 {
                var goal = Path()
                goal.move(to: CGPoint(x: leftPad, y: yLabor(g)))
                goal.addLine(to: CGPoint(x: leftPad + plotW, y: yLabor(g)))
                ctx.stroke(goal, with: .color(TVColor.teal), style: StrokeStyle(lineWidth: 3, dash: [10, 8]))
            }

            // labor line (stepped, one level per hour)
            var path = Path()
            var started = false
            var dots: [CGPoint] = []
            for (i, h) in hours.enumerated() {
                guard let l = h.laborPercent, l > 0 else { continue }
                let x0 = leftPad + slot * CGFloat(i)
                let y = yLabor(l)
                if !started { path.move(to: CGPoint(x: x0, y: y)); started = true }
                else { path.addLine(to: CGPoint(x: x0, y: y)) }
                path.addLine(to: CGPoint(x: x0 + slot, y: y))
                dots.append(CGPoint(x: x0 + slot / 2, y: y))
            }
            ctx.stroke(path, with: .color(TVColor.orange), style: StrokeStyle(lineWidth: 5, lineJoin: .round))
            for d in dots {
                let r: CGFloat = 8
                let dot = Path(ellipseIn: CGRect(x: d.x - r, y: d.y - r, width: r * 2, height: r * 2))
                ctx.fill(dot, with: .color(TVColor.orange))
                ctx.stroke(dot, with: .color(TVColor.card), lineWidth: 3)
            }
        }
    }
}
