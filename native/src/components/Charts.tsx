/** The two Analytics charts, drawn with plain views: no chart library. Brand colours only:
 * Volt series, Line gridlines, Steel axis labels. Tapping a bar or a point shows its value
 * underneath, where the website shows a tooltip.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { barHeight, distanceAxis, lineSegments, paceAxis, plotPace, type PacePoint, type WeekBar } from '../run/analytics';
import { formatPace } from '../run/zones';
import { colors } from '../theme';
import { fonts, type } from '../typography';

const PLOT_HEIGHT = 160;
const AXIS_WIDTH = 40;
const LABEL_WIDTH = 56;
/** Room either side of the pace line so the first and last dots are not cut off. */
const INSET = 8;
const DOT = 10;

function usePlotWidth(): [number, (event: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  return [width, (event) => setWidth(Math.round(event.nativeEvent.layout.width))];
}

/** Axis values down the left edge, each centred on its gridline. */
function AxisLabels({ ticks }: { ticks: { y: number; text: string }[] }) {
  return <View style={styles.axis}>
    {ticks.map((tick) => <Text key={tick.text} style={[styles.axisText, styles.axisValue, { top: tick.y - 7 }]} numberOfLines={1}>{tick.text}</Text>)}
  </View>;
}

function Gridlines({ ys }: { ys: number[] }) {
  return <>{ys.map((y) => <View key={y} style={[styles.gridline, { top: y }]} />)}</>;
}

/** Date labels under the plot, centred on `x` and kept inside its edges. */
function DateLabels({ items, width }: { items: { x: number; text: string }[]; width: number }) {
  return <View style={styles.dates}>
    {width > 0 && items.map((item) => <Text key={`${item.x}-${item.text}`} numberOfLines={1}
      style={[styles.axisText, styles.date, { left: Math.max(0, Math.min(width - LABEL_WIDTH, item.x - LABEL_WIDTH / 2)) }]}>{item.text}</Text>)}
  </View>;
}

export function WeeklyDistanceChart({ data }: { data: WeekBar[] }) {
  const [width, onLayout] = usePlotWidth();
  const [picked, setPicked] = useState(data.length - 1);
  const axis = distanceAxis(data.map((week) => week.miles));
  const slot = data.length ? width / data.length : 0;
  const barWidth = Math.max(4, Math.min(26, Math.round(slot * 0.6)));
  const chosen = Math.max(0, Math.min(picked, data.length - 1));
  const shown = data[chosen];
  const ys = axis.ticks.map((tick) => PLOT_HEIGHT - (tick / axis.max) * PLOT_HEIGHT);

  return <View style={styles.chart}>
    <View style={styles.row}>
      <AxisLabels ticks={axis.ticks.map((tick, index) => ({ y: ys[index], text: String(tick) }))} />
      <View style={styles.plot} onLayout={onLayout}>
        <Gridlines ys={ys} />
        {width > 0 && data.map((week, index) => <Pressable key={week.label} accessibilityRole="button"
          accessibilityLabel={`Week of ${week.label}: ${week.miles.toFixed(1)} miles`} accessibilityState={{ selected: index === chosen }}
          onPress={() => setPicked(index)}
          style={[styles.column, { left: index * slot, width: slot }, index === chosen && styles.columnPicked]}>
          <View style={[styles.bar, { width: barWidth, height: barHeight(week.miles, axis.max, PLOT_HEIGHT) }]} />
        </Pressable>)}
      </View>
    </View>
    <View style={styles.datesRow}>
      {/* Every other week is named, ending with this week, so the dates never run into each other. */}
      <DateLabels width={width} items={data.flatMap((week, index) => ((data.length - 1 - index) % 2 === 0 ? [{ x: index * slot + slot / 2, text: week.label }] : []))} />
    </View>
    {!!shown && <Text style={styles.readout}>
      Week of {shown.label} · <Text style={styles.readoutValue}>{shown.miles.toFixed(1)} mi</Text>
    </Text>}
  </View>;
}

/** Average pace per run, oldest to newest. The axis is reversed: faster is higher. */
export function PaceTrendChart({ data }: { data: PacePoint[] }) {
  const [width, onLayout] = usePlotWidth();
  const [picked, setPicked] = useState(data.length - 1);
  if (!data.length) return null;
  const axis = paceAxis(data);
  const inner = Math.max(0, width - INSET * 2);
  const points = plotPace(data, inner, PLOT_HEIGHT).map((point) => ({ x: point.x + INSET, y: point.y }));
  const chosen = Math.max(0, Math.min(picked, data.length - 1));
  const shown = data[chosen];
  const ys = axis.ticks.map((tick) => ((tick - axis.top) / (axis.bottom - axis.top)) * PLOT_HEIGHT);
  const touch = Math.max(24, data.length > 1 ? inner / (data.length - 1) : inner);
  const named = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])];

  return <View style={styles.chart}>
    <View style={styles.row}>
      <AxisLabels ticks={axis.ticks.map((tick, index) => ({ y: ys[index], text: formatPace(tick) }))} />
      <View style={styles.plot} onLayout={onLayout}>
        <Gridlines ys={ys} />
        {lineSegments(points).map((segment, index) => <View key={`line-${index}`} style={[styles.segment, {
          left: segment.cx - segment.length / 2, top: segment.cy - 1, width: segment.length, transform: [{ rotate: `${segment.angleDeg}deg` }],
        }]} />)}
        {points.map((point, index) => <View key={`dot-${index}`}
          style={[styles.dot, { left: point.x - DOT / 2, top: point.y - DOT / 2 }, index === chosen && styles.dotPicked]} />)}
        {points.map((point, index) => <Pressable key={`touch-${index}`} accessibilityRole="button"
          accessibilityLabel={`${data[index].label}: ${formatPace(data[index].pace)} per mile`} accessibilityState={{ selected: index === chosen }}
          onPress={() => setPicked(index)} style={[styles.touch, { left: point.x - touch / 2, width: touch }]} />)}
      </View>
    </View>
    <View style={styles.datesRow}>
      <DateLabels width={width} items={points.length ? named.map((index) => ({ x: points[index].x, text: data[index].label })) : []} />
    </View>
    {!!shown && <Text style={styles.readout}>
      {shown.label} · <Text style={styles.readoutValue}>{formatPace(shown.pace)} /mi</Text>
    </Text>}
  </View>;
}

const styles = StyleSheet.create({
  chart: { marginTop: 10 },
  row: { flexDirection: 'row' },
  axis: { width: AXIS_WIDTH, height: PLOT_HEIGHT },
  axisText: { fontFamily: fonts.body, fontSize: 11, lineHeight: 14, color: colors.subtle },
  axisValue: { position: 'absolute', left: 0, right: 8, textAlign: 'right' },
  plot: { flex: 1, height: PLOT_HEIGHT },
  gridline: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: colors.panelBorder },
  column: { position: 'absolute', top: 0, bottom: 0, alignItems: 'center', justifyContent: 'flex-end' },
  columnPicked: { backgroundColor: 'rgba(245, 245, 242, 0.06)' },
  bar: { backgroundColor: colors.accent, borderTopLeftRadius: 5, borderTopRightRadius: 5 },
  segment: { position: 'absolute', height: 2, borderRadius: 1, backgroundColor: colors.accent },
  dot: { position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2, borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.background },
  dotPicked: { backgroundColor: colors.accent },
  touch: { position: 'absolute', top: 0, bottom: 0 },
  datesRow: { marginLeft: AXIS_WIDTH, marginTop: 6 },
  dates: { height: 16 },
  date: { position: 'absolute', top: 0, width: LABEL_WIDTH, textAlign: 'center' },
  readout: { ...type.small, marginTop: 10 },
  readoutValue: { fontFamily: fonts.bodyStrong, color: colors.text },
});
