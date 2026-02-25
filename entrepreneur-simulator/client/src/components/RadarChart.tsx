interface RadarChartProps {
  data: {
    label: string;
    value: number; // 0-100
    maxValue: number;
  }[];
  size?: number;
  color?: string;
}

export default function RadarChart({ data, size = 300, color = "#4F46E5" }: RadarChartProps) {
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = (size / 2) - 40; // Padding
  const angleSlice = (Math.PI * 2) / data.length;

  // Helper to calculate coordinates
  const getCoordinates = (value: number, index: number, max: number) => {
    const angle = index * angleSlice - Math.PI / 2; // Start from top
    const r = (value / max) * radius;
    return {
      x: centerX + r * Math.cos(angle),
      y: centerY + r * Math.sin(angle),
    };
  };

  // Generate points for the data polygon
  const points = data.map((d, i) => {
    const { x, y } = getCoordinates(d.value, i, d.maxValue);
    return `${x},${y}`;
  }).join(" ");

  // Generate points for the background grid (e.g., 5 levels)
  const gridLevels = [0.2, 0.4, 0.6, 0.8, 1];
  
  return (
    <div className="relative flex justify-center items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background Grid */}
        {gridLevels.map((level, levelIndex) => {
          const levelPoints = data.map((d, i) => {
            const { x, y } = getCoordinates(d.maxValue * level, i, d.maxValue);
            return `${x},${y}`;
          }).join(" ");
          return (
            <polygon
              key={levelIndex}
              points={levelPoints}
              fill="none"
              stroke="#E5E7EB"
              strokeWidth="1"
            />
          );
        })}

        {/* Axes */}
        {data.map((d, i) => {
          const { x, y } = getCoordinates(d.maxValue, i, d.maxValue);
          return (
            <line
              key={i}
              x1={centerX}
              y1={centerY}
              x2={x}
              y2={y}
              stroke="#E5E7EB"
              strokeWidth="1"
            />
          );
        })}

        {/* Data Polygon */}
        <polygon
          points={points}
          fill={color}
          fillOpacity="0.2"
          stroke={color}
          strokeWidth="2"
        />

        {/* Data Points */}
        {data.map((d, i) => {
          const { x, y } = getCoordinates(d.value, i, d.maxValue);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r="4"
              fill={color}
            />
          );
        })}

        {/* Labels */}
        {data.map((d, i) => {
          const { x, y } = getCoordinates(d.maxValue * 1.15, i, d.maxValue);
          return (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="12"
              fill="#4B5563"
              fontWeight="500"
            >
              {d.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}