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

const axis = { fill: '#8A8A93', fontSize: 11, fontFamily: 'Inter, system-ui, sans-serif' };
const tooltipStyle = {
  background: '#1C1C1F',
  border: '1px solid #2A2A2F',
  borderRadius: 12,
  fontSize: 12,
  color: '#F5F5F2',
};

export function WeeklyDistanceChart({ data }) {
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} stroke="#2A2A2F" />
          <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
          <YAxis tick={axis} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ fill: 'rgba(245,245,242,0.06)' }}
            formatter={(value) => [`${Number(value).toFixed(1)} mi`, 'Distance']}
            labelStyle={{ color: '#8A8A93', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em' }}
          />
          <Bar dataKey="miles" fill="#C6FF00" radius={[5, 5, 0, 0]} maxBarSize={26} />
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
          <CartesianGrid vertical={false} stroke="#2A2A2F" />
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
            labelStyle={{ color: '#8A8A93', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.14em' }}
          />
          <Line
            type="monotone"
            dataKey="pace"
            stroke="#C6FF00"
            strokeWidth={2}
            dot={{ r: 3, fill: '#0B0B0C', stroke: '#C6FF00', strokeWidth: 2 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}