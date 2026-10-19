import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { useElementWidth } from "../hooks.ts";
import { drawPath, fadeIn } from "../motion.ts";

interface ValueChartProps {
  values: number[];
  labels: string[];
  /** Formats a hovered or current value. */
  format: (value: number) => string;
  /** Formats axis ticks; defaults to `format`. */
  formatTick?: (value: number) => string;
  /** Accessible description of what the chart shows. */
  label: string;
  height?: number;
}

const PAD = { top: 14, right: 64, bottom: 26, left: 4 };

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1;
  const rough = span / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? rough;
  const ticks: number[] = [];
  for (
    let value = Math.floor(min / step) * step;
    value <= max + step * 0.999;
    value += step
  ) {
    ticks.push(Math.round(value * 1e6) / 1e6);
  }
  return ticks;
}

/** A single-series line chart drawn in real pixels, with a crosshair on hover. */
export function ValueChart({
  values,
  labels,
  format,
  formatTick = format,
  label,
  height = 220,
}: ValueChartProps) {
  const [containerRef, width] = useElementWidth();
  const [hover, setHover] = useState<number | null>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const areaRef = useRef<SVGPathElement>(null);
  const markerRef = useRef<SVGGElement>(null);
  const animated = useRef(false);
  const gradientId = `area-${useId().replace(/[^\w-]/g, "")}`;

  const ready = width > 0 && values.length > 1;

  useLayoutEffect(() => {
    if (!ready || animated.current) return;
    animated.current = true;
    const stopLine = drawPath(lineRef.current);
    const extras = [areaRef.current, markerRef.current].filter(
      (el): el is SVGPathElement | SVGGElement => el !== null,
    );
    const stopExtras = fadeIn(extras, 450);
    return () => {
      stopLine();
      stopExtras();
    };
  }, [ready]);

  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const low = ticks[0] ?? 0;
  const high = ticks[ticks.length - 1] ?? 1;
  const innerWidth = Math.max(width - PAD.left - PAD.right, 1);
  const innerHeight = height - PAD.top - PAD.bottom;
  const x = (index: number) =>
    PAD.left + (index / (values.length - 1)) * innerWidth;
  const y = (value: number) =>
    PAD.top + (1 - (value - low) / (high - low || 1)) * innerHeight;

  const line = values
    .map(
      (value, index) =>
        `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`,
    )
    .join(" ");
  const bottom = PAD.top + innerHeight;
  const area = `${line} L${x(values.length - 1).toFixed(1)} ${String(bottom)} L${x(0).toFixed(1)} ${String(bottom)} Z`;
  const last = values[values.length - 1] ?? 0;
  const hoverValue = hover === null ? undefined : values[hover];
  const xLabels = [0, Math.floor((values.length - 1) / 2), values.length - 1];

  const onPointerMove = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    setHover(
      Math.min(
        values.length - 1,
        Math.max(0, Math.round(ratio * (values.length - 1))),
      ),
    );
  };

  return (
    <div ref={containerRef} className="relative" style={{ height }}>
      {ready && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          className="block overflow-visible"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" className="kw-area-stop-top" />
              <stop offset="100%" className="kw-area-stop-bottom" />
            </linearGradient>
          </defs>

          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={PAD.left + innerWidth}
                y1={y(tick)}
                y2={y(tick)}
                className={tick === 0 ? "stroke-line-strong" : "stroke-line"}
                strokeWidth={1}
              />
              {/* The current-value pill sits on the axis; skip ticks it would cover. */}
              {Math.abs(y(tick) - y(last)) > 16 && (
                <text
                  x={PAD.left + innerWidth + 10}
                  y={y(tick)}
                  dy="0.32em"
                  className="fill-fg-muted text-[11px] tabular-nums"
                >
                  {formatTick(tick)}
                </text>
              )}
            </g>
          ))}

          {xLabels.map((index, position) => (
            <text
              key={index}
              x={x(index)}
              y={height - 6}
              textAnchor={
                position === 0 ? "start" : position === 1 ? "middle" : "end"
              }
              className="fill-fg-muted text-[11px]"
            >
              {labels[index]}
            </text>
          ))}

          <path ref={areaRef} d={area} fill={`url(#${gradientId})`} />
          <path
            ref={lineRef}
            d={line}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="stroke-accent"
          />

          <g ref={markerRef}>
            <circle
              cx={x(values.length - 1)}
              cy={y(last)}
              r={4}
              strokeWidth={2}
              className="fill-accent stroke-canvas"
            />
            <rect
              x={PAD.left + innerWidth + 4}
              y={y(last) - 10}
              width={PAD.right - 6}
              height={20}
              rx={6}
              className="fill-accent"
            />
            <text
              x={PAD.left + innerWidth + 4 + (PAD.right - 6) / 2}
              y={y(last)}
              dy="0.34em"
              textAnchor="middle"
              className="fill-on-accent text-[11px] font-medium tabular-nums"
            >
              {formatTick(last)}
            </text>
          </g>

          {hover !== null && hoverValue !== undefined && (
            <g aria-hidden="true">
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={bottom}
                className="stroke-line-strong"
                strokeWidth={1}
              />
              <circle
                cx={x(hover)}
                cy={y(hoverValue)}
                r={4.5}
                strokeWidth={2}
                className="fill-accent stroke-canvas"
              />
            </g>
          )}

          <rect
            x={PAD.left}
            y={PAD.top}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onPointerMove={onPointerMove}
            onPointerLeave={() => {
              setHover(null);
            }}
          />
        </svg>
      )}

      {ready && hover !== null && hoverValue !== undefined && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs shadow-raised"
          style={{
            left: Math.min(Math.max(x(hover), 60), width - 60),
            top: Math.max(y(hoverValue) - 52, 0),
            transform: "translateX(-50%)",
          }}
        >
          <div className="text-fg-muted">{labels[hover]}</div>
          <div className="font-medium tabular-nums">{format(hoverValue)}</div>
        </div>
      )}
    </div>
  );
}
