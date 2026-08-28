// Step-progress dots used by multi-step modal/card flows.
// The active dot is wider and colored; inactive dots are small and slate.
//
// Usage:
//   <StepDots step={0} total={3} color="bg-red-500" />
//   <StepDots step={step} total={2} className="mb-4" />
export default function StepDots({ step, total, color = 'bg-brand', className = 'mb-2' }) {
  return (
    <div className={`flex items-center justify-center gap-2 ${className}`}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`rounded-full transition-all ${
            i === step ? `w-5 h-2 ${color}` : 'w-2 h-2 bg-slate-200'
          }`}
        />
      ))}
    </div>
  )
}
