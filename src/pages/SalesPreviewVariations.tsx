import { ChevronLeft, ChevronRight } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts';

const chartData = [
  { time: '11:00 AM', projected: 150, actual: 180 },
  { time: '1:00 PM', projected: 200, actual: 190 },
  { time: '3:00 PM', projected: 250, actual: 280 },
  { time: '5:00 PM', projected: 380, actual: 400 },
  { time: '7:00 PM', projected: 320, actual: 380 },
  { time: '9:00 PM', projected: 220, actual: 200 },
];

const colorSchemes = [
  {
    name: 'Current (Orange/Teal)',
    header: 'bg-[#4a9ba7]',
    hero: 'bg-[#ee7a3a]',
    labor: 'bg-[#4a9ba7]',
    chartLine: '#4a9ba7',
    chartArea: 'rgba(74, 155, 167, 0.1)',
  },
  {
    name: 'Purple/Lavender',
    header: 'bg-[#6b5b95]',
    hero: 'bg-[#a569bd]',
    labor: 'bg-[#6b5b95]',
    chartLine: '#6b5b95',
    chartArea: 'rgba(107, 91, 149, 0.1)',
  },
  {
    name: 'Emerald/Rose',
    header: 'bg-[#2d6a4f]',
    hero: 'bg-[#e63946]',
    labor: 'bg-[#2d6a4f]',
    chartLine: '#2d6a4f',
    chartArea: 'rgba(45, 106, 79, 0.1)',
  },
  {
    name: 'Deep Blue/Coral',
    header: 'bg-[#1e3a5f]',
    hero: 'bg-[#ff6b6b]',
    labor: 'bg-[#1e3a5f]',
    chartLine: '#1e3a5f',
    chartArea: 'rgba(30, 58, 95, 0.1)',
  },
  {
    name: 'Navy/Gold',
    header: 'bg-[#0f3460]',
    hero: 'bg-[#f4a261]',
    labor: 'bg-[#0f3460]',
    chartLine: '#0f3460',
    chartArea: 'rgba(15, 52, 96, 0.1)',
  },
];

function ColorVariation({ scheme, index }: { scheme: typeof colorSchemes[0]; index: number }) {
  return (
    <div key={index} className="bg-white rounded-2xl p-8 space-y-6">
      <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">{scheme.name}</h3>

      {/* Header Bar */}
      <div className={`${scheme.header} rounded-xl px-6 py-4 flex items-center justify-between text-white`}>
        <ChevronLeft className="w-6 h-6" />
        <div className="bg-white/20 rounded-lg px-6 py-2 font-semibold text-base">Today</div>
        <ChevronRight className="w-6 h-6" />
      </div>

      {/* Hero Tile */}
      <div className={`${scheme.hero} rounded-2xl p-6 text-white space-y-4`}>
        <div className="text-sm font-semibold opacity-90 uppercase tracking-wide">Today's Sales</div>
        <div className="text-3xl font-bold">—</div>
        <div className="flex justify-between items-start">
          <div />
          <div className="text-right space-y-1">
            <div className="text-xs opacity-75 uppercase tracking-wide">Goal</div>
            <div className="text-3xl font-bold">$3,800</div>
            <div className="text-xs opacity-75 uppercase tracking-wide mt-3">Pace</div>
            <div className="text-3xl font-bold">$3,800</div>
          </div>
        </div>
      </div>

      {/* Labor Strip */}
      <div className={`${scheme.labor} rounded-lg px-6 py-3 text-white flex items-center justify-center gap-2 text-sm font-medium`}>
        <span className="font-semibold">0.0%</span>
        <span className="opacity-75">Labor %</span>
      </div>

      {/* Chart */}
      <div className="bg-gray-50 rounded-lg p-6 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id={`gradient-${index}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={scheme.chartLine} stopOpacity={0.2}/>
                <stop offset="95%" stopColor={scheme.chartLine} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis 
              dataKey="time" 
              tick={{ fontSize: 12 }}
              tickLine={false}
            />
            <YAxis 
              tick={{ fontSize: 12 }}
              tickLine={false}
            />
            <Tooltip 
              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}
            />
            <Area 
              type="monotone" 
              dataKey="projected" 
              stroke={scheme.chartLine} 
              fill={`url(#gradient-${index})`}
              isAnimationActive={false}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function SalesPreviewVariations() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Sales Summary Color Variations</h1>
          <p className="text-gray-600">5 different color schemes with the same layout</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {colorSchemes.map((scheme, index) => (
            <ColorVariation key={index} scheme={scheme} index={index} />
          ))}
        </div>

        <div className="bg-white rounded-2xl p-8 mt-12">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Notes:</h2>
          <ul className="space-y-2 text-gray-700 text-sm">
            <li>• <strong>Current (Orange/Teal):</strong> Warm orange hero with cool teal accents</li>
            <li>• <strong>Purple/Lavender:</strong> Cohesive purple family, softer aesthetic</li>
            <li>• <strong>Emerald/Rose:</strong> Natural green with bold rose accent</li>
            <li>• <strong>Deep Blue/Coral:</strong> Professional dark blue with vibrant coral</li>
            <li>• <strong>Navy/Gold:</strong> Classic luxury pairing with sophisticated feel</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
