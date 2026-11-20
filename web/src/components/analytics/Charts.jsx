import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatPace } from '@/lib/format';

const axis = { fill: 'hsl(60 7% 62%)', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' };
const tooltipStyle = {
  background: '#16170F',
  border: '1px solid #2A2A22',
  borderRadius: 12,
  fontSize: 12,
  color: '#F2F2EC',
};

export function WeeklyDistanceChart({ data }) {
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} stroke="#22231B" />
          <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
          <YAxis tick={axis} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ fill: 'rgba(201,248,74,0.06)' }}
            formatter={(value) => [`${Number(value).toFixed(1)} mi`, 'Distance']}
            labelStyle={{ color: '#9A9A8C', fontSize: 10, textTransform: 'uppercase' }}
          />
          <Bar dataKey="miles" fill="#C9F84A" radius={[5, 5, 0, 0]} maxBarSize={26} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PaceTrendChart({ data }) {
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="#22231B" />
          <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
          <YAxis
            tick={axis}
            axisLine={false}
            tickLine={false}
            width={44}
            reversed
            domain={['dataMin - 20', 'dataMax + 20']}
            tickFormatter={(v) => formatPace(v)}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value) => [`${formatPace(value)} /mi`, 'Avg pace']}
            labelStyle={{ color: '#9A9A8C', fontSize: 10, textTransform: 'uppercase' }}
          />
          <Line
            type="monotone"
            dataKey="pace"
            stroke="#C9F84A"
            strokeWidth={2}
            dot={{ r: 3, fill: '#0C0C0A', stroke: '#C9F84A', strokeWidth: 2 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}