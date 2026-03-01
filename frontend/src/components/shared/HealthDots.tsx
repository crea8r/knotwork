/** ●●●○○ display for health score 0–5. */
interface HealthDotsProps {
  score: number | null
}

export default function HealthDots({ score }: HealthDotsProps) {
  if (score === null) return <span className="text-xs text-gray-400">—</span>

  const filled = Math.round(score)
  const color =
    score >= 4 ? 'text-green-500' :
    score >= 2.5 ? 'text-amber-500' : 'text-red-500'

  return (
    <span className={`inline-flex gap-0.5 ${color}`} title={`Health: ${score.toFixed(1)}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="text-sm leading-none">
          {i <= filled ? '●' : '○'}
        </span>
      ))}
    </span>
  )
}
